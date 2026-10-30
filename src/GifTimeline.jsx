import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Diamond, Film, Pause, Play, Scissors } from 'lucide-react';
import { IconButton } from './editor-controls';
import { canTrimMedia, clamp, formatTime, frameAt } from './engine';

export default function GifTimeline({media,doc,selected,time,setTime,playing,setPlaying,stepFrame,dragTrim,onAnimation,trimControls=true,animation=false}) {
  const trackRef=useRef(null);
  if(!media)return null;
  const sourceDuration=media.duration || 3000,trim=trimControls && canTrimMedia(media);
  const start=animation ? doc.trim[0] : 0,end=animation ? doc.trim[1] : sourceDuration,duration=Math.max(1,end-start);
  const displayTime=value=>animation ? value-start : value;
  const position=value=>clamp((value-start)/duration*100,0,100);
  const cursor=clamp(time,start,end-1);
  const seek=value=>{setPlaying(false);setTime(clamp(value,doc.trim[0],doc.trim[1]-1));};
  const scrub=event=>{
    const rect=trackRef.current.getBoundingClientRect();
    seek(start+(event.clientX-rect.left)/Math.max(1,rect.width)*duration);
  };
  const keydown=event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    if(event.key==='Home' || event.key==='End')seek(event.key==='Home' ? doc.trim[0] : doc.trim[1]-1);
    else stepFrame(event.key==='ArrowRight' ? 1 : -1);
  };
  const frameIndex=value=>media.isVideo ? Math.floor((value+.001)*(media.frameRate || 30)/1000) : frameAt(media.frames,value);
  const firstFrame=frameIndex(start),frame=frameIndex(cursor)-firstFrame+1,count=frameIndex(Math.max(start,end-1))-firstFrame+1;
  const keys=(selected?.keyframes || []).filter(key=>key.time>=start && key.time<=end);
  const playbackLabel=animation ? 'animation' : 'preview';
  return <section className="timeline" aria-label={animation ? 'Animation timeline' : 'GIF timeline'}>
    <div className="timeline-top">
      <div className="timeline-title"><Film size={14} /><strong>Timeline</strong></div>
      <div className="timeline-actions">{onAnimation && <button title="Edit object animation" onClick={onAnimation}><Scissors size={13} />Object animation</button>}<span>{formatTime(doc.trim[1]-doc.trim[0])}</span></div>
    </div>
    <div className="timeline-body">
      <div className="playback-controls">
        <IconButton icon={ChevronLeft} label="Previous frame" onClick={()=>stepFrame(-1)} />
        <button className="play-button" aria-label={`${playing ? 'Pause' : 'Play'} ${playbackLabel}`} onClick={()=>setPlaying(value=>!value)}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <IconButton icon={ChevronRight} label="Next frame" onClick={()=>stepFrame(1)} />
        <span className="time-display">{formatTime(displayTime(cursor))}<span> / {formatTime(duration)}</span></span>
      </div>
      <div className="timeline-track-area">
        <div className="timeline-ruler">{[0,.25,.5,.75,1].map(value=><span key={value}>{formatTime(duration*value)}</span>)}</div>
        <div className="filmstrip" role="slider" tabIndex={0} aria-label="Timeline playhead" aria-valuemin={0} aria-valuemax={duration-1} aria-valuenow={Math.round(displayTime(cursor))} aria-valuetext={formatTime(displayTime(cursor))}
          onKeyDown={keydown} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);scrub(event);}}
          onPointerMove={event=>{if(event.buttons===1 && event.currentTarget.hasPointerCapture(event.pointerId))scrub(event);}}
          onPointerUp={event=>event.currentTarget.releasePointerCapture?.(event.pointerId)} onPointerCancel={event=>event.currentTarget.releasePointerCapture?.(event.pointerId)}>
          <div className="thumbnail-row" ref={trackRef}>{Array.from({length:10},(_,index)=><FrameThumbnail key={index} media={media} time={start+index/10*duration} />)}</div>
          {!animation && <><div className="trim-shade start" style={{width:`${position(doc.trim[0])}%`}} /><div className="trim-shade end" style={{width:`${100-position(doc.trim[1])}%`}} /></>}
          {[0,1].map(index=><div key={index} className={`trim-boundary trim-boundary-${index}`} style={{left:`${position(doc.trim[index])}%`}} />)}
          {trim && [0,1].map(index=><button key={index} className={`trim-handle trim-handle-${index}`} aria-label={`Drag to trim ${index===0 ? 'beginning' : 'end'}`} title={`Drag to trim ${index===0 ? 'beginning' : 'end'}`} style={{left:`${position(doc.trim[index])}%`}} onPointerDown={event=>dragTrim(event,index,true)} onPointerMove={event=>dragTrim(event,index)} onPointerUp={event=>dragTrim(event,index)} onPointerCancel={event=>dragTrim(event,index)} onLostPointerCapture={event=>dragTrim(event,index)} onClick={event=>event.stopPropagation()}><span /></button>)}
          <div className="playhead" style={{left:`${position(cursor)}%`}}><span /></div>
          {keys.map(key=><button className="timeline-keyframe" key={key.time} title={`${key.visible===undefined ? 'Position' : key.visible ? 'Show' : 'Hide'} keyframe ${formatTime(displayTime(key.time))}`} style={{left:`${position(key.time)}%`}} onPointerDown={event=>{event.stopPropagation();seek(key.time);}}><Diamond size={12} fill="currentColor" /></button>)}
        </div>
      </div>
    </div>
    <div className="timeline-bottom"><span><span className="green-dot" />{media.isAnimated ? `Frame ${Math.min(frame,count)} / ${count}` : 'Still image'}</span><span><kbd>space</kbd> to {playing ? 'pause' : 'play'}</span></div>
  </section>;
}

function FrameThumbnail({media,time}) {
  const ref=useRef(null);
  useEffect(()=>{
    if(!ref.current)return;
    const canvas=ref.current,ctx=canvas.getContext('2d');
    const thumbnail=Math.min((media.thumbnails?.length || 1)-1,Math.round(time/media.duration*(media.thumbnails?.length || 1)));
    const image=media.thumbnails?.[thumbnail] || media.frames[frameAt(media.frames,time)].image;
    const ratio=Math.max(canvas.width/media.width,canvas.height/media.height),width=media.width*ratio,height=media.height*ratio;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,(canvas.width-width)/2,(canvas.height-height)/2,width,height);
  },[media,time]);
  return <canvas ref={ref} width="100" height="48" />;
}
