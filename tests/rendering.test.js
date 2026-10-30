import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createCanvas, Image, ImageData, GlobalFonts, loadImage } from '@napi-rs/canvas';
import gifenc from 'gifenc';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { loadMedia, renderScene, exportSchedule, objectBounds, resizeObject, textLayout, updateObjectProperties, canvasSize, updateCanvasPadding } from '../src/engine.js';

const { GIFEncoder } = gifenc;
const originalDocument = globalThis.document, originalImageData = globalThis.ImageData;
before(() => {
  globalThis.document = { createElement: () => createCanvas(1, 1) };
  globalThis.ImageData = ImageData;
  GlobalFonts.registerFromPath('public/fonts/anton.ttf', 'Anton');
});
after(() => { globalThis.document = originalDocument; globalThis.ImageData = originalImageData; });

function gifFixture(dispose = 1) {
  const encoder = GIFEncoder();
  const palette = [[0,0,0],[255,0,0],[0,255,0],[0,0,255]];
  encoder.writeFrame(new Uint8Array(16).fill(1),4,4,{palette,delay:100,dispose:1});
  const green = new Uint8Array(16); green[5] = 2;
  encoder.writeFrame(green,4,4,{palette,delay:200,dispose,transparent:true,transparentIndex:0});
  const blue = new Uint8Array(16); blue[0] = 3;
  encoder.writeFrame(blue,4,4,{palette,delay:300,dispose:1,transparent:true,transparentIndex:0});
  encoder.finish();
  return new File([encoder.bytes()], 'test.gif', { type: 'image/gif' });
}
const pixel = (image,x,y) => [...image.getContext('2d').getImageData(x,y,1,1).data];
const baseDoc = (width,height) => ({ crop:{x:0,y:0,width,height},trim:[0,600],objects:[] });

test('GIF decoder preserves transparent patches and variable frame delays', async () => {
  const media = await loadMedia(gifFixture());
  assert.equal(media.isGif,true); assert.equal(media.duration,600);
  assert.deepEqual(media.frames.map(f => f.delay),[100,200,300]);
  assert.deepEqual(pixel(media.frames[1].image,1,1),[0,255,0,255]);
  assert.deepEqual(pixel(media.frames[1].image,0,0),[255,0,0,255]);
  assert.deepEqual(pixel(media.frames[2].image,0,0),[0,0,255,255]);
  assert.deepEqual(pixel(media.frames[2].image,1,1),[0,255,0,255]);
});

test('GIF disposal 2 clears only after capturing the displayed frame', async () => {
  const media = await loadMedia(gifFixture(2));
  assert.deepEqual(pixel(media.frames[1].image,1,1),[0,255,0,255]);
  assert.deepEqual(pixel(media.frames[2].image,1,1),[0,0,0,0]);
  assert.deepEqual(pixel(media.frames[2].image,0,0),[0,0,255,255]);
});

test('GIF disposal 3 restores the previous composite before the next frame', async () => {
  const media = await loadMedia(gifFixture(3));
  assert.deepEqual(pixel(media.frames[1].image,1,1),[0,255,0,255]);
  assert.deepEqual(pixel(media.frames[2].image,1,1),[255,0,0,255]);
});

test('crop samples the requested source rectangle and respects output dimensions', async () => {
  const source = createCanvas(100,60),ctx = source.getContext('2d');
  ctx.fillStyle='#ff0000';ctx.fillRect(0,0,50,60);ctx.fillStyle='#00ff00';ctx.fillRect(50,0,50,60);
  const media={width:100,height:60,frames:[{image:source,delay:3000}]};
  const doc={...baseDoc(50,60),crop:{x:50,y:0,width:50,height:60}};
  const result=renderScene(createCanvas(1,1),media,doc,0,new Map(),100);
  assert.equal(result.width,100);assert.equal(result.height,120);
  // Sample inside the crop, away from the resampling filter at its edges.
  assert.deepEqual(pixel(result,4,4),[0,255,0,255]);
  assert.deepEqual(pixel(result,95,115),[0,255,0,255]);
  const png=result.toBuffer('image/png');
  assert.equal(png.readUInt32BE(16),100);assert.equal(png.readUInt32BE(20),120);
});

