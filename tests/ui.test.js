import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { build } from 'esbuild';
import { createCanvas, ImageData, GlobalFonts } from '@napi-rs/canvas';
import gifenc from 'gifenc';
import { mkdtemp, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { resolveObjectURL } from 'node:buffer';
import vm from 'node:vm';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const wait = ms => new Promise(resolve => setTimeout(resolve,ms));

test('editor retains toolkit tabs, accepts large GIFs, and supports formatting, resizing, animation, and export', async () => {
  const workerName=(await readdir('dist/assets')).find(name=>name.startsWith('gif.worker-')&&name.endsWith('.js'));
  const workerSource=await readFile(`dist/assets/${workerName}`,'utf8');
  class LocalGifWorker {
    constructor(){
      this.thread={postMessage:data=>queueMicrotask(()=>{if(!this.stopped)this.onmessage?.({data});})};
      vm.runInNewContext(workerSource,{self:this.thread,Uint8Array,Uint32Array,ArrayBuffer,Math,Map,Set,console});
    }
    postMessage(data){queueMicrotask(()=>{if(!this.stopped)this.thread.onmessage({data});});}
    terminate(){this.stopped=true;}
  }
  const window = new Window({ url:'http://freememes.local/' });
  const saved = new Map();
  const globals = { window,document:window.document,navigator:window.navigator,Element:window.Element,HTMLElement:window.HTMLElement,Node:window.Node,Event:window.Event,MouseEvent:window.MouseEvent,PointerEvent:window.PointerEvent,ImageData,Worker:LocalGifWorker,fetch:globalThis.fetch,requestAnimationFrame:window.requestAnimationFrame.bind(window),cancelAnimationFrame:window.cancelAnimationFrame.bind(window) };
  for (const [key,value] of Object.entries(globals)) { saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value}); }
  GlobalFonts.registerFromPath('public/fonts/anton.ttf','Anton');
  // Skip the starter-image network request; upload deterministic GIF fixtures.
  Object.defineProperty(window.document,'fonts',{value:{load:() => new Promise(() => {})}});
  window.document.body.innerHTML='<div id="root"></div>';
  const canvases = new WeakMap();
  const videoStates=new WeakMap(),videos=[];
  const videoState=element=>{
    if(!videoStates.has(element)){videoStates.set(element,{time:0,seeking:false,ready:0,paused:true});videos.push(element);}
    return videoStates.get(element);
  };
  const videoPixels=createCanvas(474,844);
  videoPixels.getContext('2d').fillStyle='#339955';videoPixels.getContext('2d').fillRect(0,0,474,844);
  for(const [key,get] of Object.entries({videoWidth:()=>474,videoHeight:()=>844,duration:()=>60,
    readyState:function(){return videoState(this).ready;},seeking:function(){return videoState(this).seeking;},
    paused:function(){return videoState(this).paused;}}))Object.defineProperty(window.HTMLVideoElement.prototype,key,{configurable:true,get});
  Object.defineProperty(window.HTMLVideoElement.prototype,'currentTime',{configurable:true,
    get(){return videoState(this).time;},set(value){const state=videoState(this);state.time=value;state.seeking=true;queueMicrotask(()=>{state.seeking=false;this.dispatchEvent(new window.Event('seeked'));});}});
  window.HTMLVideoElement.prototype.load=function(){const state=videoState(this);state.ready=this.getAttribute('src')?2:0;if(state.ready)queueMicrotask(()=>this.dispatchEvent(new window.Event('loadeddata')));};
  window.HTMLVideoElement.prototype.pause=function(){videoState(this).paused=true;};
  window.HTMLVideoElement.prototype.play=async function(){videoState(this).paused=false;};
  function nativeCanvas(element) {
    let c = canvases.get(element);
    if (!c || c.width !== element.width || c.height !== element.height) { c=createCanvas(element.width,element.height);canvases.set(element,c); }
    return c;
  }
  window.HTMLCanvasElement.prototype.getContext=function() {
    const ctx=nativeCanvas(this).getContext('2d');
    if (!ctx.unwrappedDrawImage) {
      ctx.unwrappedDrawImage=ctx.drawImage.bind(ctx);
      ctx.drawImage=(source,...args)=>ctx.unwrappedDrawImage(source instanceof window.HTMLCanvasElement ? nativeCanvas(source) : source instanceof window.HTMLVideoElement ? videoPixels : source,...args);
    }
    return ctx;
  };
  window.HTMLCanvasElement.prototype.toBlob=function(callback,type='image/png') {callback(new Blob([nativeCanvas(this).toBuffer(type)],{type}));};
  window.HTMLElement.prototype.setPointerCapture=function(id){this.capturedPointer=id;};
  window.HTMLElement.prototype.hasPointerCapture=function(id){return this.capturedPointer===id;};
  window.HTMLElement.prototype.releasePointerCapture=function(id){if(this.capturedPointer===id)delete this.capturedPointer;};
  window.HTMLElement.prototype.getBoundingClientRect=() => ({left:0,top:0,width:1000,height:700,right:1000,bottom:700,x:0,y:0});
  const query=selector=>window.document.querySelector(selector);
  const all=selector=>[...window.document.querySelectorAll(selector)];
  const byLabel=label=>all('[aria-label]').find(e=>e.getAttribute('aria-label')===label);
  const button=text=>all('button').find(e=>e.textContent.trim()===text) || all('button').find(e=>e.textContent.trim().startsWith(text));
  async function click(element) { assert.ok(element,'Expected an interactive element');element.dispatchEvent(new window.MouseEvent('click',{bubbles:true,detail:0}));await wait(25); }
  async function input(element,value) {
    assert.ok(element,'Expected an input');
    const prototype=element.tagName==='SELECT' ? window.HTMLSelectElement.prototype : element.tagName==='TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,String(value));
    element.dispatchEvent(new window.Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));
    await wait(30);
  }
  async function pointer(element,type,x=500,y=300) {
    element.dispatchEvent(new window.PointerEvent(type,{bubbles:true,button:0,buttons:type==='pointerup'?0:1,pointerId:1,clientX:x,clientY:y}));await wait(25);
  }
  function gifFile(frameCount,size) {
    const encoder=gifenc.GIFEncoder();
    for(let i=0;i<frameCount;i++) encoder.writeFrame(new Uint8Array(160*100).fill(i%2),160,100,{palette:[[30,100,180],[100,180,30]],delay:1000,repeat:0});
    encoder.finish();
    const file=new File([encoder.bytes()],'fixture.gif',{type:'image/gif'});
    if(size!==undefined)Object.defineProperty(file,'size',{value:size});
    return file;
  }
  async function upload(frameCount,size) {
    const element=query('input[type=file]');
    Object.defineProperty(element,'files',{configurable:true,value:[gifFile(frameCount,size)]});
    element.dispatchEvent(new window.Event('change',{bubbles:true}));await wait(60);
  }
  let editorRoot;
  const bundleDir=await mkdtemp(path.join(tmpdir(),'freememes-ui-'));
  try {
    const result=await build({entryPoints:['src/main.jsx'],bundle:true,format:'esm',platform:'browser',write:false,jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"development"'}});
    const bundlePath=path.join(bundleDir,'editor.mjs');await writeFile(bundlePath,result.outputFiles[0].text);
    ({ editorRoot } = await import(pathToFileURL(bundlePath).href));
    await wait(80);
    assert.match(query('.brand').textContent,/FreeMemes/);
    assert.equal(all('.tool-button').length,2);
    assert.deepEqual(all('.inspector-tabs>button').map(e=>e.textContent),['Object','Canvas','Animation']);
    assert.equal(byLabel('Export width').value,'original');
    assert.equal(all('.trim-handle').length,0);
    await click(button('Canvas'));
    assert.ok(byLabel('Crop width'));assert.equal(Boolean(byLabel('Trim start seconds')),false);
    await click(button('Object'));
    assert.equal(query('textarea').value,'');
    await input(query('textarea'),'JUST ONE MORE\nLITTLE CHANGE');
    await click(all('.layer-select')[0]);assert.equal(query('textarea').value,'');
    await input(query('textarea'),'3 HOURS LATER');await click(all('.layer-select')[1]);

    assert.equal(+byLabel('Max font size').value,1000);
    await input(byLabel('Font size'),20);
    const before=+byLabel('Font size').value;
    await pointer(byLabel('Increase font size'),'pointerdown');await wait(430);
    await pointer(byLabel('Increase font size'),'pointerup');
    const held=+byLabel('Font size').value;assert.ok(held>=before+6);
    await wait(150);assert.equal(+byLabel('Font size').value,held);
    await click(byLabel('Undo (⌘Z)'));assert.equal(+byLabel('Font size').value,before);
    await pointer(byLabel('Decrease font size'),'pointerdown');await wait(370);
    window.dispatchEvent(new window.Event('blur'));await wait(25);
    const blurred=+byLabel('Font size').value;await wait(150);assert.equal(+byLabel('Font size').value,blurred);
    await click(byLabel('Align bottom'));
    await click(button('Apply formatting to all text boxes'));
    await click(query('.layer-select'));
    assert.equal(query('textarea').value,'3 HOURS LATER');
    assert.equal(byLabel('Align bottom').classList.contains('active'),true);
    assert.equal(+byLabel('Font size').value,blurred);

    await upload(3,200*1024*1024);
    assert.ok(button('GIF'));assert.equal(byLabel('Export width').value,'original');
    assert.equal(byLabel('GIF FPS').value,'');
    await input(byLabel('GIF FPS'),100);assert.equal(+byLabel('GIF FPS').value,50);
    await input(byLabel('GIF FPS'),12.5);assert.equal(+byLabel('GIF FPS').value,12.5);
    await input(byLabel('GIF FPS'),'');assert.equal(byLabel('GIF FPS').value,'');
    for(const [index,caption] of [[0,'3 HOURS LATER'],[1,'JUST ONE MORE\nLITTLE CHANGE']]){
      await click(all('.layer-select')[index]);assert.equal(query('textarea').value,'');
      await input(query('textarea'),caption);await input(byLabel('Font size'),blurred);
    }
    await click(all('.layer-select')[0]);
    for(const tab of ['Canvas','GIF','Animation']){
      await click(button(tab));
      for(const index of [1,0]){
        await click(all('.layer-select')[index]);
        assert.equal(query('.inspector-tabs>button.active').textContent,tab);
        assert.ok(all('.layer-select')[index].closest('.layer-row').classList.contains('selected'));
      }
      await pointer(query('.canvas-surface'),'pointerdown',500,112);await pointer(query('.canvas-surface'),'pointerup',500,112);
      assert.match(query('.layer-row.selected').textContent,/JUST ONE MORE/);
      assert.equal(query('.inspector-tabs>button.active').textContent,tab);
      await pointer(query('.canvas-surface'),'pointerdown',500,616);await pointer(query('.canvas-surface'),'pointerup',500,616);
      assert.match(query('.layer-row.selected').textContent,/3 HOURS LATER/);
      assert.equal(query('.inspector-tabs>button.active').textContent,tab);
    }
    const layerCount=all('.layer-select').length;
    await click(byLabel('Add text layer'));
    assert.equal(query('.inspector-tabs>button.active').textContent,'Animation');
    assert.equal(all('.layer-select').length,layerCount+1);
    await click(button('Object'));
    assert.equal(query('textarea').value,'');
    await click(byLabel('Delete layer'));await click(all('.layer-select')[0]);
    await pointer(byLabel('Rotate object'),'pointerdown',500,500);
    await pointer(query('.canvas-surface'),'pointermove',700,616);await pointer(query('.canvas-surface'),'pointerup',700,616);
    assert.equal(+byLabel('Rotation degrees').value,90);assert.equal(query('.selection-box').style.transform,'rotate(90deg)');
    await click(byLabel('Undo (⌘Z)'));assert.equal(+byLabel('Rotation degrees').value,0);
    await click(byLabel('Redo (⌘⇧Z)'));assert.equal(+byLabel('Rotation degrees').value,90);
    await input(byLabel('Rotation degrees'),-30);assert.equal(query('.selection-box').style.transform,'rotate(-30deg)');
    await input(byLabel('Rotation degrees'),0);
    await click(button('Canvas'));await input(byLabel('Space above image'),10);await input(byLabel('Space below image'),20);
    assert.match(query('.canvas-dimensions').textContent,/160.*130/);assert.match(query('.export-size-summary').textContent,/160 × 130/);
    await click(byLabel('Undo (⌘Z)'));assert.equal(+byLabel('Space below image').value,0);
    await click(byLabel('Redo (⌘⇧Z)'));assert.equal(+byLabel('Space below image').value,20);
    await input(byLabel('Above space color'),'#ff0000');await input(byLabel('Below space color'),'#0000ff');
    const previewCanvas=query('.canvas-surface>canvas'),previewPixels=previewCanvas.getContext('2d');
    assert.deepEqual([...previewPixels.getImageData(0,0,1,1).data],[255,0,0,255]);
    assert.deepEqual([...previewPixels.getImageData(0,previewCanvas.height-1,1,1).data],[0,0,255,255]);
    await click(button('Start crop'));
    assert.ok(Math.abs(parseFloat(query('.crop-preview').style.top)-10/130*100)<.01);
    assert.ok(Math.abs(parseFloat(query('.crop-preview').style.height)-100/130*100)<.01);
    await click(button('Cancel crop'));
    await input(byLabel('Space above image'),0);await input(byLabel('Space below image'),0);await click(button('Object'));
    await click(byLabel('Play preview'));await wait(180);
    assert.equal(Boolean(query('.selection-box')),false);
    await click(byLabel('Pause preview'));
    const pausedTime=query('.time-display').textContent;await wait(150);
    assert.equal(query('.time-display').textContent,pausedTime);
    assert.ok(query('.selection-box'));
    assert.equal(all('.gif-scale-suggestions>button').length,3);
    const canvasSize=query('.canvas-dimensions').textContent;
    await click(byLabel('Export at 50% size'));
    assert.equal(byLabel('Export width').value,'80');
    assert.equal(query('.canvas-dimensions').textContent,canvasSize);
    assert.match(query('.export-size-summary').textContent,/80 × 50 px/);
    assert.match(query('.export-advice-note:last-child').textContent,/Rough size estimate/);
    await input(byLabel('Export width'),'original');
    assert.equal(byLabel('Export width').value,'original');
    const originalSize=+byLabel('Font size').value;
    const width=query('.selection-box').style.width,height=query('.selection-box').style.height;
    await pointer(query('.selection-handle.r'),'pointerdown');await pointer(query('.canvas-surface'),'pointermove',560,300);await pointer(query('.canvas-surface'),'pointerup',560,300);
    assert.ok(parseFloat(query('.selection-box').style.width)>parseFloat(width));
    assert.equal(query('.selection-box').style.height,height);assert.ok(+byLabel('Font size').value>originalSize);
    const wider=query('.selection-box').style.width;
    await pointer(query('.selection-handle.b'),'pointerdown');await pointer(query('.canvas-surface'),'pointermove',500,340);await pointer(query('.canvas-surface'),'pointerup',500,340);
    assert.equal(query('.selection-box').style.width,wider);assert.ok(parseFloat(query('.selection-box').style.height)>parseFloat(height));
    const resizedHeight=query('.selection-box').style.height;
    await input(byLabel('Max font size'),40);
    assert.ok(+byLabel('Font size').value<=40);
    assert.equal(query('.selection-box').style.width,wider);assert.equal(query('.selection-box').style.height,resizedHeight);
    await click(byLabel('Undo (⌘Z)'));assert.equal(+byLabel('Max font size').value,1000);
    await click(byLabel('Redo (⌘⇧Z)'));assert.equal(+byLabel('Max font size').value,40);
    await input(byLabel('Width'),10);
    const narrowSize=+byLabel('Font size').value;assert.ok(narrowSize<40);
    await input(byLabel('Height'),2);assert.ok(+byLabel('Font size').value<narrowSize);
    await input(byLabel('Max font size'),18);await input(byLabel('Width'),92);await input(byLabel('Height'),22);
    assert.equal(+byLabel('Font size').value,18);
    await click(byLabel('Increase font size'));assert.equal(+byLabel('Font size').value,18);
    await click(button('Apply formatting to all text boxes'));await click(all('.layer-select')[1]);
    assert.equal(+byLabel('Max font size').value,18);
    assert.ok(+byLabel('Font size').value<=18);

    await click(button('Animation'));
    assert.equal(all('.inspector .thumbnail-row canvas').length,10);assert.equal(all('.trim-handle').length,0);
    assert.equal(button('Copy keyframes').disabled,true);assert.equal(button('Paste keyframes').disabled,true);
    const timelineButton=label=>query(`.inspector .timeline [aria-label="${label}"]`);
    await input(byLabel('Animation time seconds'),0);
    await click(timelineButton('Next frame'));assert.equal(+byLabel('Animation time seconds').value,1);
    await click(timelineButton('Next frame'));assert.equal(+byLabel('Animation time seconds').value,2);
    await click(timelineButton('Previous frame'));assert.equal(+byLabel('Animation time seconds').value,1);
    await click(byLabel('Play animation'));await click(timelineButton('Next frame'));
    assert.ok(byLabel('Play animation'));assert.equal(+byLabel('Animation time seconds').value,2);
    await pointer(byLabel('Timeline playhead'),'pointerdown',500,0);await pointer(byLabel('Timeline playhead'),'pointerup',500,0);
    assert.equal(+byLabel('Animation time seconds').value,1.5);
    byLabel('Timeline playhead').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Home',bubbles:true}));await wait(25);
    assert.equal(+byLabel('Animation time seconds').value,0);
    byLabel('Timeline playhead').dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await wait(25);
    assert.equal(+byLabel('Animation time seconds').value,1);
    await input(byLabel('Animation time seconds'),0);
    await input(byLabel('Keyframe action'),'hide');await click(button('Add keyframe'));
    assert.equal(Boolean(query('.selection-box')),false);
    await input(byLabel('Animation time seconds'),1);
    assert.equal(+byLabel('Animation time seconds').value,1);
    await input(byLabel('Keyframe action'),'show');await click(button('Add keyframe'));
    assert.ok(query('.selection-box'));assert.equal(all('.keyframe-row').length,2);
    await input(byLabel('Interpolation'),'smooth');await click(button('Copy keyframes'));
    await click(all('.layer-select')[0]);
    assert.equal(query('.inspector-tabs>button.active').textContent,'Animation');assert.equal(all('.keyframe-row').length,0);
    assert.equal(button('Paste keyframes').disabled,false);await click(button('Paste keyframes'));
    assert.equal(all('.keyframe-row').length,2);assert.equal(byLabel('Interpolation').value,'smooth');
    await click(byLabel('Undo (⌘Z)'));assert.equal(all('.keyframe-row').length,0);assert.equal(byLabel('Interpolation').value,'linear');
    await click(byLabel('Redo (⌘⇧Z)'));assert.equal(all('.keyframe-row').length,2);
    await input(byLabel('Keyframe visibility at 0.00s'),'show');
    await click(all('.layer-select')[1]);assert.equal(byLabel('Keyframe visibility at 0.00s').value,'hide');
    byLabel('Timeline playhead').dispatchEvent(new window.KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true}));await wait(25);
    await click(all('.layer-select')[0]);
    // Pasting while typing a time remains a normal text-input operation.
    byLabel('Animation time seconds').dispatchEvent(new window.KeyboardEvent('keydown',{key:'v',ctrlKey:true,bubbles:true}));await wait(25);
    assert.equal(byLabel('Keyframe visibility at 0.00s').value,'show');
    byLabel('Timeline playhead').dispatchEvent(new window.KeyboardEvent('keydown',{key:'v',ctrlKey:true,bubbles:true}));await wait(25);
    assert.equal(byLabel('Keyframe visibility at 0.00s').value,'hide');
    await input(byLabel('GIF FPS'),25);await click(button('Generate'));await wait(60);
    assert.ok(query('.result-modal'));assert.match(query('.result-meta').textContent,/25 FPS · 3.00s/);
    const encoded=resolveObjectURL(query('.result-actions a[download]').href);
    const exportedFrames=decompressFrames(parseGIF(await encoded.arrayBuffer()),true);
    assert.equal(exportedFrames.length,75);assert.equal(exportedFrames.reduce((sum,frame)=>sum+frame.delay,0),3000);
    assert.ok(exportedFrames.every(frame=>frame.delay===40));
    await click(byLabel('Close dialog'));await input(byLabel('GIF FPS'),'');
    await click(all('.layer-select')[1]);
    await click(button('GIF'));
    assert.equal(all('.trim-handle').length,2);assert.ok(byLabel('Trim start seconds'));assert.ok(query('.inspector .filmstrip'));
    await input(byLabel('Trim start seconds'),.25);await input(byLabel('Trim end seconds'),2.75);
    const strip=byLabel('Timeline playhead'),track=query('.inspector .thumbnail-row');
    // The real filmstrip has a border; timeline coordinates use its inner row.
    strip.getBoundingClientRect=()=>({left:100,top:0,width:202,height:46,right:302,bottom:46});
    track.getBoundingClientRect=()=>({left:101,top:1,width:200,height:44,right:301,bottom:45});
    const endHandle=query('.trim-handle-1'),startHandle=query('.trim-handle-0');
    await pointer(endHandle,'pointerdown',288,0);
    assert.equal(+byLabel('Trim end seconds').value,2.75,'grabbing the handle must not move its cutoff');
    await pointer(endHandle,'pointermove',298,0);await pointer(endHandle,'pointerup',298,0);
    assert.equal(+byLabel('Trim end seconds').value,2.9);
    assert.equal(endHandle.hasPointerCapture(1),false);
    await pointer(endHandle,'pointermove',200,0);assert.equal(+byLabel('Trim end seconds').value,2.9);
    await pointer(startHandle,'pointerdown',113,0);assert.equal(+byLabel('Trim start seconds').value,.25);
    await pointer(startHandle,'pointermove',103,0);await pointer(startHandle,'pointerup',103,0);
    assert.equal(+byLabel('Trim start seconds').value,.1);
    strip.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Home',bubbles:true}));await wait(25);
    for(let i=0;i<4;i++)await click(timelineButton('Next frame'));
    assert.equal(+strip.getAttribute('aria-valuenow'),2899);
    const cutoff=parseFloat(query('.trim-boundary-1').style.left),playhead=parseFloat(query('.inspector .playhead').style.left);
    assert.equal(query('.trim-handle-1').style.left,query('.trim-boundary-1').style.left);
    assert.ok(cutoff-playhead>0 && cutoff-playhead<.04,'playhead must reach immediately before the end boundary');
    await pointer(strip,'pointerdown',101+200*2899/3000,0);await pointer(strip,'pointerup',101+200*2899/3000,0);
    assert.equal(+strip.getAttribute('aria-valuenow'),2899,'scrubbing and frame stepping must reach the same endpoint');
    await click(button('Animation'));
    assert.deepEqual(all('.inspector .timeline-ruler>span').map(element=>element.textContent),['0.00s','0.70s','1.40s','2.10s','2.80s']);
    assert.equal(+byLabel('Animation time seconds').max,2.8);
    assert.equal(all('.inspector .trim-shade').length,0);
    assert.equal(all('.inspector .timeline-keyframe').length,1);
    const visibleKey=query('.inspector .timeline-keyframe');
    assert.equal(visibleKey.title,'Show keyframe 0.90s');
    assert.ok(Math.abs(parseFloat(visibleKey.style.left)-900/2800*100)<.001);
    assert.equal(all('.keyframe-row').length,1);assert.ok(byLabel('Keyframe visibility at 0.90s'));
    await pointer(byLabel('Timeline playhead'),'pointerdown',500,0);await pointer(byLabel('Timeline playhead'),'pointerup',500,0);
    assert.equal(+byLabel('Animation time seconds').value,1.4);
    assert.equal(query('.inspector .playhead').style.left,'50%');
    byLabel('Timeline playhead').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Home',bubbles:true}));await wait(25);
    assert.equal(+byLabel('Animation time seconds').value,0);
    assert.equal(query('.inspector .playhead').style.left,'0%');
    byLabel('Timeline playhead').dispatchEvent(new window.KeyboardEvent('keydown',{key:'End',bubbles:true}));await wait(25);
    assert.equal(+byLabel('Timeline playhead').getAttribute('aria-valuenow'),2799);
    await pointer(visibleKey,'pointerdown');
    assert.equal(+byLabel('Animation time seconds').value,.9);
    await input(byLabel('Animation time seconds'),0);await click(timelineButton('Next frame'));
    assert.equal(+byLabel('Animation time seconds').value,.9);
    await input(byLabel('Animation time seconds'),.7);await input(byLabel('Keyframe action'),'move');await click(button('Add keyframe'));
    const addedKey=all('.inspector .timeline-keyframe').find(element=>element.title==='Position keyframe 0.70s');
    assert.ok(addedKey);assert.equal(addedKey.style.left,'25%');
    await click(byLabel('Undo (⌘Z)'));assert.equal(all('.keyframe-row').length,1);
    await click(button('GIF'));
    assert.equal(+byLabel('Trim start seconds').value,.1);assert.equal(+byLabel('Trim end seconds').value,2.9);
    await input(byLabel('Trim start seconds'),1);await input(byLabel('Trim end seconds'),2);await click(button('Animation'));
    assert.deepEqual(all('.inspector .timeline-ruler>span').map(element=>element.textContent),['0.00s','0.25s','0.50s','0.75s','1.00s']);
    assert.match(query('.inspector .timeline-bottom').textContent,/Frame 1 \/ 1/);
    for(const thumbnail of all('.inspector .thumbnail-row canvas'))assert.deepEqual([...thumbnail.getContext('2d').getImageData(50,24,1,1).data],[100,180,30,255]);
    assert.equal(query('.inspector .timeline-keyframe').style.left,'0%');
    await click(button('GIF'));
    await input(byLabel('Trim start seconds'),0);await input(byLabel('Trim end seconds'),3);
    byLabel('Timeline playhead').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Home',bubbles:true}));await wait(25);
    await click(button('Animation'));
    assert.equal(all('.keyframe-row').length,2);assert.ok(byLabel('Keyframe visibility at 0.00s'));assert.ok(byLabel('Keyframe visibility at 1.00s'));
    await click(button('Canvas'));
    assert.equal(all('.trim-handle').length,0);assert.equal(Boolean(byLabel('Trim start seconds')),false);assert.ok(byLabel('Crop width'));
    await click(button('1:1'));await click(button('Apply crop'));
    assert.match(byLabel('Export width').selectedOptions[0].textContent,/Original · 100px/);
    await click(button('GIF'));await upload(1);
    assert.equal(Boolean(button('GIF')),false);assert.equal(all('.trim-handle').length,0);assert.equal(Boolean(byLabel('Trim end seconds')),false);
    assert.equal(query('textarea').value,'');
    await input(byLabel('Export format'),'gif');assert.equal(byLabel('GIF FPS').value,'');await input(byLabel('Export format'),'png');
    await input(query('textarea'),'Retain this if import fails');

    await click(button('New image'));await click(button('Upload'));
    assert.match(query('.source-privacy').textContent,/GIF uploads and YouTube animations up to 200 MB/);
    const dialogUpload=byLabel('Upload new image');
    Object.defineProperty(dialogUpload,'files',{configurable:true,value:[gifFile(2,200*1024*1024+1)]});
    dialogUpload.dispatchEvent(new window.Event('change',{bubbles:true}));await wait(60);
    assert.match(query('.import-error').textContent,/GIF files.*200 MB/);
    assert.equal(query('textarea').value,'Retain this if import fails');
    Object.defineProperty(dialogUpload,'files',{configurable:true,value:[gifFile(2,200*1024*1024)]});
    dialogUpload.dispatchEvent(new window.Event('change',{bubbles:true}));await wait(80);
    assert.equal(Boolean(query('.new-image-modal')),false);assert.equal(query('.file-kind').textContent,'GIF');
    assert.equal(query('textarea').value,'');
    await input(query('textarea'),'Clear this on YouTube import');
    await click(button('New image'));await click(button('From URL'));
    await input(query('#source-url'),'https://youtu.be/AbCdEfGh_-0?t=2m');
    assert.match(query('.source-detection').textContent,/120s–180s/);
    let submitted;
    globalThis.fetch=async (url,options) => {
      assert.equal(url,'/api/import');submitted=JSON.parse(options.body).url;
      return new Response(Buffer.from('\0\0\0\x18ftypisom'),{headers:{'Content-Type':'video/mp4','X-Media-Name':'clip.mp4','X-Media-Source':'youtube','X-Media-Width':'474','X-Media-Height':'843','X-Media-Duration':'60','X-Media-Frame-Rate':'25'}});
    };
    await click(button('Import YouTube video'));await wait(80);
    assert.equal(submitted,'https://www.youtube.com/watch?v=AbCdEfGh_-0&t=120');
    assert.equal(Boolean(query('.new-image-modal')),false);assert.equal(query('.file-kind').textContent,'YOUTUBE');
    assert.equal(query('textarea').value,'');
    assert.equal(videos.length,1);assert.match(query('.canvas-dimensions').textContent,/474.*843/);
    assert.equal(byLabel('Export width').value,'original');
    await click(byLabel('Play preview'));
    videos[0].currentTime=1.25;await wait(140);
    assert.match(query('.time-display').textContent,/1.25s/);assert.equal(videos[0].paused,false);
    await click(byLabel('Pause preview'));
    assert.equal(videos[0].paused,true);
    await click(button('GIF'));assert.equal(all('.trim-handle').length,2);
    await click(button('Animation'));await input(byLabel('Animation time seconds'),2);
    assert.equal(button('Paste keyframes').disabled,true);
    await click(timelineButton('Next frame'));assert.equal(videos[0].currentTime,2.04);
    await click(timelineButton('Previous frame'));assert.equal(videos[0].currentTime,2);
    await input(byLabel('Animation time seconds'),2.5);
    assert.equal(videos[0].currentTime,2.5);
    await wait(120);assert.match(query('.time-display').textContent,/2.50s/);
    await click(button('Canvas'));await input(byLabel('Space above image'),10);await input(byLabel('Space below image'),20);
    await input(byLabel('Export format'),'png');await click(button('Generate'));await wait(60);
    assert.ok(query('.result-modal'));assert.match(query('.result-meta').textContent,/474 × 873 · PNG/);
    assert.equal(videos.length,2);assert.equal(videos[0].currentTime,2.5);
    assert.equal(videos[1].currentTime,2.5);assert.equal(videos[1].getAttribute('src'),null);
  } finally {
    editorRoot?.unmount();await wait(30);
    await window.happyDOM.abort();window.close();
    await rm(bundleDir,{recursive:true,force:true});
    for (const [key,descriptor] of saved) { if (descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]; }
  }
});
