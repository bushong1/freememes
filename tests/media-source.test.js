import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySourceUrl, detectImageType, detectVideoType, getYouTubeClip, parseYouTubeTimestamp, validateMediaSize, validateYouTubeMetadata, MAX_YOUTUBE_BYTES, MAX_MEDIA_BYTES, MAX_GIF_BYTES } from '../src/media-source.js';

test('native MP4 detection does not mistake AVIF or image payloads for video', () => {
  assert.deepEqual(detectVideoType(Buffer.from('\0\0\0\x18ftypisom')), {format:'mp4',mime:'video/mp4',label:'MP4'});
  for(const bytes of [Buffer.from('\0\0\0\x20ftypavif'),Buffer.from('GIF89a'),Buffer.from('RIFF0000WEBPVP8 '),Buffer.from('<html>error</html>'),new Uint8Array()])assert.equal(detectVideoType(bytes),null);
});

test('GIF uploads and YouTube imports accept up to 200 MB while other images stay at 30 MB', () => {
  assert.equal(MAX_YOUTUBE_BYTES,200*1024*1024);
  assert.equal(MAX_GIF_BYTES,200*1024*1024);
  assert.doesNotThrow(()=>validateMediaSize(MAX_GIF_BYTES,'gif'));
  assert.throws(()=>validateMediaSize(MAX_GIF_BYTES+1,'gif'),/GIF files.*200 MB/);
  assert.doesNotThrow(()=>validateMediaSize(MAX_YOUTUBE_BYTES,'youtube'));
  assert.throws(()=>validateMediaSize(MAX_YOUTUBE_BYTES+1,'youtube'),/200 MB/);
  assert.doesNotThrow(()=>validateMediaSize(MAX_MEDIA_BYTES));
  assert.throws(()=>validateMediaSize(MAX_MEDIA_BYTES+1),/30 MB/);
  for(const type of ['png','jpeg','webp','avif'])assert.throws(()=>validateMediaSize(MAX_MEDIA_BYTES+1,type),/30 MB/);
});

test('image types are identified by bytes even without extensions or MIME headers', () => {
  assert.equal(detectImageType(Uint8Array.of(137,80,78,71,13,10,26,10)).format,'png');
  assert.equal(detectImageType(Buffer.from('GIF89a')).format,'gif');
  assert.equal(detectImageType(Buffer.from('GIF87a')).format,'gif');
  assert.equal(detectImageType(Buffer.from('RIFF0000WEBPVP8 ')).format,'webp');
  assert.equal(detectImageType(Uint8Array.of(255,216,255,224)).format,'jpeg');
  assert.equal(detectImageType(Buffer.from('\0\0\0\x20ftypavif')).format,'avif');
  assert.equal(detectImageType(Buffer.from('<html>not an image</html>')),null);
  assert.equal(detectImageType(Buffer.from('GIF8garbage')),null);
  assert.equal(detectImageType(new Uint8Array()),null);
});

test('WebP animation flag distinguishes animation from a still image', () => {
  const bytes=Buffer.alloc(32);bytes.write('RIFF',0);bytes.write('WEBPVP8X',8);
  assert.equal(detectImageType(bytes).animated,false);
  bytes[20]=2;
  assert.equal(detectImageType(bytes).animated,true);
});

test('image URL hints support query strings and do not require an extension', () => {
  assert.deepEqual(classifySourceUrl(' https://example.com/photo.PNG?size=400 '),{type:'image',url:'https://example.com/photo.PNG?size=400',label:'PNG'});
  assert.equal(classifySourceUrl('https://example.com/photo.webp?token=1').label,'WebP');
  assert.equal(classifySourceUrl('https://example.com/asset/123').type,'image');
  assert.equal(classifySourceUrl('example.com/cat.gif').url,'https://example.com/cat.gif');
});