test('independent colored space renders around the cropped image at original size and in PNG exports', () => {
  const source=createCanvas(100,60),ctx=source.getContext('2d');
  ctx.fillStyle='#ff0000';ctx.fillRect(0,0,50,60);ctx.fillStyle='#00ff00';ctx.fillRect(50,0,50,60);
  const doc={...baseDoc(50,60),crop:{x:50,y:0,width:50,height:60},padding:{top:12,bottom:18,topColor:'#0000ff',bottomColor:'#ffff00'}};
  const media={frames:[{image:source,delay:3000}]};
  const result=renderScene(createCanvas(1,1),media,doc,0,new Map());
  assert.equal(result.width,50);assert.equal(result.height,90);
  assert.deepEqual(pixel(result,25,0),[0,0,255,255]);assert.deepEqual(pixel(result,25,11),[0,0,255,255]);
  assert.deepEqual(pixel(result,25,12),[0,255,0,255]);assert.deepEqual(pixel(result,25,71),[0,255,0,255]);
  assert.deepEqual(pixel(result,25,72),[255,255,0,255]);assert.deepEqual(pixel(result,25,89),[255,255,0,255]);
  const png=result.toBuffer('image/png');assert.equal(png.readUInt32BE(16),50);assert.equal(png.readUInt32BE(20),90);
  const downscaled=renderScene(createCanvas(1,1),media,doc,0,new Map(),25);
  assert.equal(downscaled.height,45);assert.deepEqual(pixel(downscaled,12,2),[0,0,255,255]);
  assert.equal(source.width,100);assert.equal(source.height,60);
});

test('text and image objects rotate in rendered pixels, including inside added space', () => {
  const source=createCanvas(100,60),sticker=createCanvas(20,10),target=createCanvas(1,1);
  sticker.getContext('2d').fillStyle='#ff0000';sticker.getContext('2d').fillRect(0,0,20,10);
  const media={frames:[{image:source,delay:3000}]};
  const object={type:'image',imageId:'red',width:.2,height:.1,x:.5,y:.2,rotation:90,keyframes:[]};
  const doc={...baseDoc(100,60),padding:{top:40,bottom:0,topColor:'#ffffff'},objects:[object]};
  renderScene(target,media,doc,0,new Map([['red',sticker]]));
  assert.deepEqual(pixel(target,50,12),[255,0,0,255]);assert.deepEqual(pixel(target,42,20),[255,255,255,255]);
  const text={type:'text',text:'HELLO',font:'Anton',bold:true,x:.5,y:.5,width:.8,height:.5,size:70,color:'#ff0000',outline:0,shadow:0,keyframes:[]};
  const large=createCanvas(900,600),base=baseDoc(900,600);
  renderScene(large,{frames:[{image:large,delay:3000}]},{...base,objects:[text]},0,new Map());
  const initial=redBounds(large);
  const transparent=createCanvas(900,600);
  renderScene(large,{frames:[{image:transparent,delay:3000}]},{...base,objects:[{...text,rotation:90}]},0,new Map());
  const rotated=redBounds(large);
  assert.ok(Math.abs(initial.width-rotated.height)<3);assert.ok(Math.abs(initial.height-rotated.width)<3);
});

test('position interpolation moves image layers in rendered pixels', () => {
  const source=createCanvas(100,100),sticker=createCanvas(10,10);
  source.getContext('2d').fillStyle='#ffffff';source.getContext('2d').fillRect(0,0,100,100);
  sticker.getContext('2d').fillStyle='#ff0000';sticker.getContext('2d').fillRect(0,0,10,10);
  const object={id:'sticker',type:'image',imageId:'asset',x:.2,y:.5,width:.1,aspect:1,opacity:100,keyframes:[{time:0,x:.2,y:.5},{time:1000,x:.8,y:.5}]};
  const doc={...baseDoc(100,100),objects:[object]},media={frames:[{image:source,delay:3000}]};
  const images=new Map([['asset',sticker]]),target=createCanvas(100,100);
  renderScene(target,media,doc,0,images);
  assert.deepEqual(pixel(target,20,50),[255,0,0,255]);
  renderScene(target,media,doc,500,images);
  assert.deepEqual(pixel(target,50,50),[255,0,0,255]);
  assert.deepEqual(pixel(target,20,50),[255,255,255,255]);
  renderScene(target,media,{...doc,objects:[{...object,hidden:true}]},500,images);
  assert.deepEqual(pixel(target,50,50),[255,255,255,255]);
});

