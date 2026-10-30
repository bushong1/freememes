import { parseGIF, decompressFrames } from 'gifuct-js';
import { detectImageType, detectVideoType, validateMediaSize, MAX_ANIMATION_PIXELS, MAX_ANIMATION_FRAMES } from './media-source.js';
import { loadVideoMedia } from './video-media.js';

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const formatTime = (ms) => `${(ms / 1000).toFixed(2)}s`;

export const canvasSize = doc => ({width:doc.crop.width,height:doc.crop.height+(doc.padding?.top || 0)+(doc.padding?.bottom || 0)});

export function updateCanvasPadding(doc,patch) {
  const padding={top:0,bottom:0,topColor:'#ffffff',bottomColor:'#ffffff',...doc.padding,...patch};
  padding.top=clamp(Math.round(Number(padding.top) || 0),0,8192);
  padding.bottom=clamp(Math.round(Number(padding.bottom) || 0),0,8192);
  const previous=canvasSize(doc),next=canvasSize({...doc,padding}),offset=padding.top-(doc.padding?.top || 0);
  const remap=y=>(y*previous.height+offset)/next.height;
  const objects=previous.height===next.height && !offset ? doc.objects : doc.objects.map(object=>({...object,
    y:remap(object.y),...(Number.isFinite(object.height) ? {height:object.height*previous.height/next.height} : {}),
    keyframes:(object.keyframes || []).map(key=>Number.isFinite(key.y) ? {...key,y:remap(key.y)} : key)}));
  return {...doc,padding,objects};
}

export function rotationFromDrag(rotation,startAngle,currentAngle,snap=false) {
  const delta=Math.atan2(Math.sin(currentAngle-startAngle),Math.cos(currentAngle-startAngle))*180/Math.PI;
  let value=rotation+delta;
  if(snap)value=Math.round(value/15)*15;
  return Math.round((((value+180)%360+360)%360-180)*10)/10;
}

