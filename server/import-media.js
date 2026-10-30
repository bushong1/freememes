import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { classifySourceUrl, detectImageType, detectVideoType, getYouTubeClip, MAX_MEDIA_BYTES, MAX_YOUTUBE_BYTES, validateYouTubeMetadata } from '../src/media-source.js';

const exec = promisify(execFile);
export class ImportError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const blocked4 = new BlockList(), blocked6 = new BlockList();
for (const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked4.addSubnet(address,prefix,'ipv4');
for (const [address,prefix] of [['::',96],['::ffff:0:0',96],['64:ff9b::',96],['100::',64],['2001::',23],['2001:db8::',32],['2002::',16],['fc00::',7],['fe80::',10],['ff00::',8]]) blocked6.addSubnet(address,prefix,'ipv6');

export function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked4.check(address,'ipv4') : family === 6 && !blocked6.check(address,'ipv6');
}

// Pin the checked DNS address to the request and re-check each redirect.
// Image URLs cannot reach private services or local files through this proxy.
export async function fetchRemoteImage(source, { resolve = lookup, request, redirects = 0 } = {}) {
  const parsed = classifySourceUrl(source);
  if (parsed.type !== 'image') throw new ImportError('Use the YouTube importer for a video link.');
  const url = new URL(parsed.url), hostname = url.hostname.replace(/^\[|\]$/g,'');
  const addresses = await resolve(hostname,{ all:true,verbatim:true });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new ImportError('Use a public image URL. Local and private network addresses are not supported.');
  const address = addresses[0];
  const body = await new Promise((accept,reject) => {
    const transport = request || (url.protocol === 'https:' ? https.request : http.request);
    const req = transport(url,{
      method:'GET',headers:{'User-Agent':'FreeMemes/1.0','Accept':'image/*','Accept-Encoding':'identity'},
      lookup: (_host,options,callback) => options?.all ? callback(null,[address]) : callback(null,address.address,address.family),
    },res => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        res.resume();
        if (redirects >= 4 || !res.headers.location) return reject(new ImportError('This image URL redirects too many times. Use a direct link to the image.'));
        let destination;
        try { destination = new URL(res.headers.location,url).href; } catch { return reject(new ImportError('The image URL returned an invalid redirect.')); }
        accept(fetchRemoteImage(destination,{ resolve,request,redirects:redirects+1 })); return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(new ImportError(`The image host returned HTTP ${res.statusCode}. Try a direct public image link.`,422)); }
      if (+res.headers['content-length'] > MAX_MEDIA_BYTES) { res.destroy(); return reject(new ImportError('Choose an image smaller than 30 MB.',413)); }
      const chunks=[]; let size=0;
      res.on('data',chunk => {
        size+=chunk.length;
        if (size > MAX_MEDIA_BYTES) { reject(new ImportError('Choose an image smaller than 30 MB.',413)); res.destroy(); req.destroy(); }
        else chunks.push(chunk);
      });
      res.on('end',() => accept({ bytes:Buffer.concat(chunks),url:url.href }));
      res.on('error',() => reject(new ImportError('The image download was interrupted. Please try again.',502)));
    });
    const timer=setTimeout(() => req.destroy(new Error('Timed out')),20000); timer.unref();
    req.on('close',() => clearTimeout(timer));
    req.on('error',() => reject(new ImportError('Could not download that image. Check the link and try again.',502)));
    req.end();
  });
  const format=detectImageType(body.bytes);
  if (!format) throw new ImportError('That URL does not return an image. Use a direct PNG, GIF, WebP, JPEG, or AVIF link.',422);
  const filename=new URL(body.url).pathname.split('/').pop() || `image.${format.format}`;
  return { bytes:body.bytes,mime:format.mime,name:filename,sourceType:format.format };
}

export async function runCommand(command,args,timeout = 30000) {
  try { return await exec(command,args,{timeout,maxBuffer:4*1024*1024,windowsHide:true}); }
  catch (error) {
    if (error.code === 'ENOENT') throw new ImportError(`YouTube import needs ${command === (process.env.YT_DLP_PATH || 'yt-dlp') ? 'yt-dlp' : 'FFmpeg and ffprobe'} installed on the server. See the setup instructions in the README.`,503);
    if (error.killed) throw new ImportError('The video import timed out. Try again or choose a smaller video.',504);
    throw new ImportError('Could not import this video. It may be private, restricted, or unavailable. Check the link and try again.',422);
  }
}

export function getVideoDisplaySize(video) {
  if(!Number.isInteger(video?.width) || !Number.isInteger(video?.height) || video.width<=0 || video.height<=0)throw new ImportError('Could not determine this clip’s video dimensions.',422);
  const rotation=Number(video.side_data_list?.find(s=>s.rotation!==undefined)?.rotation || video.tags?.rotate || 0);
  return Math.abs(rotation)%180===90 ? {width:video.height,height:video.width} : {width:video.width,height:video.height};
}

export function getVideoFrameRate(video) {
  for(const rate of [video?.avg_frame_rate,video?.r_frame_rate]){
    const [numerator,denominator='1']=String(rate).split('/');
    const value=Number(numerator)/Number(denominator);
    if(Number.isFinite(value) && value>0)return value;
  }
  return 30;
}

