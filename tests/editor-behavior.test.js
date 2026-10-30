import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTextFormatting, canTrimMedia, exportSchedule, exportSize, positionAt, resizeObject, upsertKeyframe, visibleAt, canvasSize, updateCanvasPadding, objectBounds, rotationFromDrag, snapshotKeyframes, pasteKeyframeSnapshot } from '../src/engine.js';

test('copying keyframes snapshots timing, positions, visibility, and easing without sharing mutable keys', () => {
  const source={type:'text',text:'Source',easing:'smooth',keyframes:[{time:100,x:.2,y:.4,visible:false},{time:800,x:.8,y:.6,visible:true}]};
  const snapshot=snapshotKeyframes(source);
  source.keyframes[0].x=.5;
  assert.equal(snapshot.keyframes[0].x,.2);
  const target={type:'image',id:'target',imageId:'asset',rotation:45,width:.4,x:.9,y:.1,easing:'linear',keyframes:[{time:0,visible:true}]};
  const pasted=pasteKeyframeSnapshot(target,snapshot);
  assert.deepEqual(pasted.keyframes,snapshot.keyframes);assert.equal(pasted.easing,'smooth');
  for(const field of ['id','type','imageId','rotation','width','x','y'])assert.equal(pasted[field],target[field]);
  pasted.keyframes[0].visible=true;assert.equal(snapshot.keyframes[0].visible,false);
  assert.deepEqual(target.keyframes,[{time:0,visible:true}]);
});

test('canvas padding adds space while preserving object sizes and animated positions relative to the image', () => {
  const object={type:'text',x:.5,y:.5,width:.6,height:.2,size:30,keyframes:[{time:0,x:.5,y:.25},{time:500,visible:false},{time:1000,x:.6,y:.75}]};
  const doc={crop:{x:0,y:0,width:100,height:60},objects:[object]};
  const padded=updateCanvasPadding(doc,{top:20,bottom:10,topColor:'#ff0000',bottomColor:'#00ff00'});
  assert.deepEqual(canvasSize(padded),{width:100,height:90});
  for(const time of [0,500,1000]){
    const before=objectBounds(object,canvasSize(doc),time),after=objectBounds(padded.objects[0],canvasSize(padded),time);
    assert.equal(after.width,before.width);assert.equal(after.height,before.height);
    assert.ok(Math.abs(after.y-before.y-20)<1e-9);
  }
  assert.equal(padded.objects[0].size,30);assert.equal(padded.objects[0].keyframes[1],object.keyframes[1]);
  const recolored=updateCanvasPadding(padded,{bottomColor:'#0000ff'});
  assert.equal(recolored.objects,padded.objects);
  assert.deepEqual(canvasSize(updateCanvasPadding(padded,{top:0,bottom:0})),canvasSize(doc));
  assert.deepEqual(canvasSize(doc),{width:100,height:60});
});

test('rotation dragging handles angle wrapping and optional 15-degree snapping', () => {
  assert.equal(rotationFromDrag(0,-Math.PI/2,0),90);
  assert.equal(rotationFromDrag(170,170*Math.PI/180,-170*Math.PI/180),-170);
  assert.equal(rotationFromDrag(0,0,37*Math.PI/180,true),30);
  assert.equal(rotationFromDrag(15,0,-50*Math.PI/180),-35);
});

test('animated GIFs and native YouTube clips expose trimming, while stills do not', () => {
  assert.equal(canTrimMedia(null),false);
  assert.equal(canTrimMedia({isGif:false,isAnimated:false,frames:[{}]}),false);
  assert.equal(canTrimMedia({isGif:true,isAnimated:false,frames:[{}]}),false);
  assert.equal(canTrimMedia({isGif:false,isAnimated:true,frames:[{},{}]}),false);
  assert.equal(canTrimMedia({isGif:true,isAnimated:true,frames:[{},{}]}),true);
  assert.equal(canTrimMedia({isVideo:true,isGif:false,isAnimated:true,frames:[{}]}),true);
});

