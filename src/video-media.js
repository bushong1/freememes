const makeCanvas=(width,height)=>{const c=document.createElement('canvas');c.width=width;c.height=height;return c;};

export function releaseVideo(video) {
  video.pause();video.removeAttribute('src');video.load();
}

export function openVideo(url) {
  const video=document.createElement('video');
  video.muted=true;video.playsInline=true;video.preload='auto';
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',ready);video.removeEventListener('error',error);};
    const ready=()=>{if(video.readyState<2)return;cleanup();resolve(video);};
    const error=()=>{cleanup();releaseVideo(video);reject(new Error('This browser could not decode the imported video. Please re-import the clip.'));};
    const timer=setTimeout(error,20000);
    video.addEventListener('loadeddata',ready);video.addEventListener('error',error);
    video.src=url;video.load();
  });
}

export function seekVideoFrame(video,time) {
  const target=Math.max(0,Math.min(time/1000,Math.max(0,video.duration-.001)));
  if(!video.seeking && Math.abs(video.currentTime-target)<.0001 && video.readyState>=2)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener('seeked',ready);video.removeEventListener('error',error);};
    const ready=()=>{if(video.seeking || video.readyState<2)return;cleanup();resolve();};
    const error=()=>{cleanup();reject(new Error('Could not seek to the requested video frame.'));};
    const timer=setTimeout(error,15000);
    video.addEventListener('seeked',ready);video.addEventListener('error',error);
    video.currentTime=target;
  });
}

export async function loadVideoMedia(file,videoSize={}) {
  const url=URL.createObjectURL(file);
  let video;
  try {
    video=await openVideo(url);
    const width=Number.isInteger(videoSize.width) && videoSize.width>0 && videoSize.width<=video.videoWidth ? videoSize.width : video.videoWidth;
    const height=Number.isInteger(videoSize.height) && videoSize.height>0 && videoSize.height<=video.videoHeight ? videoSize.height : video.videoHeight;
    const seconds=Math.min(video.duration,videoSize.duration>0 ? videoSize.duration : video.duration,60);
    if(!width || !height || !Number.isFinite(seconds) || seconds<=0)throw new Error('The imported video has invalid dimensions or duration.');
    const duration=Math.round(seconds*1000);
    // Lightweight timing placeholders; preview and GIF export use the native
    // clock/frame rate. No full decoded frame canvases are allocated here.
    const frames=Array.from({length:Math.ceil(duration/100)},(_,i)=>({delay:Math.min(100,duration-i*100)}));
    const thumbnails=[];
    const scale=Math.min(96/width,64/height);
    for(let i=0;i<10;i++){
      await seekVideoFrame(video,i/10*duration);
      const thumb=makeCanvas(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));
      thumb.getContext('2d').drawImage(video,0,0,width,height,0,0,thumb.width,thumb.height);
      thumbnails.push(thumb);
    }
    await seekVideoFrame(video,0);
    const frameRate=Number.isFinite(videoSize.frameRate) && videoSize.frameRate>0 ? videoSize.frameRate : 30;
    return {name:file.name,byteSize:file.size,width,height,video,url,frames,thumbnails,duration,frameRate,format:'mp4',isVideo:true,isAnimated:true,isGif:false,
      dispose:()=>{releaseVideo(video);URL.revokeObjectURL(url);}};
  } catch(error){if(video)releaseVideo(video);URL.revokeObjectURL(url);throw error;}
}

export async function createExportSource(media) {
  if(!media.video)return {media,dispose:()=>{}};
  // Export seeks its own decoder, so generating a GIF cannot move the preview.
  const video=await openVideo(media.url);
  return {media:{...media,video},dispose:()=>releaseVideo(video)};
}

export async function prepareMediaFrame(media,time) {
  if(media.video)await seekVideoFrame(media.video,time);
}
