import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbackTime, previewSize, startPreviewPlayback } from '../src/preview.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function playback({media={frames:Array.from({length:10},()=>({delay:100}))},doc={trim:[0,1000],objects:[]},start=0,seek}={}) {
  let wall=0,id=0;
  const queue=new Map(),draws=[],published=[],errors=[],clock={current:start};
  const stop=startPreviewPlayback({media,getDoc:()=>doc,clock,draw:t=>draws.push(t),publish:t=>published.push(t),onError:e=>errors.push(e),
    requestFrame:callback=>{queue.set(++id,callback);return id;},cancelFrame:key=>queue.delete(key),now:()=>wall,...(seek?{seek}:{})});
  return {clock,draws,published,errors,stop,queue,step:at=>{wall=at;const [key,callback]=queue.entries().next().value;queue.delete(key);callback(at);}};
}

test('moving objects draw at animation cadence while editor time updates stay at 10 Hz', () => {
  const player=playback({doc:{trim:[0,3000],objects:[{keyframes:[{time:0,x:0,y:0},{time:3000,x:1,y:1}]}]}});
  for(let i=0;i<60;i++)player.step(i*1000/60);
  assert.equal(player.draws.length,60);
  assert.ok(player.published.length<=10);
  assert.ok(player.published.length>=9);
  assert.ok(Math.abs(player.clock.current-983.333333)<.001);
  player.stop();assert.equal(player.queue.size,0);
});

test('unchanged GIF frames do not repaint at the animation callback rate', () => {
  const player=playback();
  for(let i=0;i<60;i++)player.step(i*1000/60);
  assert.equal(player.draws.length,10);
  player.stop();
});

test('GIF playback catches up after a long stall and loops within the trim window', () => {
  assert.equal(playbackTime(1200,1750,[1000,2000]),1950);
  const player=playback({doc:{trim:[1000,2000],objects:[]},start:1200});
  player.step(0);player.step(1750);
  assert.equal(player.clock.current,1950);
  player.stop();
  const resumed=playback({doc:{trim:[1000,2000],objects:[]},start:player.clock.current});
  resumed.step(100);assert.equal(resumed.clock.current,1050);resumed.stop();
});

function videoFixture() {
  return {currentTime:0,readyState:2,seeking:false,ended:false,plays:0,pauses:0,cancelled:[],
    play:async function(){this.plays++;},pause(){this.pauses++;},
    requestVideoFrameCallback:()=>123,cancelVideoFrameCallback(id){this.cancelled.push(id);}};
}

test('native preview follows decoded video time even without compositor callbacks', async () => {
  const video=videoFixture(),player=playback({media:{video,frames:[{delay:60000}]},doc:{trim:[0,60000],objects:[]}});
  await flush();assert.equal(video.plays,1);
  for(let i=0;i<60;i++){video.currentTime=i/60;player.step(i*1000/60);}
  assert.ok(player.draws.length>=29,'video redraws even when requestVideoFrameCallback never fires');
  assert.ok(player.published.length<=10);
  video.currentTime=.9;player.step(8000);
  assert.equal(player.clock.current,900,'wall clock stalls must not move video overlays ahead of the decoded image');
  // A seek set by the UI immediately before effect cleanup must survive.
  player.clock.current=250;player.stop();assert.equal(player.clock.current,250);
  assert.equal(video.pauses,1);assert.deepEqual(video.cancelled,[123]);
});

test('native preview seeks and resumes at trim boundaries without drawing stale frames', async () => {
  const video=videoFixture(),seeks=[];
  video.currentTime=1;
  const player=playback({media:{video},doc:{trim:[1000,2000],objects:[]},start:1000,
    seek:async (v,t)=>{seeks.push(t);await flush();v.currentTime=t/1000;v.ended=false;}});
  await flush();player.step(0);assert.equal(player.draws.length,1);
  video.currentTime=2;video.ended=true;player.step(1000);
  assert.equal(player.draws.length,1);
  await flush();await flush();
  assert.deepEqual(seeks,[1000]);assert.equal(video.plays,2);
  player.step(1017);assert.equal(player.clock.current,1000);
  player.stop();
});

test('native playback failures reach the editor and cleanup cancels pending work', async () => {
  const video=videoFixture();video.play=async()=>{throw new Error('Decoder unavailable');};
  const player=playback({media:{video}});await flush();
  assert.match(player.errors[0].message,/Decoder unavailable/);player.stop();
  assert.equal(player.queue.size,0);
});

test('preview backing pixels are bounded independently of original export dimensions', () => {
  const crop={width:3840,height:2160};
  assert.deepEqual(previewSize(crop,960,2),{width:1280,height:720});
  assert.deepEqual(previewSize({width:2160,height:3840},960,2),{width:720,height:1280});
  assert.deepEqual(previewSize({width:474,height:843},960,2),{width:474,height:843});
  assert.deepEqual(crop,{width:3840,height:2160});
});
