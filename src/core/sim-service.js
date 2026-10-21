// Service de résultats : calcule les matches télévisés dans un Worker,
// avec cache en mémoire et en localStorage (le résultat est identique au direct).
import { footTiming } from '../data/season.js';

const VERSION = 'v1';
const mem = new Map();
const pending = new Map();
let worker = null;
let seq = 0;
const queue = [];
let busy = false;

function store() {
  try { return window.localStorage; } catch (e) { return null; }
}

function key(info, k) { return `res:${VERSION}:${info.seed}`; }

export function cachedResult(info, k) {
  const kk = key(info, k);
  if (mem.has(kk)) return mem.get(kk);
  const s = store();
  if (s) {
    try { const v = s.getItem(kk); if (v) { const r = JSON.parse(v); mem.set(kk, r); return r; } } catch (e) { /* ignore */ }
  }
  return null;
}

export function saveResult(info, k, summary) {
  const kk = key(info, k);
  mem.set(kk, summary);
  const s = store();
  if (s) { try { s.setItem(kk, JSON.stringify(summary)); } catch (e) { /* quota */ } }
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { id, summary } = e.data;
    const p = pending.get(id);
    pending.delete(id);
    busy = false;
    if (p) p.resolve(summary);
    next();
  };
  worker.onerror = (e) => { console.error('worker', e); busy = false; next(); };
  return worker;
}

function next() {
  if (busy || !queue.length) return;
  const job = queue.shift();
  busy = true;
  pending.set(job.id, job);
  ensureWorker().postMessage(job.msg);
}

// Résultat complet d'un match télévisé (async)
export function fullSim(k) {
  return async (info) => {
    const c = cachedResult(info, k);
    if (c) return c;
    const kk = key(info, k);
    if (mem.has('p:' + kk)) return mem.get('p:' + kk);
    const T = footTiming(k);
    const prom = new Promise((resolve) => {
      const id = ++seq;
      queue.push({ id, resolve, msg: { id, homeId: info.home.id, awayId: info.away.id, seed: info.seed, speed: k, knockout: info.knockout, h2Offset: T.h2Offset } });
      next();
    }).then((summary) => { saveResult(info, k, summary); return summary; });
    mem.set('p:' + kk, prom);
    return prom;
  };
}