export async function importYouTube(source,{ run = runCommand } = {}) {
  const parsed=classifySourceUrl(source);
  if (parsed.type !== 'youtube') throw new ImportError('Enter a link to a YouTube video.');
  const ytdlp=process.env.YT_DLP_PATH || 'yt-dlp';
  const videoUrl=`https://www.youtube.com/watch?v=${parsed.videoId}`;
  const common=['--ignore-config','--no-playlist','--no-cache-dir','--no-warnings','--no-progress','--socket-timeout','15','--retries','1','--js-runtimes',`node:${process.execPath}`];
  const result=await run(ytdlp,[...common,'--dump-single-json','--skip-download','--',videoUrl],30000);
  let info;
  try { info=JSON.parse(result.stdout); } catch { throw new ImportError('Could not read this video’s information. Please try another link.',422); }
  const clip=getYouTubeClip(info,parsed.startSeconds);
  const dir=await mkdtemp(path.join(tmpdir(),'freememes-import-'));
  try {
    // Download the selected range rather than the full source. Re-encoding at
    // the cut avoids starting at an earlier keyframe. The size cap applies to
    // FFmpeg's clip output, not the full video's advertised filesize.
    await run(ytdlp,[...common,'--match-filter','!is_live',
      '--download-sections',`*${clip.startSeconds}-${clip.endSeconds}`,'--force-keyframes-at-cuts',
      ...(process.env.FFMPEG_PATH ? ['--ffmpeg-location',process.env.FFMPEG_PATH] : []),
      '--downloader-args',`ffmpeg_o:-fs ${MAX_YOUTUBE_BYTES+1}`,
      '--format','bv/b',
      '--output',path.join(dir,'source.%(ext)s'),'--',videoUrl],120000);
    const file=(await readdir(dir)).find(f => /^source\.[a-z0-9]+$/.test(f));
    if (!file) throw new ImportError('The video could not be downloaded within the size and duration limits.',422);
    const input=path.join(dir,file);
    if ((await stat(input)).size > MAX_YOUTUBE_BYTES) throw new ImportError('The downloaded YouTube clip exceeds the 200 MB limit.',413);
    const probe=await run(process.env.FFPROBE_PATH || 'ffprobe',['-v','error','-protocol_whitelist','file,pipe','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate,r_frame_rate:stream_tags=rotate:stream_side_data=rotation:format=duration','-of','json',input],10000);
    let actualDuration,video;
    try { const data=JSON.parse(probe.stdout);actualDuration=Number(data.format.duration);video=data.streams?.[0]; } catch { /* fail closed below */ }
    validateYouTubeMetadata({ duration:actualDuration });
    // Allow small container/frame rounding, then impose the exact maximum on
    // conversion. A full source returned in place of its section is rejected.
    if (actualDuration > clip.duration + .25) throw new ImportError('The downloaded clip exceeds the requested range. Please try again.',422);
    const duration=Math.min(clip.duration,actualDuration);
    const {width,height}=getVideoDisplaySize(video);
    const output=path.join(dir,'result.mp4');
    // Keep native video cadence. Pad an odd edge for browser-compatible H.264;
    // the editor uses the original visible dimensions and excludes that edge.
    await run(process.env.FFMPEG_PATH || 'ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe','-i',input,'-t',String(duration),'-an',
      '-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',
      '-fs',String(MAX_YOUTUBE_BYTES+1),'-y',output],90000);
    if((await stat(output)).size>MAX_YOUTUBE_BYTES)throw new ImportError('This YouTube animation exceeds the 200 MB limit.',413);
    const bytes=await readFile(output);
    if(!detectVideoType(bytes))throw new ImportError('The video could not be prepared for playback.',422);

    const title=String(info.title || 'YouTube video').replace(/[\x00-\x1f/\\]/g,' ').slice(0,160);
    return { bytes,mime:'video/mp4',name:`${title}.mp4`,sourceType:'youtube',width,height,frameRate:getVideoFrameRate(video),duration,startSeconds:clip.startSeconds,endSeconds:clip.startSeconds+duration };
  } finally { await rm(dir,{recursive:true,force:true}); }
}

export function createImportMiddleware({ image = fetchRemoteImage, youtube = importYouTube } = {}) {
  let active=0;
  return async (req,res,next) => {
    const pathname=req.url?.split('?')[0];
    if (pathname !== '/api/import') return next?.();
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    try {
      if (req.method !== 'POST') { res.setHeader('Allow','POST'); throw new ImportError('Use POST to import a URL.',405); }
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new ImportError('Import URLs from this app’s own page.',403);
      if (active >= 2) throw new ImportError('Two imports are already running. Try again in a moment.',429);
      let body='';
      for await (const chunk of req) { body+=chunk.toString(); if (Buffer.byteLength(body)>4096) throw new ImportError('The URL is too long.',413); }
      let data;
      try { data=JSON.parse(body); } catch { throw new ImportError('Enter a valid image or YouTube URL.'); }
      if (typeof data?.url !== 'string' || data.url.length > 2048) throw new ImportError('Enter an image or YouTube URL.');
      const source=classifySourceUrl(data.url);
      active++;
      let result;
      try { result=await (source.type === 'youtube' ? youtube(source.url) : image(source.url)); }
      finally { active--; }
      res.statusCode=200;
      res.setHeader('Content-Type',result.mime);
      res.setHeader('Content-Length',result.bytes.length);
      res.setHeader('X-Media-Name',encodeURIComponent(result.name));
      res.setHeader('X-Media-Source',result.sourceType);
      if(result.width)res.setHeader('X-Media-Width',String(result.width));
      if(result.height)res.setHeader('X-Media-Height',String(result.height));
      if(result.duration)res.setHeader('X-Media-Duration',String(result.duration));
      if(result.frameRate)res.setHeader('X-Media-Frame-Rate',String(result.frameRate));
      res.end(result.bytes);
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      res.statusCode=error.status || (error instanceof TypeError ? 502 : 400);
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({error:error.message || 'Import failed. Please try again.'}));
    }
  };
}
