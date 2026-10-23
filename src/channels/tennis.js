// Chaîne TENNIS+ : un match du circuit toutes les deux heures.
import { TennisMatch } from '../tennis/engine.js';
import { catchUp, budget } from '../core/catchup.js';
import { TennisView } from '../tennis/view.js';
import { getTennisTour, TOURNAMENTS, ROUNDS } from '../tennis/data.js';
import { EPOCH } from '../data/season.js';
import { RNG } from '../core/rng.js';
import { AdBreak, pickSpots } from '../tv/ads.js';
import { voice } from '../audio/voice.js';
import { StadiumSound, audioCtx, kick } from '../audio/audio.js';
import { el, esc } from '../tv/overlay.js';
import { NATIONS } from '../data/names.js';

const CYCLE = 7200, PRE = 300;
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const flag = (code) => { const f = NATIONS[code].flag; return `<i class="tn-flag" style="background:linear-gradient(90deg,${f[0]} 0 33%,${f[1]} 33% 66%,${f[2]} 66%)"></i>`; };

export class TennisChannel {
  constructor(app, num) {
    this.app = app;
    this.id = 'tennis'; this.name = 'TENNIS+'; this.color = '#c0ca33'; this.num = num;
    this.ads = new AdBreak(app.tvRoot, 'TENNIS+');
    this.bug = el('div', 'tn-bug hidden');
    app.tvRoot.appendChild(this.bug);
    this.slot = null;
  }

  slotAt(t) {
    const slot = Math.floor((t - EPOCH) / (CYCLE * 1000));
    const start = EPOCH + slot * CYCLE * 1000;
    return { slot, start, play: start + PRE * 1000, end: start + CYCLE * 1000 };
  }

  matchup(slot) {
    const T = getTennisTour();
    const rng = new RNG('tennis-' + slot);
    const ps = rng.shuffle([...T.players]);
    return { p1: ps[0], p2: ps[1], seed: 'tn-' + slot, tournament: TOURNAMENTS[Math.floor(slot / 6) % TOURNAMENTS.length], round: ROUNDS[slot % ROUNDS.length] };
  }

  async epg(now, count = 6) {
    const s = this.slotAt(now);
    return Array.from({ length: count }, (_, i) => {
      const m = this.matchup(s.slot + i), start = s.start + i * CYCLE * 1000;
      return { start, end: start + CYCLE * 1000, title: `${m.p1.name} – ${m.p2.name}`, sub: `${m.tournament} · ${m.round}`, live: i === 0 };
    });
  }

  prepare(now) {
    const s = this.slotAt(now);
    if (this.slot === s.slot && this.engine) return;
    if (this.view) { this.view.dispose(); this.view = null; }
    this.slot = s.slot; this.s = s;
    this.m = this.matchup(s.slot);
    const e = new TennisMatch({ p1: this.m.p1, p2: this.m.p2, seed: this.m.seed });
    const target = (now - s.play) / 1000;
    this.catching = target > 0; // rattrapage par tranches dans update()
    e.pullEvents();
    this.engine = e;
    this.introDone = false;
    if (this.visible) this.buildView();
  }

  buildView() {
    if (this.view || !this.engine) return;
    const h = new Date(this.s.play).getHours();
    this.view = new TennisView(this.app.renderer, { tournament: this.m.tournament, night: h >= 20 || h < 7 }, this.app.settings.quality);
    this.view.setRoster(this.engine);
    this.app.resizeView(this.view);
    this.app.warmView(this.view);
  }

  enter() {
    this.visible = true;
    this.app.overlay.setChannel('TENNIS+', this.color);
    if (!this.sound && audioCtx()) this.sound = new StadiumSound();
    if (this.sound) { this.sound.fadeIn(); this.sound.setVolume(0.35); }
    this.buildView();
  }

  leave() {
    this.visible = false;
    if (this.sound) this.sound.fadeOut();
    this.ads.close(); voice.stop();
    this.bug.classList.add('hidden');
    this.app.parkView(this);
    this.app.overlay.hideAll();
  }

