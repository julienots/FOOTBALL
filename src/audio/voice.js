// Voix de synthèse : moteur TTS natif d'Android (via Capacitor) ou Web Speech.
// Deux commentateurs avec des voix différentes + une voix "pub".
import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { neural } from '../tts/neural.js';
import { busGain } from './audio.js';

const native = Capacitor.isNativePlatform();

export const SPEAKERS = {
  // commentateur principal : débit rapide, voix claire
  pbp: { name: 'Jean-Marc Ferrand', rate: 1.08, pitch: 1.0, pref: 0 },
  // consultant : voix plus grave et posée
  cons: { name: 'Didier Lacombe', rate: 0.98, pitch: 0.8, pref: 1 },
  // voix off des publicités / de la chaîne
  ad: { name: 'Voix off', rate: 1.05, pitch: 1.12, pref: 2 },
  anchor: { name: 'Claire Aubert', rate: 1.0, pitch: 1.15, pref: 3 },
};

class VoiceEngine {
  constructor() {
    this.queue = [];
    this.speaking = false;
    this.enabled = true;
    this.volume = 1;
    this.voices = [];
    this.webVoices = [];
    this.current = null;
    this.ready = this.loadVoices();
    this.listeners = new Set();
  }

  async loadVoices() {
    try {
      if (native) {
        const { voices } = await TextToSpeech.getSupportedVoices();
        this.voices = voices.map((v, i) => ({ ...v, index: i })).filter(v => /^fr/i.test(v.lang));
      } else if ('speechSynthesis' in window) {
        const get = () => speechSynthesis.getVoices().filter(v => /^fr/i.test(v.lang));
        this.webVoices = get();
        if (!this.webVoices.length) {
          await new Promise(r => { speechSynthesis.onvoiceschanged = () => r(); setTimeout(r, 1500); });
          this.webVoices = get();
        }
      }
    } catch (e) {
      console.warn('TTS voices', e);
    }
  }

  // Choisit des voix différentes pour chaque intervenant (hommes en priorité)
  pickVoice(spk) {
    const list = native ? this.voices : this.webVoices;
    if (!list.length) return null;
    const maleHint = /(^|[^e])male|homme|thomas|paul|henri|nicolas|frb|frd|fr-fr-x-frb|fr-fr-x-frd|daniel|guillaume|smtm|-m\d|#male|_m\d/i;
    const femaleHint = /female|femme|amelie|amélie|audrey|marie|julie|frc|fra\b|fr-fr-x-frc|fr-fr-x-fra|vlf|virginie|celine|céline|smtf|-f\d|_f\d/i;
    const males = list.filter(v => maleHint.test(v.name || v.voiceURI || ''));
    const females = list.filter(v => femaleHint.test(v.name || v.voiceURI || ''));
    const others = list.filter(v => !males.includes(v) && !females.includes(v));
    let pool;
    if (spk.pref === 0) pool = [males[0], others[0], list[0]];
    else if (spk.pref === 1) pool = [males[1], others[1], males[0] && list.find(v => v !== males[0]), list[1], list[0]];
    else pool = [females[0], others[2], list[list.length - 1]];
    return pool.find(Boolean) || list[0];
  }

  setEnabled(on) { this.enabled = on; if (!on) this.stop(); }