export function positionAt(object, time) {
  const keys = [...(object.keyframes || [])].filter(k => Number.isFinite(k.x) && Number.isFinite(k.y)).sort((a, b) => a.time - b.time);
  if (!keys.length) return { x: object.x, y: object.y };
  if (time <= keys[0].time) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    if (time <= keys[i].time) {
      const a = keys[i - 1], b = keys[i];
      let t = (time - a.time) / (b.time - a.time);
      if (object.easing === 'smooth') t = t * t * (3 - 2 * t);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  return keys[keys.length - 1];
}

export function visibleAt(object, time) {
  if (object.hidden) return false;
  let visible = true;
  const keys = [...(object.keyframes || [])].filter(k => typeof k.visible === 'boolean').sort((a,b) => a.time-b.time);
  for (const key of keys) { if (key.time > time) break; visible = key.visible; }
  return visible;
}

export function upsertKeyframe(object, time, patch) {
  const t = Math.round(time / 10) * 10;
  const existing = (object.keyframes || []).find(k => Math.round(k.time / 10) * 10 === t);
  return [...(object.keyframes || []).filter(k => Math.round(k.time / 10) * 10 !== t), { ...existing, time: t, ...patch }].sort((a,b) => a.time-b.time);
}

export function snapshotKeyframes(object) {
  return {keyframes:(object.keyframes || []).map(key=>({...key})),easing:object.easing || 'linear'};
}

export function pasteKeyframeSnapshot(object,snapshot) {
  return {...object,keyframes:snapshot.keyframes.map(key=>({...key})),easing:snapshot.easing};
}

export function applyTextFormatting(objects, source) {
  const fields = ['font','size','maxFontSize','bold','align','verticalAlign','color','outlineColor','outline','shadowColor','shadow','opacity'];
  const defaults = { verticalAlign: 'middle', maxFontSize: 1000, opacity: 100 };
  const formatting = Object.fromEntries(fields.filter(key => source[key] !== undefined || key in defaults).map(key => [key,source[key] ?? defaults[key]]));
  return objects.map(o => o.type === 'text' ? { ...o, ...formatting } : o);
}

export function resizeObject(object, crop, bounds, factorX, factorY) {
  const fx = Math.max(.02, factorX), fy = Math.max(.02, factorY);
  const result = { width: bounds.width * fx / crop.width, height: bounds.height * fy / crop.height };
  if (object.type === 'text') {
    result.size = textLayout({...object,...result},crop,undefined,object.maxFontSize ?? 1000).size;
  }
  return result;
}

export const canTrimMedia = media => !!(media?.isVideo || (media?.isGif && media.frames.length > 1));
export const exportSize = (crop, width = 'original') => {
  const w = width === 'original' ? crop.width : Math.min(Number(width),crop.width);
  return { width: Math.round(w), height: Math.round(w * crop.height / crop.width) };
};

export function frameAt(frames, time) {
  let cursor = 0;
  for (let i = 0; i < frames.length; i++) {
    cursor += frames[i].delay;
    if (time < cursor) return i;
  }
  return frames.length - 1;
}

export function stepMediaFrame(media,time,direction,trim) {
  let target;
  if(media.isVideo){
    const interval=1000/(media.frameRate || 30);
    target=(Math.floor((time+.001)/interval)+direction)*interval;
  } else if(media.isAnimated){
    const index=frameAt(media.frames,time)+direction;
    target=index<0 ? trim[0] : index>=media.frames.length ? trim[1]-1 : media.frames.slice(0,index).reduce((sum,frame)=>sum+frame.delay,0);
  } else target=time+direction*50;
  return clamp(target,trim[0],trim[1]-1);
}

export function exportSchedule(media, start, end, animated, keyframes = [], fps = 'auto') {
  if(end<=start)return [];
  // GIF stores hundredths of a second. Browsers can expand 0/10ms delays to
  // 100ms, so use at least two ticks without adding time to the whole clip.
  const totalTicks=Math.max(2,Math.round((end-start)/10));
  let boundaries;
  if(fps!=='auto' || media.isVideo){
    const rate=fps==='auto' ? Math.min(50,Math.max(.01,media.frameRate || 30,animated ? 20 : 0)) : clamp(Number(fps) || 20,1,50);
    const count=Math.max(1,Math.min(Math.round((end-start)*rate/1000),Math.floor(totalTicks/2)));
    boundaries=Array.from({length:count},(_,index)=>({tick:Math.round(index*100/rate),time:start+index*1000/rate}));
    while(boundaries.length>1 && totalTicks-boundaries.at(-1).tick<2)boundaries.pop();
  } else {
    const points=new Set([start]);
    let cursor=0;
    for(const frame of media.frames){cursor+=frame.delay;if(cursor>start && cursor<end)points.add(cursor);}
    if(animated)for(let time=start+50;time<end;time+=50)points.add(time);
    const events=new Set(keyframes.filter(key=>key.time>start && key.time<end).map(key=>key.time));
    for(const time of events)points.add(time);
    boundaries=[];
    for(const time of [...points].sort((a,b)=>a-b)){
      const tick=Math.round((time-start)/10);
      if(totalTicks-tick<2)continue;
      const previous=boundaries.at(-1);
      if(!previous || tick-previous.tick>=2)boundaries.push({tick,time});
      else if(events.has(time) && boundaries.length>1 && tick-boundaries.at(-2).tick>=2)boundaries[boundaries.length-1]={tick,time};
    }
  }
  const result=[];
  for(let index=0;index<boundaries.length;index++){
    const point=boundaries[index];
    let ticks=(boundaries[index+1]?.tick ?? totalTicks)-point.tick,time=point.time;
    // A GIF delay field is 16 bits. Split unusually long holds safely too.
    while(ticks>0){
      const part=ticks===65536 ? 65534 : Math.min(65535,ticks);
      result.push({time,delay:part*10});time+=part*10;ticks-=part;
    }
  }
  return result;
}

export function canvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  return c;
}

