import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { access, copyFile, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createImportMiddleware, fetchRemoteImage, importYouTube, isPublicAddress, runCommand, getVideoDisplaySize, getVideoFrameRate } from '../server/import-media.js';
import { MAX_MEDIA_BYTES, MAX_YOUTUBE_BYTES } from '../src/media-source.js';

const youtube='https://youtube.com/watch?v=AbCdEfGh_-0';
const mp4=Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,50]);
const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');

test('video frame rate accepts fractional metadata and falls back for missing or invalid rates', () => {
  assert.equal(getVideoFrameRate({avg_frame_rate:'30000/1001'}),30000/1001);
  assert.equal(getVideoFrameRate({avg_frame_rate:'0/0',r_frame_rate:'25/1'}),25);
  assert.equal(getVideoFrameRate({avg_frame_rate:'-1',r_frame_rate:'nope'}),30);
});

function videoRunner({duration=12,actual,width=474,height=843,live=false,failConvert=false,sourceBytes=0,preparedBytes=0}={}) {
  const calls=[];let dir,sectionDuration=duration;
  const run=async (command,args) => {
    calls.push({command,args});
    if (args.includes('--dump-single-json')) return {stdout:JSON.stringify({duration,is_live:live,title:'My video'})};
    if (args.includes('--output')) {
      const [start,end]=args[args.indexOf('--download-sections')+1].slice(1).split('-').map(Number);
      sectionDuration=end-start;
      dir=path.dirname(args[args.indexOf('--output')+1]);
      await writeFile(path.join(dir,'source.mp4'),'video fixture');
      if(sourceBytes)await truncate(path.join(dir,'source.mp4'),sourceBytes);
      return {stdout:''};
    }
    if (args.includes('-show_entries')) return {stdout:JSON.stringify({format:{duration:String(actual ?? sectionDuration)},streams:[{width,height}]})};
    if (failConvert) throw new Error('Conversion failed');
    await writeFile(args[args.length-1],mp4);
    if(preparedBytes)await truncate(args[args.length-1],preparedBytes);
    return {stdout:''};
  };
  return {run,calls,directory:() => dir};
}

test('a copied current-time link imports seconds 120 through 180 from a long video', async () => {
  const runner=videoRunner({duration:600});
  const result=await importYouTube(youtube+'&t=120',runner);
  assert.equal(result.startSeconds,120);assert.equal(result.endSeconds,180);assert.equal(result.duration,60);
  const download=runner.calls[1].args;
  assert.equal(download[download.indexOf('--download-sections')+1],'*120-180');
  assert.ok(download.includes('--force-keyframes-at-cuts'));
  assert.ok(download.includes(`ffmpeg_o:-fs ${MAX_YOUTUBE_BYTES+1}`));
  assert.ok(!download.includes('--max-filesize'));
  assert.ok(!download.includes('duration <= 60 & !is_live'));
  assert.equal(runner.calls[3].args[runner.calls[3].args.indexOf('-t')+1],'60');
  await assert.rejects(() => access(runner.directory()));
});

test('YouTube download and prepared video can exceed the regular 30 MB limit', async () => {
  const runner=videoRunner({sourceBytes:MAX_MEDIA_BYTES+1,preparedBytes:MAX_MEDIA_BYTES+1});
  const result=await importYouTube(youtube,runner);
  assert.equal(result.bytes.length,MAX_MEDIA_BYTES+1);
  const convert=runner.calls[3].args;
  assert.equal(convert[convert.indexOf('-fs')+1],String(MAX_YOUTUBE_BYTES+1));
  await assert.rejects(()=>access(runner.directory()));
});

test('YouTube sources over 200 MB are rejected before probing and removed', async () => {
  const runner=videoRunner({sourceBytes:MAX_YOUTUBE_BYTES+1});
  await assert.rejects(()=>importYouTube(youtube,runner),/200 MB limit/);
  assert.equal(runner.calls.length,2);
  await assert.rejects(()=>access(runner.directory()));
});

test('prepared videos over 200 MB are rejected before reading into memory', async () => {
  const runner=videoRunner({preparedBytes:MAX_YOUTUBE_BYTES+1});
  await assert.rejects(()=>importYouTube(youtube,runner),/200 MB limit/);
  assert.equal(runner.calls.length,4);
  await assert.rejects(()=>access(runner.directory()));
});

