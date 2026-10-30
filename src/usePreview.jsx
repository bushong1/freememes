import { useCallback, useEffect, useRef, useState } from 'react';
import { renderScene, canvasSize } from './engine';
import { previewSize, startPreviewPlayback } from './preview';
import { seekVideoFrame } from './video-media';

export default function usePreview({media,doc,images,canvasRef,surfaceRef,onError}) {
  const [time,publish]=useState(0),[playing,setPlayingState]=useState(false);
  const timeRef=useRef(0),playingRef=useRef(false),current=useRef(),width=useRef(0);
  current.current={media,doc,onError};
  const draw=useCallback(at=>{
    const state=current.current;
    if(!state.media || !canvasRef.current)return;
    renderScene(canvasRef.current,state.media,state.doc,at,images.current,width.current || Math.min(960,state.doc.crop.width));
  },[canvasRef,images]);
  const setTime=useCallback(value=>{
    const next=typeof value==='function' ? value(timeRef.current) : value;
    timeRef.current=next;publish(next);
  },[]);
  const setPlaying=useCallback(value=>{
    const next=typeof value==='function' ? value(playingRef.current) : value;
    playingRef.current=next;
    if(!next){
      const video=current.current.media?.video;
      if(video){video.pause();timeRef.current=video.currentTime*1000;}
      publish(timeRef.current);
    }
    setPlayingState(next);
  },[]);
  useEffect(()=>{
    timeRef.current=0;publish(0);playingRef.current=false;setPlayingState(false);
    media?.video?.pause();
  },[media]);
  useEffect(()=>{
    const resize=()=>{
      const rect=surfaceRef.current?.getBoundingClientRect();
      width.current=previewSize(canvasSize(doc),rect?.width || 960,window.devicePixelRatio || 1).width;
      if(!media?.video || media.video.readyState>=2)draw(timeRef.current);
    };
    resize();
    const observer=globalThis.ResizeObserver ? new ResizeObserver(resize) : null;
    if(surfaceRef.current)observer?.observe(surfaceRef.current);
    window.addEventListener('resize',resize);
    return ()=>{observer?.disconnect();window.removeEventListener('resize',resize);};
  },[media,doc.crop,doc.padding,draw,surfaceRef]);
  useEffect(()=>{
    if(playing || !media)return;
    let cancelled=false;
    if(media.video){
      seekVideoFrame(media.video,timeRef.current).then(()=>{if(!cancelled)draw(timeRef.current);}).catch(error=>{if(!cancelled)current.current.onError(error.message);});
    } else draw(timeRef.current);
    return ()=>{cancelled=true;};
  },[media,doc,time,playing,draw]);
  useEffect(()=>{
    if(!playing || !media)return;
    return startPreviewPlayback({media,getDoc:()=>current.current.doc,clock:timeRef,draw,publish,
      onError:error=>{setPlaying(false);current.current.onError(error.message || 'Playback could not start.');}});
  },[playing,media,doc.trim[0],doc.trim[1],draw,setPlaying]);
  useEffect(()=>()=>media?.dispose?.(),[media]);
  return {time,setTime,timeRef,playing,setPlaying};
}