test('original export uses full canvas pixels including large images and crops', () => {
  assert.deepEqual(exportSize({width:4096,height:3072}),{width:4096,height:3072});
  assert.deepEqual(exportSize({width:1240,height:803},'original'),{width:1240,height:803});
  assert.deepEqual(exportSize({width:1240,height:803},480),{width:480,height:311});
  assert.deepEqual(exportSize({width:320,height:180},900),{width:320,height:180});
});

test('format all text preserves content, geometry, visibility, and animation', () => {
  const source={id:'a',type:'text',text:'A',font:'Anton',size:80,maxFontSize:90,color:'#ff0000',outline:3,shadow:8,bold:true,align:'right',verticalAlign:'bottom',width:.8,height:.3,x:.2,y:.1,keyframes:[],hidden:false};
  const other={...source,id:'b',text:'B',font:'Arial',color:'#00ff00',size:20,align:'left',verticalAlign:'top',x:.8,y:.9,width:.3,height:.2,rotation:30,hidden:true,keyframes:[{time:100,visible:false}]};
  const image={id:'img',type:'image',x:.5,y:.5,opacity:20};
  const result=applyTextFormatting([source,other,image],source);
  for(const key of ['font','size','maxFontSize','color','outline','shadow','bold','align','verticalAlign']) assert.equal(result[1][key],source[key]);
  for(const key of ['id','text','x','y','width','height','rotation','hidden','keyframes']) assert.deepEqual(result[1][key],other[key]);
  assert.equal(result[2],image);
  assert.equal(other.font,'Arial');
});

test('image layers retain independent horizontal and vertical resizing', () => {
  const object={type:'image',width:.5,height:.2};
  const crop={width:1000,height:600},bounds={width:500,height:120};
  const horizontal=resizeObject(object,crop,bounds,2,1);
  assert.equal(horizontal.width,1);assert.equal(horizontal.height,.2);
  const vertical=resizeObject(object,crop,bounds,1,2);
  assert.equal(vertical.width,.5);assert.equal(vertical.height,.4);
  const both=resizeObject(object,crop,bounds,2,3);
  assert.equal(both.width,1);assert.equal(both.height,.6);
  assert.equal(both.size,undefined);
});

test('visibility is a step change while position still interpolates across visibility-only keys', () => {
  const object={x:.1,y:.2,keyframes:[{time:0,x:.1,y:.2},{time:200,visible:false},{time:800,visible:true},{time:1000,x:.9,y:.8}]};
  assert.equal(visibleAt(object,199),true);
  assert.equal(visibleAt(object,200),false);
  assert.equal(visibleAt(object,799),false);
  assert.equal(visibleAt(object,800),true);
  assert.equal(positionAt(object,500).x,.5);
  assert.equal(positionAt(object,500).y,.5);
  assert.equal(visibleAt({...object,hidden:true},900),false);
});

test('show/hide-only keyframes never alter an object position', () => {
  const object={x:.4,y:.6,keyframes:[{time:200,visible:false},{time:800,visible:true}]};
  assert.deepEqual(positionAt(object,500),{x:.4,y:.6});
  assert.equal(visibleAt(object,0),true);assert.equal(visibleAt(object,500),false);
});

test('position and visibility can be edited independently at the same keyframe', () => {
  let object={keyframes:[]};
  object={...object,keyframes:upsertKeyframe(object,120,{visible:false})};
  object={...object,keyframes:upsertKeyframe(object,120,{x:.2,y:.3})};
  assert.deepEqual(object.keyframes,[{time:120,visible:false,x:.2,y:.3}]);
  object={...object,keyframes:upsertKeyframe(object,120,{visible:true})};
  assert.deepEqual(object.keyframes,[{time:120,visible:true,x:.2,y:.3}]);
  object={...object,keyframes:upsertKeyframe(object,140,{visible:false})};
  assert.equal(object.keyframes.length,2);
});

test('GIF encoding includes exact visibility event boundaries between regular samples', () => {
  const media={frames:[{delay:3000}]};
  const keys=[{time:120,visible:false},{time:280,visible:true}];
  const schedule=exportSchedule(media,0,1000,true,keys);
  assert.ok(schedule.some(f=>f.time===120));assert.ok(schedule.some(f=>f.time===280));
  assert.equal(schedule.reduce((sum,f)=>sum+f.delay,0),1000);
  assert.equal(schedule.find(f=>f.time===100).delay,20);
});
