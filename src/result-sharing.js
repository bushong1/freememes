export function resultFilename(result) {
  const base=String(result.name || '').replace(/\.(png|gif)$/i,'').replace(/[^a-z0-9 -]/gi,'').trim() || 'freememes';
  return `${base}.${result.format}`;
}

export function resultFile(result) {
  return new File([result.blob],resultFilename(result),{type:result.blob.type});
}

export function canCopyResult(result,nav=globalThis.navigator,Item=globalThis.ClipboardItem) {
  try {
    if(!nav?.clipboard?.write || !Item)return false;
    const type=result.blob.type;
    // Custom "web image/gif" data is not a native GIF for apps such as Slack.
    // Never substitute a PNG representation for an animated GIF.
    if(result.format==='gif')return type==='image/gif' && Item.supports?.('image/gif')===true;
    return type==='image/png' && (!Item.supports || Item.supports(type));
  } catch { return false; }
}

export async function copyResultToClipboard(result,nav=globalThis.navigator,Item=globalThis.ClipboardItem) {
  if(!canCopyResult(result,nav,Item))throw new Error(result.format==='gif'
    ? 'Animated GIF copying is not supported here. Download the GIF and attach the file instead.'
    : 'Image copying is unavailable. Right-click the PNG and choose Copy image.');
  await nav.clipboard.write([new Item({[result.blob.type]:result.blob})]);
}

export function canShareFile(file,nav=globalThis.navigator) {
  try { return typeof nav?.share==='function' && nav.canShare?.({files:[file]})===true; }
  catch { return false; }
}

export async function shareFile(file,nav=globalThis.navigator) {
  if(!canShareFile(file,nav))throw new Error('File sharing is unavailable. Download the file and attach it instead.');
  await nav.share({files:[file]});
}
