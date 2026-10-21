// Moteur audio entièrement synthétisé (Web Audio) : rumeur de la foule,
// clameurs, "ohhh", sifflets, chants et tambours des ultras, sifflet de
// l'arbitre, frappes de balle, jingles publicitaires.

let ctx = null;
let master = null;
const buses = {};

export function audioCtx() { return ctx; }

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC({ latencyHint: 'playback' });
  master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 3;
  master.connect(comp).connect(ctx.destination);
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(2.8, 2.2);
  const revGain = ctx.createGain(); revGain.gain.value = 0.35;
  reverb.connect(revGain).connect(master);
  buses.reverb = reverb;
  for (const name of ['stadium', 'ads', 'fx']) {
    const g = ctx.createGain(); g.gain.value = 1; g.connect(master); buses[name] = g;
  }
  return ctx;
}

export function setMasterVolume(v) { if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05); }
export function busGain(name, v, tc = 0.3) { if (buses[name]) buses[name].gain.setTargetAtTime(v, ctx.currentTime, tc); }

function impulse(sec, decay) {
  const len = Math.floor(ctx.sampleRate * sec);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}

let noiseBuf = null;
function noise() {
  if (noiseBuf) return noiseBuf;
  const len = ctx.sampleRate * 4;
  noiseBuf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = noiseBuf.getChannelData(c);
    // bruit rose (filtre de Paul Kellet)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return noiseBuf;
}

function noiseSource() {
  const s = ctx.createBufferSource();
  s.buffer = noise(); s.loop = true;
  s.loopStart = Math.random() * 2; s.loopEnd = s.loopStart + 2;
  return s;
}

// ------------------------------------------------------------------
// Ambiance de stade
export class StadiumSound {
  constructor() {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(buses.stadium);
    this.out.connect(buses.reverb);
    // couche "rumeur" (murmure de 50 000 personnes)
    this.layers = [];
    const mk = (type, freq, q, gain) => {
      const src = noiseSource();
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f).connect(g).connect(this.out);
      src.start(ctx.currentTime + Math.random() * 0.1);
      return { src, f, g };
    };
    this.murmur = mk('bandpass', 520, 0.6, 0.55);
    this.chatter = mk('bandpass', 1300, 1.2, 0.2);
    this.roar = mk('bandpass', 900, 0.5, 0);
    this.boo = mk('bandpass', 260, 2.0, 0);
    // modulation lente pour une rumeur vivante
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lg = ctx.createGain(); lg.gain.value = 0.12;
    lfo.connect(lg).connect(this.murmur.g.gain); lfo.start();
    this.level = 0.3;
    this.nextChant = ctx.currentTime + 6;
    this.chanting = false;
  }

  fadeIn(t = 1.5) { this.out.gain.setTargetAtTime(0.9, ctx.currentTime, t / 3); }
  fadeOut(t = 0.6) { this.out.gain.setTargetAtTime(0, ctx.currentTime, t / 3); }
  setVolume(v) { this.out.gain.setTargetAtTime(v, ctx.currentTime, 0.2); }

  // excitation 0..1 (proximité du but, action chaude)
  update(exc, dt) {
    const now = ctx.currentTime;
    this.level += (exc - this.level) * Math.min(1, dt * 1.5);
    const L = this.level;
    this.murmur.g.gain.setTargetAtTime(0.45 + L * 0.45, now, 0.4);
    this.chatter.g.gain.setTargetAtTime(0.12 + L * 0.25, now, 0.4);
    this.murmur.f.frequency.setTargetAtTime(480 + L * 260, now, 0.5);
    if (!this.chanting && now > this.nextChant && L < 0.7) {
      this.chant();
      this.nextChant = now + 28 + Math.random() * 40;
    }
  }

  surge(amount = 1, dur = 2.5) {
    const now = ctx.currentTime;
    const g = this.roar.g.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(1.1 * amount, now + 0.35);
    g.setTargetAtTime(0, now + dur, dur / 3);
    this.roar.f.frequency.setValueAtTime(700, now);
    this.roar.f.frequency.linearRampToValueAtTime(1200, now + 0.5);
    this.roar.f.frequency.setTargetAtTime(800, now + 1, 1);
  }

  // "Ohhhh" sur une occasion manquée
  ohh() {
    const now = ctx.currentTime;
    const src = noiseSource();
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 4;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 5;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f1); src.connect(f2); f1.connect(g); f2.connect(g); g.connect(this.out);
    f1.frequency.setValueAtTime(750, now); f1.frequency.exponentialRampToValueAtTime(380, now + 1.8);
    f2.frequency.setValueAtTime(1150, now); f2.frequency.exponentialRampToValueAtTime(700, now + 1.8);
    g.gain.linearRampToValueAtTime(2.2, now + 0.25); g.gain.setTargetAtTime(0, now + 1.0, 0.5);
    src.start(now); src.stop(now + 3);
  }

  booWhistle(dur = 2.5) {
    const now = ctx.currentTime;
    const g = this.boo.g.gain;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.9, now + 0.4); g.setTargetAtTime(0, now + dur, 0.6);
    // sifflets aigus de la foule
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const t0 = now + Math.random() * 0.8;
      const f = 2200 + Math.random() * 1400;
      o.frequency.setValueAtTime(f, t0); o.frequency.linearRampToValueAtTime(f * (0.9 + Math.random() * 0.2), t0 + 1);
      const og = ctx.createGain(); og.gain.value = 0;
      og.gain.setValueAtTime(0, t0); og.gain.linearRampToValueAtTime(0.015, t0 + 0.1); og.gain.setTargetAtTime(0, t0 + 0.6 + Math.random(), 0.2);
      o.connect(og).connect(this.out); o.start(t0); o.stop(t0 + 3);
    }
  }

  applause(dur = 4, intensity = 1) {
    const now = ctx.currentTime;
    const n = Math.floor(40 * dur * intensity);
    for (let i = 0; i < n; i++) {
      const t = now + Math.random() * dur;
      clap(this.out, t, 0.05 + Math.random() * 0.06 * intensity, 1200 + Math.random() * 1800);
    }
  }

  // Chant des supporters : chœur synthétisé + claps + tambour
  chant(kind) {
    const melodies = [
      // "Allez, allez, allez..."
      { tempo: 132, notes: [[67, 1], [67, 1], [67, 2], [65, 1], [64, 1], [62, 2], [67, 1], [67, 1], [67, 2], [69, 1], [67, 1], [65, 2]], vowel: 'a' },
      // "Olé, olé, olé, olé"
      { tempo: 120, notes: [[64, 1], [67, 2], [64, 1], [67, 2], [64, 1], [67, 1], [69, 1], [67, 1], [65, 1], [64, 3]], vowel: 'o' },
      // tapes rythmiques type "clap-clap-clap"
      { tempo: 110, claps: true, notes: [[0, 1], [0, 1], [0, 2], [0, 1], [0, 1], [0, 2]] },
    ];
    const m = melodies[kind ?? Math.floor(Math.random() * melodies.length)];
    const beat = 60 / m.tempo;
    const reps = 2 + Math.floor(Math.random() * 2);
    let t = ctx.currentTime + 0.05;
    this.chanting = true;
    const total = m.notes.reduce((a, n) => a + n[1], 0) * beat * reps;
    setTimeout(() => (this.chanting = false), total * 1000 + 300);
    this.chantLevel = 1;
    for (let r = 0; r < reps; r++) {
      for (const [note, len] of m.notes) {
        const d = len * beat;
        if (m.claps) {
          for (let k = 0; k < 60; k++) clap(this.out, t + Math.random() * 0.05, 0.04, 1000 + Math.random() * 2000);
        } else {
          choir(this.out, t, d * 0.92, note, m.vowel);
          drum(this.out, t);
        }
        t += d;
      }
    }
    return total;
  }
}