test('repeated preview rendering reuses backing pixels, clears old content, and resets transforms', () => {
  const source=createCanvas(100,60),native=createCanvas(1,1);
  const ctx=source.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,100,60);
  let resets=0;
  const target={get width(){return native.width;},set width(v){resets++;native.width=v;},
    get height(){return native.height;},set height(v){resets++;native.height=v;},getContext:()=>native.getContext('2d')};
  const media={video:source,frames:[{delay:100}]},doc=baseDoc(100,60);
  renderScene(target,media,doc,0,new Map(),50);
  assert.equal(resets,2);assert.deepEqual(pixel(native,25,15),[255,0,0,255]);
  ctx.clearRect(0,0,100,60);ctx.fillStyle='#00ff00';ctx.fillRect(0,0,50,60);
  renderScene(target,media,doc,100,new Map(),50);
  assert.equal(resets,2,'same-size frames must not reallocate the canvas');
  assert.deepEqual(pixel(native,10,15),[0,255,0,255]);
  assert.deepEqual(pixel(native,40,15),[0,0,0,0]);
});

test('native video rendering crops encoder padding without resizing the source image', () => {
  const video=createCanvas(474,844),ctx=video.getContext('2d');
  ctx.fillStyle='#00ff00';ctx.fillRect(0,0,474,843);ctx.fillStyle='#ff0000';ctx.fillRect(0,843,474,1);
  const target=renderScene(createCanvas(1,1),{video,frames:[{delay:100}]},baseDoc(474,843),0,new Map());
  assert.equal(target.width,474);assert.equal(target.height,843);
  assert.deepEqual(pixel(target,200,842),[0,255,0,255]);
});

test('text, outline, and shadow colors all reach the rendered image', async () => {
  const source=createCanvas(900,500);source.getContext('2d').fillStyle='#fff';source.getContext('2d').fillRect(0,0,900,500);
  const object={type:'text',text:'HELLO',font:'Anton',bold:true,x:.5,y:.5,width:.9,size:100,color:'#ff0000',outlineColor:'#00ff00',shadowColor:'#0000ff',outline:5,shadow:22,opacity:100,keyframes:[]};
  const target=renderScene(createCanvas(1,1),{frames:[{image:source,delay:3000}]},{...baseDoc(900,500),objects:[object]},0,new Map());
  const {data}=target.getContext('2d').getImageData(0,0,900,500);
  let red=0,green=0,blue=0;
  for(let i=0;i<data.length;i+=4){ if(data[i]>200&&data[i+1]<50&&data[i+2]<50)red++;if(data[i]<50&&data[i+1]>200&&data[i+2]<50)green++;if(data[i+2]>data[i]+15&&data[i+2]>data[i+1]+15)blue++; }
  assert.ok(red>100);assert.ok(green>100);assert.ok(blue>100);
});

function redBounds(target) {
  const {width,height}=target, {data}=target.getContext('2d').getImageData(0,0,width,height);
  let left=width,right=0,top=height,bottom=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    if(data[i]>180&&data[i+1]<60&&data[i+2]<60){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  }
  return {left,top,width:right-left+1,height:bottom-top+1,centerY:(top+bottom)/2};
}

test('top, middle, and bottom alignment position text within the same box', () => {
  const source=createCanvas(900,600),target=createCanvas(900,600);
  const object={type:'text',text:'HELLO',font:'Anton',bold:true,x:.5,y:.5,width:.8,height:.8,size:80,color:'#ff0000',outline:0,shadow:0,keyframes:[]};
  const doc=baseDoc(900,600),media={frames:[{image:source,delay:3000}]};
  const centers=['top','middle','bottom'].map(verticalAlign=>{
    renderScene(target,media,{...doc,objects:[{...object,verticalAlign}]},0,new Map());return redBounds(target).centerY;
  });
  assert.ok(centers[1]-centers[0]>150);assert.ok(centers[2]-centers[1]>150);
});

