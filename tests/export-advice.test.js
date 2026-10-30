import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDownscaleSuggestions, estimateGifBytes } from '../src/export-advice.js';

test('portrait downscaling suggestions preserve aspect and quantify fewer pixels', () => {
  const crop={width:474,height:843};
  const sizes=getDownscaleSuggestions(crop);
  assert.deepEqual(sizes.map(s=>[s.width,s.height]),[[356,633],[237,422],[119,212]]);
  assert.deepEqual(sizes.map(s=>s.pixelReduction),[44,75,94]);
  assert.deepEqual(crop,{width:474,height:843});
});

test('landscape suggestions do not upscale or generate unusably small options', () => {
  assert.deepEqual(getDownscaleSuggestions({width:800,height:400}).map(s=>[s.width,s.height]),[[600,300],[400,200],[200,100]]);
  assert.deepEqual(getDownscaleSuggestions({width:16,height:16}),[]);
});

test('rough GIF estimates respond to export size, crop, and retained frames', () => {
  const media={format:'gif',byteSize:8*1024*1024,width:800,height:400,frames:Array.from({length:20},()=>({delay:100}))};
  const doc={crop:{width:800,height:400},trim:[0,2000],objects:[]};
  assert.equal(estimateGifBytes(media,doc,'original'),8*1024*1024);
  assert.equal(estimateGifBytes(media,doc,400),2*1024*1024);
  assert.equal(estimateGifBytes(media,{...doc,trim:[0,1000]},400),1024*1024);
  assert.equal(estimateGifBytes(media,{...doc,crop:{width:400,height:400}},'original'),4*1024*1024);
  assert.equal(estimateGifBytes({...media,format:'webp'},doc,400),null);
});

test('estimates account for added motion frames rather than promising source size', () => {
  const media={format:'gif',byteSize:1024*1024,width:800,height:400,frames:[{delay:2000}]};
  const doc={crop:{width:800,height:400},trim:[0,2000],objects:[{keyframes:[{time:0,x:0,y:0},{time:2000,x:1,y:1}]}]};
  assert.ok(estimateGifBytes(media,doc,400)>1024*1024);
});

test('GIF size advice includes added canvas space', () => {
  const media={format:'gif',byteSize:1024*1024,width:800,height:400,frames:[{delay:1000}]};
  const doc={crop:{width:800,height:400},padding:{top:100,bottom:100},trim:[0,1000],objects:[]};
  assert.equal(estimateGifBytes(media,doc,'original'),1.5*1024*1024);
});

test('GIF size estimates account for configured export FPS', () => {
  const media={format:'gif',byteSize:1024*1024,width:100,height:100,frames:Array.from({length:10},()=>({delay:100}))};
  const doc={crop:{width:100,height:100},trim:[0,1000],objects:[]};
  assert.equal(estimateGifBytes(media,doc,'original',5),512*1024);
  assert.equal(estimateGifBytes(media,doc,'original',30),3*1024*1024);
});
