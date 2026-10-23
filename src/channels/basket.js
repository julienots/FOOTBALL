// Chaîne BASKET+ : un match de Ligue Pro toutes les heures.
import { BasketMatch } from '../basket/engine.js';
import { catchUp, budget } from '../core/catchup.js';
import { BasketView } from '../basket/view.js';
import { getBasketLeague } from '../basket/data.js';
import { EPOCH } from '../data/season.js';
import { RNG } from '../core/rng.js';
import { AdBreak, pickSpots } from '../tv/ads.js';
import { voice } from '../audio/voice.js';
import { StadiumSound, whistle, busGain, audioCtx } from '../audio/audio.js';
import { esc, teamBadge } from '../tv/overlay.js';

const CYCLE = 3600, PRE = 240;
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const nb = (n) => String(n);

export class BasketChannel {
  constructor(app) {
    this.app = app;
    this.id = 'basket'; this.name = 'BASKET+'; this.color = '#ff6d00'; this.num = 2;
    this.ads = new AdBreak(app.tvRoot, 'BASKET+');
    this.visible = false;
    this.slot = null;
  }

  slotAt(t) {
    const slot = Math.floor((t - EPOCH) / (CYCLE * 1000));
    const start = EPOCH + slot * CYCLE * 1000;
    return { slot, start, tip: start + PRE * 1000, end: start + CYCLE * 1000 };
  }

  matchup(slot) {
    const L = getBasketLeague();
    const rng = new RNG('basket-slot-' + slot);
    const order = rng.shuffle(L.teams.map((t, i) => i));
    const home = L.teams[order[0]], away = L.teams[order[1]];
    return { home, away, seed: 'b-' + slot };
  }

  async epg(now, count = 6) {
    const s = this.slotAt(now);
    const out = [];
    for (let i = 0; i < count; i++) {
      const m = this.matchup(s.slot + i);
      const start = s.start + i * CYCLE * 1000;
      out.push({ start, end: start + CYCLE * 1000, title: `${m.home.name} – ${m.away.name}`, sub: 'Basket · Ligue Pro', live: i === 0 });
    }
    return out;
  }

  prepare(now) {
    const s = this.slotAt(now);
    if (this.slot === s.slot && this.engine) return;
    this.teardown();
    this.slot = s.slot; this.s = s;
    const m = this.matchup(s.slot);
    this.m = m;
    this.kits = [
      { shirt: m.home.colors[0], num: m.home.colors[1] },
      { shirt: lum(m.away.colors[0]) > 0.7 || dist(m.home.colors[0], m.away.colors[0]) < 120 ? '#f5f5f5' : m.away.colors[0], num: '#111111' },
    ];
    if (this.kits[1].shirt !== '#f5f5f5') this.kits[1].num = m.away.colors[1];
    const e = new BasketMatch({ home: m.home, away: m.away, seed: m.seed });
    const target = (now - s.tip) / 1000;
    this.catching = target > 0; // rattrapage par tranches dans update()
    e.pullEvents();
    this.engine = e;
    this.introDone = false;
    if (this.visible) this.buildView();
  }

  buildView() {
    if (this.view || !this.engine) return;
    this.view = new BasketView(this.app.renderer, { home: this.m.home, away: this.m.away }, this.app.settings.quality);
    this.view.setRoster(this.engine, this.kits);
    this.app.resizeView(this.view);
    this.app.warmView(this.view);
  }

  teardown() {
    if (this.view) { this.view.dispose(); this.view = null; }
    this.engine = null;
    this.ads.close();
  }

  enter() {
    this.visible = true;
    this.app.overlay.setChannel('BASKET+', this.color);
    if (!this.sound && audioCtx()) this.sound = new StadiumSound();
    if (this.sound) this.sound.fadeIn();
    busGain('stadium', 1);
    this.buildView();
  }

  leave() {
    this.visible = false;
    if (this.sound) this.sound.fadeOut();
    this.ads.close();
    voice.stop();
    this.app.parkView(this);
    this.app.overlay.hideAll();
  }