  update(dt, now) {
    const s = this.slotAt(now);
    if (this.slot !== s.slot) this.prepare(now);
    const E = this.engine;
    const target = (now - s.play) / 1000;
    if (this.catching) {
      this.catching = !catchUp(E, target, budget(this.visible));
      E.pullEvents();
      if (this.catching) { if (this.visible) this.app.showCatchUp(this, E.wall / target); return; }
    }
    if (target > 0) E.syncTo(target, 400);
    const events = E.pullEvents();
    if (!this.visible) return;
    this.app.hideLoader();
    const O = this.app.overlay;
    O.wallClock(new Date(now));
    const since = (now - s.start) / 1000;
    let phase;
    if (target < 0) phase = since < 60 ? { name: 'ads', t: since, len: 60, seed: 1 } : since < 190 ? { name: 'intro' } : { name: 'warm' };
    else if (E.done && E.wall - (E.doneAt ?? (E.doneAt = E.wall)) > 40) {
      const left = (s.end - now) / 1000;
      phase = left < 180 ? { name: 'ads', t: 180 - left, len: 180, seed: 9 } : { name: 'post' };
    } else if (E.phase === 'after' && E.afterLen > 50 && E.phaseT > 8 && E.phaseT < E.afterLen - 8) phase = { name: 'ads', t: E.phaseT - 8, len: E.afterLen - 16, seed: E.games[0] * 7 + E.games[1] + E.sets.length * 31 };
    else phase = { name: 'live' };
    this.commentate(events, phase);
    if (phase.name === 'ads') {
      this.ads.update(phase.t, pickSpots(s.slot * 13 + phase.seed, phase.len), true);
      this.bug.classList.add('hidden');
      if (this.sound) this.sound.setVolume(0);
      O.hideAll(); this.app.canvasVisible(false);
      return;
    }
    this.ads.update(0, [], false);
    this.app.canvasVisible(true);
    if (!this.view) this.buildView();
    if (this.sound) { this.sound.setVolume(E.phase === 'flight' ? 0.12 : 0.3); this.sound.update(E.excitement * 0.6, dt); }
    O.setLive(phase.name === 'post' ? 'APRÈS-MATCH' : 'EN DIRECT');
    O.scorebug(null);
    this.drawBug(phase);
    if (phase.name === 'intro' && O.panelKey !== 'ti') {
      O.panelKey = 'ti';
      const { p1, p2 } = this.m;
      const card = (p) => `<div class="mc-team"><div class="tn-ava" style="background:${p.kit[0]}">${esc(p.short[0])}</div><div>${esc(p.name)}</div><small>${flag(p.nation)} ${esc(NATIONS[p.nation].name)} · n°${p.rank} mondial</small></div>`;
      O.showPanel(`<div class="pn-title">${esc(this.m.tournament)} · ${esc(this.m.round)}</div><div class="mc">${card(p1)}<div class="mc-vs"><div class="mc-big">VS</div><div class="mc-sub">Début du match à ${fmtTime(s.play)}</div></div>${card(p2)}</div>`, 'matchcard');
      if (!this.introDone) {
        this.introDone = true;
        voice.say('pbp', `Bienvenue au ${this.m.tournament} pour ce ${this.m.round} entre ${p1.name}, numéro ${p1.rank} mondial, et ${p2.name}, numéro ${p2.rank}.`, 1, { channel: 'tennis', ttl: 60000 });
        voice.say('cons', pick([`Deux styles très différents. ${p1.serve > p2.serve ? p1.short : p2.short} s'appuie beaucoup sur son service.`, `Ça promet. ${p1.fh > p2.fh ? p1.short : p2.short} a l'un des meilleurs coups droits du circuit.`]), 1, { channel: 'tennis', ttl: 60000 });
      }
    } else if (phase.name === 'post' && O.panelKey !== 'tp') {
      O.panelKey = 'tp'; this.statsPanel('Statistiques du match');
    } else if ((phase.name === 'live' || phase.name === 'warm') && O.panelKey) O.hidePanel();
    O.setTicker([`TENNIS+ · ${this.m.tournament} en direct`, `Prochain match : ${(() => { const n = this.matchup(s.slot + 1); return `${n.p1.name} – ${n.p2.name} à ${fmtTime(s.end + PRE * 1000)}`; })()}`]);
    this.view.render(dt, E, Math.max(0, target), { camMode: phase.name === 'live' ? (E.phase === 'after' && E.phaseT > 3 && E.phaseT < 9 ? 'side' : 'wide') : 'aerial' });
  }

  drawBug(phase) {
    const E = this.engine;
    if (phase.name !== 'live' && phase.name !== 'post') { this.bug.classList.add('hidden'); return; }
    const row = (i) => {
      const p = E.pl[i].d;
      const sets = E.sets.map(s => `<td>${s[i]}</td>`).join('');
      return `<tr><td class="tn-sv">${!E.done && E.server === i ? '●' : ''}</td><td class="tn-nm">${flag(p.nation)} ${esc(p.short.toUpperCase())}</td>${sets}${E.done ? '' : `<td class="tn-cur">${E.games[i]}</td><td class="tn-pt">${E.pointLabel(i)}</td>`}</tr>`;
    };
    const html = `<table>${row(0)}${row(1)}</table>${E.tb ? '<div class="tn-tag">TIE-BREAK</div>' : ''}`;
    if (html !== this._bug) { this.bug.innerHTML = html; this._bug = html; }
    this.bug.classList.remove('hidden');
  }

