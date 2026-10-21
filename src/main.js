// Sport TV IA : application "télévision" avec trois chaînes de sport.
import * as THREE from 'three';
import { Capacitor } from '@capacitor/core';
import { getWorld } from './data/world.js';
import { SPEEDS, footSlotAt, getSeason } from './data/season.js';
import { fullSim } from './core/sim-service.js';
import { Overlay, el, esc } from './tv/overlay.js';
import { FootChannel } from './channels/foot.js';
import { BasketChannel } from './channels/basket.js';
import { InfoChannel } from './channels/info.js';
import { initAudio, zap, setMasterVolume, sting } from './audio/audio.js';
import { voice } from './audio/voice.js';

const fmtTime = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const params = new URLSearchParams(location.search);

function loadSettings() {
  const def = { speed: 1, quality: /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'medium' : 'high', volume: 0.9, commentary: true, channel: 0 };
  try { return { ...def, ...JSON.parse(localStorage.getItem('sporttv-settings') || '{}') }; } catch (e) { return def; }
}

class App {
  constructor() {
    this.settings = loadSettings();
    if (params.get('speed')) this.settings.speed = +params.get('speed');
    if (params.get('q')) this.settings.quality = params.get('q');
    this.offset = (+params.get('offset') || 0) * 60000;
    this.world = getWorld();
    this.canvas = document.getElementById('gl');
    this.tvRoot = document.getElementById('tv');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.settings.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.settings.quality === 'high' ? 1.75 : this.settings.quality === 'medium' ? 1.25 : 1));
    this.renderer.shadowMap.enabled = this.settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.overlay = new Overlay(this.tvRoot);
    this.loader = el('div', 'loader hidden');
    this.tvRoot.appendChild(this.loader);
    this.channels = [new FootChannel(this), new BasketChannel(this), new InfoChannel(this)];
    this.current = null;
    this.views = new Set();
    this.buildUI();
    addEventListener('resize', () => this.resize());
    this.resize();
    this.last = performance.now();
    this.on = false;
    requestAnimationFrame((t) => this.loop(t));
    if (params.has('autostart')) this.powerOn();
    // calcul en tâche de fond des résultats de la saison (classements exacts)
    setTimeout(() => this.backgroundResults(), 8000);
  }

  now() { return Date.now() + this.offset; }

  save() { try { localStorage.setItem('sporttv-settings', JSON.stringify(this.settings)); } catch (e) { /* rien */ } }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    for (const ch of this.channels) if (ch.view) ch.view.resize(w, h);
    document.documentElement.style.setProperty('--ui', Math.max(0.6, Math.min(1.2, Math.min(w / 1280, h / 720))).toFixed(3));
  }
  resizeView(v) { v.resize(innerWidth, innerHeight); }
  canvasVisible(on) { this.canvas.style.visibility = on ? 'visible' : 'hidden'; }
  showLoader(html) { this.loader.innerHTML = html; this.loader.classList.remove('hidden'); }
  hideLoader() { this.loader.classList.add('hidden'); }

  // ---------- Allumage ----------
  buildUI() {
    // écran d'accueil (nécessaire pour activer le son)
    this.splash = el('div', 'splash', `
      <div class="sp-logo"><span>SPORT</span><b>TV</b><i>IA</i></div>
      <div class="sp-sub">Football · Basket · Info — 100 % simulé par intelligence artificielle</div>
      <button class="sp-btn">⏻ Allumer la télé</button>
      <div class="sp-hint">Glissez vers le haut / le bas pour zapper · Touchez l'écran pour la télécommande</div>`);
    this.tvRoot.appendChild(this.splash);
    this.splash.querySelector('.sp-btn').addEventListener('click', () => this.powerOn());
    this.tvRoot.style.pointerEvents = 'auto';

    // télécommande
    this.remote = el('div', 'remote hidden', `
      <button data-a="chdown">▼ CH</button>
      <button data-a="chup">CH ▲</button>
      <button data-a="guide">📺 Guide</button>
      <button data-a="settings">⚙️ Réglages</button>
      <button data-a="mute">🔊</button>`);
    this.tvRoot.appendChild(this.remote);
    this.remote.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (!a) return;
      e.stopPropagation();
      if (a === 'chup') this.zap(1);
      if (a === 'chdown') this.zap(-1);
      if (a === 'guide') this.toggleGuide();
      if (a === 'settings') this.toggleSettings();
      if (a === 'mute') this.toggleMute(e.target);
      this.pokeRemote();
    });
    this.osd = el('div', 'osd hidden');
    this.tvRoot.appendChild(this.osd);
    this.guide = el('div', 'guide hidden');
    this.tvRoot.appendChild(this.guide);
    this.settingsBox = el('div', 'settings hidden');
    this.tvRoot.appendChild(this.settingsBox);
    this.static = el('div', 'static hidden');
    this.tvRoot.appendChild(this.static);

    // gestes : glisser pour zapper, toucher pour la télécommande
    let y0 = null, t0 = 0;
    this.tvRoot.addEventListener('pointerdown', (e) => { y0 = e.clientY; t0 = performance.now(); });
    this.tvRoot.addEventListener('pointerup', (e) => {
      if (!this.on || y0 == null) return;
      const dy = e.clientY - y0; y0 = null;
      if (e.target.closest('.remote, .guide, .settings')) return;
      if (Math.abs(dy) > 60 && performance.now() - t0 < 600) this.zap(dy < 0 ? 1 : -1);
      else this.pokeRemote();
    });
    addEventListener('keydown', (e) => {
      if (!this.on) { if (e.key === 'Enter' || e.key === ' ') this.powerOn(); return; }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') this.zap(1);
      if (e.key === 'ArrowDown' || e.key === 'PageDown') this.zap(-1);
      if (/^[1-9]$/.test(e.key)) this.tune(+e.key - 1);
      if (e.key === 'g') this.toggleGuide();
      if (e.key === 'm') this.toggleSettings();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { voice.stop(); setMasterVolume(0); } else if (this.on) setMasterVolume(this.muted ? 0 : this.settings.volume);
    });
  }

  async powerOn() {
    if (this.on) return;
    this.on = true;
    initAudio();
    setMasterVolume(this.settings.volume);
    voice.setEnabled(this.settings.commentary);
    this.splash.classList.add('off');
    setTimeout(() => this.splash.remove(), 900);
    this.tvRoot.classList.add('power-on');
    if (Capacitor.isNativePlatform()) {
      try {
        const { StatusBar } = await import('@capacitor/status-bar');
        await StatusBar.hide();
      } catch (e) { /* facultatif */ }
      try {
        const { KeepAwake } = await import('@capacitor-community/keep-awake');
        await KeepAwake.keepAwake();
      } catch (e) { /* facultatif */ }
      try {
        const { ScreenOrientation } = await import('@capacitor/screen-orientation');
        await ScreenOrientation.lock({ orientation: 'landscape' });
      } catch (e) { /* facultatif */ }
    } else {
      try { await document.documentElement.requestFullscreen?.(); } catch (e) { /* pas grave */ }
    }
    const start = params.get('ch') ? +params.get('ch') - 1 : this.settings.channel || 0;
    this.tune(start, true);
  }

  tune(i, first = false) {
    i = ((i % this.channels.length) + this.channels.length) % this.channels.length;
    const ch = this.channels[i];
    if (this.current === ch) return;
    if (this.current) this.current.leave();
    this.overlay.hideAll();
    if (!first) { zap(); this.static.classList.remove('hidden'); setTimeout(() => this.static.classList.add('hidden'), 350); }
    else sting('ident');
    this.current = ch;
    this.settings.channel = i; this.save();
    ch.enter();
    this.showOSD(ch);
  }

  zap(d) { const i = this.channels.indexOf(this.current); this.tune(i + d); }

  async showOSD(ch) {
    const list = await ch.epg(this.now(), 2).catch(() => []);
    const cur = list[0], next = list[1];
    const prog = cur ? Math.min(1, (this.now() - cur.start) / (cur.end - cur.start)) : 0;
    this.osd.innerHTML = `<div class="osd-num" style="background:${ch.color}">${ch.num}</div>
      <div class="osd-main"><div class="osd-name">${esc(ch.name)}</div>
      ${cur ? `<div class="osd-prog"><b>${fmtTime(cur.start)}</b> ${esc(cur.title)} <small>${esc(cur.sub)}</small></div><div class="osd-bar"><i style="width:${(prog * 100).toFixed(0)}%"></i></div>` : ''}
      ${next ? `<div class="osd-next">Ensuite : <b>${fmtTime(next.start)}</b> ${esc(next.title)}</div>` : ''}</div>`;
    this.osd.classList.remove('hidden');
    clearTimeout(this.osdT);
    this.osdT = setTimeout(() => this.osd.classList.add('hidden'), 4500);
  }

  pokeRemote() {
    this.remote.classList.remove('hidden');
    clearTimeout(this.remoteT);
    this.remoteT = setTimeout(() => this.remote.classList.add('hidden'), 5000);
  }

  toggleMute(btn) {
    this.muted = !this.muted;
    setMasterVolume(this.muted ? 0 : this.settings.volume);
    voice.volume = this.muted ? 0 : 1;
    if (this.muted) voice.stop();
    if (btn) btn.textContent = this.muted ? '🔇' : '🔊';
  }

  async toggleGuide() {
    if (!this.guide.classList.contains('hidden')) { this.guide.classList.add('hidden'); return; }
    this.settingsBox.classList.add('hidden');
    this.guide.innerHTML = '<div class="gd-title">Guide des programmes</div><div class="gd-body">Chargement…</div>';
    this.guide.classList.remove('hidden');
    const now = this.now();
    const rows = await Promise.all(this.channels.map(async (c, i) => ({ c, i, list: await c.epg(now, 5).catch(() => []) })));
    this.guide.querySelector('.gd-body').innerHTML = rows.map(({ c, i, list }) => `
      <div class="gd-row" data-i="${i}"><div class="gd-ch" style="background:${c.color}"><b>${c.num}</b>${esc(c.name)}</div>
      <div class="gd-progs">${list.map(e => `<div class="gd-p ${e.live ? 'live' : ''}"><div class="gd-time">${fmtTime(e.start)}${e.live ? ' · EN COURS' : ''}</div><div class="gd-t">${esc(e.title)}</div><div class="gd-s">${esc(e.sub)}</div>${e.live ? `<div class="osd-bar"><i style="width:${Math.min(100, (100 * (now - e.start)) / (e.end - e.start)).toFixed(0)}%"></i></div>` : ''}</div>`).join('')}</div></div>`).join('') + '<div class="gd-close">Fermer ✕</div>';
    this.guide.querySelectorAll('.gd-row').forEach(r => r.addEventListener('click', () => { this.tune(+r.dataset.i); this.guide.classList.add('hidden'); }));
    this.guide.querySelector('.gd-close').addEventListener('click', () => this.guide.classList.add('hidden'));
  }

  toggleSettings() {
    if (!this.settingsBox.classList.contains('hidden')) { this.settingsBox.classList.add('hidden'); return; }
    this.guide.classList.add('hidden');
    const s = this.settings;
    const opt = (name, val, label, cur) => `<button class="st-opt ${cur === val ? 'on' : ''}" data-k="${name}" data-v="${val}">${label}</button>`;
    this.settingsBox.innerHTML = `<div class="gd-title">Réglages</div>
      <div class="st-grp"><div class="st-lbl">Durée des matchs de foot</div>${Object.entries(SPEEDS).map(([k, v]) => opt('speed', +k, v.label, s.speed)).join('')}
      <div class="st-note">En temps réel, un match dure 90 minutes comme à la télé. La grille des programmes s'adapte.</div></div>
      <div class="st-grp"><div class="st-lbl">Qualité graphique</div>${opt('quality', 'low', 'Économie', s.quality)}${opt('quality', 'medium', 'Standard', s.quality)}${opt('quality', 'high', 'Ultra', s.quality)}</div>
      <div class="st-grp"><div class="st-lbl">Commentateurs</div>${opt('commentary', true, 'Activés', s.commentary)}${opt('commentary', false, 'Coupés', s.commentary)}</div>
      <div class="st-grp"><div class="st-lbl">Volume</div>${[0.3, 0.6, 0.9, 1.2].map(v => opt('volume', v, Math.round(v * 100) + ' %', s.volume)).join('')}</div>
      <div class="gd-close">Fermer ✕</div>`;
    this.settingsBox.classList.remove('hidden');
    this.settingsBox.querySelectorAll('.st-opt').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.k;
      let v = b.dataset.v;
      if (k === 'speed' || k === 'volume') v = +v;
      if (k === 'commentary') v = v === 'true';
      this.settings[k] = v;
      this.save();
      if (k === 'volume') setMasterVolume(v);
      if (k === 'commentary') voice.setEnabled(v);
      if (k === 'speed' || k === 'quality') { location.reload(); return; }
      this.settingsBox.classList.add('hidden'); this.toggleSettings();
    }));
    this.settingsBox.querySelector('.gd-close').addEventListener('click', () => this.settingsBox.classList.add('hidden'));
  }

  // ---------- Boucle ----------
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (!this.on) return;
    const now = this.now();
    for (const ch of this.channels) {
      try { ch.update(dt, now); } catch (e) { console.error(ch.id, e); }
    }
  }

  async backgroundResults() {
    // remplit le cache des résultats télévisés passés de la saison en cours
    const k = this.settings.speed;
    const s = footSlotAt(this.now(), k);
    const { season, item } = getSeason(s.slot, k, fullSim(k));
    for (let j = 0; j < item.n; j++) {
      const it = season.items[j];
      try { await season.result(it.comp, it.round, it.idx); } catch (e) { /* ignore */ }
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

window.app = new App();
