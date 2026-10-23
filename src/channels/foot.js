// Chaîne FOOT+ : grille continue (avant-match, match en direct, mi-temps,
// après-match, publicités) calée sur l'heure réelle.
import { FootballMatch, ENT, HL } from '../football/engine.js';
import { FootballView } from '../football/view.js';
import { Commentary } from '../football/commentary.js';
import { kitsFor } from '../data/world.js';
import { footSlotAt, getSeason, COMP, SPEEDS } from '../data/season.js';
import { fullSim, cachedResult, saveResult } from '../core/sim-service.js';
import { catchUp, budget } from '../core/catchup.js';
import { AdBreak, pickSpots, breakLength } from '../tv/ads.js';
import { StadiumSound, whistle, kick, goalHorn, busGain, audioCtx } from '../audio/audio.js';
import { voice } from '../audio/voice.js';
import { esc, teamBadge } from '../tv/overlay.js';

const fmtTime = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export class FootChannel {
  constructor(app, opts = {}) {
    this.app = app;
    this.id = opts.id || 'foot';
    this.name = opts.name || 'FOOT+';
    this.color = opts.color || '#00c853';
    this.num = opts.num || 1;
    this.slot = null;
    this.engine = null;
    this.view = null;
    this.loading = null;
    this.ads = new AdBreak(app.tvRoot, this.name);
    this.lastHighlight = 0;
    this.playedClips = new Set();
    this.visible = false;
  }

  get k() { return this.app.settings.speed; }

  // ---------- Grille ----------
  slotInfo(t) { return footSlotAt(t, this.k); }

  async infoForSlot(slot) {
    const { season, item, sIdx } = getSeason(slot, this.k, fullSim(this.k));
    const info = await season.matchInfo(item.comp, item.round, item.idx);
    info.compName = COMP[item.comp].name;
    info.compShort = COMP[item.comp].short;
    info.compColor = COMP[item.comp].color;
    info.season = season; info.item = item; info.sIdx = sIdx;
    return info;
  }

  async epg(now, count = 6) {
    const s = this.slotInfo(now);
    const out = [];
    for (let i = 0; i < count; i++) {
      const slot = s.slot + i;
      const start = s.start + i * s.timing.cycle * 1000;
      let title = 'Football';
      let sub = '';
      try {
        const info = await withTimeout(this.infoForSlot(slot), 400);
        if (info) { title = `${info.home.name} – ${info.away.name}`; sub = `${info.compName} · ${info.roundLabel}`; }
        else { sub = 'Programme à venir'; }
      } catch (e) { sub = 'Programme à venir'; }
      out.push({ start, end: start + s.timing.cycle * 1000, title, sub, live: i === 0 });
    }
    return out;
  }

  // ---------- Préparation du match de la case ----------
  async prepare(now) {
    const s = this.slotInfo(now);
    if (this.slot === s.slot && this.engine) return;
    this.teardown();
    this.slot = s.slot;
    this.slotData = s;
    const token = (this.token = {});
    this.loading = { progress: 0, text: 'Connexion au direct…' };
    const info = await this.infoForSlot(s.slot);
    if (token !== this.token) return;
    this.info = info;
    const kits = kitsFor(info.home, info.away);
    const T = s.timing;
    this.kits = kits;
    const engine = new FootballMatch({ home: info.home, away: info.away, seed: info.seed, speed: this.k, knockout: info.knockout, h2Offset: T.h2Offset, kits, record: true });
    const hour = new Date(s.kickoff).getHours();
    const night = hour >= 19 || hour < 7, sunset = hour >= 17 && hour < 19;
    info.night = night;
    // contexte pour les commentateurs (classement, buts de la saison)
    const ctx = { home: info.home, away: info.away, comp: info.compName, roundLabel: info.roundLabel, stadium: info.neutral ? 'Stade International' : info.home.stadium, night, ranks: {}, seasonGoals: {}, players: this.app.world.players };
    try {
      if (info.season && info.item.comp === 'L') {
        const tbl = await withTimeout(info.season.leagueTable(info.item.n, true), 1500);
        if (tbl) tbl.forEach((r, i) => (ctx.ranks[r.id] = i + 1));
        this.table = tbl;
      }
      const sc = info.season ? await withTimeout(info.season.topScorers(info.item.n, 200), 800) : null;
      if (sc) sc.forEach(x => (ctx.seasonGoals[x.player.id] = x.goals));
    } catch (e) { /* facultatif */ }
    if (token !== this.token) return;
    this.ctx = ctx;
    // rattrapage du direct (simulation accélérée depuis le coup d'envoi)
    const target = (this.app.now() - s.kickoff) / 1000;
    // par petites tranches, pour ne pas faire saccader la chaîne regardée pendant ce temps
    if (target > 0) {
      while (!catchUp(engine, (this.app.now() - s.kickoff) / 1000, budget(this.visible))) {
        this.loading.progress = Math.min(0.99, engine.wall / Math.max(1, (this.app.now() - s.kickoff) / 1000));
        await new Promise(r => setTimeout(r, this.visible ? 0 : 16));
        if (token !== this.token) return;
      }
    }
    engine.pullEvents();
    engine.highlights.forEach(c => this.playedClips.add(c));
    this.engine = engine;
    this.commentary = new Commentary(engine, ctx);
    if (this.visible) this.buildView();
    this.loading = null;
    this.introDone = false;
    this.htDone = false;
    this.ftDone = false;
  }

  buildView() {
    if (this.view || !this.engine) return;
    const info = this.info;
    this.view = new FootballView(this.app.renderer, { home: info.home, away: info.away, kits: this.kits, night: info.night, sunset: false, seed: info.seed }, this.app.settings.quality);
    this.view.setRoster(this.engine);
    this.app.resizeView(this.view);
    this.app.warmView(this.view);
  }

  teardown() {
    this.token = null;
    if (this.view) { this.view.dispose(); this.view = null; }
    if (this.commentary) { this.commentary.dispose(); this.commentary = null; }
    this.engine = null;
    this.ads.close();
    this.playedClips = new Set();
    this.replayInfo = null;
  }

  enter() {
    this.visible = true;
    this.app.overlay.setChannel(this.name, this.color);
    if (!this.sound && audioCtx()) this.sound = new StadiumSound();
    if (this.sound) this.sound.fadeIn();
    busGain('stadium', 1);
    if (this.engine) this.buildView();
  }

  leave() {
    this.visible = false;
    if (this.sound) this.sound.fadeOut();
    this.ads.close();
    voice.clear('foot');
    voice.clear('ad');
    voice.stop();
    this.app.parkView(this);
    this.app.overlay.hideAll();
  }

  // ---------- Boucle principale ----------
  update(dt, now) {
    const s = this.slotInfo(now);
    if (this.slot !== s.slot && !this.preparing) {
      this.preparing = true;
      this.prepare(now).finally(() => (this.preparing = false));
    }
    const O = this.app.overlay;
    if (!this.engine || this.loading) {
      if (this.visible) this.showLoading();
      return;
    }
    const E = this.engine;
    const T = s.timing;
    const target = (now - s.kickoff) / 1000;
    if (target >= 0) E.syncTo(target, 400);
    const events = E.pullEvents();
    if (!this.visible) return;
    if (!this.sound && audioCtx()) { this.sound = new StadiumSound(); this.sound.fadeIn(); }
    this.app.hideLoader();
    // on garde le résultat final en cache pour les classements
    if (E.period === 'end' && !this.saved) { this.saved = true; if (this.info.season) saveResult(this.info, this.k, E.summary()); if (this.info.season) this.info.season.setResult(this.info.item.comp, this.info.item.round, this.info.item.idx, E.summary(), this.info); }

    const phase = this.phase(now, s, target);
    this.phaseNow = phase;
    O.wallClock(new Date(now));
    this.handleEvents(events, phase);
    this.commentary.tick(dt, phase.name === 'live');

    // coupures pub
    const adActive = phase.ads != null;
    this.ads.update(phase.ads ?? 0, phase.adSeq || [], adActive);
    if (this.sound) this.sound.setVolume(adActive ? 0 : phase.name === 'studio' ? 0.15 : 0.9);
    if (adActive) { O.hideAll(); this.app.canvasVisible(false); return; }
    this.app.canvasVisible(true);
    if (!this.view) this.buildView();
    if (this.sound) this.sound.update(Math.min(1, E.excitement * 1.1 + (E.state === 'celebrate' ? 0.5 : 0)), dt);

    // habillage
    this.drawOverlay(phase, E, s, target);
    // réalisation
    const st = { camMode: phase.cam, focus: phase.focus, preMatch: phase.preMatch };
    if (phase.cam === 'celebrate' && E.celebScorer) st.focus = E.celebScorer.team * 11 + E.celebScorer.slot;
    this.directReplays(phase, E);
    this.view.render(dt, E, Math.max(0, target), st);
    O.replay(!!this.view.replay);
  }

  showLoading() {
    const l = this.loading;
    this.app.showLoader(`<div class="ld-chan">${this.name}</div><div class="ld-txt">${l ? l.text : 'Connexion…'}</div><div class="ld-bar"><i style="width:${Math.round((l?.progress || 0) * 100)}%"></i></div>`);
  }

  // Détermine ce qui passe à l'antenne
  phase(now, s, target) {
    const T = s.timing;
    const E = this.engine;
    const k = this.k;
    const since = (now - s.start) / 1000;
    if (target < 0) {
      const P = T.pre;
      const adEnd = P * (k === 1 ? 0.21 : 0.2);
      if (since < adEnd) {
        const seq = pickSpots(s.slot * 7 + 1, adEnd);
        return { name: 'ads', ads: since, adSeq: seq };
      }
      const f = (since - adEnd) / (P - adEnd);
      if (f < 0.33) return { name: 'pre-intro', cam: 'aerial', preMatch: 0 };
      if (f < 0.6) return { name: 'pre-lineups', cam: 'aerial', preMatch: 0 };
      if (f < 0.86) return { name: 'pre-walk', cam: 'wide', preMatch: 0 };
      return { name: 'pre-place', cam: 'wide', preMatch: Math.min(1, (f - 0.86) / 0.12) };
    }
    if (E.period === 'ht') {
      const htStart = E.stopWall ?? target;
      const t = target - htStart;
      const remaining = T.h2Offset - target;
      const adLen = k === 1 ? 190 : 60;
      if (t < 30) return { name: 'ht-live', cam: t < 12 ? 'wide' : 'aerial', htT: t };
      if (t < 30 + adLen && remaining > 70) return { name: 'ads', ads: t - 30, adSeq: pickSpots(s.slot * 7 + 2, adLen) };
      if (remaining > (k === 1 ? 240 : 40)) return { name: 'studio', cam: 'aerial', studioT: t - 30 - adLen, remaining };
      if (k === 1 && remaining > 70) return { name: 'ads', ads: (remaining - 240) * -1, adSeq: pickSpots(s.slot * 7 + 3, 170) };
      return { name: 'ht-return', cam: 'aerial', remaining };
    }
    if (E.period === 'pens') return { name: 'pens', cam: 'pens' };
    if (E.period === 'end' || E.period === 'ft') {
      const endWall = E.stopWall ?? target;
      const t = target - endWall;
      const left = (s.end - now) / 1000;
      if (E.period === 'ft' && E.knockout && E.score[0] === E.score[1]) return { name: 'pre-pens', cam: 'wide', postT: t };
      if (t < 25) return { name: 'post-live', cam: t < 8 ? 'wide' : 'aerial', postT: t };
      if (left < (k === 1 ? 150 : 50)) {
        const len = k === 1 ? 150 : 50;
        return { name: 'ads', ads: len - left, adSeq: pickSpots(s.slot * 7 + 4, len) };
      }
      return { name: 'post', cam: 'aerial', postT: t - 25, left };
    }
    // match en direct
    let cam = 'wide', focus = null;
    if (E.state === 'celebrate') {
      const since = (k === 1 ? 42 : 16) - E.celebT;
      if (since > 2.5 && since < (k === 1 ? 11 : 7)) cam = 'celebrate';
    } else if (E.state === 'dead' && E.restart && (E.restart.type === 'free' || E.restart.type === 'penalty') && E.restart.timer > 4 && this.lastCard && performance.now() - this.lastCard.t < 4000) {
      cam = 'closeup'; focus = this.lastCard.focus;
    }
    return { name: 'live', cam, focus };
  }

  handleEvents(events, phase) {
    const E = this.engine;
    const O = this.app.overlay;
    const live = phase.name === 'live' || phase.name === 'pens' || phase.name === 'pre-pens' || phase.name === 'post-live' || phase.name === 'ht-live';
    for (const ev of events) {
      if (live || ev.type === 'goal') this.commentary.handle(ev);
      if (!live) continue;
      const team = ev.team != null ? E.teams[ev.team].data : null;
      const snd = this.sound;
      switch (ev.type) {
        case 'whistle': whistle(ev.n || 1); break;
        case 'pass': case 'cross': case 'clearance': case 'throw': kick(ev.long ? 0.6 : 0.35); break;
        case 'shot': kick(0.95); if (snd) snd.surge(0.6, 1.2); break;
        case 'goal':
          if (snd) { snd.surge(1.3, 9); setTimeout(() => snd.applause(6, 1.2), 4000); setTimeout(() => snd.chant(1), 12000); }
          goalHorn();
          O.goal(team, ev, ev.score);
          if (this.view) this.view.joy[ev.team === 0 ? 0 : 1] = 1;
          break;
        case 'save': case 'miss': case 'post': if (snd) snd.ohh(); break;
        case 'block': if (snd) snd.surge(0.4, 0.8); break;
        case 'foul': if (snd && ev.team === 0) snd.booWhistle(1.5); break;
        case 'card':
          O.card(team, ev);
          this.lastCard = { t: performance.now(), focus: this.slotIndexOf(ev.player) };
          if (snd) (ev.team === 0 ? snd.booWhistle(2.5) : snd.surge(0.5, 2));
          break;
        case 'sub': O.sub(team, ev); if (snd) snd.applause(3, 0.6); break;
        case 'stoppage': O.info(`Temps additionnel : <b>+${ev.minutes} min</b>`, 6000); break;
        case 'penalty': if (snd) snd.surge(0.8, 3); break;
        case 'halftime': setTimeout(() => this.showStats('Mi-temps'), 9000); if (snd) snd.applause(5, 0.8); break;
        case 'fulltime': setTimeout(() => this.showStats('Score final'), 9000); if (snd) snd.applause(8, 1.1); break;
        case 'pen_kick': if (snd) (ev.result === 'goal' ? snd.surge(0.9, 3) : snd.ohh()); kick(0.9); break;
        case 'kickoff': O.hidePanel(); break;
        default: break;
      }
    }
  }

  slotIndexOf(pid) {
    const E = this.engine;
    for (let t = 0; t < 2; t++) for (let s = 0; s < 11; s++) if (E.teams[t].players[s].data.id === pid) return t * 11 + s;
    return null;
  }

  showStats(title) {
    if (!this.engine || !this.visible) return;
    const ph = this.phaseNow?.name;
    if (ph === 'ads') return;
    this.app.overlay.stats(title, this.engine, this.info.home, this.info.away);
    this.statsShownAt = performance.now();
  }

  directReplays(phase, E) {
    const V = this.view;
    if (!V) return;
    // ralenti des buts pendant la célébration
    if (phase.name === 'live' && E.state === 'celebrate') {
      const since = (this.k === 1 ? 42 : 16) - E.celebT;
      const clip = E.highlights[E.highlights.length - 1];
      if (since > (this.k === 1 ? 11 : 7) && clip && clip.kind === 'goal' && !this.playedClips.has(clip) && !V.replay) {
        this.playedClips.add(clip);
        V.startReplay(clip, { short: this.k !== 1 });
      }
    } else if (phase.name === 'live' && E.state === 'dead' && E.restart && E.restart.timer > 5.5 && !V.replay) {
      const clip = E.highlights[E.highlights.length - 1];
      if (clip && clip.kind !== 'goal' && !this.playedClips.has(clip) && E.tick - clip.tickEnd < 200) {
        this.playedClips.add(clip);
        V.startReplay(clip, { short: true });
      }
    } else if (phase.name === 'live' && V.replay && E.state === 'play' && V.replay.clip.kind !== 'goal') {
      V.stopReplay();
    }
    // résumé à la mi-temps / après le match
    if ((phase.name === 'studio' || phase.name === 'post') && !V.replay) {
      const goals = E.highlights.filter(c => c.kind === 'goal' && (phase.name === 'post' || c.info.period === 'h1'));
      const idx = this.hlIdx ?? 0;
      if (goals.length && (phase.studioT ?? phase.postT) > 12) {
        const clip = goals[idx % goals.length];
        this.hlIdx = idx + 1;
        if (this.hlIdx <= goals.length * 2) {
          V.startReplay(clip, { short: false });
          this.app.overlay.info(`⚽ ${esc(clip.info.fullName)} ${clip.info.minute}' · ${esc(E.teams[clip.info.team].data.name)}`, 6000);
        }
      }
    } else if (phase.name !== 'studio' && phase.name !== 'post') this.hlIdx = 0;
    if (phase.name === 'ht-return' || phase.name === 'live') { if (V.replay && (phase.name !== 'live')) V.stopReplay(); }
  }

  drawOverlay(phase, E, s, target) {
    const O = this.app.overlay;
    const info = this.info;
    const name = phase.name;
    O.setLive(name === 'live' || name === 'pens' || name.startsWith('pre-') || name === 'ht-live' || name === 'post-live' ? 'EN DIRECT' : name === 'studio' ? 'MI-TEMPS' : name === 'post' ? 'APRÈS-MATCH' : name === 'ht-return' ? 'EN DIRECT' : null);
    // bandeau de score
    if (name === 'live' || name === 'pens' || name === 'ht-live' || name === 'post-live' || name === 'pre-pens' || name === 'ht-return') {
      let clock = E.clockLabel();
      if (E.period === 'ht') clock = 'MT';
      if (E.period === 'ft' || E.period === 'end') clock = 'FIN';
      if (E.period === 'pens') clock = 'TAB';
      const idx = E.period === 'h1' ? 0 : 1;
      const base = E.period === 'h1' ? 2700 : 5400;
      const added = (E.period === 'h1' || E.period === 'h2') && E.stoppageAnnounced && E.clock >= base - 60 ? E.stoppage[idx] : 0;
      let extra = '';
      if (E.pens) extra = `Tirs au but ${E.pens.score[0]} - ${E.pens.score[1]} ${penDots(E.pens.kicks[0])} | ${penDots(E.pens.kicks[1])}`;
      const reds = [0, 1].map(t => E.stats[t].red);
      if (!extra && (reds[0] || reds[1])) extra = `${reds[0] ? '🟥'.repeat(reds[0]) + ' ' + esc(info.home.short) : ''} ${reds[1] ? '🟥'.repeat(reds[1]) + ' ' + esc(info.away.short) : ''}`;
      O.scorebug({ home: info.home, away: info.away, score: E.score, clock, added, comp: info.compShort, compColor: info.compColor, homeColor: this.kits.home.shirt, awayColor: this.kits.away.shirt, extra });
    } else O.scorebug(null);
    // porteur du ballon
    const carrier = E.ball.owner;
    if (name === 'live' && carrier && !this.view.replay && E.state === 'play') O.setCarrier(carrier, carrier.team === 0 ? this.kits.home.shirt : this.kits.away.shirt);
    else O.setCarrier(null);
    // panneaux
    if (name === 'pre-intro') {
      if (O.panelKey !== 'intro') { O.panelKey = 'intro'; O.matchCard(`${info.compName} · ${info.roundLabel}`, info, `Coup d'envoi ${fmtTime(s.kickoff)} · ${esc(this.ctx.stadium)}`); }
      if (!this.introDone) { this.introDone = true; this.commentary.intro(); }
    } else if (name === 'pre-lineups') {
      if (O.panelKey !== 'lu') { O.panelKey = 'lu'; O.lineups(info.home, info.away, null, null, 'Compositions officielles'); }
    } else if (name === 'studio') {
      const st = phase.studioT;
      const cyc = Math.floor(st / 25) % 3;
      if (!E.highlights.some(c => c.kind === 'goal' && c.info.period === 'h1') || this.view.replay == null) {
        if (cyc === 0 && O.panelKey !== 'st1') { O.panelKey = 'st1'; O.stats('Statistiques de la 1re période', E, info.home, info.away); }
        if (cyc === 1 && O.panelKey !== 'tb' && this.table) { O.panelKey = 'tb'; O.table(`${info.compName} · Classement avant la journée`, this.table, [info.home.id, info.away.id]); }
        if (cyc === 2 && O.panelKey !== 'lu2') { O.panelKey = 'lu2'; O.matchCard('Mi-temps', info, `<span class="big-score">${E.score[0]} - ${E.score[1]}</span>`); }
      } else if (O.panelKey) O.hidePanel();
      if (!this.htDone) { this.htDone = true; voice.say('cons', 'On revoit les temps forts de cette première période.', 1, { channel: 'foot', ttl: 20000 }); }
    } else if (name === 'post') {
      const pt = phase.postT;
      const cyc = Math.floor(pt / 30) % 3;
      if (this.view.replay == null) {
        if (cyc === 0 && O.panelKey !== 'pst') { O.panelKey = 'pst'; O.stats('Score final', E, info.home, info.away); }
        if (cyc === 1 && O.panelKey !== 'next') { O.panelKey = 'next'; this.showNext(s); }
        if (cyc === 2 && O.panelKey !== 'ptb' && this.table) { O.panelKey = 'ptb'; O.table(`${info.compName} · Classement`, this.table, [info.home.id, info.away.id]); }
      } else if (O.panelKey) O.hidePanel();
    } else if (name === 'ht-return') {
      if (O.panelKey !== 'ret') { O.panelKey = 'ret'; O.hidePanel(); O.info('Seconde période dans un instant', 8000); }
    } else if (name === 'pre-walk' || name === 'pre-place' || name === 'live' || name === 'pens') {
      if (O.panelKey && !(this.statsShownAt && performance.now() - this.statsShownAt < 12000)) O.hidePanel();
    }
    // bandeau défilant
    O.setTicker(this.tickerItems(s));
  }

  async showNext(s) {
    const O = this.app.overlay;
    try {
      const n = await this.infoForSlot(s.slot + 1);
      const start = s.start + s.timing.cycle * 1000;
      if (this.phaseNow?.name === 'post') O.matchCard(`À suivre · ${fmtTime(start + s.timing.pre * 1000)}`, n, `Sur ${this.name}`);
    } catch (e) { /* rien */ }
  }

  tickerItems(s) {
    if (this._tk && this._tk.slot === s.slot && performance.now() - this._tk.t < 30000) return this._tk.items;
    const items = [`${this.name} · ${SPEEDS[this.k].short} par match · Toute la ${this.info.compName} en direct`];
    const nextStart = s.start + s.timing.cycle * 1000 + s.timing.pre * 1000;
    items.push(`Prochain coup d'envoi à ${fmtTime(nextStart)}`);
    if (this.table && this.table.length) items.push(`Leader de Ligue Élite : ${this.table[0].team.name} (${this.table[0].pts} pts)`);
    const sc = Object.entries(this.ctx?.seasonGoals || {}).sort((a, b) => b[1] - a[1])[0];
    if (sc) { const p = this.app.world.players[sc[0]]; if (p) items.push(`Meilleur buteur : ${p.name} (${sc[1]} buts)`); }
    items.push(this.app.channels.filter(c => c !== this).map(c => `${c.name} sur la chaîne ${c.num}`).join(' · '));
    this._tk = { slot: s.slot, t: performance.now(), items };
    return items;
  }

  // Score en direct pour les autres chaînes
  liveScore() {
    const E = this.engine;
    if (!E || !this.info) return null;
    return { home: this.info.home, away: this.info.away, score: E.score, minute: E.period === 'ht' ? 'MT' : E.period === 'end' || E.period === 'ft' ? 'Fin' : E.period === 'pens' ? 'TAB' : E.minute() + "'", comp: this.info.compName };
  }
}

function penDots(arr) { return arr.map(x => (x ? '●' : '○')).join(''); }
function withTimeout(p, ms) { return Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]); }