test('without a timestamp, long videos import only the first 60 seconds', async () => {
  const runner=videoRunner({duration:600});
  const result=await importYouTube(youtube,runner);
  assert.equal(result.duration,60);assert.equal(result.startSeconds,0);
  assert.ok(runner.calls[1].args.includes('*0-60'));
});

test('portrait imports retain native video cadence without a frame budget or downscaling', async () => {
  const runner=videoRunner({duration:60,width:474,height:843});
  const result=await importYouTube(youtube,runner);
  const download=runner.calls[1].args,convert=runner.calls[3].args;
  assert.equal(download[download.indexOf('--format')+1],'bv/b');
  assert.ok(convert.includes('libx264'));assert.ok(convert.includes('yuv420p'));
  assert.ok(!convert.some(arg=>arg.includes('fps=') || arg.includes('scale=')));
  assert.ok(!convert.includes('-frames:v'));
  assert.equal(result.width,474);assert.equal(result.height,843);
  assert.equal(result.mime,'video/mp4');
});

test('visible video dimensions respect rotation and reject invalid metadata', () => {
  assert.deepEqual(getVideoDisplaySize({width:474,height:843}),{width:474,height:843});
  assert.deepEqual(getVideoDisplaySize({width:1920,height:1080,side_data_list:[{rotation:90}]}),{width:1080,height:1920});
  assert.deepEqual(getVideoDisplaySize({width:1920,height:1080,tags:{rotate:'-90'}}),{width:1080,height:1920});
  for(const width of [0,-1,undefined,474.5])assert.throws(()=>getVideoDisplaySize({width,height:843}),/dimensions/);
});

test('timestamps at or beyond the end are rejected before downloading', async () => {
  const runner=videoRunner({duration:120});
  await assert.rejects(() => importYouTube(youtube+'&t=120',runner),/earlier starting point/);
  assert.equal(runner.calls.length,1);assert.equal(runner.directory(),undefined);
});

test('live and unknown-duration YouTube sources never download', async () => {
  for (const options of [{duration:null},{duration:12,live:true}]) {
    const runner=videoRunner(options);
    await assert.rejects(() => importYouTube(youtube,runner));
    assert.equal(runner.calls.length,1);
  }
});

test('accepted YouTube video is prepared for native playback and temporary media is removed', async () => {
  const runner=videoRunner({duration:60});
  const result=await importYouTube(youtube+'&start=50&end=55',runner);
  assert.equal(result.mime,'video/mp4');assert.equal(result.sourceType,'youtube');assert.equal(result.duration,10);
  assert.equal(result.startSeconds,50);assert.equal(result.endSeconds,60);
  assert.equal(result.name,'My video.mp4');assert.deepEqual(result.bytes,mp4);
  assert.equal(runner.calls.length,4);
  assert.equal(runner.calls[0].args.at(-1),'https://www.youtube.com/watch?v=AbCdEfGh_-0');
  assert.ok(runner.calls[1].args.includes('*50-60'));
  assert.ok(runner.calls[3].args.includes('libx264'));
  assert.ok(!runner.calls[3].args.some(arg=>arg.includes('scale=')));
  assert.equal(runner.calls[3].args[runner.calls[3].args.indexOf('-t')+1],'10');
  await assert.rejects(() => access(runner.directory()));
});

test('downloaded video duration is independently checked before conversion', async () => {
  const runner=videoRunner({duration:59,actual:61});
  await assert.rejects(() => importYouTube(youtube,runner),/exceeds the requested range/);
  assert.equal(runner.calls.length,3);
  await assert.rejects(() => access(runner.directory()));
});

test('failed conversions also remove all temporary downloads', async () => {
  const runner=videoRunner({failConvert:true});
  await assert.rejects(() => importYouTube(youtube,runner),/Conversion failed/);
  await assert.rejects(() => access(runner.directory()));
});

