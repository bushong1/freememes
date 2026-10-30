import React, { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

export function IconButton({ icon: Icon, label, className = '', ...props }) {
  return <button className={`icon-button ${className}`} title={label} aria-label={label} {...props}><Icon size={16} /></button>;
}
export function Field({ label, children, className = '' }) {
  return <div className={`field ${className}`}><label>{label}</label>{children}</div>;
}
export function Slider({ label, value, onChange, min = 0, max = 100, step = 1, suffix = '' }) {
  return <Field label={<><span>{label}</span><span className="field-value">{Math.round(value * 10) / 10}{suffix}</span></>}><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} style={{ '--range': `${(value - min) / (max - min) * 100}%` }} /></Field>;
}
export function ColorField({ label, value, onChange }) {
  return <Field label={label}><div className="color-input"><input type="color" aria-label={`${label} color`} value={value} onChange={e => onChange(e.target.value)} /><span>{value.toUpperCase()}</span><ChevronDown size={12} /></div></Field>;
}

export function HoldButton({ label, onStart, onStep, children }) {
  const delay = useRef(null), interval = useRef(null);
  const callbacks = useRef({ onStart,onStep }); callbacks.current = { onStart,onStep };
  const stop = () => { clearTimeout(delay.current); clearInterval(interval.current); delay.current = null; interval.current = null; };
  useEffect(() => {
    window.addEventListener('blur',stop);
    document.addEventListener('visibilitychange',stop);
    return () => { stop(); window.removeEventListener('blur',stop); document.removeEventListener('visibilitychange',stop); };
  },[]);
  return <button aria-label={label} title={`${label} · hold to repeat`}
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
      stop(); callbacks.current.onStart(); callbacks.current.onStep();
      delay.current = setTimeout(() => { callbacks.current.onStep(); interval.current = setInterval(() => callbacks.current.onStep(),65); },300);
    }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
    onClick={e => { if (e.detail === 0) { callbacks.current.onStart(); callbacks.current.onStep(); } }}>
    {children}
  </button>;
}