function clap(dest, t, gain, freq) {
  const src = ctx.createBufferSource();
  src.buffer = noise();
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.5;
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 3, 0.1);
}

const VOWELS = { a: [800, 1150, 2900], o: [450, 800, 2830], e: [400, 1600, 2700] };
function choir(dest, t, dur, midi, vowel = 'a') {
  const f0 = 440 * Math.pow(2, (midi - 69) / 12) / 2; // voix d'hommes
  const out = ctx.createGain(); out.gain.value = 0;
  const forms = VOWELS[vowel].map((fr, i) => {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = 6 + i * 2;
    const g = ctx.createGain(); g.gain.value = [1, 0.5, 0.18][i];
    bp.connect(g).connect(out);
    return bp;
  });
  const voices = 9;
  for (let v = 0; v < voices; v++) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const det = (Math.random() - 0.5) * 60;
    o.frequency.value = f0 * (v % 3 === 0 ? 2 : 1);
    o.detune.value = det;
    // vibrato individuel
    const vib = ctx.createOscillator(); vib.frequency.value = 4.5 + Math.random() * 2;
    const vg = ctx.createGain(); vg.gain.value = 6 + Math.random() * 8;
    vib.connect(vg).connect(o.detune);
    const t0 = t + Math.random() * 0.06;
    forms.forEach(f => o.connect(f));
    o.start(t0); vib.start(t0); o.stop(t + dur + 0.3); vib.stop(t + dur + 0.3);
  }
  // souffle
  const ns = ctx.createBufferSource(); ns.buffer = noise();
  const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = VOWELS[vowel][0]; nf.Q.value = 2;
  const ng = ctx.createGain(); ng.gain.value = 0.6;
  ns.connect(nf).connect(ng).connect(out); ns.start(t, Math.random() * 3, dur + 0.3);
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.05, t + 0.08);
  out.gain.setValueAtTime(0.05, t + dur * 0.75);
  out.gain.linearRampToValueAtTime(0, t + dur + 0.2);
  out.connect(dest);
}

function drum(dest, t) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g).connect(dest); o.start(t); o.stop(t + 0.4);
}

