import { frameAt } from './engine.js';
import { seekVideoFrame } from './video-media.js';

export function previewSize(crop,displayWidth,ratio=1) {
  const scale=Math.min(1,Math.max(1,displayWidth)*Math.min(2,ratio)/crop.width,1280/Math.max(crop.width,crop.height));
  const width=Math.max(1,Math.round(crop.width*scale));
  return {width,height:Math.max(1,Math.round(width*crop.height/crop.width))};
}

export function playbackTime(start,elapsed,trim) {
  const length=trim[1]-trim[0];
  if(length<=0)return trim[0];
  return trim[0]+((Math.max(start,trim[0])-trim[0]+elapsed)%length+length)%length;
}

// Canvas frames use their own clock. Publishing the time to React is limited
// to 10 Hz, so the editor and its form fields are not rebuilt at video cadence.
export function startPreviewPlayback({media,getDoc,clock,draw,publish,onError=()=>{},requestFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame,now=()=>performance.now(),seek=seekVideoFrame}) {
  let stopped=false,raf,videoCallback,lastDoc,lastFrame,lastPublish=-Infinity,loopSeeking=false;
  let serial=0;
  const origin=now(),start=clock.current;
  const video=media.video;
  const watchVideo=()=>{
    if(stopped || !video?.requestVideoFrameCallback)return;
    videoCallback=video.requestVideoFrameCallback(()=>{serial++;watchVideo();});
  };
  const fail=error=>{if(!stopped)onError(error);};
  if(video){
    watchVideo();
    (async()=>{if(Math.abs(video.currentTime*1000-start)>30)await seek(video,start);if(!stopped)await video.play();if(stopped)video.pause();})().catch(fail);
  }
  const tick=wall=>{
    if(stopped)return;
    const doc=getDoc(),trim=doc.trim;
    let time;
    if(video){
      if(!loopSeeking && (video.currentTime*1000>=trim[1] || video.ended || video.currentTime*1000<trim[0])){
        loopSeeking=true;
        (async()=>{await seek(video,trim[0]);if(!stopped)await video.play();})().catch(fail).finally(()=>{loopSeeking=false;});
      }
      time=Math.max(trim[0],Math.min(trim[1]-1,video.currentTime*1000));
    } else time=playbackTime(start,wall-origin,trim);
    clock.current=time;
    // Detached video elements may not receive compositor callbacks in every
    // browser. The media clock remains a fallback so playback cannot freeze.
    const key=video ? `${serial}:${Math.floor(video.currentTime*30)}` : frameAt(media.frames,time);
    const motion=doc.objects.some(o=>o.keyframes?.length);
    const ready=!video || (video.readyState>=2 && !video.seeking && !loopSeeking);
    if(ready && (motion || key!==lastFrame || doc!==lastDoc)){
      draw(time);lastFrame=key;lastDoc=doc;
    }
    if(wall-lastPublish>=100){publish(time);lastPublish=wall;}
    raf=requestFrame(tick);
  };
  raf=requestFrame(tick);
  return ()=>{
    stopped=true;cancelFrame(raf);
    if(video){video.pause();if(videoCallback!==undefined)video.cancelVideoFrameCallback?.(videoCallback);}
  };
}
