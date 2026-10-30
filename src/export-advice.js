import { exportSchedule, exportSize, canvasSize } from './engine.js';

export function getDownscaleSuggestions(crop) {
  const seen=new Set();
  return [.75,.5,.25].flatMap(scale => {
    const width=Math.round(crop.width*scale);
    if(width<16 || width>=crop.width || seen.has(width))return [];
    seen.add(width);
    const size=exportSize(crop,width);
    const pixelReduction=Math.round((1-size.width*size.height/(crop.width*crop.height))*100);
    return [{...size,percent:Math.round(scale*100),pixelReduction}];
  });
}

// A source-based estimate, not an encoder prediction: pixel area and the actual
// export frame schedule account for crop, trim, resize, and added animation.
// Text, image layers, palette changes, and compression can change the result.
export function estimateGifBytes(media,doc,width,fps='auto') {
  if(media?.format!=='gif' || !media.byteSize || !media.frames?.length)return null;
  const size=exportSize(canvasSize(doc),width);
  const keys=doc.objects.flatMap(o=>o.keyframes || []);
  const schedule=exportSchedule(media,doc.trim[0],doc.trim[1],keys.length>0,keys,fps);
  const pixelRatio=size.width*size.height/(media.width*media.height);
  return Math.max(50,Math.round(media.byteSize*pixelRatio*schedule.length/media.frames.length));
}

export function formatFileSize(bytes) {
  if(bytes<1024)return `${Math.round(bytes)} B`;
  if(bytes<1024*1024)return `${Math.round(bytes/1024)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}
