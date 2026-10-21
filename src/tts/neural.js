// Voix neuronales hors-ligne (Piper) : un worker par voix pour paralléliser.
import { audioCtx, getBus } from '../audio/audio.js';

export const VOICE_MODELS = {
  // commentateur principal : voix d'homme rapide et claire
  pbp: { file: 'voices/fr_FR-gilles-low.onnx', sid: 0 },
  // consultant : voix d'homme plus posée
  cons: { file: 'voices/fr_FR-tom-medium.onnx', sid: 0 },
};

class Neural {
  constructor() {
    this.workers = {};
    this.ready = {};
    this.seq = 0;
    this.waiting = new Map();
    this.rtf = {};
  }

  init() {
    if (this.started) return;
    this.started = true;
    const base = new URL('./', document.baseURI).href;
    for (const [id, m] of Object.entries(VOICE_MODELS)) {
      const w = new Worker(new URL('./piper-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onMsg(id, e.data);
      w.onerror = (e) => { console.warn('voix', id, e.message); this.ready[id] = false; };
      w.postMessage({ type: 'init', base, models: [{ id, url: base + m.file }] });
      this.workers[id] = w;
    }
  }

  onMsg(id, m) {
    if (m.type === 'model') { this.ready[id] = m.ok; if (!m.ok) console.warn('voix', id, m.error); }
    else if (m.type === 'audio' || m.type === 'error') {
      const p = this.waiting.get(m.id);
      this.waiting.delete(m.id);
      if (!p) return;
      if (m.type === 'error') return p.reject(new Error(m.error));
      const ctx = audioCtx();
      const buf = ctx.createBuffer(1, m.pcm.length, m.rate);
      buf.copyToChannel(m.pcm, 0);
      this.rtf[id] = m.ms / 1000 / Math.max(0.2, m.pcm.length / m.rate);
      p.resolve(buf);
    }
  }

  has(id) { return !!this.ready[id] && !!audioCtx(); }

  synth(id, text, opts = {}) {
    const n = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(n, { resolve, reject });
      this.workers[id].postMessage({ type: 'speak', id: n, model: id, text, sid: VOICE_MODELS[id].sid, length: opts.length ?? 1, noise: opts.noise, noiseW: opts.noiseW });
      setTimeout(() => { if (this.waiting.has(n)) { this.waiting.delete(n); reject(new Error('délai')); } }, 20000);
    });
  }

  // Chaîne "cabine de commentateur" : filtre, présence, compression
  chain() {
    if (this._chain) return this._chain;
    const ctx = audioCtx();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110;
    const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3200; pres.gain.value = 4; pres.Q.value = 0.9;
    const warm = ctx.createBiquadFilter(); warm.type = 'lowshelf'; warm.frequency.value = 220; warm.gain.value = 2.5;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -22; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.15;
    const out = ctx.createGain(); out.gain.value = 1.6;
    hp.connect(warm).connect(pres).connect(comp).connect(out).connect(getBus('voice'));
    this._chain = hp;
    return hp;
  }

  play(buf, { rate = 1, gain = 1 } = {}) {
    const ctx = audioCtx();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g).connect(this.chain());
    src.start();
    return { src, done: new Promise(r => (src.onended = r)), dur: buf.duration / rate };
  }
}

export const neural = new Neural();
