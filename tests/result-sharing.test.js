import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'esbuild';
import gifenc from 'gifenc';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { canCopyResult, copyResultToClipboard, resultFile, resultFilename, canShareFile, shareFile } from '../src/result-sharing.js';

function animatedResult() {
  const encoder=gifenc.GIFEncoder();
  for(let i=0;i<3;i++)encoder.writeFrame(new Uint8Array(4).fill(i),2,2,{palette:[[255,0,0],[0,255,0],[0,0,255]],delay:(i+1)*100,repeat:0});
  encoder.finish();
  return {format:'gif',name:'My creation.gif',url:'blob:generated-animation',blob:new Blob([encoder.bytes()],{type:'image/gif'})};
}
async function assertAnimation(blob) {
  assert.equal(blob.type,'image/gif');
  const frames=decompressFrames(parseGIF(await blob.arrayBuffer()),true);
  assert.deepEqual(frames.map(frame=>frame.delay),[100,200,300]);
  assert.notDeepEqual(frames[0].patch,frames[2].patch);
}
class ClipboardItemFake {
  static supports=type=>['image/png','image/gif'].includes(type);
  constructor(data){this.data=data;this.types=Object.keys(data);}
}

test('native GIF clipboard writes preserve the complete encoded animation', async () => {
  const output=animatedResult(),writes=[];
  const nav={clipboard:{write:async items=>writes.push(items)}};
  await copyResultToClipboard(output,nav,ClipboardItemFake);
  assert.equal(writes.length,1);assert.deepEqual(writes[0][0].types,['image/gif']);
  assert.equal(writes[0][0].data['image/gif'],output.blob);
  await assertAnimation(writes[0][0].data['image/gif']);
});

test('unsupported GIF or web-custom clipboard formats never substitute a still PNG', async () => {
  const output=animatedResult();let writes=0;
  const nav={clipboard:{write:async()=>writes++}};
  class CustomOnly extends ClipboardItemFake {static supports=type=>['image/png','web image/gif'].includes(type);}
  class Legacy extends ClipboardItemFake {static supports=undefined;}
  for(const Item of [CustomOnly,Legacy,undefined]){
    assert.equal(canCopyResult(output,nav,Item),false);
    await assert.rejects(()=>copyResultToClipboard(output,nav,Item),/Download the GIF/);
  }
  assert.equal(writes,0);
});

test('denied native GIF clipboard writes propagate failure without a PNG fallback', async () => {
  const attempts=[];
  const nav={clipboard:{write:async items=>{attempts.push(items[0].types);throw new DOMException('Denied','NotAllowedError');}}};
  await assert.rejects(()=>copyResultToClipboard(animatedResult(),nav,ClipboardItemFake),/Denied/);
  assert.deepEqual(attempts,[['image/gif']]);
});

test('PNG copying remains available with legacy ClipboardItem implementations', async () => {
  const blob=new Blob(['png fixture'],{type:'image/png'}),output={format:'png',blob};let copied;
  class Legacy extends ClipboardItemFake {static supports=undefined;}
  await copyResultToClipboard(output,{clipboard:{write:async items=>{copied=items[0];}}},Legacy);
  assert.deepEqual(copied.types,['image/png']);assert.equal(copied.data['image/png'],blob);
  assert.equal(canCopyResult(output,{},Legacy),false);
});

test('file sharing hands off the original GIF with a GIF filename and all frames', async () => {
  const output=animatedResult(),file=resultFile(output);let data;
  const nav={canShare:({files})=>files.length===1 && files[0].type==='image/gif',share:async value=>{data=value;}};
  assert.equal(file.name,'My creation.gif');assert.equal(resultFilename({name:'///',format:'gif'}),'freememes.gif');
  assert.equal(canShareFile(file,nav),true);await shareFile(file,nav);
  assert.deepEqual(Object.keys(data),['files']);assert.equal(data.files[0],file);
  assert.deepEqual(await file.arrayBuffer(),await output.blob.arrayBuffer());await assertAnimation(data.files[0]);
  assert.equal(canShareFile(file,{share:nav.share,canShare:()=>false}),false);
  await assert.rejects(()=>shareFile(file,{}),/Download the file/);
});

