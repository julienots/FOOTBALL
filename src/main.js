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
import { BetCenter } from './bet/bets.js';

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
    this.player = document.getElementById('player');
    this.hub = document.getElementById('hub');
    this.appRoot = document.getElementById('app');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
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
    this.bets = new BetCenter(this);
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
    const full = this.isFull();
    document.body.classList.toggle('full', full);
    document.body.classList.toggle('portrait', !full);
    const r = this.player.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    this.renderer.setSize(w, h, false);
    for (const ch of this.channels) if (ch.view) ch.view.resize(w, h);
    const ui = full ? Math.max(0.6, Math.min(1.2, Math.min(w / 1280, h / 720))) : Math.max(0.5, Math.min(0.9, w / 760));
    document.documentElement.style.setProperty('--ui', ui.toFixed(3));
  }
  isFull() { return this.full || (innerWidth > innerHeight * 1.15); }
  resizeView(v) { const r = this.player.getBoundingClientRect(); v.resize(Math.max(1, r.width), Math.max(1, r.height)); }
  canvasVisible(on) { this.canvas.style.visibility = on ? 'visible' : 'hidden'; }
  showLoader(html) { this.loader.innerHTML = html; this.loader.classList.remove('hidden'); }
  hideLoader() { this.loader.classList.add('hidden'); }

  toast(text) {
    const t = el('div', 'toast', esc(text));
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3800);
    setTimeout(() => t.remove(), 4400);
  }

  // ---------- Interface ----------
  buildUI() {
    // écran d'accueil (nécessaire pour activer le son)
    this.splash = el('div', 'splash', `
      <div class="sp-logo"><span>SPORT</span><b>TV</b><i>IA</i></div>
      <div class="sp-sub">Football · Basket · Info · Paris — 100 % simulé par intelligence artificielle</div>
      <button class="sp-btn">⏻ Allumer la télé</button>
      <div class="sp-hint">Touchez ⛶ pour le grand écran · glissez sur l'image pour zapper</div>`);
    this.appRoot.appendChild(this.splash);
    this.splash.querySelector('.sp-btn').addEventListener('click', () => this.powerOn());
    this.tvRoot.style.pointerEvents = 'auto';
    this.toasts = el('div', 'toasts');
    this.appRoot.appendChild(this.toasts);

    // barre du lecteur (toujours visible en portrait)
    this.pbar = el('div', 'pbar', `<button data-a="chdown">◀</button><span class="pb-ch"></span><button data-a="chup">▶</button><span class="pb-sp"></span><button data-a="mute">🔊</button><button data-a="full" class="pb-full">⛶</button>`);
    this.tvRoot.appendChild(this.pbar);
    this.pbar.addEventListener('click', (e) => this.onRemote(e));

    // télécommande plein écran
    this.remote = el('div', 'remote hidden', `
      <button data-a="chdown">▼ CH</button>
      <button data-a="chup">CH ▲</button>
      <button data-a="chlist">📺 Chaînes</button>
      <button data-a="bets">💰 Paris</button>
      <button data-a="mute">🔊</button>
      <button data-a="exitfull">⤡ Quitter</button>`);
    this.tvRoot.appendChild(this.remote);
    this.remote.addEventListener('click', (e) => this.onRemote(e));
    this.chList = el('div', 'chlist hidden');
    this.tvRoot.appendChild(this.chList);
    this.chList.addEventListener('click', (e) => {
      const c = e.target.closest('[data-i]');
      if (c) { e.stopPropagation(); this.tune(+c.dataset.i); this.chList.classList.add('hidden'); }
    });
    this.osd = el('div', 'osd hidden');
    this.tvRoot.appendChild(this.osd);
    this.static = el('div', 'static hidden');
    this.tvRoot.appendChild(this.static);

    // panneau sous l'image (mode portrait) : chaînes, paris, programme, réglages
    this.hub.innerHTML = `
      <div class="hub-tabs">
        <button data-tab="chaines" class="on">📺 Chaînes</button>
        <button data-tab="paris">💰 Paris</button>
        <button data-tab="guide">📅 Programme</button>
        <button data-tab="reglages">⚙️</button>
      </div>
      <div class="hub-body"></div>`;
    this.hubBody = this.hub.querySelector('.hub-body');
    this.tab = 'chaines';
    this.hub.querySelector('.hub-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) this.showTab(b.dataset.tab);
    });
    this.hubBody.addEventListener('click', (e) => {
      const c = e.target.closest('[data-ch]');
      if (c) this.tune(+c.dataset.ch);
    });

    // gestes : glisser pour zapper, toucher pour la télécommande
    let y0 = null, x0 = null, t0 = 0;
    this.tvRoot.addEventListener('pointerdown', (e) => { y0 = e.clientY; x0 = e.clientX; t0 = performance.now(); });
    this.tvRoot.addEventListener('pointerup', (e) => {
      if (!this.on || y0 == null) return;
      const dy = e.clientY - y0, dx = e.clientX - x0; y0 = null;
      if (e.target.closest('.remote, .pbar, .chlist')) return;
      const swipe = this.isFull() ? dy : dx;
      if (Math.abs(swipe) > 50 && performance.now() - t0 < 600) this.zap(swipe < 0 ? 1 : -1);
      else if (this.isFull()) this.pokeRemote();
    });
    addEventListener('keydown', (e) => {
      if (!this.on) { if (e.key === 'Enter' || e.key === ' ') this.powerOn(); return; }
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowUp' || e.key === 'PageUp') this.zap(1);
      if (e.key === 'ArrowDown' || e.key === 'PageDown') this.zap(-1);
      if (/^[1-9]$/.test(e.key)) this.tune(+e.key - 1);
      if (e.key === 'f') this.setFull(!this.full);
      if (e.key === 'Escape' && this.full) this.setFull(false);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { voice.stop(); setMasterVolume(0); } else if (this.on) setMasterVolume(this.muted ? 0 : this.settings.volume);
    });
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && this.full && !Capacitor.isNativePlatform()) this.setFull(false); });
  }

  onRemote(e) {
    const a = e.target.closest('button')?.dataset.a;
    if (!a) return;
    e.stopPropagation();
    if (a === 'chup') this.zap(1);
    if (a === 'chdown') this.zap(-1);
    if (a === 'mute') this.toggleMute();
    if (a === 'full') this.setFull(true);
    if (a === 'exitfull') this.setFull(false);
    if (a === 'chlist') { this.renderChList(); this.chList.classList.toggle('hidden'); }
    if (a === 'bets') { this.setFull(false); this.showTab('paris'); }
    if (this.isFull()) this.pokeRemote();
  }

  async setFull(on) {
    this.full = on;
    this.chList.classList.add('hidden');
    if (Capacitor.isNativePlatform()) {
      try {
        const { ScreenOrientation } = await import('@capacitor/screen-orientation');
        await ScreenOrientation.lock({ orientation: on ? 'landscape' : 'portrait' });
      } catch (e) { /* facultatif */ }
    } else {
      try {
        if (on && !document.fullscreenElement) { await document.documentElement.requestFullscreen?.(); await screen.orientation?.lock?.('landscape'); }
        if (!on && document.fullscreenElement) await document.exitFullscreen();
      } catch (e) { /* pas grave */ }
    }
    setTimeout(() => this.resize(), 60);
    setTimeout(() => this.resize(), 400);
    this.resize();
    if (on) this.pokeRemote(); else this.remote.classList.add('hidden');
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
        await ScreenOrientation.lock({ orientation: 'portrait' });
      } catch (e) { /* facultatif */ }
      try {
        const { App: CapApp } = await import('@capacitor/app');
        CapApp.addListener('backButton', () => {
          if (this.full) this.setFull(false);
          else if (this.tab !== 'chaines') this.showTab('chaines');
          else CapApp.minimizeApp();
        });
      } catch (e) { /* facultatif */ }
    }
    const start = params.get('ch') ? +params.get('ch') - 1 : this.settings.channel || 0;
    this.tune(start, true);
    this.showTab(params.get('tab') || 'chaines');
    if (params.has('full')) this.setFull(true);
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
    this.pbar.querySelector('.pb-ch').innerHTML = `<b style="background:${ch.color}">${ch.num}</b> ${esc(ch.name)}`;
    if (this.tab === 'chaines') this.renderChannels();
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

  toggleMute() {
    this.muted = !this.muted;
    setMasterVolume(this.muted ? 0 : this.settings.volume);
    voice.volume = this.muted ? 0 : 1;
    if (this.muted) voice.stop();
    this.tvRoot.querySelectorAll('[data-a="mute"]').forEach(b => (b.textContent = this.muted ? '🔇' : '🔊'));
  }

  // ---------- Onglets ----------
  showTab(tab) {
    this.tab = tab;
    this.hub.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    this.hubBody.innerHTML = '';
    if (tab === 'chaines') this.renderChannels();
    if (tab === 'paris') this.bets.mount(this.hubBody);
    if (tab === 'guide') this.renderGuide();
    if (tab === 'reglages') this.renderSettings();
  }

  channelCards() {
    const now = this.now();
    return this.channels.map((c, i) => {
      const l = c.liveScore?.();
      const ep = this._epgCache?.[c.id];
      const cur = ep && ep[0];
      const prog = cur ? Math.min(100, (100 * (now - cur.start)) / (cur.end - cur.start)) : 0;
      return `<div class="ch-card ${this.current === c ? 'on' : ''}" data-ch="${i}" data-i="${i}">
        <div class="ch-num" style="background:${c.color}">${c.num}</div>
        <div class="ch-main"><div class="ch-name">${esc(c.name)} ${this.current === c ? '<span class="ch-now">● À L\'ANTENNE</span>' : ''}</div>
          <div class="ch-prog">${cur ? `${fmtTime(cur.start)} · ${esc(cur.title)}` : ''}</div>
          ${l ? `<div class="ch-live">${esc(l.home.short)} <b>${l.score[0]} - ${l.score[1]}</b> ${esc(l.away.short)} <small>${esc(l.minute)}</small></div>` : `<div class="ch-live">${cur ? esc(cur.sub) : ''}</div>`}
          <div class="osd-bar"><i style="width:${prog.toFixed(0)}%"></i></div></div>
        <div class="ch-go">▶</div></div>`;
    }).join('');
  }

  async refreshEpgCache() {
    const now = this.now();
    const out = {};
    for (const c of this.channels) out[c.id] = await c.epg(now, 2).catch(() => []);
    this._epgCache = out;
  }

  renderChannels() {
    if (this.tab !== 'chaines') return;
    this.hubBody.innerHTML = `<div class="hub-h">Vos chaînes</div>${this.channelCards()}
      <div class="hub-tip">Touchez <b>⛶</b> sur l'image pour passer en grand écran. Dans le grand écran, touchez l'image pour la télécommande.</div>`;
  }

  renderChList() {
    this.chList.innerHTML = `<div class="hub-h">Chaînes</div>${this.channelCards()}`;
  }

  async renderGuide() {
    this.hubBody.innerHTML = '<div class="hub-h">Guide des programmes</div><div class="gd-body">Chargement…</div>';
    const now = this.now();
    const rows = await Promise.all(this.channels.map(async (c, i) => ({ c, i, list: await c.epg(now, 5).catch(() => []) })));
    if (this.tab !== 'guide') return;
    this.hubBody.querySelector('.gd-body').innerHTML = rows.map(({ c, i, list }) => `
      <div class="gd-row"><div class="gd-ch" data-ch="${i}" style="background:${c.color}"><b>${c.num}</b>${esc(c.name)}</div>
      <div class="gd-progs">${list.map(e => `<div class="gd-p ${e.live ? 'live' : ''}" data-ch="${i}"><div class="gd-time">${fmtTime(e.start)}${e.live ? ' · EN COURS' : ''}</div><div class="gd-t">${esc(e.title)}</div><div class="gd-s">${esc(e.sub)}</div></div>`).join('')}</div></div>`).join('');
  }

  renderSettings() {
    const s = this.settings;
    const opt = (name, val, label, cur) => `<button class="st-opt ${cur === val ? 'on' : ''}" data-k="${name}" data-v="${val}">${label}</button>`;
    this.hubBody.innerHTML = `<div class="hub-h">Réglages</div>
      <div class="st-grp"><div class="st-lbl">Durée des matchs de foot</div>${Object.entries(SPEEDS).map(([k, v]) => opt('speed', +k, v.label, s.speed)).join('')}
      <div class="st-note">En temps réel, un match dure 90 minutes comme à la télé. La grille des programmes s'adapte.</div></div>
      <div class="st-grp"><div class="st-lbl">Qualité graphique</div>${opt('quality', 'low', 'Économie', s.quality)}${opt('quality', 'medium', 'Standard', s.quality)}${opt('quality', 'high', 'Ultra', s.quality)}</div>
      <div class="st-grp"><div class="st-lbl">Commentateurs</div>${opt('commentary', true, 'Activés', s.commentary)}${opt('commentary', false, 'Coupés', s.commentary)}</div>
      <div class="st-grp"><div class="st-lbl">Volume</div>${[0.3, 0.6, 0.9, 1.2].map(v => opt('volume', v, Math.round(v * 100) + ' %', s.volume)).join('')}</div>`;
    this.hubBody.querySelectorAll('.st-opt').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.k;
      let v = b.dataset.v;
      if (k === 'speed' || k === 'volume') v = +v;
      if (k === 'commentary') v = v === 'true';
      this.settings[k] = v;
      this.save();
      if (k === 'volume') setMasterVolume(v);
      if (k === 'commentary') voice.setEnabled(v);
      if (k === 'speed' || k === 'quality') { location.reload(); return; }
      this.renderSettings();
    }));
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
    // panneau du bas rafraîchi régulièrement
    if (t - (this.hubT || 0) > 2000) {
      this.hubT = t;
      if (!this._epgCache || t - (this.epgT || 0) > 30000) { this.epgT = t; this.refreshEpgCache(); }
      if (!this.isFull() && this.tab === 'chaines') this.renderChannels();
      if (!this.chList.classList.contains('hidden')) this.renderChList();
      this.bets.tick();
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