// ------------------------------------------------------------------
// Effets ponctuels
export function whistle(kind = 1) {
  if (!ctx) return;
  const blasts = kind === 3 ? [[0, 0.45], [0.6, 0.45], [1.2, 1.1]] : kind === 2 ? [[0, 0.25], [0.35, 0.6]] : [[0, 0.35 + Math.random() * 0.25]];
  const now = ctx.currentTime;
  for (const [st, d] of blasts) {
    const t = now + st;
    const o = ctx.createOscillator(); o.type = 'triangle';
    const f = 2750 + Math.random() * 120;
    o.frequency.setValueAtTime(f * 0.96, t); o.frequency.linearRampToValueAtTime(f, t + 0.05);
    // roulement de la bille
    const am = ctx.createOscillator(); am.frequency.value = 28 + Math.random() * 6;
    const amg = ctx.createGain(); amg.gain.value = 0.35;
    const g = ctx.createGain(); g.gain.value = 0;
    am.connect(amg).connect(g.gain);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.11, t + 0.02); g.gain.setValueAtTime(0.11, t + d); g.gain.linearRampToValueAtTime(0, t + d + 0.05);
    o.connect(g).connect(buses.fx); g.connect(buses.reverb);
    o.start(t); am.start(t); o.stop(t + d + 0.1); am.stop(t + d + 0.1);
  }
}

export function kick(power = 0.5) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(160 + power * 60, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.09);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25 * power + 0.05, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  o.connect(g).connect(buses.fx); o.start(t); o.stop(t + 0.16);
  const n = ctx.createBufferSource(); n.buffer = noise();
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0.12 * power, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  n.connect(f).connect(ng).connect(buses.fx); n.start(t, Math.random() * 3, 0.05);
}

export function goalHorn() {
  if (!ctx) return;
  const t = ctx.currentTime + 0.4;
  for (const [f, d] of [[233, 1.8], [293, 1.8], [349, 1.8]]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.1); g.gain.setValueAtTime(0.05, t + d - 0.3); g.gain.linearRampToValueAtTime(0, t + d);
    o.connect(lp).connect(g).connect(buses.fx); g.connect(buses.reverb);
    o.start(t); o.stop(t + d + 0.1);
  }
}

export function zap() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = ctx.createBufferSource(); n.buffer = noise();
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 900;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  n.connect(f).connect(g).connect(master); n.start(t, 0, 0.25);
}

export function sting(kind = 'goal') {
  // petit habillage sonore de la chaîne (transition, générique)
  if (!ctx) return;
  const t = ctx.currentTime;
  const seq = kind === 'ident' ? [72, 76, 79, 84] : kind === 'break' ? [79, 74, 71, 67] : [67, 71, 74, 79];
  seq.forEach((m, i) => {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 440 * Math.pow(2, (m - 57) / 12);
    const g = ctx.createGain(); const t0 = t + i * 0.12;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.09, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    o.connect(g); o2.connect(g); g.connect(master); g.connect(buses.reverb);
    o.start(t0); o2.start(t0); o.stop(t0 + 1); o2.stop(t0 + 1);
  });
}

// Jingle publicitaire : mélodie + basse + batterie
export function jingle(spec, dur = 14) {
  if (!ctx) return () => {};
  const out = ctx.createGain(); out.gain.value = 0.0001;
  out.connect(buses.ads); out.connect(buses.reverb);
  const t0 = ctx.currentTime + 0.05;
  out.gain.exponentialRampToValueAtTime(0.5, t0 + 0.3);
  const beat = 60 / spec.tempo;
  const nodes = [];
  const note = (m, t, d, type, vol) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.05); nodes.push(o);
  };
  let t = t0;
  let i = 0;
  while (t < t0 + dur - 0.5) {
    const step = i % spec.melody.length;
    const m = spec.melody[step];
    if (m) note(m + spec.key, t, beat * 0.9, spec.lead || 'square', 0.07);
    if (i % 2 === 0) note(spec.bass[(i / 2) % spec.bass.length] + spec.key - 24, t, beat * 1.8, 'triangle', 0.18);
    if (i % 2 === 0) drumHit(out, t, 'kick');
    if (i % 4 === 2) drumHit(out, t, 'snare');
    drumHit(out, t + beat / 2, 'hat');
    t += beat; i++;
  }
  out.gain.setValueAtTime(0.5, t0 + dur - 0.6);
  out.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  return () => { try { out.gain.cancelScheduledValues(ctx.currentTime); out.gain.setTargetAtTime(0, ctx.currentTime, 0.05); nodes.forEach(n => n.stop(ctx.currentTime + 0.2)); } catch (e) { /* déjà arrêté */ } };
}

function drumHit(dest, t, kind) {
  if (kind === 'kick') {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(dest); o.start(t); o.stop(t + 0.25);
  } else {
    const n = ctx.createBufferSource(); n.buffer = noise();
    const f = ctx.createBiquadFilter(); f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const g = ctx.createGain(); g.gain.setValueAtTime(kind === 'hat' ? 0.08 : 0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'hat' ? 0.04 : 0.15));
    n.connect(f).connect(g).connect(dest); n.start(t, Math.random() * 3, 0.2);
  }
}
