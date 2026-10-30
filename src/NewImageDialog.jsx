import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ClipboardPaste, FileImage, ImagePlus, Link, LoaderCircle, Upload, X, Youtube } from 'lucide-react';
import { classifySourceUrl, detectImageType, detectVideoType, validateMediaSize, MAX_YOUTUBE_SECONDS } from './media-source.js';

export default function NewImageDialog({ onImport, onClose }) {
  const [tab,setTab]=useState('paste');
  const [url,setUrl]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const input=useRef(null),dialog=useRef(null),controller=useRef(null);
  let source=null;
  try { if (url.trim()) source=classifySourceUrl(url); } catch { /* Show validation when submitted. */ }

  useEffect(() => {
    const previous=document.activeElement;
    dialog.current?.querySelector('button')?.focus();
    return () => { controller.current?.abort(); previous?.focus(); };
  },[]);

  async function openFile(file,sourceType) {
    if (!file || busy) return;
    setBusy(true); setError(''); setStatus('Checking your image…');
    try {
      const detected=detectImageType(await file.slice(0,32).arrayBuffer());
      validateMediaSize(file.size,sourceType==='youtube' ? 'youtube' : detected?.format);
      if (!detected) throw new Error('Choose a PNG, GIF, WebP, JPEG, or AVIF image.');
      setStatus(`Opening ${sourceType === 'youtube' ? 'YouTube animation' : detected.label}…`);
      const result=await onImport(file,sourceType);
      if (!result.ok) throw new Error(result.error);
      onClose();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); if (input.current) input.current.value=''; }
  }

  useEffect(() => {
    function paste(event) {
      if (busy) return;
      const file=[...event.clipboardData.items].find(item => item.kind === 'file')?.getAsFile();
      if (file) { event.preventDefault(); openFile(file); return; }
      if (event.target instanceof Element && event.target.closest('input,textarea')) return;
      const text=event.clipboardData.getData('text/plain').trim();
      if (/^(https?:\/\/|www\.|(?:m\.)?(?:youtube\.com|youtu\.be)\/)/i.test(text)) {
        event.preventDefault(); setUrl(text); setTab('url'); setError('');
      }
    }
    window.addEventListener('paste',paste);
    return () => window.removeEventListener('paste',paste);
  },[busy,onImport,onClose]);

  async function readClipboard() {
    setError('');
    if (!navigator.clipboard?.read) { setError('Press Ctrl+V (or ⌘V on Mac) anywhere in this dialog to paste an image.'); return; }
    try {
      const items=await navigator.clipboard.read();
      for (const item of items) {
        const type=item.types.find(type => type.startsWith('image/'));
        if (type) {
          const blob=await item.getType(type);
          await openFile(new File([blob],`pasted-image.${type.split('/')[1]}`,{type})); return;
        }
      }
      for (const item of items) {
        if (item.types.includes('text/plain')) {
          const text=await (await item.getType('text/plain')).text();
          classifySourceUrl(text); setUrl(text.trim()); setTab('url'); return;
        }
      }
      setError('Your clipboard has no image. Copy an image, then paste it here.');
    } catch { setError('Clipboard access isn’t available. Press Ctrl+V (or ⌘V on Mac) to paste your image directly.'); }
  }

  async function openUrl(event) {
    event.preventDefault(); if (busy) return;
    setError('');
    let parsed;
    try { parsed=classifySourceUrl(url); } catch (err) { setError(err.message); return; }
    setBusy(true); setStatus(parsed.type === 'youtube' ? 'Checking the requested clip, then preparing video…' : 'Fetching and detecting your image…');
    controller.current=new AbortController();
    const timer=setTimeout(() => controller.current?.abort(),300000);
    try {
      const response=await fetch('/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:parsed.url}),signal:controller.current.signal});
      if (!response.ok) {
        let message='URL import isn’t available right now. Try uploading or pasting an image.';
        try { message=(await response.json()).error || message; } catch { /* Static hosts may return HTML. */ }
        throw new Error(message);
      }
      const blob=await response.blob();
      if (controller.current.signal.aborted) return;
      validateMediaSize(blob.size,parsed.type === 'youtube' ? 'youtube' : undefined);
      const signature=await blob.slice(0,32).arrayBuffer();
      const type=detectImageType(signature) || (parsed.type==='youtube' && detectVideoType(signature));
      if (!type) throw new Error('That link did not return a supported image. Use a direct image or YouTube video link.');
      let name=response.headers.get('X-Media-Name');
      try { name=name && decodeURIComponent(name); } catch { name=null; }
      const file=new File([blob],name || `imported-image.${type.format}`,{type:type.mime});
      const result=await onImport(file,parsed.type==='youtube' ? 'youtube' : response.headers.get('X-Media-Source') || type.format,{width:Number(response.headers.get('X-Media-Width')),height:Number(response.headers.get('X-Media-Height')),duration:Number(response.headers.get('X-Media-Duration')),frameRate:Number(response.headers.get('X-Media-Frame-Rate'))});
      if (!result.ok) throw new Error(result.error);
      onClose();
    } catch (err) { setError(err.name === 'AbortError' ? 'The import was cancelled or timed out. Please try again.' : err.message); }
    finally { clearTimeout(timer); setBusy(false); }
  }

  function keyboard(event) {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const controls=[...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')];
    const first=controls[0],last=controls[controls.length-1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} onDragOver={e => { e.preventDefault(); e.stopPropagation(); }} onDrop={e => { e.preventDefault(); e.stopPropagation(); if (!busy) openFile(e.dataTransfer.files[0]); }}>
    <section ref={dialog} className="modal new-image-modal" role="dialog" aria-modal="true" aria-labelledby="new-image-title" onKeyDown={keyboard}>
      <button className="icon-button modal-close" aria-label="Close new image dialog" onClick={onClose}><X size={17} /></button>
      <span className="modal-eyebrow"><ImagePlus size={14} /> A FRESH START FOR YOUR NEXT IDEA</span>
      <h2 id="new-image-title">Bring your own pixels.</h2>
      <p>Paste an image, grab a link, or find something on your computer.</p>
      <div className="source-tabs" role="tablist" aria-label="Image source">{[['paste',ClipboardPaste,'Paste'],['url',Link,'From URL'],['upload',Upload,'Upload']].map(([id,Icon,label]) => <button key={id} id={`source-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls="source-panel" disabled={busy} onClick={() => { setTab(id); setError(''); }}><Icon size={15} />{label}</button>)}</div>
      <div id="source-panel" className="source-panel" role="tabpanel" aria-labelledby={`source-tab-${tab}`}>
        {tab === 'paste' && <div className="paste-zone" tabIndex={0}><span className="source-hero-icon"><ClipboardPaste size={28} /></span><h3>A good idea, copied.</h3><p>Copy an image, then press <kbd>Ctrl</kbd> + <kbd>V</kbd><br /><span>or <kbd>⌘</kbd> + <kbd>V</kbd> on a Mac.</span></p><button className="button primary" disabled={busy} onClick={readClipboard}><ClipboardPaste size={15} /> Paste from clipboard</button></div>}
        {tab === 'upload' && <div className="paste-zone"><span className="source-hero-icon"><Upload size={28} /></span><h3>Find your next frame.</h3><p>Drop an image into this dialog<br /><span>or choose a file from your computer.</span></p><button className="button primary" disabled={busy} onClick={() => input.current.click()}><Upload size={15} /> Upload from computer</button><input ref={input} type="file" aria-label="Upload new image" accept="image/png,image/gif,image/webp,image/jpeg,image/avif" hidden onChange={e => openFile(e.target.files[0])} /></div>}
        {tab === 'url' && <form onSubmit={openUrl}><label className="source-url-label" htmlFor="source-url">Image or YouTube URL</label><div className="source-url-input"><Link size={16} /><input id="source-url" type="text" inputMode="url" autoComplete="off" autoFocus placeholder="https://…" disabled={busy} value={url} onChange={e => { setUrl(e.target.value); setError(''); }} /></div><div className={`source-detection ${source?.type === 'youtube' ? 'youtube-detection' : ''}`} aria-live="polite">{source ? <>{source.type === 'youtube' ? <Youtube size={17} /> : <FileImage size={17} />}<span><strong>{source.label}{source.type === 'image' ? ' link' : ' video detected'}</strong>{source.type === 'youtube' ? `Imports ${source.startSeconds}s–${source.startSeconds+MAX_YOUTUBE_SECONDS}s, or to the end of the video.` : 'The image type will be verified from its contents.'}</span><Check size={14} /></> : <><FileImage size={17} /><span>Direct image URLs and YouTube video links welcome.</span></>}</div><button className="button primary full-width" disabled={busy || !url.trim()} type="submit">{busy ? <LoaderCircle className="spin" size={15} /> : source?.type === 'youtube' ? <Youtube size={16} /> : <ImagePlus size={16} />}{busy ? 'Importing…' : source?.type === 'youtube' ? 'Import YouTube video' : 'Load image'}{!busy && <ArrowRight size={15} />}</button><p className="url-source-note">Imports up to 60 seconds from the link’s timestamp, or from the beginning if none is set. Live streams and unverified durations are not supported.</p></form>}
      </div>
      {busy && <div className="import-status" role="status"><LoaderCircle className="spin" size={16} />{status}</div>}
      {error && <div className="import-error" role="alert">{error}</div>}
      <div className="source-formats"><span>PNG</span><span>GIF</span><span>WebP</span><span>JPEG</span><span>AVIF</span><span className="youtube-format"><Youtube size={12} /> ≤ 60s</span></div>
      <p className="source-privacy">GIF uploads and YouTube animations up to 200 MB. Other image uploads and image URLs up to 30 MB.<br />Uploads and pastes stay in your browser. URL imports use the import service.</p>
    </section>
  </div>;
}