test('one-axis resizing changes font size with natural letter proportions in rendered pixels', () => {
  const source=createCanvas(900,600),target=createCanvas(900,600);
  const object={type:'text',text:'HELLO',font:'Anton',bold:true,x:.5,y:.5,width:.5,height:.2,size:50,color:'#ff0000',outline:0,shadow:0,keyframes:[]};
  const doc=baseDoc(900,600),media={frames:[{image:source,delay:3000}]};
  const draw=o=>{renderScene(target,media,{...doc,objects:[o]},0,new Map());return redBounds(target);};
  const initial=draw(object),bounds=objectBounds(object,doc.crop,0);
  const horizontal=draw({...object,...resizeObject(object,doc.crop,bounds,2,1)});
  const vertical=draw({...object,...resizeObject(object,doc.crop,bounds,1,2)});
  assert.ok(horizontal.width>initial.width);assert.ok(horizontal.height>initial.height);
  assert.ok(vertical.width>initial.width);assert.ok(vertical.height>initial.height);
  const aspect=initial.width/initial.height;
  assert.ok(Math.abs(horizontal.width/horizontal.height-aspect)<.2);
  assert.ok(Math.abs(vertical.width/vertical.height-aspect)<.2);
  const fitted=draw({...object,...resizeObject(object,doc.crop,bounds,3,3),maxFontSize:35});
  const manual=draw({...object,size:35,maxFontSize:35});
  assert.equal(fitted.width,manual.width);assert.equal(fitted.height,manual.height);
});

test('text fits both box dimensions through wrapping and uniform font sizing', () => {
  const crop={width:900,height:600};
  const object={type:'text',text:'ONE TWO THREE FOUR FIVE SIX',font:'Anton',bold:true,size:50,maxFontSize:180,width:.7,height:.3};
  const ctx=createCanvas(1,1).getContext('2d');
  const fitted=(width,height)=>{
    const patch=resizeObject(object,crop,{width:630,height:180},width/630,height/180);
    const result={...object,...patch},layout=textLayout(result,crop,ctx);
    ctx.font=layout.font;
    assert.ok(layout.lines.every(line=>ctx.measureText(line).width<=width+.01));
    assert.ok(layout.contentHeight<=height+.01);
    assert.ok(layout.size<=180);
    assert.equal(patch.textScaleX,undefined);assert.equal(patch.textScaleY,undefined);
    return layout;
  };
  const wide=fitted(630,180),narrow=fitted(180,180),short=fitted(630,35),grown=fitted(1000,400);
  assert.ok(narrow.lines.length>1);assert.ok(narrow.size<wide.size);
  assert.ok(short.size<wide.size);assert.ok(grown.size>wide.size);
});

test('max font size caps resizing and text/font edits refit without changing box dimensions', () => {
  const crop={width:900,height:600};
  const object={type:'text',text:'SHORT',font:'Anton',bold:true,size:30,maxFontSize:60,width:.8,height:.4};
  const cap=updateObjectProperties(object,{maxFontSize:45},crop);
  assert.equal(cap.size,45);
  const resized={...cap,...resizeObject(cap,crop,{width:720,height:240},2,3)};
  assert.equal(resized.size,45);
  const long=updateObjectProperties(cap,{text:'UNBROKEN'.repeat(20)},crop);
  assert.ok(long.size<45);assert.equal(long.width,cap.width);assert.equal(long.height,cap.height);
  const layout=textLayout(long,crop),ctx=createCanvas(1,1).getContext('2d');ctx.font=layout.font;
  assert.ok(ctx.measureText(layout.lines[0]).width<=720+.01);
  const raised=updateObjectProperties(long,{text:'SHORT',maxFontSize:80},crop);
  assert.equal(raised.size,80);
  assert.equal(updateObjectProperties(cap,{size:200},crop).size,45);
});

