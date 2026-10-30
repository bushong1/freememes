import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionAt, frameAt, exportSchedule, stepMediaFrame } from '../src/engine.js';

test('frame stepping follows GIF frame delays and stays within partial trim boundaries', () => {
  const media={isAnimated:true,frames:[{delay:100},{delay:200},{delay:300}]};
  assert.equal(stepMediaFrame(media,50,1,[50,450]),100);
  assert.equal(stepMediaFrame(media,100,1,[50,450]),300);
  assert.equal(stepMediaFrame(media,300,-1,[50,450]),100);
  assert.equal(stepMediaFrame(media,100,-1,[50,450]),50);
  assert.equal(stepMediaFrame(media,400,1,[50,450]),449);
  assert.equal(stepMediaFrame(media,50,-1,[50,450]),50);
});

test('repeated frame advances reach the last kept instant without entering an excluded frame', () => {
  const media={isAnimated:true,frames:[{delay:100},{delay:200},{delay:300}]};
  for(const [start,end,lastFrame] of [[0,600,2],[50,450,2],[50,300,1]]){
    let time=start;
    for(let i=0;i<10;i++)time=stepMediaFrame(media,time,1,[start,end]);
    assert.equal(time,end-1);assert.equal(frameAt(media.frames,time),lastFrame);
  }
});

test('video frame stepping uses native cadence rather than GIF export sample times', () => {
  const media={isVideo:true,isAnimated:true,frameRate:25,frames:[{delay:100}]};
  assert.equal(stepMediaFrame(media,2000,1,[0,60000]),2040);
  assert.equal(stepMediaFrame(media,2040,-1,[0,60000]),2000);
  const fractional={...media,frameRate:30000/1001};
  let time=0;
  for(let i=0;i<100;i++)time=stepMediaFrame(fractional,time,1,[0,60000]);
  assert.ok(Math.abs(time-100*1000/fractional.frameRate)<1e-6);
  assert.equal(stepMediaFrame({...media,isVideo:false,isAnimated:false},100,1,[0,3000]),150);
});

test('keyframes interpolate positions and hold at the ends', () => {
  const object = { x: .5, y: .5, keyframes: [{ time: 100, x: .1, y: .2 }, { time: 500, x: .9, y: .6 }] };
  assert.deepEqual(positionAt(object, 0), object.keyframes[0]);
  assert.equal(positionAt(object, 300).x, .5);
  assert.ok(Math.abs(positionAt(object, 300).y - .4) < 1e-10);
  assert.deepEqual(positionAt(object, 900), object.keyframes[1]);
  assert.deepEqual(positionAt({ ...object, keyframes: [] }, 0), { x: .5, y: .5 });
});

test('smooth interpolation eases motion without changing endpoints', () => {
  const object = { easing: 'smooth', keyframes: [{ time: 0, x: 0, y: 0 }, { time: 1000, x: 1, y: 1 }] };
  assert.equal(positionAt(object, 250).x, .15625);
  assert.equal(positionAt(object, 500).x, .5);
  assert.equal(positionAt(object, 1000).x, 1);
});

test('GIF frame selection respects variable frame durations and boundaries', () => {
  const frames = [{ delay: 100 }, { delay: 200 }, { delay: 300 }];
  assert.equal(frameAt(frames, 0), 0);
  assert.equal(frameAt(frames, 100), 1);
  assert.equal(frameAt(frames, 299), 1);
  assert.equal(frameAt(frames, 300), 2);
  assert.equal(frameAt(frames, 600), 2);
});

test('trimming retains partial first and last frames', () => {
  const media = { frames: [{ delay: 100 }, { delay: 200 }, { delay: 300 }] };
  assert.deepEqual(exportSchedule(media, 50, 450, false), [
    { time: 50, delay: 50 }, { time: 100, delay: 200 }, { time: 300, delay: 150 },
  ]);
});

test('animation samples motion, preserves source boundaries and total duration', () => {
  const media = { frames: [{ delay: 70 }, { delay: 180 }, { delay: 350 }] };
  const schedule = exportSchedule(media, 20, 580, true);
  assert.equal(schedule.reduce((sum, f) => sum + f.delay, 0), 560);
  assert.ok(schedule.every(f => f.delay >= 20 && f.delay <= 60));
  assert.ok(schedule.some(f => f.time === 250));
});

test('GIF tick rounding never accumulates timing drift', () => {
  const media = { frames: Array.from({ length: 100 }, () => ({ delay: 33 })) };
  const schedule = exportSchedule(media, 3, 3298, true);
  assert.equal(schedule.reduce((sum, f) => sum + f.delay, 0), 3300);
  assert.ok(schedule.every(f => f.delay % 10 === 0 && f.delay >= 20));
});

test('custom FPS resamples the clip without changing its duration or introducing 10ms delays', () => {
  const media={frames:[{delay:3000}]};
  for(const fps of [1,5,12.5,15,24,25,29.97,30,50]){
    const frames=exportSchedule(media,120,1120,true,[{time:135,visible:false}],fps);
    assert.equal(frames.length,Math.round(fps));
    assert.equal(frames.reduce((sum,frame)=>sum+frame.delay,0),1000);
    assert.ok(frames.every(frame=>frame.delay>=20 && frame.delay%10===0));
    assert.ok(frames.every(frame=>frame.time>=120 && frame.time<1120));
  }
  assert.equal(exportSchedule(media,0,1000,false,[],100).length,50);
});

test('auto timing merges close source, motion, and visibility boundaries instead of slowing playback', () => {
  const media={frames:Array.from({length:30},()=>({delay:1000/30}))};
  const keys=[{time:110,visible:false},{time:120,visible:true},{time:991,visible:false}];
  const frames=exportSchedule(media,0,1000,true,keys);
  assert.ok(frames.every(frame=>frame.delay>=20));
  assert.equal(frames.reduce((sum,frame)=>sum+frame.delay,0),1000);
  // Simulate viewers that expand sub-20ms GIF frames to 100ms.
  assert.equal(frames.reduce((sum,frame)=>sum+(frame.delay<20 ? 100 : frame.delay),0),1000);
});

test('custom frame sampling avoids short tail frames and cumulative rounding drift', () => {
  const media={frames:[{delay:10000}]};
  for(const duration of [21,39,1010,1030,1040,3295,60001])for(const fps of [1,12.5,24,29.97,30,50]){
    const frames=exportSchedule(media,123,123+duration,true,[],fps);
    assert.equal(frames.reduce((sum,frame)=>sum+frame.delay,0),Math.max(20,Math.round(duration/10)*10));
    assert.ok(frames.every(frame=>frame.delay>=20 && frame.delay<=655350 && frame.delay%10===0));
  }
});

test('automatic video export uses native FPS up to the playable GIF limit', () => {
  const media={isVideo:true,frameRate:30,frames:[{delay:1000}]};
  assert.equal(exportSchedule(media,0,1000,false).length,30);
  assert.equal(exportSchedule({...media,frameRate:60},0,1000,false).length,50);
});

test('very long holds split within GIF delay field limits while preserving duration', () => {
  const media={frames:[{delay:655350},{delay:20}]};
  const frames=exportSchedule(media,0,655360,false);
  assert.equal(frames.reduce((sum,frame)=>sum+frame.delay,0),655360);
  assert.ok(frames.every(frame=>frame.delay>=20 && frame.delay<=655350));
});
