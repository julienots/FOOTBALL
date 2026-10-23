// Chaîne MOTEUR+ : un Grand Prix toutes les heures.
import { RaceSim } from '../racing/engine.js';
import { catchUp, budget } from '../core/catchup.js';
import { RacingView } from '../racing/view.js';
import { getRacing, CIRCUITS } from '../racing/data.js';
import { EPOCH } from '../data/season.js';
import { RNG } from '../core/rng.js';
import { AdBreak, pickSpots } from '../tv/ads.js';
import { voice } from '../audio/voice.js';
import { audioCtx, getBus, StadiumSound } from '../audio/audio.js';
import { el, esc } from '../tv/overlay.js';

const CYCLE = 3600, PRE = 240;
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtLap = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`;
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class RacingChannel {
  constructor(app, num) {
    this.app = app;
    this.id = 'racing'; this.name = 'MOTEUR+'; this.color = '#e53935'; this.num = num;
    this.ads = new AdBreak(app.tvRoot, 'MOTEUR+');
    this.tower = el('div', 'rc-tower hidden');
    app.tvRoot.appendChild(this.tower);
    this.slot = null;
  }

  slotAt(t) {
    const slot = Math.floor((t - EPOCH) / (CYCLE * 1000));
    const start = EPOCH + slot * CYCLE * 1000;
    return { slot, start, go: start + PRE * 1000, end: start + CYCLE * 1000 };
  }

  circuit(slot) { return CIRCUITS[((slot % CIRCUITS.length) + CIRCUITS.length) % CIRCUITS.length]; }

  async epg(now, count = 6) {
    const s = this.slotAt(now);
    return Array.from({ length: count }, (_, i) => ({ start: s.start + i * CYCLE * 1000, end: s.start + (i + 1) * CYCLE * 1000, title: this.circuit(s.slot + i), sub: 'Course automobile · 38 tours', live: i === 0 }));
  }

  prepare(now) {
    const s = this.slotAt(now);
    if (this.slot === s.slot && this.sim) return;
    if (this.view) { this.view.dispose(); this.view = null; }
    this.slot = s.slot; this.s = s;
    this.sim = new RaceSim({ drivers: getRacing().drivers, seed: 'gp-' + s.slot });
    const target = (now - s.go) / 1000;
    this.catching = target > 0; // rattrapage par tranches dans update()
    this.sim.pullEvents();
    this.introDone = false;
    if (this.visible) this.buildView();
  }

  buildView() {
    if (this.view || !this.sim) return;
    this.view = new RacingView(this.app.renderer, { circuit: this.circuit(this.slot), drivers: getRacing().drivers }, this.app.settings.quality);
    this.app.resizeView(this.view);
    this.app.warmView(this.view);
  }

  enter() {
    this.visible = true;
    this.app.overlay.setChannel('MOTEUR+', this.color);
    if (audioCtx() && !this.engineSnd) this.makeEngineSound();
    if (!this.crowd && audioCtx()) this.crowd = new StadiumSound();
    if (this.crowd) { this.crowd.fadeIn(); this.crowd.setVolume(0.25); }
    this.buildView();
  }

  leave() {
    this.visible = false;
    if (this.engineSnd) this.engineSnd.out.gain.setTargetAtTime(0, audioCtx().currentTime, 0.1);
    if (this.crowd) this.crowd.fadeOut();
    this.ads.close(); voice.stop();
    this.tower.classList.add('hidden');
    this.app.parkView(this);
    this.app.overlay.hideAll();
  }

  // son de moteur : harmoniques + bruit, la hauteur suit la vitesse
  makeEngineSound() {
    const ctx = audioCtx();
    const out = ctx.createGain(); out.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    lp.connect(out).connect(getBus('fx'));
    const oscs = [['sawtooth', 1, 0.22], ['square', 2, 0.08], ['sawtooth', 0.5, 0.14], ['triangle', 3, 0.05]].map(([type, mul, g]) => {
      const o = ctx.createOscillator(); o.type = type; const gg = ctx.createGain(); gg.gain.value = g; o.connect(gg).connect(lp); o.start(); return { o, mul };
    });
    this.engineSnd = { out, oscs, lp };
  }

  update(dt, now) {
    const s = this.slotAt(now);
    if (this.slot !== s.slot) this.prepare(now);
    const R = this.sim;
    const target = (now - s.go) / 1000;
    if (this.catching) {
      this.catching = !catchUp(R, target, budget(this.visible));
      R.pullEvents();
      if (this.catching) { if (this.visible) this.app.showCatchUp(this, R.wall / target); return; }
    }
    if (target > 0) R.syncTo(target, 600);
    const events = R.pullEvents();
    if (!this.visible) return;
    this.app.hideLoader();
    const O = this.app.overlay;
    O.wallClock(new Date(now));
    const since = (now - s.start) / 1000;
    let phase;
    if (target < 0) phase = since < 60 ? { name: 'ads', t: since, len: 60, seed: 1 } : since < 150 ? { name: 'grid' } : { name: 'prestart' };
    else if (R.finished) {
      const left = (s.end - now) / 1000;
      phase = left < 150 ? { name: 'ads', t: 150 - left, len: 150, seed: 7 } : { name: 'post' };
    } else phase = { name: 'live' };
    this.commentate(events, phase);
    const ctx = audioCtx();
    if (phase.name === 'ads') {
      this.ads.update(phase.t, pickSpots(s.slot * 17 + phase.seed, phase.len), true);
      this.tower.classList.add('hidden');
      if (this.engineSnd) this.engineSnd.out.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      O.hideAll(); this.app.canvasVisible(false);
      return;
    }
    this.ads.update(0, [], false);
    this.app.canvasVisible(true);
    if (!this.view) this.buildView();
    // voiture suivie : le leader ou une bataille serrée
    const ord = R.order();
    this.focusT = (this.focusT || 0) - dt;
    if (this.focusT <= 0 || !this.focus || this.focus.out) {
      this.focusT = 18;
      let f = ord[0];
      if (Math.random() < 0.6) {
        let bg = 1e9;
        for (let i = 1; i < Math.min(12, ord.length); i++) { const g = R.dist(ord[i - 1]) - R.dist(ord[i]); if (g < bg && g > 0) { bg = g; f = ord[i]; } }
      }
      this.focus = f;
    }
    if (this.engineSnd && this.focus) {
      const v = this.focus.v, f0 = 60 + v * 4.2;
      this.engineSnd.oscs.forEach(({ o, mul }) => o.frequency.setTargetAtTime(f0 * mul, ctx.currentTime, 0.08));
      this.engineSnd.out.gain.setTargetAtTime(phase.name === 'live' ? 0.05 + v / 1800 : 0.02, ctx.currentTime, 0.2);
    }
    if (this.crowd) this.crowd.update(0.3, dt);
    O.setLive(phase.name === 'post' ? 'APRÈS-COURSE' : 'EN DIRECT');
    O.scorebug(null);
    this.drawTower(phase, ord);
    if (phase.name === 'grid' && O.panelKey !== 'rg') {
      O.panelKey = 'rg';
      const grid = [...R.cars].sort((a, b) => a.grid - b.grid);
      O.showPanel(`<div class="pn-title">${esc(this.circuit(this.slot))} · Grille de départ</div><div class="rc-grid">${grid.map(c => `<div class="rc-g"><b>${c.grid}</b><i style="background:${c.d.colors[0]}"></i>${esc(c.d.name)}<small>${esc(c.d.team)}</small></div>`).join('')}</div>`, 'lineups');
      if (!this.introDone) {
        this.introDone = true;
        voice.say('pbp', `Bienvenue au ${this.circuit(this.slot)} ! ${grid[0].d.name} s'élance en pole position, devant ${grid[1].d.name}.`, 1, { channel: 'racing', ttl: 60000 });
        voice.say('cons', pick(['Le départ sera décisif, la piste est étroite au premier virage.', 'La stratégie des arrêts aux stands va jouer un grand rôle aujourd\'hui.']), 1, { channel: 'racing', ttl: 60000 });
      }
    } else if (phase.name === 'post' && O.panelKey !== 'rp') {
      O.panelKey = 'rp';
      O.showPanel(`<div class="pn-title">Classement final · ${esc(this.circuit(this.slot))}</div><div class="rc-grid">${R.results.map((c, i) => `<div class="rc-g"><b>${i + 1}</b><i style="background:${c.d.colors[0]}"></i>${esc(c.d.name)}<small>${i === 0 ? '🏆 ' : ''}${esc(c.d.team)}</small></div>`).join('')}</div>${R.fastest.car ? `<div class="lu-bench">Meilleur tour : ${esc(R.fastest.car.d.name)} en ${fmtLap(R.fastest.t)}</div>` : ''}`, 'lineups');
    } else if ((phase.name === 'live' || phase.name === 'prestart') && O.panelKey) O.hidePanel();
    O.setTicker([`MOTEUR+ · ${this.circuit(this.slot)} en direct`, `Prochaine course : ${this.circuit(this.slot + 1)} à ${fmtTime(s.end + PRE * 1000)}`]);
    const focus = phase.name === 'prestart' ? [...R.cars].sort((a, b) => a.grid - b.grid)[0] : this.focus;
    this.view.render(dt, R, focus, { camMode: phase.name === 'post' ? 'aerial' : phase.name === 'prestart' ? 'tv' : undefined, target: Math.max(0, target) });
  }

  drawTower(phase, ord) {
    const R = this.sim;
    if (phase.name !== 'live' && phase.name !== 'prestart') { this.tower.classList.add('hidden'); return; }
    const leader = ord[0];
    const lap = Math.min(R.laps, Math.max(1, R.leaderLap + (R.started ? 1 : 0)));
    const rows = ord.slice(0, 10).map((c, i) => `<div class="rc-r ${c === this.focus ? 'f' : ''}"><b>${i + 1}</b><i style="background:${c.d.colors[0]}"></i><span>${c.d.code}</span><em>${c.pitT > 0 ? 'STAND' : i === 0 ? 'Leader' : '+' + R.gapToLeader(c, leader).toFixed(1)}</em></div>`).join('');
    const html = `<div class="rc-lap">TOUR ${lap}/${R.laps}</div>${rows}`;
    if (html !== this._tw || performance.now() - (this._twT || 0) > 500) { this.tower.innerHTML = html; this._tw = html; this._twT = performance.now(); }
    this.tower.classList.remove('hidden');
  }

  commentate(events, phase) {
    const say = (w, t, p = 2, ttl = 6000) => voice.say(w, t, p, { channel: 'racing', ttl });
    for (const ev of events) {
      if (phase.name !== 'live' && phase.name !== 'post') continue;
      switch (ev.type) {
        case 'start': say('pbp', 'Les feux s\'éteignent... C\'est parti !', 3, 8000); if (this.crowd) this.crowd.surge(1, 4); break;
        case 'overtake': if (!voice.busy() || Math.random() < 0.4) say('pbp', pick([`Dépassement de ${ev.name} sur ${ev.victim} !`, `${ev.name} passe ${ev.victim} !`, `Quelle manœuvre de ${ev.name} !`]) + (ev.pos === 1 ? ' Il prend la tête !' : ''), ev.pos <= 3 ? 3 : 2); break;
        case 'pit': say('pbp', `${ev.name} rentre aux stands.`, 1, 6000); break;
        case 'fastest': say('pbp', `Meilleur tour en course pour ${ev.name}, ${fmtLap(ev.time).replace('.', ' secondes ')}.`, 1, 8000); break;
        case 'lap': if (ev.lap === this.sim.laps) say('pbp', `Dernier tour ! ${ev.leader} est en tête.`, 3, 10000); else if (ev.lap % 8 === 0) say('cons', `Tour ${ev.lap}, ${ev.leader} contrôle la course.`, 1, 10000); break;
        case 'dnf': say('pbp', `Abandon de ${ev.name} : ${ev.reason} !`, 3, 8000); say('cons', 'Une grosse déception pour son équipe.', 1, 10000); break;
        case 'win': say('pbp', `Drapeau à damier ! ${ev.name} remporte le Grand Prix pour ${ev.team} !`, 3, 15000); if (this.crowd) { this.crowd.surge(1.2, 6); this.crowd.applause(6, 1.2); } break;
        default: break;
      }
    }
  }

  liveScore() {
    const R = this.sim;
    if (!R) return null;
    const o = R.order();
    if (!o[0]) return null;
    const mk = (c) => ({ name: c.d.name, short: c.d.code, colors: c.d.colors });
    return { home: mk(o[0]), away: mk(o[1] || o[0]), score: ['P1', 'P2'], minute: R.finished ? 'Fin' : `Tour ${Math.min(R.laps, R.leaderLap + 1)}`, comp: this.circuit(this.slot) };
  }
}