  update(dt, now) {
    const s = this.slotAt(now);
    if (this.slot !== s.slot) this.prepare(now);
    const E = this.engine;
    const target = (now - s.tip) / 1000;
    if (this.catching) {
      this.catching = !catchUp(E, target, budget(this.visible));
      E.pullEvents();
      if (this.catching) { if (this.visible) this.app.showCatchUp(this, E.wall / target); return; }
    }
    if (target > 0) E.syncTo(target, 600);
    const events = E.pullEvents();
    if (!this.visible) return;
    this.app.hideLoader();
    if (!this.sound && audioCtx()) { this.sound = new StadiumSound(); this.sound.fadeIn(); }
    const O = this.app.overlay;
    O.wallClock(new Date(now));
    const since = (now - s.start) / 1000;
    // phase
    let phase;
    if (target < 0) {
      if (since < 60) phase = { name: 'ads', ads: since, seq: pickSpots(s.slot * 11 + 1, 60) };
      else if (since < 150) phase = { name: 'intro' };
      else phase = { name: 'lineups' };
    } else if (E.period === 'break') {
      const into = (E.quarter === 2 ? E.halfLen : E.breakLen) - E.breakT;
      const adLen = E.quarter === 2 ? 200 : 70;
      if (into > 15 && into < 15 + adLen) phase = { name: 'ads', ads: into - 15, seq: pickSpots(s.slot * 11 + E.quarter + 2, adLen) };
      else phase = { name: 'break', into };
    } else if (E.period === 'end') {
      const left = (s.end - now) / 1000;
      if (left < 120) phase = { name: 'ads', ads: 120 - left, seq: pickSpots(s.slot * 11 + 9, 120) };
      else phase = { name: 'post' };
    } else phase = { name: 'live' };
    this.phaseNow = phase;
    this.commentate(events, phase);
    if (phase.name === 'ads') {
      this.ads.update(phase.ads, phase.seq, true);
      if (this.sound) this.sound.setVolume(0);
      O.hideAll(); this.app.canvasVisible(false);
      return;
    }
    this.ads.update(0, [], false);
    this.app.canvasVisible(true);
    if (!this.view) this.buildView();
    if (this.sound) { this.sound.setVolume(phase.name === 'live' ? 0.75 : 0.35); this.sound.update(E.excitement, dt); }
    // habillage
    O.setLive(phase.name === 'live' || phase.name === 'break' ? 'EN DIRECT' : phase.name === 'post' ? 'APRÈS-MATCH' : 'AVANT-MATCH');
    const H = this.m.home, A = this.m.away;
    if (phase.name === 'live' || phase.name === 'break' || phase.name === 'post') {
      const qtxt = E.period === 'end' ? 'FIN' : E.period === 'break' ? (E.quarter === 2 ? 'MT' : `FIN Q${E.quarter}`) : `Q${E.quarter > 4 ? 'P' : E.quarter} ${E.clockLabel()}`;
      O.scorebug({ home: H, away: A, score: E.score, clock: qtxt, comp: 'LIGUE PRO', compColor: '#e65100', homeColor: this.kits[0].shirt, awayColor: this.kits[1].shirt, extra: E.period === 'play' ? `⏱ ${Math.max(0, Math.ceil(E.shotClock))}` : '' });
    } else O.scorebug(null);
    if (phase.name === 'intro' && O.panelKey !== 'bi') {
      O.panelKey = 'bi';
      O.matchCard('Basket · Ligue Pro', { home: H, away: A, compName: 'Ligue Pro', roundLabel: H.arena }, `Entre-deux à ${fmtTime(s.tip)}`);
      if (!this.introDone) {
        this.introDone = true;
        voice.say('pbp', `Bonsoir et bienvenue à la ${H.arena} pour ce match de Ligue Pro entre les ${H.name} et les ${A.name} !`, 1, { channel: 'basket', ttl: 60000 });
        voice.say('cons', pick([`Deux équipes qui aiment courir, on devrait voir beaucoup de points ce soir.`, `Attention à la défense des ${A.name}, c'est leur grande force.`]), 1, { channel: 'basket', ttl: 60000 });
      }
    }
    if (phase.name === 'lineups' && O.panelKey !== 'bl') { O.panelKey = 'bl'; this.lineups(); }
    if ((phase.name === 'break' && phase.into > 4) || phase.name === 'post') {
      if (O.panelKey !== 'bs' + E.quarter + E.period) { O.panelKey = 'bs' + E.quarter + E.period; this.boxscore(); }
    } else if (phase.name === 'live' && O.panelKey) O.hidePanel();
    O.setTicker([`BASKET+ · Ligue Pro en direct`, `Prochain match : ${(() => { const n = this.matchup(s.slot + 1); return `${n.home.name} – ${n.away.name} à ${fmtTime(s.end + PRE * 1000)}`; })()}`, 'FOOT+ sur la chaîne 1 · SPORT 24 INFO sur la chaîne 3']);
    if (Math.floor(now / 1000) !== this._scr) { this._scr = Math.floor(now / 1000); this.view.drawScreen(E, H, A); }
    this.view.render(dt, E, Math.max(0, target), { camMode: phase.name === 'live' ? 'wide' : 'aerial', swish: this.swish });
    this.swish = null;
  }