  statsPanel(title) {
    const E = this.engine;
    const st = E.stats;
    const rows = [['Aces', st[0].aces, st[1].aces], ['Doubles fautes', st[0].df, st[1].df], ['1re balle', `${Math.round(100 * st[0].firstIn / Math.max(1, st[0].firstTot))}%`, `${Math.round(100 * st[1].firstIn / Math.max(1, st[1].firstTot))}%`], ['Coups gagnants', st[0].winners, st[1].winners], ['Fautes directes', st[0].errors, st[1].errors], ['Breaks', st[0].breaks, st[1].breaks], ['Points gagnés', st[0].pts, st[1].pts]];
    this.app.overlay.showPanel(`<div class="pn-title">${esc(title)}</div>
      <div class="st-head"><span class="st-team">${esc(E.pl[0].d.name)}</span><span class="st-score">${E.sets.map(s => s.join('-')).join(' ') || '-'}</span><span class="st-team">${esc(E.pl[1].d.name)}</span></div>
      <div class="st-rows">${rows.map(([l, a, b]) => `<div class="st-row"><span class="st-a">${a}</span><div class="st-mid"><div class="st-l">${l}</div></div><span class="st-b">${b}</span></div>`).join('')}</div>`, 'stats');
  }

  commentate(events, phase) {
    const E = this.engine;
    const nm = (i) => E.pl[i].d.short;
    const say = (w, t, p = 2, ttl = 6000) => voice.say(w, t, p, { channel: 'tennis', ttl });
    for (const ev of events) {
      if (phase.name !== 'live' && phase.name !== 'post') continue;
      if (ev.type === 'hit') kick(ev.kind === 'serve' ? 0.6 : 0.35);
      if (ev.type === 'point') {
        if (this.sound) { if (ev.rally > 8 || ev.how === 'ace' || ev.how === 'winner') { this.sound.surge(0.7 + Math.min(0.5, ev.rally * 0.04), 2.5); this.sound.applause(3, 1); } else this.sound.applause(2, 0.6); }
        const w = ev.winner;
        if (ev.how === 'ace') say('pbp', pick([`Ace de ${nm(w)} !`, `Ace ! Imparable.`, `${nm(w)}, service gagnant !`]), 2);
        else if (ev.how === 'double') say('pbp', `Double faute de ${nm(1 - w)}.`, 2);
        else if (ev.how === 'winner') say('pbp', ev.rally > 8 ? `Quel échange ! Et le point pour ${nm(w)} !` : pick([`Coup gagnant de ${nm(w)} !`, `Superbe ${pick(['coup droit', 'revers', 'passing'])} de ${nm(w)} !`, `Gagnant de ${nm(w)}.`]), ev.rally > 8 ? 3 : 2);
        else if (ev.how === 'net') say('pbp', pick([`Dans le filet.`, `${nm(1 - w)} trouve le filet.`]), 1, 3500);
        else say('pbp', pick([`C'est faute.`, `La balle est longue.`, `Dehors !`, `Faute de ${nm(1 - w)}.`]), 1, 3500);
        if (ev.rally > 10) say('cons', `Échange de ${ev.rally} frappes, le public apprécie !`, 1, 8000);
      }
      if (ev.type === 'fault') { if (Math.random() < 0.5) say('pbp', 'Faute. Deuxième balle.', 1, 3000); }
      if (ev.type === 'breakpoint') say('pbp', `Balle de break pour ${nm(ev.player)} !`, 2, 8000);
      if (ev.type === 'break') say('pbp', `Break ! ${nm(ev.player)} prend le service de son adversaire !`, 3, 8000);
      if (ev.type === 'game') say('pbp', `Jeu ${nm(ev.winner)}. ${ev.games[0]} jeux à ${ev.games[1]}.`, 2, 9000);
      if (ev.type === 'tiebreak') say('pbp', 'Six jeux partout : on va jouer le tie-break !', 2, 10000);
      if (ev.type === 'set') { say('pbp', `Set pour ${nm(ev.winner)}, ${Math.max(...ev.set)} jeux à ${Math.min(...ev.set)} !`, 3, 12000); say('cons', pick(['Un set très bien maîtrisé.', 'Il a su élever son niveau dans les moments importants.']), 1, 15000); }
      if (ev.type === 'match') { say('pbp', `Jeu, set et match, ${E.pl[ev.winner].d.name} ! Score final : ${ev.sets.map(s => s.join(' ')).join(', ')}.`, 3, 20000); say('cons', `Bravo à lui, une victoire méritée.`, 2, 20000); if (this.sound) { this.sound.surge(1, 5); this.sound.applause(8, 1.2); } }
    }
  }

  liveScore() {
    const E = this.engine;
    if (!E) return null;
    const mk = (p) => ({ name: p.d.name, short: p.d.short.slice(0, 3).toUpperCase(), colors: p.d.kit });
    return { home: mk(E.pl[0]), away: mk(E.pl[1]), score: E.done ? E.setsWon : E.games, minute: E.done ? 'Fin' : `Set ${E.sets.length + 1}`, comp: this.m.tournament };
  }
}
