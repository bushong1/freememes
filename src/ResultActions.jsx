import React, { useMemo } from 'react';
import { Copy, Download, MousePointer2, Share2 } from 'lucide-react';
import { canCopyResult, copyResultToClipboard, resultFile, canShareFile, shareFile } from './result-sharing';

export default function ResultActions({output,onNotify}) {
  const file=useMemo(()=>resultFile(output),[output]);
  const gif=output.format==='gif',copySupported=canCopyResult(output),shareSupported=canShareFile(file);
  async function copy() {
    try {
      await copyResultToClipboard(output);
      onNotify(gif ? 'GIF copied. The receiving app must support animated GIFs.' : 'Image copied to clipboard.');
    } catch { onNotify(gif ? 'Could not copy the animated GIF. Download it and attach the file instead.' : 'Right-click the PNG and choose Copy image.'); }
  }
  async function share() {
    try { await shareFile(file); }
    catch(error){if(error.name!=='AbortError')onNotify('Could not share this file. Download it and attach the file instead.');}
  }
  return <>
    <div className="copy-tip"><MousePointer2 size={15} /><span>{gif
      ? 'Right-click “Copy image” may paste a still frame. Download the GIF, then attach or drag the downloaded file into Slack or another app.'
      : 'Right-click the image to copy or save it, or use Copy image below.'}</span></div>
    <div className="result-actions">
      {(!gif || copySupported) && <button className="button" onClick={copy}><Copy size={15} />{gif ? 'Copy GIF' : 'Copy image'}</button>}
      {shareSupported && <button className="button" onClick={share}><Share2 size={15} />Share {gif ? 'GIF' : 'image'}</button>}
      <a className="button primary" href={output.url} download={file.name}><Download size={15} />Download {output.format.toUpperCase()}</a>
    </div>
  </>;
}