  lineups() {
    const O = this.app.overlay;
    const col = (t) => `<div class="lu-col"><div class="lu-head" style="--tc:${t.colors[0]}">${teamBadge(t, 40)}<div><div class="lu-name">${esc(t.name)}</div><div class="lu-form">Cinq de départ</div></div></div>
      <ol class="lu-list">${t.roster.slice(0, 5).map(p => `<li><b>${p.number}</b> ${esc(p.name)} <small>${p.posLabel} · ${p.height.toFixed(2)} m</small></li>`).join('')}</ol></div>`;
    O.showPanel(`<div class="pn-title">Cinq de départ</div><div class="lu">${col(this.m.home)}${col(this.m.away)}</div>`, 'lineups');
  }

  boxscore() {
    const E = this.engine, O = this.app.overlay;
    const col = (ti) => {
      const t = E.teams[ti], st = E.stats[ti];
      return `<div class="lu-col"><div class="lu-head">${teamBadge(t.data, 36)}<div><div class="lu-name">${esc(t.data.name)} · ${E.score[ti]}</div><div class="lu-form">Tirs ${st.fgm}/${st.fga} · 3 pts ${st.tpm}/${st.tpa} · LF ${st.ftm}/${st.fta}</div></div></div>
      <ol class="lu-list">${t.players.map(p => `<li><b>${p.d.number}</b> ${esc(p.d.short)} <small>${p.pts} pts · ${p.reb} rbd · ${p.ast} pd</small></li>`).join('')}</ol>
      <div class="lu-bench">Rebonds ${st.reb} · Passes ${st.ast} · Interceptions ${st.stl} · Contres ${st.blk} · Fautes ${st.fouls}</div></div>`;
    };
    O.showPanel(`<div class="pn-title">${E.period === 'end' ? 'Score final' : 'Statistiques'}</div><div class="lu">${col(0)}${col(1)}</div>`, 'lineups');
  }

