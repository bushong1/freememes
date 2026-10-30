import { GIFEncoder, quantize, applyPalette } from 'gifenc';
let encoder, width, height;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'start') {
      width = data.width; height = data.height;
      encoder = GIFEncoder();
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'frame') {
      if(!Number.isFinite(data.delay) || data.delay<20 || data.delay>655350 || data.delay%10!==0)throw new Error('GIF frame timing must be 20 ms or more in 10 ms increments.');
      const pixels = new Uint8Array(data.pixels);
      const palette = quantize(pixels, 256);
      const index = applyPalette(pixels, palette);
      encoder.writeFrame(index, width, height, { palette, delay: data.delay, repeat: 0 });
      self.postMessage({ type: 'frame' });
    } else if (data.type === 'finish') {
      encoder.finish();
      const bytes = encoder.bytes();
      self.postMessage({ type: 'done', bytes }, [bytes.buffer]);
    }
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