  onSpeak(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // prio : 3 = but / temps fort (coupe la parole), 2 = action, 1 = remplissage
  say(who, text, prio = 1, opts = {}) {
    if (!this.enabled || !text) return;
    const item = { who, text, prio, t: performance.now(), ttl: opts.ttl ?? (prio >= 2 ? 6000 : 15000), channel: opts.channel };
    this.prepare(item);
    if (prio >= 3) {
      this.queue = this.queue.filter(q => q.prio >= 3);
      this.queue.push(item);
      if (this.speaking && this.current && this.current.prio < 3) { this.interrupt(); setTimeout(() => this.pump(), 80); return; }
    } else {
      if (this.queue.length > 4 && prio <= 1) return;
      this.queue.push(item);
    }
    this.pump();
  }

  busy() { return this.speaking || this.queue.length > 0; }

  clear(channel) {
    this.queue = channel ? this.queue.filter(q => q.channel !== channel) : [];
  }

  stop() {
    this.queue = [];
    this.interrupt();
  }

  interrupt() {
    try { if (this.src) { this.src.stop(); this.src = null; } } catch (e) { /* déjà fini */ }
    try {
      if (native) TextToSpeech.stop();
      else if ('speechSynthesis' in window) speechSynthesis.cancel();
    } catch (e) { /* rien */ }
    this.seq = (this.seq || 0) + 1;
    this.speaking = false;
    this.current = null;
  }

  // Lance la synthèse neuronale dès la mise en file (l'audio est prêt plus vite)
  prepare(item) {
    const id = item.who === 'cons' || item.who === 'anchor' ? 'cons' : 'pbp';
    if (!neural.has(id) || item.who === 'anchor') return;
    const excited = item.prio >= 3;
    const style = item.who === 'cons'
      ? { length: 1.0, noise: 0.72, rate: 0.98, gain: 1 }
      : item.who === 'ad' ? { length: 0.86, noise: 0.75, rate: 1.04, gain: 1 }
      : excited ? { length: 0.8, noise: 0.85, noiseW: 0.9, rate: 1.07, gain: 1.35 }
      : { length: 0.9, noise: 0.75, rate: 1.02, gain: 1.05 };
    const segs = [];
    let text = item.text;
    // le fameux "BUUUUT !" étiré
    const m = text.match(/^(BU+T|GO+AL|IL MARQUE)\s*!?\s*/i);
    if (m && excited) {
      segs.push({ text: /BU/i.test(m[1]) ? 'But !' : m[1].toLowerCase() + ' !', length: 2.6 + Math.random() * 0.6, noise: 0.9, rate: 1.1, gain: 1.5 });
      text = text.slice(m[0].length);
    }
    if (text.trim()) segs.push({ text: text.replace(/[A-ZÉÈÀ]{3,}/g, w => w[0] + w.slice(1).toLowerCase()), ...style });
    item.audio = Promise.all(segs.map(sg => neural.synth(id, sg.text, sg).then(buf => ({ buf, rate: sg.rate, gain: sg.gain }))));
    item.audio.catch(() => { item.audio = null; });
  }

  async pump() {
    if (this.speaking) return;
    const now = performance.now();
    this.queue = this.queue.filter(q => now - q.t < q.ttl);
    const item = this.queue.shift();
    if (!item) return;
    this.speaking = true;
    this.current = item;
    const my = (this.seq = (this.seq || 0) + 1);
    this.listeners.forEach(fn => fn(item));
    const spk = SPEAKERS[item.who] || SPEAKERS.pbp;
    await this.ready;
    const voice = this.pickVoice(spk);
    const excited = item.prio >= 3;
    const rate = spk.rate * (excited ? 1.12 : 1);
    const pitch = spk.pitch * (excited ? 1.08 : 1);
    try {
      if (item.audio) {
        // voix neuronale réaliste
        const parts = await item.audio;
        if (my !== this.seq) return;
        if (performance.now() - item.t > item.ttl + 2500) throw new Error('trop tard');
        busGain('stadium', 0.62, 0.15);
        for (const p of parts) {
          if (my !== this.seq) return;
          const pl = neural.play(p.buf, { rate: p.rate, gain: p.gain * this.volume });
          this.src = pl.src;
          await pl.done;
        }
        this.src = null;
        if (this.queue.length === 0) busGain('stadium', 1, 0.4);
      } else if (native) {
        await TextToSpeech.speak({ text: item.text, lang: 'fr-FR', rate, pitch, volume: this.volume, voice: voice ? voice.index : undefined, category: 'playback', queueStrategy: 0 });
      } else if ('speechSynthesis' in window) {
        await new Promise((resolve) => {
          const u = new SpeechSynthesisUtterance(item.text);
          u.lang = 'fr-FR'; u.rate = rate; u.pitch = pitch; u.volume = this.volume;
          if (voice) u.voice = voice;
          u.onend = resolve; u.onerror = resolve;
          speechSynthesis.speak(u);
          setTimeout(resolve, 2000 + item.text.length * 120);
        });
      } else {
        await new Promise(r => setTimeout(r, 600 + item.text.length * 55));
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 300));
    }
    if (my !== this.seq) return; // interrompu entre-temps
    this.speaking = false;
    this.current = null;
    if (this.queue.length) setTimeout(() => this.pump(), item.who === 'cons' || item.prio >= 3 ? 120 : 250);
  }
}

export const voice = new VoiceEngine();