export async function loadMedia(file, { sourceType,videoSize } = {}) {
  const signature=await file.slice(0,32).arrayBuffer();
  const detected=detectImageType(signature);
  validateMediaSize(file.size,sourceType==='youtube' ? 'youtube' : detected?.format);
  if(sourceType==='youtube' && detectVideoType(signature))return loadVideoMedia(file,videoSize);
  const bytes = await file.arrayBuffer();
  if (!detected) throw new Error('This file is not a supported image. Choose a PNG, GIF, WebP, JPEG, or AVIF.');
  const isGif = detected.format === 'gif';
  if (isGif) {
    const parsed = parseGIF(bytes);
    const width = parsed.lsd.width, height = parsed.lsd.height;
    const frameCount = parsed.frames.filter(f => f.image).length;
    if (width * height * frameCount > MAX_ANIMATION_PIXELS || frameCount > MAX_ANIMATION_FRAMES) throw new Error('This GIF is too large to edit in your browser. Try a shorter or smaller GIF.');
    const decoded = decompressFrames(parsed, true);
    if (!decoded.length) throw new Error('This GIF has no readable frames.');
    const composite = canvas(width, height), ctx = composite.getContext('2d');
    const frames = [];
    for (const frame of decoded) {
      const before = frame.disposalType === 3 ? ctx.getImageData(0, 0, width, height) : null;
      const patch = canvas(frame.dims.width, frame.dims.height);
      patch.getContext('2d').putImageData(new ImageData(frame.patch, frame.dims.width, frame.dims.height), 0, 0);
      ctx.drawImage(patch, frame.dims.left, frame.dims.top);
      const image = canvas(width, height);
      // Materialize the pixels before applying disposal to the working canvas.
      // Each timeline frame must retain its own independent composite.
      image.getContext('2d').putImageData(ctx.getImageData(0, 0, width, height), 0, 0);
      frames.push({ image, delay: Math.max(20, frame.delay || 100) });
      if (frame.disposalType === 2) ctx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
      if (before) ctx.putImageData(before, 0, 0);
    }
    return { name: file.name, byteSize:file.size, width, height, frames, format: 'gif', isGif: true, isAnimated: frames.length > 1, duration: frames.length > 1 ? frames.reduce((s, f) => s + f.delay, 0) : 3000 };
  }
  if (detected.format === 'webp' && detected.animated) return { ...await decodeAnimatedWebP(bytes,file.name), byteSize:file.size };
  const blob = new Blob([bytes], { type: detected.mime });
  const url = URL.createObjectURL(blob);
  try {
    const image = await imageFromUrl(url);
    if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('This image is too large to edit. Choose an image under 40 megapixels.');
    const c = canvas(image.naturalWidth, image.naturalHeight);
    c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
    return { name: file.name, byteSize:file.size, width: c.width, height: c.height, frames: [{ image: c, delay: 3000 }], format: detected.format, isGif: false, isAnimated: false, duration: 3000 };
  } finally { URL.revokeObjectURL(url); }
}

async function decodeAnimatedWebP(bytes, name) {
  if (!globalThis.ImageDecoder || !await ImageDecoder.isTypeSupported('image/webp')) throw new Error('This browser cannot decode animated WebP. Open it in Chrome, or convert it to a GIF first.');
  const decoder = new ImageDecoder({ data: bytes, type: 'image/webp', preferAnimation: true });
  try {
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack.frameCount;
    if (!count || count > MAX_ANIMATION_FRAMES) throw new Error('This animated WebP has too many frames. Try a shorter animation.');
    const frames = [];
    let width, height;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      try {
        width = image.displayWidth; height = image.displayHeight;
        if (width * height * count > MAX_ANIMATION_PIXELS) throw new Error('This animated WebP is too large to edit. Try a smaller animation.');
        const c = canvas(width, height); c.getContext('2d').drawImage(image, 0, 0);
        frames.push({ image: c, delay: Math.max(20, (image.duration || 100000) / 1000) });
      } finally { image.close(); }
    }
    return { name, width, height, frames, format: 'webp', isGif: false, isAnimated: true, duration: frames.reduce((s,f) => s+f.delay,0) };
  } finally { decoder.close(); }
}

export function imageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not open this image. Try a PNG, JPEG, WebP, or GIF.'));
    image.src = url;
  });
}

export function textLines(ctx, object, width) {
  const lines = [];
  for (const paragraph of (object.text || '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) { lines.push(line); line = word; }
      else line = next;
    }
    lines.push(line);
  }
  return lines;
}

const textLayouts = new WeakMap();
// Sizes are stored relative to a 900px canvas. Measure at that resolution so
// preview and export use identical line breaks, regardless of output scale.
export function textLayout(object,crop,context,limit=object.size ?? 59) {
  const width=Math.max(.01,object.width*900);
  const height=Number.isFinite(object.height) ? Math.max(.01,object.height*crop.height*900/crop.width) : Infinity;
  const maximum=clamp(Number(object.maxFontSize) || 1000,1,1000);
  const cap=Math.max(.01,Math.min(Number(limit) || .01,maximum));
  const key=JSON.stringify([object.text,object.font,object.bold,width,height,cap,globalThis.document?.fonts?.status]);
  const cached=textLayouts.get(object);
  if(cached?.key===key)return cached.layout;
  const ctx=context || canvas(1,1).getContext('2d');
  const at=size=>{
    const font=`${object.bold ? '900' : '500'} ${size}px ${object.font}`;
    ctx.font=font;
    const lines=textLines(ctx,object,width),lineHeight=size*1.18;
    const fits=lines.length*lineHeight<=height && lines.every(line=>{
      const metrics=ctx.measureText(line);
      return Math.max(metrics.width,(metrics.actualBoundingBoxLeft || 0)+(metrics.actualBoundingBoxRight || 0))<=width;
    });
    return {size,lines,lineHeight,contentHeight:lines.length*lineHeight,font,fits};
  };
  let layout=at(cap);
  if(!layout.fits){
    let low=0,high=cap;
    for(let i=0;i<18;i++){
      const mid=(low+high)/2;
      if(at(mid).fits)low=mid;else high=mid;
    }
    layout=at(Math.max(.001,low));
  }
  textLayouts.set(object,{key,layout});
  return layout;
}