test('result dialog hides unsupported GIF copying, exposes file sharing, and keeps PNG copying', async () => {
  const window=new Window({url:'https://freememes.local/'}),saved=new Map(),notices=[],writes=[],shared=[];
  let gifSupported=false,sharing=false,denyCopy=false,cancelShare=false;
  class Item extends ClipboardItemFake {static supports=type=>type==='image/png' || (gifSupported && type==='image/gif');}
  Object.defineProperty(window.navigator,'clipboard',{value:{write:async items=>{writes.push(items);if(denyCopy)throw new DOMException('Denied','NotAllowedError');}}});
  Object.defineProperty(window.navigator,'canShare',{value:()=>sharing});
  Object.defineProperty(window.navigator,'share',{value:async data=>{if(cancelShare)throw new DOMException('Cancelled','AbortError');shared.push(data);}});
  for(const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,Element:window.Element,HTMLElement:window.HTMLElement,Node:window.Node,Event:window.Event,MouseEvent:window.MouseEvent,ClipboardItem:Item})){
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  window.document.body.innerHTML='<div id="root"></div>';
  const directory=await mkdtemp(path.join(tmpdir(),'freememes-sharing-'));
  const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
  let app;
  try {
    const source="import React from 'react';import {createRoot} from 'react-dom/client';import Actions from './src/ResultActions.jsx';const root=createRoot(document.getElementById('root'));export const render=(output,onNotify)=>root.render(React.createElement(Actions,{output,onNotify}));export const unmount=()=>root.unmount();";
    const built=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'esm',platform:'browser',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
    const file=path.join(directory,'sharing.mjs');await writeFile(file,built.outputFiles[0].text);app=await import(pathToFileURL(file).href);
    const output=animatedResult(),render=async value=>{app.render(value,text=>notices.push(text));await pause();};
    const button=label=>[...window.document.querySelectorAll('button')].find(element=>element.textContent.trim()===label);
    const click=async element=>{assert.ok(element);element.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await pause();};
    await render(output);
    assert.equal(Boolean(button('Copy GIF')),false);assert.equal(Boolean(button('How to copy')),false);
    assert.match(window.document.querySelector('.copy-tip').textContent,/still frame/);
    const download=window.document.querySelector('a[download]');assert.equal(download.getAttribute('href'),output.url);assert.equal(download.download,'My creation.gif');
    assert.equal(writes.length,0);assert.equal(Boolean(button('Share GIF')),false);
    gifSupported=true;sharing=true;await render(output);
    await click(button('Copy GIF'));await assertAnimation(writes[0][0].data['image/gif']);assert.match(notices.at(-1),/receiving app/);
    denyCopy=true;await click(button('Copy GIF'));assert.match(notices.at(-1),/Could not copy.*Download/);
    assert.ok(writes.every(items=>items[0].types.join()==='image/gif'));
    await click(button('Share GIF'));await assertAnimation(shared[0].files[0]);
    cancelShare=true;const before=notices.length;await click(button('Share GIF'));assert.equal(notices.length,before);
    gifSupported=false;sharing=false;denyCopy=false;
    const png={...output,format:'png',blob:new Blob(['png'],{type:'image/png'})};await render(png);
    await click(button('Copy image'));assert.deepEqual(writes.at(-1)[0].types,['image/png']);
    assert.equal(window.document.querySelector('a[download]').download,'My creation.png');
  } finally {
    app?.unmount();await pause();await window.happyDOM.abort();window.close();await rm(directory,{recursive:true,force:true});
    for(const [key,value] of saved){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}
  }
});
