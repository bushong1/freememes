import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMedia, exportSchedule } from '../src/engine.js';
import { createExportSource, prepareMediaFrame, seekVideoFrame } from '../src/video-media.js';

class FakeVideo extends EventTarget {
  videoWidth=474;videoHeight=844;duration=60;readyState=0;seeking=false;position=0;pauses=0;
  load(){if(this.src)queueMicrotask(()=>{this.readyState=2;this.dispatchEvent(new Event('loadeddata'));});else this.readyState=0;}
  pause(){this.pauses++;}
  removeAttribute(name){if(name==='src')delete this.src;}
  get currentTime(){return this.position;}
  set currentTime(value){this.position=value;this.seeking=true;queueMicrotask(()=>{this.seeking=false;this.dispatchEvent(new Event('seeked'));});}
}

test('large YouTube clips decode on demand with tiny thumbnails and independent export seeking', async t => {
  const saved=globalThis.document,videos=[],canvases=[],revoked=[];
  t.after(()=>{globalThis.document=saved;});
  t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
  globalThis.document={createElement:type=>{
    if(type==='video'){const video=new FakeVideo();videos.push(video);return video;}
    const image={width:0,height:0,getContext:()=>({drawImage:(...args)=>{image.drawn=args;}})};canvases.push(image);return image;
  }};
  const file=new File([Buffer.from('\0\0\0\x18ftypisom')],'portrait.mp4',{type:'video/mp4'});
  Object.defineProperty(file,'size',{value:190*1024*1024});
  Object.defineProperty(file,'arrayBuffer',{value:()=>{throw new Error('Do not copy the entire compressed video into JS memory');}});
  const media=await loadMedia(file,{sourceType:'youtube',videoSize:{width:474,height:843,duration:60,frameRate:25}});
  assert.equal(media.width,474);assert.equal(media.height,843);assert.equal(media.duration,60000);
  assert.equal(media.isAnimated,true);assert.equal(media.isVideo,true);assert.equal(media.isGif,false);
  assert.equal(media.frameRate,25);
  assert.equal(media.frames.length,600);assert.equal(media.frames.reduce((sum,f)=>sum+f.delay,0),60000);
  assert.ok(media.frames.every(frame=>!frame.image),'export sample schedule must not allocate full decoded images');
  assert.equal(canvases.length,10);assert.equal(media.thumbnails.length,10);
  assert.ok(canvases.every(c=>c.width<=96&&c.height<=64));
  assert.deepEqual(canvases[0].drawn.slice(1,5),[0,0,474,843],'padding must be excluded from the visible image');
  assert.equal(media.video.currentTime,0);
  assert.equal(media.video.muted,true);assert.equal(media.video.playsInline,true);
  const schedule=exportSchedule(media,1200,1500,false);
  assert.deepEqual(schedule.map(frame=>frame.time),[1200,1240,1280,1320,1360,1400,1440,1480]);
  assert.equal(schedule.reduce((sum,frame)=>sum+frame.delay,0),300);
  assert.ok(schedule.every(frame=>frame.delay>=20));
  await prepareMediaFrame(media,12345);
  const source=await createExportSource(media);
  assert.notEqual(source.media.video,media.video);
  for(const frame of schedule)await prepareMediaFrame(source.media,frame.time);
  assert.equal(source.media.video.currentTime,1.48);assert.equal(media.video.currentTime,12.345);
  source.dispose();assert.equal(videos[1].src,undefined);assert.equal(revoked.length,0);
  media.dispose();assert.deepEqual(revoked,[media.url]);assert.equal(videos[0].src,undefined);
});

test('video seeking clamps to a decodable final frame and waits for seek completion', async () => {
  const video=new FakeVideo();video.readyState=2;
  await seekVideoFrame(video,90000);assert.equal(video.currentTime,59.999);assert.equal(video.seeking,false);
  await seekVideoFrame(video,-100);assert.equal(video.currentTime,0);
  await seekVideoFrame(video,0);assert.equal(video.currentTime,0);
});

test('video payloads remain restricted to the YouTube importer', async () => {
  const file=new File([Buffer.from('\0\0\0\x18ftypisom')],'video.png',{type:'image/png'});
  await assert.rejects(()=>loadMedia(file),/not a supported image/);
});
