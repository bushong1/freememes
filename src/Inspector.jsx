import React from 'react';
import { AlignLeft, AlignCenter, AlignRight, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Copy, Crop, Diamond, Eye, EyeOff, Film, Frame, ImagePlus, MousePointer2, Move, Pause, Play, Plus, RotateCcw, Scissors, Settings2, Trash2, Type, X } from 'lucide-react';
import { Field, Slider, ColorField, IconButton, HoldButton } from './editor-controls';
import { canTrimMedia, clamp, formatTime, objectBounds, positionAt, visibleAt, textLayout, canvasSize } from './engine';
import GifTimeline from './GifTimeline';
import ExportSettings from './ExportSettings';

export default function Inspector(p) {
  const { inspector,setInspector,media,doc,selected,time,setTime,playing,setPlaying,stepFrame,updateObject,addText,checkpoint,changeFontSize,applyFormatting,setPosition,scaleSelected,duplicate,reorder,deleteObject,cropDraft,setCropDraft,openCrop,cropRatio,applyCrop,setPadding,setTrim,dragTrim,commit,keyframeAction,setKeyframeAction,addKeyframe,copyKeyframes,pasteKeyframes,keyframeClipboard,exportFormat,setExportFormat,exportWidth,setExportWidth,exportFps,setExportFps } = p;
  const draft = cropDraft || doc.crop;
  const geometry=canvasSize(doc);
  const bounds = selected ? objectBounds(selected,geometry,time) : null;
  const fontSize=selected?.type==='text' ? textLayout(selected,geometry).size : 0;
  const clipDuration=doc.trim[1]-doc.trim[0],clipTime=clamp(time,doc.trim[0],doc.trim[1]-1)-doc.trim[0];
  const clipKeys=(selected?.keyframes || []).filter(key=>key.time>=doc.trim[0] && key.time<=doc.trim[1]);
  const outsideKeys=(selected?.keyframes.length || 0)-clipKeys.length;
  const tabs = [['object',Settings2,'Object'],['canvas',Frame,'Canvas'],['animation',Diamond,'Animation'],...(canTrimMedia(media) ? [['gif',Film,'GIF']] : [])];

  function setVisibility(key,value) {
    const keyframes = selected.keyframes.map(k => {
      if (k.time !== key.time) return k;
      const next = { ...k };
      if (value === 'unchanged') delete next.visible;
      else next.visible = value === 'show';
      return next;
    }).filter(k => typeof k.visible === 'boolean' || Number.isFinite(k.x));
    updateObject({ keyframes });
  }

  return <aside className="inspector">
    <div className="inspector-tabs" role="tablist" aria-label="Editing toolkit">
      {tabs.map(([id,Icon,label]) => <button key={id} role="tab" id={`inspector-tab-${id}`} aria-controls="inspector-panel" aria-selected={inspector === id} className={inspector === id ? 'active' : ''} onClick={() => setInspector(id)}><Icon size={14} />{label}</button>)}
    </div>
    <div className="inspector-scroll" id="inspector-panel" role="tabpanel" aria-labelledby={`inspector-tab-${inspector}`}>
      {inspector === 'object' && (selected ? <>
        <div className="inspector-heading"><span>{selected.type === 'text' ? <Type size={16} /> : <ImagePlus size={16} />}{selected.type === 'text' ? 'Text properties' : 'Image properties'}</span><span className="editing-badge">EDITING</span></div>
        {selected.type === 'text' && <>
          <Field label="YOUR TEXT"><textarea aria-label="Text content" value={selected.text} onChange={e => updateObject({ text:e.target.value })} rows={3} placeholder="Something worth sharing…" /></Field>
          <Field label="Font family"><select aria-label="Font family" value={selected.font} onChange={e => updateObject({ font:e.target.value })}>
            <option value={'Anton, Impact, "Arial Black", sans-serif'}>Impact</option><option value={'"DM Sans", sans-serif'}>DM Sans</option><option value="Arial, sans-serif">Arial</option><option value="Georgia, serif">Georgia</option><option value={'"Courier New", monospace'}>Courier New</option>
          </select></Field>
          <div className="font-tools"><div className="number-stepper">
            <HoldButton key={`${selected.id}-decrease`} label="Decrease font size" onStart={checkpoint} onStep={() => changeFontSize(-2)}><ChevronDown size={12} /></HoldButton>
            <input aria-label="Font size" type="number" min="1" max={selected.maxFontSize ?? 1000} step="0.1" value={Math.round(fontSize*10)/10} onChange={e => updateObject({ size:clamp(+e.target.value,1,selected.maxFontSize ?? 1000) })} />
            <HoldButton key={`${selected.id}-increase`} label="Increase font size" onStart={checkpoint} onStep={() => changeFontSize(2)}><ChevronUp size={12} /></HoldButton>
          </div><button className={`bold-button ${selected.bold ? 'active' : ''}`} title="Toggle bold" aria-label="Toggle bold" onClick={() => updateObject({ bold:!selected.bold })}>B</button><span className="font-size-hint">Hold ↑ / ↓</span></div>
          <Field label="Max font size"><input aria-label="Max font size" type="number" min="1" max="1000" value={selected.maxFontSize ?? 1000} onChange={e => updateObject({ maxFontSize:clamp(+e.target.value,1,1000) })} /></Field>
          <div className="text-alignment-row"><span>Horizontal</span><div className="alignment-buttons">{[['left',AlignLeft],['center',AlignCenter],['right',AlignRight]].map(([align,Icon]) => <IconButton key={align} icon={Icon} label={`Align ${align}`} className={selected.align === align ? 'active' : ''} onClick={() => updateObject({ align })} />)}</div></div>
          <div className="text-alignment-row"><span>Vertical</span><div className="alignment-buttons">{[['top',AlignVerticalJustifyStart],['middle',AlignVerticalJustifyCenter],['bottom',AlignVerticalJustifyEnd]].map(([verticalAlign,Icon]) => <IconButton key={verticalAlign} icon={Icon} label={`Align ${verticalAlign}`} className={(selected.verticalAlign || 'middle') === verticalAlign ? 'active' : ''} onClick={() => updateObject({ verticalAlign })} />)}</div></div>
          <div className="inspector-divider" />
          <ColorField label="Text" value={selected.color} onChange={color => updateObject({ color })} />
          <ColorField label="Outline" value={selected.outlineColor} onChange={outlineColor => updateObject({ outlineColor })} />
          <Slider label="Outline width" value={selected.outline} max={12} step={.5} onChange={outline => updateObject({ outline })} suffix="px" />
          <ColorField label="Shadow" value={selected.shadowColor} onChange={shadowColor => updateObject({ shadowColor })} />
          <Slider label="Drop shadow" value={selected.shadow} max={40} onChange={shadow => updateObject({ shadow })} suffix="px" />
          <button className="button full-width apply-formatting" onClick={applyFormatting}><Copy size={14} />Apply formatting to all text boxes</button>
        </>}
        <div className="inspector-divider" /><div className="section-label">POSITION & SIZE <Move size={12} /></div>
        <div className="two-fields position-fields">{['x','y'].map(axis => <Field key={axis} label={axis.toUpperCase()}><input aria-label={`${axis.toUpperCase()} position percent`} type="number" value={Math.round(positionAt(selected,time)[axis]*100)} onChange={e => setPosition(axis,+e.target.value)} /></Field>)}</div>
        <Slider label="Width" value={selected.width*100} min={5} max={200} onChange={v => scaleSelected('x',v)} suffix="%" />
        <Slider label="Height" value={bounds.height/geometry.height*100} min={2} max={200} onChange={v => scaleSelected('y',v)} suffix="%" />
        <Slider label="Rotation" value={selected.rotation || 0} min={-180} max={180} onChange={rotation => updateObject({ rotation })} suffix="°" />
        <Field label="Rotation (degrees)"><input aria-label="Rotation degrees" type="number" min="-180" max="180" step="0.1" value={selected.rotation || 0} onChange={e => updateObject({rotation:clamp(+e.target.value,-180,180)})} /></Field>
        <Slider label="Opacity" value={selected.opacity} onChange={opacity => updateObject({ opacity })} suffix="%" />
        <div className="object-actions"><IconButton icon={Copy} label="Duplicate layer" onClick={duplicate} /><IconButton icon={ArrowUp} label="Bring layer forward" onClick={() => reorder(1)} /><IconButton icon={ArrowDown} label="Send layer backward" onClick={() => reorder(-1)} /><IconButton icon={Trash2} label="Delete layer" className="delete-button" onClick={deleteObject} /></div>
      </> : <div className="inspector-empty"><MousePointer2 size={28} /><h3>Find your focus.</h3><p>Select a text or image layer to make it your own.</p><button className="button full-width" onClick={addText}><Plus size={14} />Add text</button></div>)}

      {inspector === 'canvas' && <>
        <div className="inspector-heading"><span><Frame size={16} />Canvas settings</span></div>
        <div className="canvas-info"><span>Original size<strong>{media?.width} × {media?.height}</strong></span><span>Current canvas<strong>{geometry.width} × {geometry.height}</strong></span><span>Source<strong>{media?.sourceType === 'youtube' ? 'YouTube animation' : media?.format?.toUpperCase()}</strong></span></div>
        <div className="inspector-divider" /><div className="section-label">SPACE ABOVE & BELOW</div>
        <div className="two-fields">{[['top','Above'],['bottom','Below']].map(([edge,label])=><Field key={edge} label={`${label} (pixels)`}><input aria-label={`Space ${label.toLowerCase()} image`} type="number" min="0" max="8192" disabled={!media} value={doc.padding?.[edge] || 0} onChange={e=>setPadding({[edge]:+e.target.value})} /></Field>)}</div>
        <ColorField label="Above space" value={doc.padding?.topColor || '#ffffff'} onChange={topColor=>setPadding({topColor})} />
        <ColorField label="Below space" value={doc.padding?.bottomColor || '#ffffff'} onChange={bottomColor=>setPadding({bottomColor})} />
        <div className="inspector-divider" /><div className="section-label">CROP CANVAS <Crop size={12} /></div>
        <p className="muted-text">Choose a preset or enter dimensions. Start a crop to draw it directly on the canvas.</p>
        {!cropDraft && <button className="button full-width" disabled={!media} onClick={openCrop}><Crop size={14} />Start crop</button>}
        {cropDraft && <p className="crop-active-note"><Crop size={12} />Drag on the image to select your crop.</p>}
        <div className="ratio-grid">{[[1,'1:1'],[4/3,'4:3'],[16/9,'16:9'],[9/16,'9:16']].map(([ratio,label]) => <button key={label} disabled={!media} onClick={() => cropRatio(ratio)}><span style={{ aspectRatio:ratio,maxHeight:22,maxWidth:30 }} />{label}</button>)}</div>
        <div className="two-fields"><Field label="Width"><input aria-label="Crop width" type="number" min={Math.min(16,media?.width || 16)} max={media ? media.width-draft.x : 2400} value={draft.width} disabled={!media} onChange={e => setCropDraft({ ...draft,width:clamp(+e.target.value,Math.min(16,media.width),media.width-draft.x) })} /></Field><Field label="Height"><input aria-label="Crop height" type="number" min={Math.min(16,media?.height || 16)} max={media ? media.height-draft.y : 2400} value={draft.height} disabled={!media} onChange={e => setCropDraft({ ...draft,height:clamp(+e.target.value,Math.min(16,media.height),media.height-draft.y) })} /></Field></div>
        <Slider label="Horizontal offset" value={draft.x} max={Math.max(1,(media?.width || 1)-draft.width)} onChange={x => media && setCropDraft({ ...draft,x:Math.min(x,media.width-draft.width) })} suffix="px" />
        <Slider label="Vertical offset" value={draft.y} max={Math.max(1,(media?.height || 1)-draft.height)} onChange={y => media && setCropDraft({ ...draft,y:Math.min(y,media.height-draft.height) })} suffix="px" />
        <button className="button primary full-width" disabled={!cropDraft} onClick={applyCrop}><Check size={15} />Apply crop</button>
        {cropDraft && <button className="text-button full-width" onClick={() => setCropDraft(null)}><X size={13} />Cancel crop</button>}
        <button className="text-button full-width" disabled={!media} onClick={() => setCropDraft({ x:0,y:0,width:media.width,height:media.height })}><RotateCcw size={13} />Reset to original</button>
      </>}

      {inspector === 'animation' && <>
        <div className="inspector-heading"><span><Diamond size={16} />Object animation</span></div>
        <p className="muted-text">Set positions or show/hide events at the playhead. Select layers from the list to edit objects while they are hidden.</p>
        <GifTimeline {...{media,doc,selected,time,setTime,playing,setPlaying,stepFrame}} trimControls={false} animation />
        <div className="animation-playback"><Field label="Playhead (seconds)"><input aria-label="Animation time seconds" type="number" min="0" max={clipDuration/1000} step="0.01" value={Math.round(clipTime/10)/100} onChange={e => { setPlaying(false);setTime(clamp(doc.trim[0]+Number(e.target.value)*1000,doc.trim[0],doc.trim[1]-1)); }} /></Field></div>
        {selected ? <>
          <div className="animation-layer-name">{selected.type === 'text' ? <Type size={13} /> : <ImagePlus size={13} />}<span>{selected.type === 'text' ? selected.text || 'Empty text' : selected.name}</span>{visibleAt(selected,time) ? <Eye size={13} /> : <EyeOff size={13} />}</div>
          <Field label="Keyframe action"><select aria-label="Keyframe action" value={keyframeAction} onChange={e => setKeyframeAction(e.target.value)}><option value="move">Move · set position</option><option value="show">Show object</option><option value="hide">Hide object</option></select></Field>
          <button className="button keyframe-button full-width" onClick={addKeyframe}><Diamond size={15} />Add keyframe<span>{formatTime(clipTime)}</span></button>
          <div className="keyframe-transfer"><button className="button" disabled={!selected.keyframes.length} onClick={copyKeyframes} title="Copy keyframes · Ctrl/Cmd+C"><Copy size={13} />Copy keyframes</button><button className="button" disabled={!keyframeClipboard} onClick={pasteKeyframes} title="Paste keyframes · Ctrl/Cmd+V"><Copy size={13} />Paste keyframes</button></div>
          <p className="muted-text">Paste replaces this object’s keyframes and easing at the original times. Undo restores its previous animation.</p>
          <Field label="Interpolation"><select aria-label="Interpolation" value={selected.easing} onChange={e => updateObject({ easing:e.target.value })}><option value="linear">Linear · steady movement</option><option value="smooth">Smooth · ease in and out</option></select></Field>
          <p className="muted-text">Position interpolates between keys. Show/hide switches instantly and holds until the next visibility key.</p>
          {outsideKeys>0 && <p className="muted-text">{outsideKeys} {outsideKeys===1 ? 'keyframe is' : 'keyframes are'} outside the trimmed range. Expand the trim to edit them.</p>}
          <div className="keyframe-list">{clipKeys.map(k => <div className="keyframe-row" key={k.time}><div className="keyframe-row-heading"><button onClick={() => { setPlaying(false);setTime(clamp(k.time,doc.trim[0],doc.trim[1]-1)); }}><Diamond size={12} />{formatTime(k.time-doc.trim[0])}</button><span>{Number.isFinite(k.x) ? `${Math.round(k.x*100)}%, ${Math.round(k.y*100)}%` : 'Visibility'}</span><IconButton icon={X} label={`Remove keyframe at ${formatTime(k.time-doc.trim[0])}`} onClick={() => updateObject({ keyframes:selected.keyframes.filter(key => key.time !== k.time) })} /></div><select aria-label={`Keyframe visibility at ${formatTime(k.time-doc.trim[0])}`} value={k.visible === undefined ? 'unchanged' : k.visible ? 'show' : 'hide'} onChange={e => setVisibility(k,e.target.value)}><option value="unchanged">Visibility unchanged</option><option value="show">Show object</option><option value="hide">Hide object</option></select></div>)}</div>
        </> : <div className="inspector-empty"><MousePointer2 size={26} /><p>Select a layer to add animation.</p></div>}
      </>}

      {inspector === 'gif' && canTrimMedia(media) && <>
        <div className="inspector-heading"><span><Film size={16} />GIF timeline</span></div>
        <GifTimeline {...{ media,doc,selected,time,setTime,playing,setPlaying,stepFrame,dragTrim }} onAnimation={() => setInspector('animation')} />
        <div className="inspector-divider" /><div className="section-label">TRIM BEGINNING & END <Scissors size={12} /></div>
        <p className="muted-text">Keep the part you want. The exported GIF loops between these points.</p>
        <div className="two-fields"><Field label="Start (seconds)"><input aria-label="Trim start seconds" type="number" min="0" max={(doc.trim[1]-100)/1000} step="0.01" value={doc.trim[0]/1000} onChange={e => setTrim(0,+e.target.value*1000)} /></Field><Field label="End (seconds)"><input aria-label="Trim end seconds" type="number" min={(doc.trim[0]+100)/1000} max={media.duration/1000} step="0.01" value={doc.trim[1]/1000} onChange={e => setTrim(1,+e.target.value*1000)} /></Field></div>
        <Slider label="Trim beginning" value={doc.trim[0]} max={media.duration} step={10} onChange={v => setTrim(0,v)} suffix="ms" />
        <Slider label="Trim end" value={doc.trim[1]} max={media.duration} min={100} step={10} onChange={v => setTrim(1,v)} suffix="ms" />
        <button className="text-button full-width" onClick={() => { commit({ ...doc,trim:[0,media.duration] });setTime(0); }}><RotateCcw size={12} />Reset trim</button>
      </>}
    </div>
    <ExportSettings {...{media,doc,exportFormat,setExportFormat,exportWidth,setExportWidth,exportFps,setExportFps}} />
  </aside>;
}