test('image proxy rejects local, private, mapped, and link-local addresses', async () => {
  for (const address of ['127.0.0.1','10.0.0.1','172.31.1.1','192.168.1.1','169.254.169.254','0.0.0.0','100.64.0.1','::1','fe80::1','fc00::1','::ffff:127.0.0.1','::ffff:169.254.169.254']) assert.equal(isPublicAddress(address),false,address);
  for (const address of ['1.1.1.1','8.8.8.8','93.184.216.34','2606:4700:4700::1111']) assert.equal(isPublicAddress(address),true,address);
  await assert.rejects(() => fetchRemoteImage('http://localhost/image.png',{resolve:async()=>[{address:'127.0.0.1',family:4}]}),/public image URL/);
});

function mockTransport(body,{status=200,headers={}}={}) {
  return (_url,options,callback) => {
    const req=new EventEmitter();
    req.end=() => queueMicrotask(() => { const res=Readable.from([body]);res.statusCode=status;res.headers=headers;callback(res); });
    req.destroy=error=>{if(error)req.emit('error',error);req.emit('close');};
    return req;
  };
}
const publicDNS=async()=>[{address:'93.184.216.34',family:4}];

test('remote images are detected from bytes despite misleading names and headers', async () => {
  const result=await fetchRemoteImage('https://example.com/claims-to-be.png',{resolve:publicDNS,request:mockTransport(gif,{headers:{'content-type':'image/png'}})});
  assert.equal(result.mime,'image/gif');assert.equal(result.sourceType,'gif');
  assert.deepEqual(result.bytes,gif);
});

test('image proxy rejects HTML pages and oversized responses', async () => {
  await assert.rejects(() => fetchRemoteImage('https://example.com/image.gif',{resolve:publicDNS,request:mockTransport(Buffer.from('<html>not an image</html>'))}),/does not return an image/);
  await assert.rejects(() => fetchRemoteImage('https://example.com/image.gif',{resolve:publicDNS,request:mockTransport(gif,{headers:{'content-length':31*1024*1024}})}),/smaller than 30 MB/);
});

test('redirect destinations are checked again for private network access', async () => {
  await assert.rejects(() => fetchRemoteImage('https://example.com/image',{resolve:async host=>[{address:host==='example.com'?'93.184.216.34':'127.0.0.1',family:4}],request:mockTransport(Buffer.alloc(0),{status:302,headers:{location:'http://localhost/secret.png'}})}),/public image URL/);
});

async function apiRequest(middleware,body,{method='POST',origin,host='freememes.local'}={}) {
  const request=Readable.from([typeof body === 'string'?body:JSON.stringify(body)]);request.method=method;request.url='/api/import';request.headers={host,...origin?{origin}:{}};
  const headers={};let output;
  const response={statusCode:200,setHeader:(k,v)=>headers[k]=v,end:body=>output=body};
  await middleware(request,response);
  return {status:response.statusCode,headers,body:output};
}

test('import API routes YouTube automatically and returns typed video bytes and visible dimensions', async () => {
  let received;
  const middleware=createImportMiddleware({youtube:async url=>{received=url;return{bytes:mp4,mime:'video/mp4',name:'A video.mp4',sourceType:'youtube',width:474,height:843,duration:60,frameRate:25};}});
  const response=await apiRequest(middleware,{url:youtube+'&t=50'});
  assert.equal(received,'https://www.youtube.com/watch?v=AbCdEfGh_-0&t=50');
  assert.equal(response.status,200);assert.deepEqual(response.body,mp4);
  assert.equal(response.headers['X-Media-Source'],'youtube');assert.equal(response.headers['Content-Type'],'video/mp4');
  assert.equal(response.headers['X-Media-Width'],'474');assert.equal(response.headers['X-Media-Height'],'843');assert.equal(response.headers['X-Media-Duration'],'60');
  assert.equal(response.headers['X-Media-Frame-Rate'],'25');
});

test('import API rejects invalid methods, cross-origin requests, bad JSON, and invalid URLs', async () => {
  const middleware=createImportMiddleware();
  assert.equal((await apiRequest(middleware,{}, {method:'GET'})).status,405);
  assert.equal((await apiRequest(middleware,{url:youtube},{origin:'https://other.example'})).status,403);
  assert.equal((await apiRequest(middleware,'{broken json')).status,400);
  assert.equal((await apiRequest(middleware,{url:'file:///etc/passwd'})).status,400);
});

