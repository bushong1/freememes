import React, { useMemo } from 'react';
import { Field } from './editor-controls';
import { exportSize, canvasSize, clamp } from './engine';
import { estimateGifBytes, formatFileSize, getDownscaleSuggestions } from './export-advice';

export default function ExportSettings({media,doc,exportFormat,setExportFormat,exportWidth,setExportWidth,exportFps,setExportFps}) {
  const geometry=canvasSize(doc);
  const suggestions=useMemo(()=>getDownscaleSuggestions(canvasSize(doc)),[doc.crop,doc.padding]);
  const estimate=useMemo(()=>estimateGifBytes(media,doc,exportWidth,exportFps),[media,doc,exportWidth,exportFps]);
  const size=exportSize(geometry,exportWidth);
  const widths=[...new Set([480,800,900,...suggestions.map(s=>s.width),...(typeof exportWidth==='number' ? [exportWidth] : [])])].filter(w=>w<doc.crop.width).sort((a,b)=>b-a);
  return <div className="export-panel">
    <div className="section-label">Export</div>
    <div className="two-fields">
      <Field label="Format"><select aria-label="Export format" value={exportFormat} onChange={e=>setExportFormat(e.target.value)}><option value="png">PNG image</option><option value="gif">Animated GIF</option></select></Field>
      <Field label="Width"><select aria-label="Export width" value={exportWidth} onChange={e=>setExportWidth(e.target.value==='original' ? 'original' : +e.target.value)}><option value="original">Original · {doc.crop.width}px</option>{widths.map(w=><option key={w} value={w}>{w}px</option>)}</select></Field>
    </div>
    {exportFormat==='gif' && <>
      <Field label="GIF FPS"><input aria-label="GIF FPS" type="number" min="1" max="50" step="0.01" placeholder="Auto" value={exportFps==='auto' ? '' : exportFps} onChange={event=>setExportFps(event.target.value==='' ? 'auto' : clamp(+event.target.value,1,50))} /></Field>
      <p className="export-advice-note">Leave blank for automatic timing. Set 1–50 FPS to change smoothness and file size while keeping the clip’s duration.</p>
    </>}
    <div className="export-size-summary" aria-live="polite"><span>{size.width} × {size.height} px</span>{exportFormat==='gif' && estimate!==null && <span>≈ {formatFileSize(estimate)}*</span>}</div>
    {exportFormat==='gif' && suggestions.length>0 && <>
      <div className="export-suggestions-heading">Smaller GIF options</div>
      <div className="gif-scale-suggestions">{suggestions.map(s=><button key={s.width} aria-label={`Export at ${s.percent}% size`} aria-pressed={exportWidth===s.width} onClick={()=>setExportWidth(s.width)}><strong>{s.percent}%</strong><span>{s.width} × {s.height}</span><small>{s.pixelReduction}% fewer pixels</small></button>)}</div>
      <p className="export-advice-note">Resize only the export; your canvas stays at its original resolution.</p>
    </>}
    {exportFormat==='gif' && estimate!==null && <p className="export-advice-note">*Rough size estimate from the imported GIF. Text, added motion, and compression affect the final size.</p>}
  </div>;
}
