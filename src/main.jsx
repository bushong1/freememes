import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Copy, Crop, Diamond, Download, Eye, EyeOff, FileImage, FolderOpen, Frame, GripVertical, ImagePlus, Layers, LoaderCircle, Maximize, MousePointer2, Move, Pause, Play, Plus, Redo2, ShieldCheck, Sparkles, Type, Undo2, Upload, WandSparkles, RotateCw, X } from 'lucide-react';
import { canvas, clamp, exportSchedule, formatTime, loadMedia, objectBounds, positionAt, renderScene, visibleAt, upsertKeyframe, applyTextFormatting, resizeObject, canTrimMedia, exportSize, textLayout, updateObjectProperties, canvasSize, updateCanvasPadding, rotationFromDrag, stepMediaFrame, snapshotKeyframes, pasteKeyframeSnapshot } from './engine';
import './styles.css';
import NewImageDialog from './NewImageDialog';
import { IconButton } from './editor-controls';
import Inspector from './Inspector';
import ResultActions from './ResultActions';
import usePreview from './usePreview';
import { createExportSource, prepareMediaFrame } from './video-media';

const uid = () => crypto.randomUUID();
const makeText = (text = '', y = .5) => ({ id: uid(), type: 'text', text, x: .5, y, width: .92, size: 59, maxFontSize: 1000, font: 'Anton, Impact, "Arial Black", sans-serif', color: '#ffffff', outlineColor: '#161616', shadowColor: '#000000', outline: 2.5, shadow: 5, bold: true, align: 'center', verticalAlign: 'middle', height: .22, rotation: 0, opacity: 100, keyframes: [], easing: 'linear' });
const initialObjects = [makeText('', .16), makeText('', .88)];
const initialDoc = { name: 'Untitled masterpiece', crop: { x: 0, y: 0, width: 900, height: 620 }, objects: initialObjects, trim: [0, 3000] };