test('out-of-range timestamps propagate through the API as readable errors', async () => {
  const runner=videoRunner({duration:120});
  const middleware=createImportMiddleware({youtube:url=>importYouTube(url,runner)});
  const response=await apiRequest(middleware,{url:youtube+'&t=120'});
  assert.equal(response.status,400);
  assert.match(JSON.parse(response.body).error,/earlier starting point/);
  assert.equal(runner.calls.length,1);
});

async function probePrepared(result,dir) {
  const file=path.join(dir,'prepared.mp4');await writeFile(file,result.bytes);
  const probe=await runCommand(process.env.FFPROBE_PATH,['-v','error','-select_streams','v:0','-show_entries','stream=width,height,codec_name,pix_fmt,avg_frame_rate,nb_frames:format=duration','-of','json',file]);
  return {file,...JSON.parse(probe.stdout)};
}

test('real import keeps video frames for native playback', {skip:!process.env.FFMPEG_PATH || !process.env.FFPROBE_PATH}, async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'freememes-conversion-test-'));
  try {
    const fixture=path.join(dir,'video.mp4');
    await runCommand(process.env.FFMPEG_PATH,['-nostdin','-loglevel','error','-f','lavfi','-i','testsrc2=size=160x90:rate=30','-t','1.2','-pix_fmt','yuv420p','-c:v','libx264','-an','-y',fixture]);
    const run=async (command,args,timeout) => {
      if (args.includes('--dump-single-json')) return {stdout:JSON.stringify({title:'Conversion test',duration:1.2})};
      if (args.includes('--output')) { await copyFile(fixture,path.join(path.dirname(args[args.indexOf('--output')+1]),'source.mp4'));return {stdout:''}; }
      return runCommand(command,args,timeout);
    };
    const result=await importYouTube(youtube,{run});
    const probe=await probePrepared(result,dir);
    assert.equal(result.frameRate,30);
    assert.equal(probe.streams[0].width,160);assert.equal(probe.streams[0].height,90);
    assert.equal(probe.streams[0].codec_name,'h264');assert.equal(probe.streams[0].pix_fmt,'yuv420p');
    assert.equal(probe.streams[0].avg_frame_rate,'30/1');assert.equal(probe.streams[0].nb_frames,'36');
    assert.ok(Math.abs(Number(probe.format.duration)-1.2)<.05);

  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('real conversion retains a 474x843 portrait including its odd source height', {skip:!process.env.FFMPEG_PATH || !process.env.FFPROBE_PATH}, async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'freememes-portrait-test-'));
  try {
    const fixture=path.join(dir,'portrait.mkv');
    // RGB/FFV1 keeps the exact odd height; YUV420 test generators round it down.
    await runCommand(process.env.FFMPEG_PATH,['-nostdin','-loglevel','error','-f','lavfi','-i','testsrc=size=474x843:rate=10','-t','1.2','-c:v','ffv1','-pix_fmt','bgr0','-an','-y',fixture]);
    const run=async (command,args,timeout) => {
      if(args.includes('--dump-single-json'))return {stdout:JSON.stringify({title:'Portrait resolution test',duration:1.2,width:474,height:843})};
      if(args.includes('--output')){await copyFile(fixture,path.join(path.dirname(args[args.indexOf('--output')+1]),'source.mkv'));return {stdout:''};}
      return runCommand(command,args,timeout);
    };
    const result=await importYouTube(youtube,{run});
    const probe=await probePrepared(result,dir);
    assert.equal(result.width,474);assert.equal(result.height,843);
    assert.equal(probe.streams[0].width,474);assert.equal(probe.streams[0].height,844);
    assert.equal(probe.streams[0].avg_frame_rate,'10/1');
    assert.equal(probe.streams[0].pix_fmt,'yuv420p');

  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('real yt-dlp section download seeks to the copied timestamp before native playback', {skip:!process.env.YT_DLP_TEST_PATH || !process.env.FFMPEG_PATH || !process.env.FFPROBE_PATH}, async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'freememes-section-test-'));
  try {
    // A cut inside a GOP must begin in the blue portion, not the preceding red.
    const fixture=path.join(dir,'colors.mp4'),infoPath=path.join(dir,'info.json');
    await runCommand(process.env.FFMPEG_PATH,['-nostdin','-loglevel','error',
      '-f','lavfi','-i','color=red:size=160x90:rate=10:duration=1',
      '-f','lavfi','-i','color=blue:size=160x90:rate=10:duration=2',
      '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0',
      '-c:v','libx264','-g','1000','-sc_threshold','0','-an','-y',fixture]);
    // Select the HTTPS/FFmpeg downloader used for YouTube, but read a local
    // fixture so this checks real section handling without network access.
    await writeFile(infoPath,JSON.stringify({id:'local-colors',title:'Color section',duration:3,url:pathToFileURL(fixture).href,ext:'mp4',extractor:'generic',extractor_key:'Generic',protocol:'https',width:160,height:90,format_id:'local',vcodec:'h264',acodec:'none',filesize:100*1024*1024}));
    const run=async (command,args,timeout) => {
      if(args.includes('--dump-single-json'))return {stdout:JSON.stringify({title:'Color section',duration:3})};
      if(args.includes('--output')){
        const localArgs=args.slice(0,args.indexOf('--'));
        return promisify(execFile)(process.env.PYTHON_PATH || 'python3',[process.env.YT_DLP_TEST_PATH,...localArgs,'--enable-file-urls','--load-info-json',infoPath],{timeout,maxBuffer:4*1024*1024});
      }
      return runCommand(command,args,timeout);
    };
    const result=await importYouTube(youtube+'&t=1',{run});
    assert.equal(result.startSeconds,1);assert.ok(result.duration<=2);
    const probe=await probePrepared(result,dir);
    const frame=await promisify(execFile)(process.env.FFMPEG_PATH,['-nostdin','-loglevel','error','-i',probe.file,'-vf','scale=1:1','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{encoding:'buffer',maxBuffer:1024*1024});
    const [red,,blue]=frame.stdout;
    assert.ok(blue>180 && red<50,`Expected blue at the requested cut, got red=${red}, blue=${blue}`);
    assert.ok(Math.abs(Number(probe.format.duration)-2)<.1);

  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('real yt-dlp prefers the 474x843 portrait WebM over a lower-resolution MP4', {skip:!process.env.YT_DLP_TEST_PATH || !process.env.FFMPEG_PATH || !process.env.FFPROBE_PATH}, async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'freememes-portrait-download-test-'));
  try {
    const high=path.join(dir,'high.webm'),low=path.join(dir,'low.mp4'),infoPath=path.join(dir,'info.json');
    await runCommand(process.env.FFMPEG_PATH,['-nostdin','-loglevel','error','-f','lavfi','-i','testsrc=size=474x843:rate=10','-t','1.2','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-an','-y',high]);
    await runCommand(process.env.FFMPEG_PATH,['-nostdin','-loglevel','error','-f','lavfi','-i','testsrc2=size=136x240:rate=10','-t','1.2','-c:v','libx264','-an','-y',low]);
    await writeFile(infoPath,JSON.stringify({id:'portrait-formats',title:'Portrait formats',duration:1.2,extractor:'generic',extractor_key:'Generic',formats:[
      {format_id:'low-mp4',url:pathToFileURL(low).href,ext:'mp4',protocol:'https',width:136,height:240,vcodec:'h264',acodec:'none'},
      {format_id:'high-webm',url:pathToFileURL(high).href,ext:'webm',protocol:'https',width:474,height:843,vcodec:'vp9',acodec:'none'},
    ]}));
    const run=async(command,args,timeout)=>{
      if(args.includes('--dump-single-json'))return {stdout:JSON.stringify({title:'Portrait formats',duration:1.2,width:474,height:843})};
      if(args.includes('--output'))return promisify(execFile)(process.env.PYTHON_PATH || 'python3',[process.env.YT_DLP_TEST_PATH,...args.slice(0,args.indexOf('--')),'--enable-file-urls','--load-info-json',infoPath],{timeout,maxBuffer:4*1024*1024});
      return runCommand(command,args,timeout);
    };
    const result=await importYouTube(youtube,{run});
    const probe=await probePrepared(result,dir);
    assert.equal(result.width,474);assert.equal(result.height,843);
    assert.equal(probe.streams[0].width,474);assert.equal(probe.streams[0].height,844);

  } finally { await rm(dir,{recursive:true,force:true}); }
});