test('preview and export share line breaks and ignore legacy letter stretching', () => {
  const source=createCanvas(900,600),target=createCanvas(900,600);
  const object={type:'text',text:'SAME LETTERS',font:'Anton',bold:true,x:.5,y:.5,width:.8,height:.4,size:70,color:'#ff0000',outline:0,shadow:0,keyframes:[]};
  const doc=baseDoc(900,600),media={frames:[{image:source,delay:3000}]};
  const draw=(o,width)=>{renderScene(target,media,{...doc,objects:[o]},0,new Map(),width);return redBounds(target);};
  const normal=draw(object,900),legacy=draw({...object,textScaleX:3,textScaleY:.25},900),preview=draw(object,450);
  assert.deepEqual(normal,legacy);
  assert.ok(Math.abs(preview.width*2-normal.width)<3);assert.ok(Math.abs(preview.height*2-normal.height)<3);
});

async function productionWorker() {
  const workerFile=(await readdir('dist/assets')).find(f=>f.startsWith('gif.worker-')&&f.endsWith('.js'));
  assert.ok(workerFile,'Run npm run build before rendering tests');
  let message;
  const self={postMessage: data => {message=data;}};
  vm.runInNewContext(await readFile(`dist/assets/${workerFile}`,'utf8'),{self,Uint8Array,Uint32Array,ArrayBuffer,Math,Map,Set,console});
  return data=>{self.onmessage({data});assert.notEqual(message?.type,'error',message?.message);return message;};
}

test('real production worker encodes cropped, trimmed, animated frames', async () => {
  const send=await productionWorker();
  const media=await loadMedia(gifFixture());
  const sticker=createCanvas(1,1);sticker.getContext('2d').fillStyle='#000000';sticker.getContext('2d').fillRect(0,0,1,1);
  const keys=[{time:120,visible:false},{time:280,visible:true}];
  const doc={...baseDoc(2,4),crop:{x:1,y:0,width:2,height:4},objects:[{type:'image',imageId:'sticker',x:.5,y:.5,width:.5,aspect:1,keyframes:keys}]};
  const images=new Map([['sticker',sticker]]);
  const schedule=exportSchedule(media,50,450,true,keys);
  send({type:'start',width:20,height:40});
  const target=createCanvas(20,40);
  for(const frame of schedule){
    renderScene(target,media,doc,frame.time,images,20,true);
    send({type:'frame',pixels:target.getContext('2d').getImageData(0,0,20,40).data.buffer,delay:frame.delay});
  }
  const output=send({type:'finish'});
  const parsed=parseGIF(output.bytes.buffer.slice(output.bytes.byteOffset,output.bytes.byteOffset+output.bytes.byteLength));
  const frames=decompressFrames(parsed,true);
  assert.equal(parsed.lsd.width,20);assert.equal(parsed.lsd.height,40);
  assert.equal(frames.reduce((sum,f)=>sum+f.delay,0),400);
  assert.equal(frames.length,schedule.length);
  const center=(time)=>{const frame=frames[schedule.findIndex(f=>f.time===time)];const index=(20*20+10)*4;return [...frame.patch.slice(index,index+3)];};
  assert.deepEqual(center(50),[0,0,0]);
  assert.notDeepEqual(center(120),[0,0,0]);
  assert.deepEqual(center(280),[0,0,0]);
  await mkdir('test-results',{recursive:true});await writeFile('test-results/verified-export.gif',output.bytes);
});

test('GIF exports retain colored bands, full image resolution, and every frame delay', async () => {
  const send=await productionWorker(),media=await loadMedia(gifFixture());
  const doc=updateCanvasPadding(baseDoc(4,4),{top:2,bottom:3,topColor:'#0000ff',bottomColor:'#ffff00'});
  const size=canvasSize(doc),target=createCanvas(size.width,size.height);
  send({type:'start',...size});
  for(const frame of exportSchedule(media,0,600,false)){
    renderScene(target,media,doc,frame.time,new Map(),undefined,true);
    send({type:'frame',pixels:target.getContext('2d').getImageData(0,0,size.width,size.height).data.buffer,delay:frame.delay});
  }
  const output=send({type:'finish'});
  const parsed=parseGIF(output.bytes.buffer.slice(output.bytes.byteOffset,output.bytes.byteOffset+output.bytes.byteLength));
  const frames=decompressFrames(parsed,true);
  assert.equal(parsed.lsd.width,4);assert.equal(parsed.lsd.height,9);
  assert.deepEqual(frames.map(frame=>frame.delay),[100,200,300]);
  const rgb=(frame,x,y)=>[...frame.patch.slice((y*4+x)*4,(y*4+x)*4+3)];
  for(const frame of frames){assert.deepEqual(rgb(frame,0,0),[0,0,255]);assert.deepEqual(rgb(frame,0,8),[255,255,0]);}
  assert.deepEqual(rgb(frames[0],1,3),[255,0,0]);assert.deepEqual(rgb(frames[1],1,3),[0,255,0]);
  await mkdir('test-results',{recursive:true});await writeFile('test-results/padded-export.gif',output.bytes);
});