test('YouTube watch, shortened, shorts, mobile, and embed URLs normalize to one video', () => {
  const id='AbCdEfGh_-0';
  for (const link of [`https://youtube.com/watch?v=${id}`,`https://youtu.be/${id}?t=40`,`https://www.youtube.com/shorts/${id}`,`https://m.youtube.com/watch?v=${id}&list=PL123`,`https://youtube-nocookie.com/embed/${id}`,`youtube.com/watch?v=${id}`]) {
    const startSeconds=link.includes('t=40') ? 40 : 0;
    assert.deepEqual(classifySourceUrl(link),{type:'youtube',videoId:id,startSeconds,url:`https://www.youtube.com/watch?v=${id}${startSeconds?'&t=40':''}`,label:'YouTube'});
  }
});

test('current-time links retain their timestamp through repeated URL normalization', () => {
  const result=classifySourceUrl('https://youtube.com/watch?v=AbCdEfGh_-0&start=300&end=305&t=300');
  assert.equal(result.url,'https://www.youtube.com/watch?v=AbCdEfGh_-0&t=300');
  assert.equal(result.startSeconds,300);
  assert.deepEqual(classifySourceUrl(result.url),result);
  // An unrelated end parameter does not change the requested next 60 seconds.
  assert.deepEqual(getYouTubeClip({duration:600},result.startSeconds),{startSeconds:300,endSeconds:360,duration:60});
});

test('YouTube timestamp formats include seconds, units, start, and fragments', () => {
  const cases=[['120',120],['120s',120],['2m',120],['2m0s',120],['1h2m3s',3723],['02:00',120],['1:02:03.5',3723.5],['2:00.5',120.5],['0',0],[null,0]];
  for(const [text,seconds] of cases)assert.equal(parseYouTubeTimestamp(text),seconds);
  for(const suffix of ['&t=120','&t=2m','&start=120','&time_continue=120','#t=2m']){
    assert.equal(classifySourceUrl(`https://youtube.com/watch?v=AbCdEfGh_-0${suffix}`).startSeconds,120);
  }
  for(const text of ['', '-1','nope','1e3','Infinity','1:99','1m2h','99999999999999999999'])assert.throws(()=>parseYouTubeTimestamp(text),/timestamp is invalid/);
});

test('invalid sources and YouTube playlists/channels are rejected', () => {
  for (const input of ['', 'not a url', 'javascript:alert(1)', 'file:///etc/passwd', 'data:image/png;base64,AAA', 'https://user:password@example.com/a.png', 'https://example.com:8080/a.png', 'https://youtube.com/playlist?list=PL123', 'https://youtube.com/@someone', 'https://youtu.be/invalid']) {
    assert.throws(() => classifySourceUrl(input),Error,input);
  }
  assert.equal(classifySourceUrl('https://youtube.com.evil.example/image.png').type,'image');
});

test('long videos are accepted while the selected section is capped at 60s', () => {
  assert.deepEqual(getYouTubeClip({duration:600},120),{startSeconds:120,endSeconds:180,duration:60});
  assert.deepEqual(getYouTubeClip({duration:600}),{startSeconds:0,endSeconds:60,duration:60});
  assert.deepEqual(getYouTubeClip({duration:60}),{startSeconds:0,endSeconds:60,duration:60});
  assert.deepEqual(getYouTubeClip({duration:.5}),{startSeconds:0,endSeconds:.5,duration:.5});
  assert.equal(getYouTubeClip({duration:600},120.123).duration,60);
});

test('clips stop at the end of a video and reject timestamps with no video remaining', () => {
  assert.deepEqual(getYouTubeClip({duration:150},120),{startSeconds:120,endSeconds:150,duration:30});
  for(const start of [150,151,-1,Infinity,NaN])assert.throws(()=>getYouTubeClip({duration:150},start),/earlier starting point/);
});

test('unknown, invalid, live, and upcoming durations fail closed', () => {
  for (const duration of [undefined,null,'30',NaN,Infinity,0,-1]) assert.throws(() => validateYouTubeMetadata({duration}),/known length/);
  for (const info of [{is_live:true,duration:20},{live_status:'is_upcoming',duration:20},{live_status:'post_live',duration:20}]) assert.throws(() => validateYouTubeMetadata(info),/Live streams/);
});