function App() {
  const [media, setMedia] = useState(null);
  const [doc, setDoc] = useState(initialDoc);
  const [selectedId, setSelectedId] = useState(initialObjects[0].id);
  const [tool, setTool] = useState('text');
  const [inspector, setInspectorState] = useState('object');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [output, setOutput] = useState(null);
  const [creations, setCreations] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportFormat, setExportFormat] = useState('png');
  const [exportWidth, setExportWidth] = useState('original');
  const [exportFps,setExportFps]=useState('auto');
  const [keyframeClipboard,setKeyframeClipboard]=useState(null);
  const [keyframeAction, setKeyframeAction] = useState('move');
  const [zoom, setZoom] = useState(100);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [cropDraft, setCropDraft] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const images = useRef(new Map());
  const history = useRef({ past: [], future: [] });
  const docRef = useRef(doc); docRef.current = doc;
  const canvasRef = useRef(null), surfaceRef = useRef(null);
  const baseInput = useRef(null), layerInput = useRef(null);
  const drag = useRef(null), trimDrag = useRef(null), toastTimer = useRef(null);
  const workerRef = useRef(null), urls = useRef([]);
  const importGeneration = useRef(0);
  const geometry=canvasSize(doc);
  const selected = doc.objects.find(o => o.id === selectedId);
  const hasMotion = doc.objects.some(o => o.keyframes.length > 0);

  function setInspector(value) {
    setInspectorState(value);
    if (value !== 'canvas') setCropDraft(null);
  }
  useEffect(() => {
    if (inspector === 'gif' && !canTrimMedia(media)) setInspector('object');
  },[media,inspector]);
  const notify = useCallback(message => { setToast(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 4200); }, []);
  const {time,setTime,timeRef,playing,setPlaying}=usePreview({media,doc,images,canvasRef,surfaceRef,onError:notify});
  const checkpoint = useCallback(() => {
    history.current.past = [...history.current.past.slice(-49), docRef.current];
    history.current.future = [];
    setHistoryVersion(v => v + 1);
  }, []);
  const commit = useCallback((change, record = true) => {
    if (record) checkpoint();
    const next = typeof change === 'function' ? change(docRef.current) : change;
    docRef.current = next; setDoc(next);
  }, [checkpoint]);
  const updateObject = (patch, id = selectedId, record = true) => commit(d => ({ ...d, objects: d.objects.map(o => o.id === id ? updateObjectProperties(o,patch,canvasSize(d)) : o) }), record);
  const undo = useCallback(() => {
    const prev = history.current.past.pop(); if (!prev) return;
    history.current.future.push(docRef.current); docRef.current = prev; setDoc(prev); setHistoryVersion(v => v + 1);
  }, []);
  const redo = useCallback(() => {
    const next = history.current.future.pop(); if (!next) return;
    history.current.past.push(docRef.current); docRef.current = next; setDoc(next); setHistoryVersion(v => v + 1);
  }, []);
  const addText = useCallback(() => {
    const object = makeText(); commit(d => ({ ...d, objects: [...d.objects, object] }));
    setSelectedId(object.id); setTool('text');
  }, [commit]);
  const deleteObject = useCallback(() => {
    if (!selectedId) return;
    commit(d => ({ ...d, objects: d.objects.filter(o => o.id !== selectedId) })); setSelectedId(null);
  }, [commit, selectedId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await document.fonts.load('59px Anton');
        const response = await fetch('/studio-cat.jpg');
        const file = new File([await response.blob()], 'a-very-relatable-cat.jpg', { type: 'image/jpeg' });
        const m = await loadMedia(file);
        if (!cancelled && importGeneration.current === 0) {
          setMedia(m); setExportWidth('original');
          setDoc(d => ({ ...d, crop: { x: 0, y: 0, width: m.width, height: m.height } }));
        }
      } catch { if (!cancelled) notify('Upload an image or GIF to get started.'); }
    })();
    return () => { cancelled = true; };
  }, [notify]);
  useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); workerRef.current?.terminate(); clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    const handler = e => {
      if (modal) { if (e.key === 'Escape') setModal(null); return; }
      if (e.target.closest('input, textarea, select, [contenteditable]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteObject(); }
      else if (e.code === 'Space') { e.preventDefault(); setPlaying(p => !p); }
      else if ((e.ctrlKey || e.metaKey) && inspector === 'animation' && e.key.toLowerCase() === 'c' && selected?.keyframes.length && !window.getSelection()?.toString()) { e.preventDefault();copyKeyframes(); }
      else if ((e.ctrlKey || e.metaKey) && inspector === 'animation' && e.key.toLowerCase() === 'v' && keyframeClipboard && selected) { e.preventDefault();pasteKeyframes(); }
      else if (e.key.toLowerCase() === 't') addText();
      else if (e.key === 'Escape') { setSelectedId(null); setModal(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, addText, deleteObject, modal,inspector,selected,keyframeClipboard]);

  async function upload(file, asLayer = false, sourceType, videoSize) {
    if (!file) return;
    const generation = asLayer ? importGeneration.current : ++importGeneration.current;
    setLoading(true); setPlaying(false);
    try {
      const next = await loadMedia(file,{sourceType,videoSize});
      if (!asLayer && generation !== importGeneration.current) { next.dispose?.(); return { ok: false, error: 'A newer image was opened.' }; }
      next.sourceType = sourceType || next.format;
      if (asLayer) {
        if (next.isAnimated) notify('Animated image layers use their first frame. Open it as your background to keep the animation.');
        const imageId = uid(); images.current.set(imageId, next.frames[0].image);
        const object = { id: uid(), imageId, type: 'image', name: file.name, x: .5, y: .5, width: .38, aspect: next.width / next.height, rotation: 0, opacity: 100, keyframes: [], easing: 'linear' };
        commit(d => ({ ...d, objects: [...d.objects, object] })); setSelectedId(object.id);
        notify('Image added. Drag it into place.');
      } else {
        setMedia(next); setTime(0); setExportFormat(next.isAnimated ? 'gif' : 'png'); setExportWidth('original');setExportFps('auto');setKeyframeClipboard(null);
        commit(d => ({ ...d, crop: { x: 0, y: 0, width: next.width, height: next.height }, trim: [0, next.duration], padding: undefined, objects: d.objects.map(o => ({ ...o, ...(o.type === 'text' ? { text: '' } : {}), keyframes: [] })) }), false);
        history.current = { past: [], future: [] }; setHistoryVersion(v => v + 1); setCropDraft(null);
        notify(`${sourceType === 'youtube' ? 'YouTube animation' : next.format.toUpperCase()} ready. Make it yours.`);
      }
      return { ok: true };
    } catch (error) { notify(error.message); return { ok: false, error: error.message }; }
    finally { setLoading(false); if (baseInput.current) baseInput.current.value = ''; if (layerInput.current) layerInput.current.value = ''; }
  }

  function pointerDown(e, forcedId, mode = 'move') {
    if (!media || e.button !== 0) return;
    const rect = surfaceRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width, y = (e.clientY - rect.top) / rect.height;
    if (inspector === 'canvas' && cropDraft) {
      e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
      setPlaying(false);
      drag.current = { mode: 'crop', startX: clamp(x,0,1), startY: clamp((y*geometry.height-(doc.padding?.top || 0))/doc.crop.height,0,1) };
      return;
    }
    let object = doc.objects.find(o => o.id === forcedId);
    if (!object) object = [...doc.objects].reverse().find(o => {
      if (!visibleAt(o,time)) return false;
      const b = objectBounds(o, geometry, time);
      const px = (x * geometry.width - b.x - b.width / 2), py = (y * geometry.height - b.y - b.height / 2);
      const angle = -(o.rotation || 0) * Math.PI / 180;
      const rx = px * Math.cos(angle) - py * Math.sin(angle), ry = px * Math.sin(angle) + py * Math.cos(angle);
      return Math.abs(rx) <= b.width / 2 && Math.abs(ry) <= b.height / 2;
    });
    if (!object) { setSelectedId(null); return; }
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    setPlaying(false); setSelectedId(object.id); checkpoint();
    drag.current = { id: object.id, startX: x, startY: y, position: positionAt(object, time), object, bounds: objectBounds(object,geometry,time), rotation: object.rotation || 0, mode, startAngle:Math.atan2((y-positionAt(object,time).y)*geometry.height,(x-positionAt(object,time).x)*geometry.width) };
  }
  function pointerMove(e) {
    if (!drag.current) return;
    const rect = surfaceRef.current.getBoundingClientRect(), d = drag.current;
    const x = (e.clientX - rect.left) / rect.width, y = (e.clientY - rect.top) / rect.height;
    if (d.mode === 'crop') {
      const crop = docRef.current.crop;
      const cropY=clamp((y*geometry.height-(docRef.current.padding?.top || 0))/crop.height,0,1);
      const left = Math.min(d.startX, clamp(x,0,1)), top = Math.min(d.startY,cropY);
      const width = Math.max(16, Math.round(Math.abs(d.startX - clamp(x,0,1)) * crop.width));
      const height = Math.max(16, Math.round(Math.abs(d.startY-cropY) * crop.height));
      setCropDraft({ x: Math.round(crop.x + Math.min(left * crop.width, crop.width - width)), y: Math.round(crop.y + Math.min(top * crop.height, crop.height - height)), width: Math.min(width, crop.width), height: Math.min(height, crop.height) });
      return;
    }
    const object = docRef.current.objects.find(o => o.id === d.id);
    if (!object) return;
    if(d.mode==='rotate'){
      const angle=Math.atan2((y-d.position.y)*geometry.height,(x-d.position.x)*geometry.width);
      updateObject({rotation:rotationFromDrag(d.rotation,d.startAngle,angle,e.shiftKey)},d.id,false);
    } else if (d.mode.startsWith('resize')) {
      const handle = d.mode.slice(7), angle = -d.rotation * Math.PI / 180;
      const dx = (x-d.startX)*geometry.width, dy = (y-d.startY)*geometry.height;
      const localX = dx*Math.cos(angle)-dy*Math.sin(angle), localY = dx*Math.sin(angle)+dy*Math.cos(angle);
      const horizontal = handle.includes('l') ? -1 : handle.includes('r') ? 1 : 0;
      const vertical = handle.includes('t') ? -1 : handle.includes('b') ? 1 : 0;
      const fx = horizontal ? Math.max(.05,(d.bounds.width+localX*2*horizontal)/d.bounds.width) : 1;
      const fy = vertical ? Math.max(.05,(d.bounds.height+localY*2*vertical)/d.bounds.height) : 1;
      updateObject(resizeObject(d.object,geometry,d.bounds,fx,fy),d.id,false);
    } else {
      const pos = { x: clamp(d.position.x+x-d.startX,-.2,1.2), y: clamp(d.position.y+y-d.startY,-.2,1.2) };
      if (object.keyframes.length) updateObject({ keyframes: upsertKeyframe(object,timeRef.current,pos) },d.id,false);
      else updateObject(pos,d.id,false);
    }
  }
  const stopDrag = () => { drag.current = null; };
  function addKeyframe() {
    if (!selected) return;
    const patch = keyframeAction === 'move' ? { x: positionAt(selected,time).x, y: positionAt(selected,time).y } : { visible: keyframeAction === 'show' };
    updateObject({ keyframes: upsertKeyframe(selected,time,patch) });
    notify(`${keyframeAction === 'move' ? 'Position' : keyframeAction === 'show' ? 'Show' : 'Hide'} keyframe added at ${formatTime(time-doc.trim[0])}.`);
  }
  function copyKeyframes() {
    if(!selected?.keyframes.length)return;
    const snapshot=snapshotKeyframes(selected);setKeyframeClipboard(snapshot);
    notify(`${snapshot.keyframes.length} keyframes copied.`);
  }
  function pasteKeyframes() {
    if(!selected || !keyframeClipboard)return;
    commit(d=>({...d,objects:d.objects.map(object=>object.id===selectedId ? pasteKeyframeSnapshot(object,keyframeClipboard) : object)}));
    notify('Keyframes pasted at their original times.');
  }
  function changeFontSize(delta) {
    const object = docRef.current.objects.find(o => o.id === selectedId);
    if (object?.type === 'text') updateObject({ size: clamp(textLayout(object,canvasSize(docRef.current)).size+delta,1,object.maxFontSize ?? 1000) },object.id,false);
  }
  function applyFormatting() {
    if (selected?.type !== 'text') return;
    commit(d => ({ ...d, objects: applyTextFormatting(d.objects,selected) }));
    notify('Formatting applied to all text boxes.');
  }
  function setPosition(axis,value) {
    if (!selected) return;
    const pos = { ...positionAt(selected,time), [axis]: clamp(value/100,-.2,1.2) };
    updateObject(selected.keyframes.length ? { keyframes: upsertKeyframe(selected,time,{ x:pos.x,y:pos.y }) } : { [axis]:pos[axis] });
  }
  function scaleSelected(axis,value) {
    if (!selected) return;
    const b = objectBounds(selected,geometry,time);
    const target = value/100*(axis === 'x' ? geometry.width : geometry.height);
    updateObject(resizeObject(selected,geometry,b,axis === 'x' ? target/b.width : 1,axis === 'y' ? target/b.height : 1));
  }
  function duplicate() {
    if (!selected) return;
    const copy = { ...selected, id: uid(), x: selected.x + .035, y: selected.y + .035, keyframes: selected.keyframes.map(k => ({ ...k, ...(Number.isFinite(k.x) ? { x:k.x+.035,y:k.y+.035 } : {}) })) };
    commit(d => ({ ...d, objects: [...d.objects, copy] })); setSelectedId(copy.id);
  }
  function reorder(delta) {
    const list = [...doc.objects], index = list.findIndex(o => o.id === selectedId), next = index + delta;
    if (index < 0 || next < 0 || next >= list.length) return;
    [list[index], list[next]] = [list[next], list[index]]; commit({ ...doc, objects: list });
  }
  function openCrop() { if (!media) return; setInspector('canvas'); setCropDraft({ ...doc.crop }); }
  function cropRatio(ratio) {
    const base = cropDraft || doc.crop;
    let w = base.width, h = w / ratio;
    if (h > base.height) { h = base.height; w = h * ratio; }
    setCropDraft({ x: Math.round(base.x + (base.width - w) / 2), y: Math.round(base.y + (base.height - h) / 2), width: Math.round(w), height: Math.round(h) });
  }
  function applyCrop() {
    const crop = cropDraft;
    if (!crop || crop.width < 16 || crop.height < 16) { notify('Crop dimensions must be at least 16 pixels.'); return; }
    commit({ ...doc, crop });
    if (exportWidth !== 'original' && exportWidth > crop.width) setExportWidth('original');
    setCropDraft(null); notify('Crop applied to every frame.');
  }
  function setPadding(patch) { commit(d => updateCanvasPadding(d,patch)); }
  function setTrim(index, value) {
    if (!canTrimMedia(media)) return;
    const trim = [...doc.trim];
    trim[index] = index === 0 ? clamp(value, 0, trim[1] - 100) : clamp(value, trim[0] + 100, media.duration);
    commit({ ...doc, trim }); setTime(t => clamp(t, trim[0], trim[1] - 1));
  }
  function stepFrame(direction) {
    if (!media) return;
    setPlaying(false);
    setTime(current => stepMediaFrame(media,current,direction,doc.trim));
  }

  function dragTrim(e, index, start = false) {
    e.preventDefault(); e.stopPropagation();
    if(['pointerup','pointercancel','lostpointercapture'].includes(e.type)){
      trimDrag.current=null;
      if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    if(!canTrimMedia(media))return;
    if(start){
      checkpoint();setPlaying(false);e.currentTarget.setPointerCapture(e.pointerId);
      const track=e.currentTarget.parentElement.querySelector('.thumbnail-row');
      const rect=track.getBoundingClientRect();
      trimDrag.current={index,pointerId:e.pointerId,startX:e.clientX,value:docRef.current.trim[index],width:Math.max(1,rect.width)};
      return;
    }
    const held=trimDrag.current;
    if(!held || held.index!==index || held.pointerId!==e.pointerId || !e.currentTarget.hasPointerCapture(e.pointerId))return;
    const trim = [...docRef.current.trim];
    const value=Math.round((held.value+(e.clientX-held.startX)/held.width*media.duration)/10)*10;
    trim[index] = index === 0 ? clamp(value,0,trim[1]-100) : clamp(value,trim[0]+100,media.duration);
    commit(d => ({ ...d, trim }),false); setTime(t => clamp(t,trim[0],trim[1]-1));
  }

  async function generate() {
    if (!media || exporting) return;
    setPlaying(false); setExporting(true); setProgress(0);
    const exportTime=timeRef.current;
    let exportSource;
    try {
      exportSource=await createExportSource(media);
      const exportMedia=exportSource.media;
      const {width,height} = exportSize(geometry,exportWidth);
      const target = canvas(width,height);
      let blob,gifStats;
      if (exportFormat === 'png') {
        await prepareMediaFrame(exportMedia,exportTime);
        renderScene(target, exportMedia, doc, exportTime, images.current, width);
        blob = await new Promise((resolve, reject) => target.toBlob(b => b ? resolve(b) : reject(new Error('The image could not be generated.')), 'image/png'));
      } else {
        const schedule = exportSchedule(media, doc.trim[0], doc.trim[1], hasMotion, doc.objects.flatMap(o => o.keyframes),exportFps);
        const worker = new Worker(new URL('./gif.worker.js', import.meta.url), { type: 'module' }); workerRef.current = worker;
        const request = (data, transfer = []) => new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Export took too long. Try a smaller output size.')), 60000);
          worker.onmessage = e => { clearTimeout(timeout); e.data.type === 'error' ? reject(new Error(e.data.message)) : resolve(e.data); };
          worker.onerror = e => { clearTimeout(timeout); reject(new Error(e.message || 'GIF export failed.')); };
          worker.postMessage(data, transfer);
        });
        try {
          await request({ type: 'start', width: target.width, height: target.height });
          for (let i = 0; i < schedule.length; i++) {
            await prepareMediaFrame(exportMedia,schedule[i].time);
            renderScene(target, exportMedia, doc, schedule[i].time, images.current, width, true);
            const pixels = target.getContext('2d').getImageData(0, 0, target.width, target.height).data.buffer;
            await request({ type: 'frame', pixels, delay: schedule[i].delay }, [pixels]);
            setProgress(Math.round((i + 1) / schedule.length * 100));
          }
          const result = await request({ type: 'finish' }); blob = new Blob([result.bytes], { type: 'image/gif' });
          const duration=schedule.reduce((sum,frame)=>sum+frame.delay,0);
          gifStats={frames:schedule.length,duration,fps:Math.round(schedule.length*1000/duration*1000)/1000};
        } finally { worker.terminate(); workerRef.current = null; }
      }
      const url = URL.createObjectURL(blob); urls.current.push(url);
      const result = { url, blob, name: doc.name, format: exportFormat, width: target.width, height: target.height, id: uid(),...gifStats };
      setOutput(result); setCreations(prev => [result, ...prev]); setModal('result');
    } catch (error) { notify(`Export failed: ${error.message}`); }
    finally { exportSource?.dispose(); setExporting(false); }
  }
  const bounds = !playing && selected && visibleAt(selected,time) && media ? objectBounds(selected, geometry, time) : null;
  const draft = cropDraft || doc.crop;
  const tools = [{ id:'text',icon:Type,label:'Text' },{ id:'images',icon:ImagePlus,label:'Images' }];

  return <div className="app-shell" onDragOver={e => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setDragOver(true); }} onDrop={e => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files[0]); }}>
    <input ref={baseInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" hidden onChange={e => upload(e.target.files[0])} />
    <input ref={layerInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden onChange={e => upload(e.target.files[0], true)} />
    <header className="topbar">
      <a className="brand" href="/" aria-label="FreeMemes home"><span className="brand-icon"><Frame size={23} strokeWidth={2.4} /></span>Free<span className="brand-light">Memes</span><span className="beta">BETA</span></a>
      <nav><button className="nav-active" onClick={() => setModal(null)}>Editor</button><button onClick={() => setModal('creations')}>My creations <span className="nav-count">{creations.length}</span></button></nav>
      <div className="topbar-end"><span className="local-badge"><span /> Edited in your browser</span><button className="help-button" onClick={() => setModal('help')}><CircleHelp size={16} /><span>Quick guide</span></button><span className="avatar">Y<span /></span></div>
    </header>

    <main>

      <section className="workspace">
        <div className="project-bar"><div className="project-name"><span className="project-icon"><FileImage size={16} /></span><input aria-label="Project name" value={doc.name} onChange={e => commit({ ...doc, name: e.target.value })} /><span className="project-dot">•</span><span className="draft-badge">DRAFT</span></div><div className="project-actions"><span><ShieldCheck size={13} /> Private by design</span><button className="button upload-button" disabled={loading} onClick={() => { setPlaying(false); setModal('new'); }}>{loading ? <LoaderCircle className="spin" size={15} /> : <ImagePlus size={15} />} New image</button><button className="button primary" disabled={!media || exporting} onClick={generate}>{exporting ? <LoaderCircle className="spin" size={15} /> : <WandSparkles size={15} />}{exporting ? `Generating ${progress}%` : 'Generate'}{!exporting && <ArrowRight size={15} />}</button></div></div>

        <div className="editor-grid">
          <aside className="toolbox">
            <div className="panel-heading">THE TOOLKIT <span>LET’S MAKE IT</span></div>
            <div className="tool-grid">{tools.map(({ id, icon: Icon, label }) => <button key={id} className={`tool-button ${tool === id ? 'active' : ''}`} onClick={() => setTool(id)}><Icon size={20} /><span>{label}</span>{tool === id && <span className="tool-dot" />}</button>)}</div>

            <div className="tool-content">
              {tool === 'text' && <><div className="section-title"><h3>A few words go a long way.</h3><p>Add a thought. Or the punchline.</p></div><button className="button add-text-button" onClick={addText}><Plus size={17} /> Add text <kbd>T</kbd></button><div className="small-label">TRY A STYLE</div><div className="text-presets"><button onClick={() => selected?.type === 'text' ? updateObject({ font: 'Anton, Impact, "Arial Black", sans-serif', bold: true, color: '#ffffff', outline: 2.5, shadow: 5 }) : addText()}><span className="preset-classic">CLASSIC</span><span>The original meme energy</span><ArrowRight size={14} /></button><button onClick={() => selected?.type === 'text' ? updateObject({ font: '"DM Sans", sans-serif', bold: true, color: '#ffffff', outline: 0, shadow: 8 }) : addText()}><span className="preset-clean">Keep it simple.</span><span>A little less loud</span><ArrowRight size={14} /></button><button onClick={() => selected?.type === 'text' ? updateObject({ font: 'Anton, Impact, "Arial Black", sans-serif', bold: true, color: '#d7ff83', outline: 0, shadow: 6 }) : addText()}><span className="preset-bold">BIG MOOD.</span><span>For the main character</span><ArrowRight size={14} /></button></div><div className="tip"><MousePointer2 size={15} /><span>Click any text on the canvas to edit it. Drag to find its happy place.</span></div></>}
              {tool === 'images' && <><div className="section-title"><h3>A picture inside a picture.</h3><p>Stickers, reaction faces, anything.</p></div><button className="upload-zone" onClick={() => layerInput.current.click()}><ImagePlus size={26} /><strong>Add an image layer</strong><span>PNG, JPG, WebP, or GIF’s first frame</span></button><button className="button full-width" onClick={() => { setPlaying(false); setModal('new'); }}><Upload size={15} /> Replace background</button><div className="tip"><Layers size={15} /><span>Transparent PNGs make great stickers. Resize using the side or corner handles.</span></div></>}

            </div>

            <div className="layers-panel"><div className="layers-heading"><span><Layers size={14} /> Layers <b>{doc.objects.length}</b></span><IconButton icon={Plus} label="Add text layer" onClick={addText} /></div><div className="layer-list">{[...doc.objects].reverse().map((o, i) => <div key={o.id} className={`layer-row ${selectedId === o.id ? 'selected' : ''}`}><button className="layer-select" onClick={() => setSelectedId(o.id)}><GripVertical size={12} className="grip" /><span className="layer-type">{o.type === 'text' ? <Type size={14} /> : <FileImage size={14} />}</span><span>{o.type === 'text' ? o.text.replaceAll('\n', ' ') || 'Empty text' : o.name}</span>{o.keyframes.length > 0 && <Diamond size={10} className="purple" />}</button><IconButton icon={o.hidden ? EyeOff : Eye} label={o.hidden ? 'Show layer' : 'Hide layer'} onClick={() => updateObject({ hidden: !o.hidden }, o.id)} /></div>)}</div><div className="base-layer"><FileImage size={13} /><span>Background</span><span>{media?.sourceType === 'youtube' ? 'YOUTUBE' : media?.format?.toUpperCase() || 'IMAGE'}</span></div></div>
          </aside>

          <section className="canvas-column">
            <div className="canvas-toolbar"><div className="file-label"><span className={`file-dot ${media?.isAnimated ? 'gif-dot' : ''}`} /><span>{media?.name || 'Your canvas'}</span><span className="file-kind">{media?.sourceType === 'youtube' ? 'YOUTUBE' : media?.format?.toUpperCase() || 'IMAGE'}</span></div><div className="canvas-controls"><IconButton icon={Undo2} label="Undo (⌘Z)" disabled={!history.current.past.length} onClick={undo} /><IconButton icon={Redo2} label="Redo (⌘⇧Z)" disabled={!history.current.future.length} onClick={redo} /><span className="divider" /><button className="zoom-control" title="Change canvas zoom" onClick={() => setZoom(z => z === 100 ? 75 : z === 75 ? 50 : 100)}>{zoom}%<ChevronDown size={12} /></button><IconButton icon={Maximize} label="Fit canvas to workspace" onClick={() => setZoom(100)} /></div></div>
            <div className="canvas-workarea">
              <div className="canvas-dimensions">{Math.round(geometry.width)} <span>×</span> {Math.round(geometry.height)} px</div>
              <div className="canvas-fit" style={{ width: `${zoom}%` }}><div ref={surfaceRef} className="canvas-surface" style={{ aspectRatio: `${geometry.width} / ${geometry.height}` }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
                <canvas ref={canvasRef} aria-label="Image and GIF editing canvas" />
                {!media && <button className="empty-canvas" onClick={() => { setPlaying(false); setModal('new'); }}><ImagePlus size={40} /><strong>Your next great idea starts here.</strong><span>Upload an image or GIF</span></button>}
                {bounds && !cropDraft && <div className="selection-box" style={{ left: `${bounds.x / geometry.width * 100}%`, top: `${bounds.y / geometry.height * 100}%`, width: `${bounds.width / geometry.width * 100}%`, height: `${bounds.height / geometry.height * 100}%`, transform: `rotate(${selected.rotation || 0}deg)` }} onPointerDown={e => pointerDown(e, selectedId)}><div className="selection-label"><Move size={10} />{selected.type === 'text' ? 'Text' : 'Image'}</div><span className="selection-rotation-stem" /><button className="selection-rotate" aria-label="Rotate object" title="Drag to rotate · Shift snaps to 15°" onPointerDown={e => pointerDown(e,selectedId,'rotate')}><RotateCw size={12} /></button>{['tl','t','tr','r','br','b','bl','l'].map(c => <span key={c} className={`selection-handle ${c}`} onPointerDown={e => pointerDown(e, selectedId, `resize-${c}`)} />)}</div>}
                {inspector === 'canvas' && cropDraft && <div className="crop-preview" style={{ left: `${(draft.x - doc.crop.x) / doc.crop.width * 100}%`, top: `${(draft.y - doc.crop.y + (doc.padding?.top || 0)) / geometry.height * 100}%`, width: `${draft.width / doc.crop.width * 100}%`, height: `${draft.height / geometry.height * 100}%` }}><span /><span /><span /><span /><div>{draft.width} × {draft.height}</div></div>}
              </div></div>
              <div className="canvas-hint"><MousePointer2 size={13} /><span>Drag to position. Create something uniquely you.</span></div>
              <div className="canvas-quick"><button onClick={addText}><Type size={14} /> Add text</button><span /><button onClick={() => layerInput.current.click()}><ImagePlus size={14} /> Add image</button></div>
              {loading && <div className="loading-overlay"><LoaderCircle size={28} className="spin" /><span>Opening your file…</span></div>}
            </div>

            {(media?.isAnimated || hasMotion) && <div className="preview-playback"><IconButton icon={ChevronLeft} label="Previous frame" onClick={() => stepFrame(-1)} /><button className="play-button" aria-label={playing ? 'Pause preview' : 'Play preview'} onClick={() => setPlaying(p => !p)}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button><IconButton icon={ChevronRight} label="Next frame" onClick={() => stepFrame(1)} /><span className="time-display">{formatTime(clamp(time-doc.trim[0],0,doc.trim[1]-doc.trim[0]))} / {formatTime(doc.trim[1]-doc.trim[0])}</span><button className="text-button" onClick={() => setInspector(canTrimMedia(media) ? 'gif' : 'animation')}>{canTrimMedia(media) ? 'Edit GIF timeline' : 'Edit animation'}<ArrowRight size={12} /></button></div>}

          </section>

          <Inspector {...{ inspector,setInspector,media,doc,selected,time,setTime,playing,setPlaying,stepFrame,hasMotion,updateObject,addText,checkpoint,changeFontSize,applyFormatting,setPosition,scaleSelected,duplicate,reorder,deleteObject,cropDraft,setCropDraft,openCrop,cropRatio,applyCrop,setPadding,setTrim,dragTrim,commit,keyframeAction,setKeyframeAction,addKeyframe,copyKeyframes,pasteKeyframes,keyframeClipboard,exportFormat,setExportFormat,exportWidth,setExportWidth,exportFps,setExportFps }} />

        </div>
      </section>
    </main>


    {toast && <div className="toast" role="status"><Check size={16} /><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={14} /></button></div>}
    {dragOver && <div className="drop-overlay" onDragLeave={e => { if (e.target === e.currentTarget) setDragOver(false); }}><div><Upload size={44} /><h2>Drop a little inspiration.</h2><p>Your image or GIF is about to become something great.</p></div></div>}
    {modal === 'new' && <NewImageDialog onImport={(file,sourceType,videoSize) => upload(file,false,sourceType,videoSize)} onClose={() => setModal(null)} />}
    {modal && modal !== 'new' && <div className="modal-backdrop" onClick={() => setModal(null)}><section className={`modal ${modal === 'result' ? 'result-modal' : ''}`} role="dialog" aria-modal="true" aria-label={modal === 'result' ? 'Your generated creation' : modal === 'help' ? 'Quick guide' : 'My creations'} onClick={e => e.stopPropagation()}><IconButton icon={X} label="Close dialog" className="modal-close" onClick={() => setModal(null)} />
      {modal === 'result' && output && <><span className="modal-eyebrow"><Sparkles size={14} /> FRESH OUT OF YOUR IMAGINATION</span><h2>That’s a good one.</h2><p>Your creation is ready for its moment.</p><div className="result-image-wrap"><img src={output.url} alt={output.name || 'Your generated creation'} /></div><div className="result-meta"><span>{output.width} × {output.height} · {output.format.toUpperCase()} · {(output.blob.size/1024).toFixed(0)} KB{output.format==='gif' && Number.isFinite(output.fps) && ` · ${output.fps} FPS · ${(output.duration/1000).toFixed(2)}s`}</span></div><ResultActions output={output} onNotify={notify} /><button className="text-button full-width" onClick={() => setModal(null)}><ArrowLeft size={13} /> Back to the canvas</button></>}
      {modal === 'help' && <><span className="modal-eyebrow"><Sparkles size={14} /> A QUICK TOUR</span><h2>From idea to “send it.”</h2><div className="help-steps"><div><span>01</span><div><h3>Bring your own pixels.</h3><p>Use New image to paste, upload, or import a URL. PNG, GIF, WebP, JPEG, and AVIF are detected automatically. YouTube links import up to 60 seconds from their timestamp. Local uploads stay in your browser.</p></div></div><div><span>02</span><div><h3>Make it yours.</h3><p>Add text and images, then drag to position. Adjust colors, outlines, shadows, and crops with the side panels.</p></div></div><div><span>03</span><div><h3>Give it a little movement.</h3><p>Open Animation on the right and add a position, show, or hide keyframe. Move the playhead forward and drag your layer to create another. Trim animated GIFs in the GIF tab. Press Space to play or pause.</p></div></div><div><span>04</span><div><h3>Release it into the group chat.</h3><p>Choose PNG or GIF and click Generate. Copy PNG images directly. To share an animated GIF, download it and attach or drag the downloaded file into your message; right-click Copy image may copy only a still frame. Use Share GIF when available.</p></div></div></div><button className="button primary full-width" onClick={() => setModal(null)}>Let’s make something <ArrowRight size={15} /></button></>}
      {modal === 'creations' && <><span className="modal-eyebrow"><FolderOpen size={14} /> YOUR SESSION GALLERY</span><h2>Good ideas live here.</h2><p>Creations from this session. Download your favorites before you leave.</p>{!creations.length ? <div className="gallery-empty"><FileImage size={40} /><h3>Your first masterpiece awaits.</h3><p>Hit Generate when your creation feels just right.</p><button className="button primary" onClick={() => setModal(null)}>Back to creating <ArrowRight size={14} /></button></div> : <div className="gallery-grid">{creations.map(c => <button key={c.id} onClick={() => { setOutput(c); setModal('result'); }}><img src={c.url} alt={c.name} /><span>{c.name}<b>{c.format.toUpperCase()}</b></span></button>)}</div>}</>}
    </section></div>}
  </div>;
}

export const editorRoot = createRoot(document.getElementById('root'));
editorRoot.render(<App />);