test('production GIF exports honor selected FPS and keep real-time duration at browser-safe delays', async () => {
  const media=await loadMedia(gifFixture()),doc=baseDoc(4,4),target=createCanvas(4,4);
  for(const fps of [12.5,24,25,30,50]){
    const send=await productionWorker();send({type:'start',width:4,height:4});
    const schedule=exportSchedule(media,0,600,true,[{time:110,visible:false}],fps);
    for(const frame of schedule){
      renderScene(target,media,doc,frame.time,new Map(),undefined,true);
      send({type:'frame',pixels:target.getContext('2d').getImageData(0,0,4,4).data.buffer,delay:frame.delay});
    }
    const output=send({type:'finish'});
    const frames=decompressFrames(parseGIF(output.bytes.buffer.slice(output.bytes.byteOffset,output.bytes.byteOffset+output.bytes.byteLength)),true);
    assert.equal(frames.length,Math.round(.6*fps));
    assert.equal(frames.reduce((sum,frame)=>sum+frame.delay,0),600);
    assert.ok(frames.every(frame=>frame.delay>=20));
    assert.notDeepEqual(frames[0].patch,frames.at(-1).patch);
  }
});

test('starter image and captions render to a full resolution PNG', async () => {
  const image=await loadImage('public/studio-cat.jpg');
  const text={type:'text',font:'Anton',bold:true,x:.5,width:.92,size:59,color:'#ffffff',outlineColor:'#161616',shadowColor:'#000000',outline:2.5,shadow:5,opacity:100,keyframes:[]};
  const doc={...baseDoc(image.width,image.height),objects:[{...text,text:'JUST ONE MORE\nLITTLE CHANGE',y:.16},{...text,text:'3 HOURS LATER',y:.88}]};
  const result=renderScene(createCanvas(1,1),{frames:[{image,delay:3000}]},doc,0,new Map(),900);
  assert.equal(result.width,900);assert.equal(result.height,619);
  await mkdir('test-results',{recursive:true});await writeFile('test-results/starter-render.png',result.toBuffer('image/png'));
});

test('oversized uploads are rejected before decoding', async () => {
  const file={size:31*1024*1024,name:'fake.gif',type:'image/gif',
    slice:()=>new Blob([Uint8Array.of(137,80,78,71,13,10,26,10)]),
    arrayBuffer:()=>{throw new Error('Must reject before reading the full file');}};
  await assert.rejects(()=>loadMedia(file),/smaller than 30 MB/);
});

test('GIF browser decoding accepts sizes through 200 MB regardless of filename or MIME', async () => {
  const fixture=gifFixture(),bytes=await fixture.arrayBuffer();
  for(const size of [31*1024*1024,200*1024*1024]){
    const file={name:'claims-to-be.png',type:'image/png',size,slice:(...args)=>fixture.slice(...args),arrayBuffer:async()=>bytes};
    const media=await loadMedia(file);
    assert.equal(media.isAnimated,true);assert.equal(media.format,'gif');assert.equal(media.byteSize,size);
  }
});

test('GIF uploads above 200 MB fail before the full contents are read', async () => {
  const fixture=gifFixture();
  const file={size:200*1024*1024+1,slice:(...args)=>fixture.slice(...args),arrayBuffer:()=>{throw new Error('Must reject before reading the full file');}};
  await assert.rejects(()=>loadMedia(file),/GIF files.*200 MB/);
  await assert.rejects(()=>loadMedia(file,{sourceType:'youtube'}),/YouTube animations.*200 MB/);
});