export function updateObjectProperties(object,patch,crop) {
  const next={...object,...patch};
  if(next.type==='text' && ['text','font','bold','width','height','size','maxFontSize'].some(field=>field in patch)){
    const limit='size' in patch ? patch.size : next.maxFontSize ?? 1000;
    next.size=textLayout(next,crop,undefined,limit).size;
  }
  return next;
}

export function objectBounds(object, crop, time) {
  const pos = positionAt(object, time);
  const width = crop.width * object.width;
  let height;
  if (Number.isFinite(object.height)) height = crop.height * object.height;
  else if (object.type === 'image') height = width / object.aspect;
  else {
    height = textLayout(object,crop).contentHeight*crop.width/900;
  }
  return { x: pos.x * crop.width - width / 2, y: pos.y * crop.height - height / 2, width, height };
}

export function renderScene(target, media, doc, time, images, outputWidth, opaque = false) {
  const crop = doc.crop;
  const geometry=canvasSize(doc),top=doc.padding?.top || 0,bottom=doc.padding?.bottom || 0;
  const width=Math.round(outputWidth || geometry.width),height=Math.round(width*geometry.height/geometry.width);
  if(target.width!==width)target.width=width;
  if(target.height!==height)target.height=height;
  const ctx = target.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,width,height);
  ctx.scale(target.width / geometry.width, target.height / geometry.height);
  if (opaque) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, geometry.width, geometry.height); }
  if(top){ctx.fillStyle=doc.padding.topColor || '#ffffff';ctx.fillRect(0,0,geometry.width,top);}
  if(bottom){ctx.fillStyle=doc.padding.bottomColor || '#ffffff';ctx.fillRect(0,top+crop.height,geometry.width,bottom);}
  const image=media.video || media.frames[frameAt(media.frames,time)].image;
  ctx.drawImage(image,crop.x,crop.y,crop.width,crop.height,0,top,crop.width,crop.height);
  for (const object of doc.objects) {
    if (!visibleAt(object,time)) continue;
    const bounds = objectBounds(object, geometry, time);
    ctx.save();
    ctx.translate(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    ctx.rotate((object.rotation || 0) * Math.PI / 180);
    ctx.globalAlpha = (object.opacity ?? 100) / 100;
    if (object.type === 'image') {
      const image = images.get(object.imageId);
      if (image) ctx.drawImage(image, -bounds.width / 2, -bounds.height / 2, bounds.width, bounds.height);
    } else {
      const scale = crop.width / 900;
      const layout=textLayout(object,geometry,ctx);
      const size = layout.size * scale;
      ctx.font = `${object.bold ? '900' : '500'} ${size}px ${object.font}`;
      ctx.textAlign = object.align || 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.fillStyle = object.color;
      const lines = layout.lines;
      const lineHeight = layout.lineHeight*scale;
      const contentHeight = layout.contentHeight*scale;
      const startY = object.verticalAlign === 'top' ? -bounds.height / 2 : object.verticalAlign === 'bottom' ? bounds.height / 2 - contentHeight : -contentHeight / 2;
      const textX = object.align === 'left' ? -bounds.width / 2 : object.align === 'right' ? bounds.width / 2 : 0;
      lines.forEach((line, i) => {
        const y = startY + lineHeight * (i + .5);
        ctx.shadowColor = object.shadowColor;
        ctx.shadowBlur = object.shadow * scale;
        ctx.shadowOffsetX = object.shadow * scale / 3;
        ctx.shadowOffsetY = object.shadow * scale / 2;
        if (object.outline > 0) {
          ctx.strokeStyle = object.outlineColor;
          ctx.lineWidth = object.outline * scale * 2;
          ctx.strokeText(line, textX, y);
        }
        ctx.fillText(line, textX, y);
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
        ctx.fillText(line, textX, y);
      });
    }
    ctx.restore();
  }
  return target;
}