  commentate(events, phase) {
    const E = this.engine;
    const live = phase.name === 'live' || phase.name === 'break' || phase.name === 'post';
    const say = (who, t, p = 2, ttl = 5000) => voice.say(who, t, p, { channel: 'basket', ttl });
    const tn = (t) => E.teams[t].data.name;
    for (const ev of events) {
      if (!live) continue;
      switch (ev.type) {
        case 'jump': say('pbp', `Entre-deux remporté par les ${tn(ev.team)}. C'est parti !`, 2); whistle(1); break;
        case 'score': {
          const s = ev.score;
          let t;
          if (ev.kind === 'dunk') t = pick([`SMASH de ${ev.name} !!`, `Quel dunk de ${ev.name} !`, `${ev.name} écrase le cercle !`]);
          else if (ev.pts === 3) t = pick([`À trois points... DEDANS ! ${ev.name} !`, `Bang ! ${ev.name} à trois points !`, `Ficelle de ${ev.name} derrière l'arc !`]);
          else if (ev.kind === 'layup') t = pick([`Double pas de ${ev.name}, panier !`, `${ev.name} finit en lay-up.`]);
          else t = pick([`${ev.name} à mi-distance, panier !`, `Joli shoot de ${ev.name}.`, `${ev.name} marque.`]);
          say('pbp', t, ev.kind === 'dunk' || ev.pts === 3 ? 3 : 2, 4000);
          if (Math.random() < 0.3) say('pbp', `${s[0]} à ${s[1]}.`, 1, 6000);
          if (ev.assist && Math.random() < 0.4) say('cons', `Belle passe de ${ev.assist} sur l'action.`, 1, 6000);
          if (ev.playerPts >= 20 && ev.playerPts - ev.pts < 20) say('cons', `${ev.name} franchit la barre des vingt points ce soir !`, 1, 8000);
          if (this.sound) this.sound.surge(ev.pts === 3 || ev.kind === 'dunk' ? 1 : 0.5, 2);
          this.swish = (E.dir(ev.team) > 0) ? 0 : 1;
          break;
        }
        case 'miss': if (Math.random() < 0.6) say('pbp', pick([`${ev.name} manque.`, `Raté pour ${ev.name}.`, `Ça ne rentre pas.`, `Sur le cercle !`]), 1, 2500); if (this.sound) this.sound.ohh(); break;
        case 'rebound': if (Math.random() < 0.4) say('pbp', ev.offensive ? `Rebond offensif de ${ev.name} !` : `Rebond ${ev.name}.`, 1, 2500); break;
        case 'steal': say('pbp', pick([`Interception de ${ev.name} !`, `${ev.name} vole le ballon !`]), 2, 3000); if (this.sound) this.sound.surge(0.6, 1.5); break;
        case 'block': say('pbp', pick([`CONTRE de ${ev.name} !`, `${ev.name} renvoie le tir de ${ev.victim} !`]), 3, 3000); if (this.sound) this.sound.surge(0.9, 2); break;
        case 'foul': whistle(1); say('pbp', `Faute de ${ev.name} sur ${ev.victim}${ev.andOne ? ', et le panier compte !' : `, ${ev.shots} lancers francs.`}`, 2, 4000); if (ev.fouls >= 4) say('cons', `Attention, c'est déjà sa ${ev.fouls}e faute.`, 1, 6000); break;
        case 'ft': if (Math.random() < 0.6 || !ev.made) say('pbp', ev.made ? `Lancer franc réussi.` : `Lancer franc manqué.`, 1, 3000); break;
        case 'shotclock': whistle(1); say('pbp', 'Violation des vingt-quatre secondes !', 2, 3000); break;
        case 'drive': if (!voice.busy() && Math.random() < 0.4) say('pbp', `${ev.name} attaque le cercle...`, 1, 2000); break;
        case 'quarter_end':
          whistle(2);
          say('pbp', ev.quarter === 2 ? `C'est la mi-temps ! ${tn(0)} ${ev.score[0]}, ${tn(1)} ${ev.score[1]}.` : ev.quarter >= 4 ? `Fin du temps réglementaire !` : `Fin du ${ev.quarter === 1 ? 'premier' : 'troisième'} quart-temps, ${ev.score[0]} à ${ev.score[1]}.`, 3, 15000);
          if (this.sound) this.sound.applause(4, 0.8);
          break;
        case 'quarter_start': say('pbp', `Début du ${['', 'premier', 'deuxième', 'troisième', 'quatrième', 'prolongation'][Math.min(5, ev.quarter)]} ${ev.quarter > 4 ? '' : 'quart-temps'}.`, 2, 8000); break;
        case 'end': {
          const w = ev.score[0] > ev.score[1] ? 0 : 1;
          say('pbp', `C'est terminé ! Victoire des ${tn(w)}, ${Math.max(...ev.score)} à ${Math.min(...ev.score)} !`, 3, 20000);
          const top = E.topScorer(w);
          say('cons', `Grosse performance de ${top.d.name}, ${top.pts} points.`, 2, 20000);
          whistle(3);
          break;
        }
        default: break;
      }
    }
  }

  liveScore() {
    const E = this.engine;
    if (!E) return null;
    return { home: this.m.home, away: this.m.away, score: E.score, minute: E.period === 'end' ? 'Fin' : `Q${E.quarter}`, comp: 'Basket · Ligue Pro' };
  }
}

function lum(hex) { const n = parseInt(hex.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }
function dist(a, b) { const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16); return Math.hypot(((x >> 16) & 255) - ((y >> 16) & 255), ((x >> 8) & 255) - ((y >> 8) & 255), (x & 255) - (y & 255)); }
