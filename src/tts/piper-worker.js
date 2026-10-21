// Synthèse vocale neuronale (Piper / VITS) exécutée hors du fil principal.
// Le texte est converti en phonèmes (espeak-ng compilé en WebAssembly), puis
// le modèle ONNX génère l'audio.
import * as ort from 'onnxruntime-web/wasm';
import { createPiperPhonemize } from './piper_phonemize.js';

let base = '';
const models = {};
let phonemizer = null;
let pending = null;

async function getPhonemizer() {
  if (phonemizer) return phonemizer;
  phonemizer = await createPiperPhonemize({
    print: (data) => { if (pending) { const p = pending; pending = null; p.resolve(JSON.parse(data)); } },
    printErr: (m) => { if (pending && /error/i.test(m)) { const p = pending; pending = null; p.reject(new Error(m)); } },
    locateFile: (url) => base + 'piper/' + url.split('/').pop(),
    noExitRuntime: true,
  });
  return phonemizer;
}

async function phonemize(text, voice) {
  const mod = await getPhonemizer();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    try {
      mod.callMain(['-l', voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
    } catch (e) {
      // certaines versions "quittent" après callMain : on recrée le module
      phonemizer = null;
      if (pending) { pending = null; reject(e); }
    }
  });
}

async function loadModel(id, url) {
  if (models[id]) return models[id];
  const [cfg, buf] = await Promise.all([
    fetch(url + '.json').then(r => { if (!r.ok) throw new Error('config ' + r.status); return r.json(); }),
    fetch(url).then(r => { if (!r.ok) throw new Error('modèle ' + r.status); return r.arrayBuffer(); }),
  ]);
  const session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  models[id] = { cfg, session };
  return models[id];
}

async function synth({ model, text, sid = 0, length = 1, noise, noiseW }) {
  const m = models[model];
  const res = await phonemize(text, m.cfg.espeak.voice);
  let ids = res.phoneme_ids;
  // re-calcul des identifiants avec la table propre au modèle (anciens modèles)
  const map = m.cfg.phoneme_id_map;
  if (map && res.phonemes) {
    const ph = Array.isArray(res.phonemes) ? res.phonemes.flat().join('') : String(res.phonemes);
    const out = [...(map['^'] || [1])];
    for (const c of ph) { const v = map[c]; if (v) { out.push(...v); out.push(...(map['_'] || [0])); } }
    out.push(...(map['$'] || [2]));
    ids = out;
  }
  const inf = m.cfg.inference || {};
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)])),
    scales: new ort.Tensor('float32', Float32Array.from([noise ?? inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) * length, noiseW ?? inf.noise_w ?? 0.8])),
  };
  if (m.cfg.num_speakers > 1 || Object.keys(m.cfg.speaker_id_map || {}).length) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(sid)]));
  const out = await m.session.run(feeds);
  return { pcm: out.output.data, rate: m.cfg.audio.sample_rate };
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      base = msg.base;
      ort.env.wasm.wasmPaths = base + 'ort/';
      ort.env.wasm.numThreads = 1;
      await getPhonemizer();
      for (const m of msg.models) {
        try { await loadModel(m.id, m.url); self.postMessage({ type: 'model', id: m.id, ok: true }); }
        catch (err) { self.postMessage({ type: 'model', id: m.id, ok: false, error: String(err) }); }
      }
      self.postMessage({ type: 'ready' });
    } else if (msg.type === 'speak') {
      const t0 = performance.now();
      const { pcm, rate } = await synth(msg);
      const arr = new Float32Array(pcm);
      self.postMessage({ type: 'audio', id: msg.id, pcm: arr, rate, ms: performance.now() - t0 }, [arr.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, error: String(err && err.message || err) });
  }
};
