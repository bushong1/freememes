export const MAX_MEDIA_BYTES = 30 * 1024 * 1024;
export const MAX_GIF_BYTES = 200 * 1024 * 1024;
export const MAX_YOUTUBE_BYTES = 200 * 1024 * 1024;
export const MAX_YOUTUBE_SECONDS = 60;
export const MAX_ANIMATION_PIXELS = 90_000_000;
export const MAX_ANIMATION_FRAMES = 1200;

export function validateMediaSize(size, sourceType) {
  const limit = sourceType === 'youtube' ? MAX_YOUTUBE_BYTES : sourceType === 'gif' ? MAX_GIF_BYTES : MAX_MEDIA_BYTES;
  if (size > limit) throw new Error(sourceType === 'youtube' ? 'YouTube animations must be 200 MB or smaller.' : sourceType === 'gif' ? 'GIF files must be 200 MB or smaller.' : 'Choose a file smaller than 30 MB.');
}

const formats = {
  png: { format: 'png', mime: 'image/png', label: 'PNG' },
  gif: { format: 'gif', mime: 'image/gif', label: 'GIF' },
  webp: { format: 'webp', mime: 'image/webp', label: 'WebP' },
  jpeg: { format: 'jpeg', mime: 'image/jpeg', label: 'JPEG' },
  avif: { format: 'avif', mime: 'image/avif', label: 'AVIF' },
};

// File extensions and Content-Type headers are hints; the bytes decide the type.
export function detectImageType(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b)) return { ...formats.png };
  if (['GIF87a','GIF89a'].includes(ascii(0,6))) return { ...formats.gif };
  if (ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') {
    const animated = ascii(12,16) === 'VP8X' && !!(bytes[20] & 2);
    return { ...formats.webp, animated };
  }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { ...formats.jpeg };
  if (ascii(4,8) === 'ftyp') {
    for (let i = 8; i + 4 <= Math.min(bytes.length,32); i += 4) {
      if (['avif','avis'].includes(ascii(i,i+4))) return { ...formats.avif };
    }
  }
  return null;
}

export function detectVideoType(input) {
  const bytes=input instanceof Uint8Array ? input : new Uint8Array(input);
  if(detectImageType(bytes))return null;
  if(String.fromCharCode(...bytes.subarray(4,8))==='ftyp')return {format:'mp4',mime:'video/mp4',label:'MP4'};
  return null;
}

export function parseYouTubeTimestamp(value) {
  if (value == null) return 0;
  const text = value.trim().toLowerCase();
  let seconds;
  if (/^\d+(?:\.\d+)?s?$/.test(text)) seconds = Number(text.replace(/s$/,''));
  else if (/^(?:\d+h)?(?:\d+m)?(?:\d+(?:\.\d+)?s)?$/.test(text) && text) {
    const match = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
    seconds = Number(match[1] || 0)*3600 + Number(match[2] || 0)*60 + Number(match[3] || 0);
  } else if (/^\d+(?::\d{1,2}){1,2}(?:\.\d+)?$/.test(text)) {
    const parts = text.split(':').map(Number);
    if (parts.slice(1).every(n => n < 60)) seconds = parts.reduce((total,n) => total*60+n,0);
  }
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > Number.MAX_SAFE_INTEGER-60) throw new Error('This YouTube timestamp is invalid. Use seconds such as t=120 or a time such as t=2m0s.');
  return seconds;
}

export function classifySourceUrl(value) {
  const text = value.trim();
  if (!text || /\s/.test(text)) throw new Error('Enter a complete image URL or YouTube video link.');
  let url;
  try { url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`); }
  catch { throw new Error('Enter a valid image URL or YouTube video link.'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a public HTTP or HTTPS link.');
  const host = url.hostname.toLowerCase();
  if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com','youtu.be','www.youtu.be'].includes(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    const id = host.endsWith('youtu.be') ? parts[0] : parts[0] === 'watch' ? url.searchParams.get('v') : ['shorts','embed','v','live'].includes(parts[0]) ? parts[1] : null;
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('Use a link to one YouTube video, rather than a playlist or channel.');
    const hash = new URLSearchParams(url.hash.slice(1));
    const startSeconds = parseYouTubeTimestamp(url.searchParams.get('t') ?? url.searchParams.get('start') ?? url.searchParams.get('time_continue') ?? hash.get('t'));
    return { type: 'youtube', videoId: id, startSeconds, url: `https://www.youtube.com/watch?v=${id}${startSeconds ? `&t=${startSeconds}` : ''}`, label: 'YouTube' };
  }
  if (url.port && !['80','443'].includes(url.port)) throw new Error('Use an image URL on the standard HTTP or HTTPS port.');
  url.hash = '';
  const ext = url.pathname.split('.').pop().toLowerCase();
  const hint = formats[ext === 'jpg' ? 'jpeg' : ext];
  return { type: 'image', url: url.href, label: hint?.label || 'Image' };
}

export function validateYouTubeMetadata(info) {
  if (info.is_live || ['is_live','is_upcoming','post_live'].includes(info.live_status)) throw new Error('Live streams and upcoming videos cannot be imported. Choose a finished video.');
  if (typeof info.duration !== 'number' || !Number.isFinite(info.duration) || info.duration <= 0) throw new Error('Could not verify this video’s duration. Choose a video with a known length.');
  return info;
}

export function getYouTubeClip(info, startSeconds = 0) {
  validateYouTubeMetadata(info);
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds >= info.duration) throw new Error('The timestamp is at or beyond the end of this video. Choose an earlier starting point.');
  const duration = Math.min(MAX_YOUTUBE_SECONDS,info.duration-startSeconds);
  return { startSeconds,endSeconds:Math.min(startSeconds+duration,info.duration),duration };
}
