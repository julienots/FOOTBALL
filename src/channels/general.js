// Chaîne généraliste ÉTOILE : grille réelle à l'heure du téléphone (journaux,
// météo avec vraies prévisions, jeu télévisé sur un grand plateau 3D,
// magazine sportif, télé-boutique), habillage, parrainages et publicités.
import { programAt, programsFrom, KIND_LABEL } from '../general/schedule.js';
import { makeEpisode, segAt, LETTERS, HOST, fmtEur } from '../general/quiz.js';
import { makeJT, ANCHOR, frDate } from '../general/news.js';
import { makeShop, PHONE, fmtPrice } from '../general/shop.js';
import { getWeather, CITIES, FRANCE, CORSICA, weatherIcon, weatherWord } from '../general/weather.js';
import { StudioView } from '../general/studio.js';
import { getStage } from '../tv/products.js';
import { AdBreak, pickSpots, SPOTS } from '../tv/ads.js';
import { voice } from '../audio/voice.js';
import { StadiumSound, audioCtx, sting, showSfx, jingle } from '../audio/audio.js';
import { el, esc, teamBadge } from '../tv/overlay.js';
import { COMP } from '../data/season.js';
import { RNG, hashStr } from '../core/rng.js';

const fmtTime = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const INTRO = { quiz: 12, meteo: 6, jt: 6, mag: 7, shop: 6 };
const SAY = { host: 'pbp', cand: 'cons', pbp: 'pbp', cons: 'cons' };
const QUIZ_THEME = { tempo: 132, key: 62, melody: [0, 7, 12, 7, 14, 12, 7, 4], bass: [0, 0, 5, 7], lead: 'sawtooth' };
const JT_THEME = { tempo: 100, key: 57, melody: [12, 0, 7, 0, 12, 14, 7, 0], bass: [0, -5, -3, -7], lead: 'triangle' };
const METEO_THEME = { tempo: 92, key: 65, melody: [0, 4, 7, 11, 12, 11, 7, 4], bass: [0, 5, 7, 5], lead: 'sine' };
const MAG_THEME = { tempo: 128, key: 60, melody: [0, 0, 7, 0, 10, 0, 12, 7], bass: [0, 0, 3, 5], lead: 'square' };
const pickBy = (arr, k) => arr[Math.abs(Math.floor(k)) % arr.length];

export class GeneralChannel {
  constructor(app, num) {
    this.app = app;
    this.id = 'etoile'; this.name = 'ÉTOILE'; this.color = '#ffb300'; this.num = num;
    this.root = el('div', 'et hidden');
    this.root.innerHTML = `<div class="et-full"></div><div class="et-quiz"></div><div class="et-l3"></div><div class="et-sub"></div><div class="et-tag"></div><div class="et-cover"></div>`;
    app.tvRoot.appendChild(this.root);
    this.full = this.root.querySelector('.et-full');
    this.quizEl = this.root.querySelector('.et-quiz');
    this.l3 = this.root.querySelector('.et-l3');
    this.sub = this.root.querySelector('.et-sub');
    this.tag = this.root.querySelector('.et-tag');
    this.cover = this.root.querySelector('.et-cover');
    this.ads = new AdBreak(app.tvRoot, 'ÉTOILE');
    this.keys = {};
    this.prog = null;
    this.viewer = this.loadViewer();
    this.quizEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-opt]');
      if (b && this.canPick) { this.pickOpt = { segT: this.curSeg.t, opt: +b.dataset.opt }; this.keys.quiz = null; showSfx('buzz'); }
    });
  }

  // ---------- grille ----------
  async epg(now, count = 6) {
    return programsFrom(now, count).map((p, i) => ({ start: p.start, end: p.end, title: p.title, sub: `${KIND_LABEL[p.kind]} · ${p.sub}`, live: i === 0 }));
  }
  liveScore() { return null; }

  loadViewer() { try { return { best: 0, played: 0, good: 0, ...JSON.parse(localStorage.getItem('etoile-quiz-v1') || '{}') }; } catch (e) { return { best: 0, played: 0, good: 0 }; } }
  saveViewer() { try { localStorage.setItem('etoile-quiz-v1', JSON.stringify(this.viewer)); } catch (e) { /* rien */ } }

  setProgram(p) {
    this.prog = p;
    const intro = INTRO[p.kind];
    p.intro = intro;
    p.content = p.dur - intro - p.brEnd - p.brMid;
    this.data = null; this.cues = []; this.cueIdx = -1; this.curSeg = null; this.lastCt = null; this.keys = {};
    if (p.kind === 'quiz') {
      const ep = makeEpisode(p.seed, p.content, p.dur >= 80 * 60);
      // scores affichés au début de chaque segment
      let cur = [0, 0, 0]; const alive = [true, true, true];
      for (const s of ep.segs) {
        if (s.type === 'round' && s.round === 2) cur = cur.map((v, i) => (alive[i] ? 0 : v));
        s.sc = [...cur]; s.alive = [...alive];
        if (s.type === 'q' && !s.final) cur = [...s.after];
        if (s.type === 'elim') alive[s.cand] = false;
      }
      this.data = ep;
      this.cues = this.quizCues(ep);
    } else if (p.kind === 'jt') {
      this.data = makeJT(p.seed, p.content, p.title, p.start);
      for (const s of this.data.segs) for (const c of s.cues || []) if (c.at < s.dur - 0.5) this.cues.push({ T: s.t + c.at, who: c.who, text: c.text });
    } else if (p.kind === 'shop') {
      this.data = makeShop(p.seed, p.content);
      for (const s of this.data.segs) for (const c of s.cues) this.cues.push({ T: s.t + c.at, who: c.who, text: c.text });
    } else if (p.kind === 'mag') {
      this.data = this.makeMag(p);
    } else if (p.kind === 'meteo') {
      this.data = this.makeMeteo(p);
      this.loadWeather(p);
    }
    this.cues.sort((a, b) => a.T - b.T);
    // coupure du milieu : au début d'un segment, vers la moitié du contenu
    p.midAt = Infinity;
    if (p.brMid && this.data?.segs) {
      const half = p.content / 2;
      let best = null;
      const ok = (s) => (p.kind === 'quiz' ? (s.type === 'q' && !s.final) || s.type === 'round' || s.type === 'chat' : p.kind === 'jt' ? s.type === 'lead' : true);
      for (const s of this.data.segs) if (ok(s) && (!best || Math.abs(s.t - half) < Math.abs(best.t - half))) best = s;
      p.midAt = best ? best.t : half;
    }
    if (this.view) { this.view.dispose(); this.view = null; }
    if (this.stopMusic) { this.stopMusic(); this.stopMusic = null; }
    this.full.innerHTML = ''; this.quizEl.innerHTML = ''; this.l3.innerHTML = ''; this.sub.innerHTML = '';
    voice.clear('etoile');
  }

  quizCues(ep) {
    const out = [];
    const add = (s, at, who, text) => { if (at < s.dur - 0.3) out.push({ T: s.t + at, who, text }); };
    const r = new RNG('qc-' + ep.seed);
    const GOOD = ['Bonne réponse !', 'C\'est exact !', 'Bravo, c\'est ça !', 'Parfait !', 'Exactement !', 'Oui, très bien !'];
    for (const s of ep.segs) {
      if (s.type === 'open') { add(s, 1.2, 'host', s.lines[0]); add(s, 8.5, 'host', s.lines[1]); }
      else if (s.type === 'cand' || s.type === 'chat') { add(s, 0.6, 'host', s.lines[0]); add(s, s.type === 'cand' ? 8.6 : 8, 'cand', s.lines[1]); }
      else if (s.type === 'round') add(s, 0.6, 'host', s.lines[0]);
      else if (s.type === 'elim') { add(s, 0.6, 'host', s.lines[0]); add(s, 10, 'cand', s.lines[1]); }
      else if (s.type === 'end') { add(s, 1, 'host', s.lines[0]); add(s, 13, 'host', s.lines[1]); }
      else if (s.type === 'q') {
        add(s, 0.3, 'host', `${s.final ? '' : s.pts === 20 ? `${s.theme}. ` : ''}${s.q}`);
        add(s, 4.4, 'host', `${LETTERS.slice(0, 3).map((l, i) => `${l} : ${s.opts[i]}`).join('. ')}. Ou D : ${s.opts[3]} ?`);
        s.ev.forEach((e, k) => {
          const c = ep.cands[e.cand];
          add(s, e.at, 'cand', e.kind === 'say' ? `Je dirais ${LETTERS[e.opt]}, ${s.opts[e.opt]}.` : `${LETTERS[e.opt]} ! ${s.opts[e.opt]} !`);
          const last = k === s.ev.length - 1;
          add(s, e.at + 2.6, 'host', e.ok ? `${r.pick(GOOD)}${s.final ? '' : ` ${c.first} marque ${s.pts} points.`}` : last ? `Eh non ! La bonne réponse était ${LETTERS[s.good]}, ${s.opts[s.good]}.` : `Non, ce n'est pas ça ! Qui d'autre ?`);
        });
        if (!s.ev.length) add(s, s.reveal, 'host', `Personne ne buzze ? Il fallait répondre ${s.opts[s.good]}.`);
      }
    }
    return out;
  }

  // Magazine sportif : rubriques de 45 s (données lues au moment de la diffusion)
  makeMag(p) {
    const kinds = ['res', 'table', 'debat', 'scorers', 'next', 'tennis', 'moteur', 'prono', 'live'];
    const segs = []; let t = 0;
    segs.push({ type: 'open', t: 0, dur: 14 }); t = 14;
    let k = new RNG('mag-' + p.seed).int(0, kinds.length - 1);
    while (t < p.content - 20) { const dur = Math.min(46, p.content - t); segs.push({ type: kinds[k % kinds.length], t, dur, k }); t += dur; k++; }
    segs.push({ type: 'bye', t, dur: p.content - t });
    return { segs };
  }

  makeMeteo(p) {
    const segs = []; let t = 0;
    const plan = [['now', 62], ['tomorrow', 62], ['temps', 54], ['days', 64]];
    for (const [type, dur] of plan) { if (t >= p.content - 10) break; segs.push({ type, t, dur: Math.min(dur, p.content - t) }); t += dur; }
    if (t < p.content) segs[segs.length - 1].dur += p.content - t;
    return { segs, wx: null };
  }

  async loadWeather(p) {
    const wx = await getWeather(p.dayNo);
    if (this.prog === p) { this.data.wx = wx; this.keys = {}; }
  }

  // ---------- découpage du temps d'antenne ----------
  phase(now) {
    const p = this.prog;
    const pt = (now - p.start) / 1000;
    if (pt >= p.dur - p.brEnd) return { name: 'ads', t: pt - (p.dur - p.brEnd), len: p.brEnd, seed: 7 };
    if (pt < p.intro) return { name: 'ident', t: pt };
    let ct = pt - p.intro;
    if (ct >= p.midAt && ct < p.midAt + p.brMid) return { name: 'ads', t: ct - p.midAt, len: p.brMid, seed: 3 };
    if (ct >= p.midAt + p.brMid) ct -= p.brMid;
    return { name: 'content', ct: Math.min(ct, p.content - 0.01) };
  }

  enter() {
    this.visible = true;
    this.app.overlay.setChannel('★ ÉTOILE', this.color);
    this.root.classList.remove('hidden');
    if (!this.sound && audioCtx()) this.sound = new StadiumSound();
    if (this.sound) { this.sound.fadeIn(); this.sound.setVolume(0); }
    this.lastCt = null; this.keys = {};
  }

  leave() {
    this.visible = false;
    this.root.classList.add('hidden');
    this.ads.close(); voice.stop();
    if (this.sound) this.sound.fadeOut();
    if (this.view) { this.view.dispose(); this.view = null; }
    if (this.stopMusic) { this.stopMusic(); this.stopMusic = null; }
    this.full.innerHTML = '';
    this.app.overlay.hideAll();
  }

  ensureView() {
    const p = this.prog;
    const mode = p.kind === 'quiz' ? 'quiz' : p.kind === 'mag' ? 'mag' : 'news';
    if (this.view && this.viewMode === mode && this.viewProg === p.start) return this.view;
    if (this.view) this.view.dispose();
    this.view = new StudioView(this.app.renderer, mode, this.app.settings.quality, { title: p.kind === 'mag' ? 'LE MAG DU SPORT' : p.title, host: HOST, cands: p.kind === 'quiz' ? this.data.cands : [] });
    this.viewMode = mode; this.viewProg = p.start;
    this.app.resizeView(this.view);
    this.wallKey = null;
    return this.view;
  }

  html(elm, key, fn) { if (this.keys[elm.className] !== key) { this.keys[elm.className] = key; elm.innerHTML = key == null ? '' : fn(); } }

  music(spec, dur) { if (this.stopMusic) this.stopMusic(); this.stopMusic = jingle(spec, dur); }

  update(dt, now) {
    const p0 = programAt(now);
    if (!this.prog || this.prog.start !== p0.start) this.setProgram(p0);
    if (!this.visible) return;
    const p = this.prog;
    this.app.hideLoader();
    const O = this.app.overlay;
    O.wallClock(new Date(now));
    const ph = this.phase(now);
    if (ph.name === 'ads') {
      this.ads.update(ph.t, pickSpots((hashStr(String(p.start)) % 9973) + ph.seed, ph.len), true);
      this.root.classList.add('hidden'); O.hideAll(); this.app.canvasVisible(false);
      if (this.sound) this.sound.setVolume(0);
      if (this.stopMusic) { this.stopMusic(); this.stopMusic = null; }
      this.lastCt = null;
      return;
    }
    this.ads.update(0, [], false);
    this.root.classList.remove('hidden');
    O.setTicker(null);
    O.setLive(p.kind === 'jt' || p.kind === 'meteo' ? 'EN DIRECT' : /Rediffusion/.test(p.sub) ? 'REDIFFUSION' : null);
    if (ph.name === 'ident') {
      this.app.canvasVisible(false);
      this.lowerThird(null); this.html(this.sub, null);
      if (this.quizEl.firstChild) { this.quizEl.innerHTML = ''; this.keys.quiz = null; }
      this.keys.full = null; this.keys['et-full'] = null;
      this.drawIdent(ph.t);
      return;
    }
    const ct = ph.ct;
    // voix programmées (on ne rattrape pas les répliques passées en zappant)
    if (this.lastCt == null || ct < this.lastCt || ct - this.lastCt > 3) {
      let lo = 0; while (lo < this.cues.length && this.cues[lo].T < ct - 1.2) lo++;
      this.cueIdx = lo;
    }
    while (this.cueIdx < this.cues.length && this.cues[this.cueIdx].T <= ct) {
      const c = this.cues[this.cueIdx++];
      voice.say(SAY[c.who] || 'pbp', c.text, c.who === 'cand' ? 2 : 1, { channel: 'etoile', ttl: 9000 });
    }
    const jumped = this.lastCt == null || Math.abs(ct - this.lastCt) > 3;
    this.lastCt = ct;
    if (p.kind === 'quiz') this.runQuiz(dt, ct, jumped);
    else if (p.kind === 'jt') this.runJT(dt, ct, jumped);
    else if (p.kind === 'mag') this.runMag(dt, ct, jumped);
    else if (p.kind === 'meteo') this.runMeteo(dt, ct, jumped);
    else this.runShop(dt, ct, jumped);
  }

  drawIdent(t) {
    const p = this.prog;
    const key = 'ident' + p.start + (t > (INTRO[p.kind] > 7 ? 6.5 : 99) ? 'b' : '');
    if (this.keys.ident !== key) {
      const first = !this.keys.ident || !this.keys.ident.startsWith('ident' + p.start);
      this.keys.ident = key;
      if (key.endsWith('b')) {
        // parrainage
        const sp = SPOTS[hashStr(p.seed) % 12];
        this.full.innerHTML = `<div class="et-bill" style="background:${sp.bg};color:${sp.fg}"><div class="eb-top">${esc(p.title)}</div><div class="eb-mid">est présenté par</div><div class="eb-brand">${sp.icon} ${esc(sp.brand)}</div><div class="eb-sl">${esc(sp.scenes[sp.scenes.length - 1].split('·').pop().trim())}</div></div>`;
        voice.say('ad', `${p.title} est présenté par ${sp.brand.toLowerCase()}.`, 1, { channel: 'etoile', ttl: 5000 });
      } else {
        this.full.innerHTML = `<div class="et-ident"><div class="ei-glow"></div><div class="ei-logo"><span class="ei-star">★</span>ÉTOILE</div><div class="ei-now">MAINTENANT</div><div class="ei-title">${esc(p.title)}</div><div class="ei-sub">${esc(p.sub)}</div></div>`;
        if (first && t < 2) sting('ident');
      }
    }
  }

  // ---------- LE GRAND QUIZ ----------
  runQuiz(dt, ct, jumped) {
    const ep = this.data;
    const s = segAt(ep, ct);
    const lt = ct - s.t;
    const v = this.ensureView();
    this.app.canvasVisible(true);
    if (s !== this.curSeg) this.enterQuizSeg(s, lt, jumped);
    this.curSeg = s;
    if (this.keys.full !== 'quiz') { this.keys.full = 'quiz'; this.full.innerHTML = ''; }
    // état des candidats
    const sc = [...s.sc];
    let active = -1, verdict = null, lights = 'idle', applause = false;
    const poses = {};
    let shot = 'wide', talk = -1;
    if (s.type === 'q') {
      for (const e of s.ev) {
        if (lt >= e.at) { active = e.cand; verdict = null; lights = 'buzz'; }
        if (lt >= e.at + 2.6) { verdict = e.ok; lights = e.ok ? 'ok' : 'ko'; if (e.ok && !s.final) sc[e.cand] += s.pts; }
      }
      if (active < 0 && lt > 6 && lt < s.reveal) lights = 'tension';
      if (lt >= s.reveal + 0.1 && !s.solved && active < 0) lights = 'ko';
      if (lt < 4) { shot = 'host'; talk = 0; }
      else if (active < 0) shot = lt < 9 ? 'cands' : 'wide';
      else shot = lt < (s.ev.at(-1).at + 5) ? `cand${active}` : 'wide';
      if (s.final) shot = lt < 4 ? 'host' : active >= 0 && lt < s.ev[0].at + 5 ? `cand${active}` : lt > 13 ? 'host' : 'cands';
      for (const e of s.ev) {
        if (lt >= e.at && lt < e.at + 2.6) poses[e.cand + 1] = 'buzz';
        else if (lt >= e.at + 2.6 && lt < e.at + 6) { poses[e.cand + 1] = e.ok ? 'joy' : 'sad'; if (e.ok) applause = true; }
      }
      if (lt >= s.reveal + 3) shot = s.final ? 'host' : 'wide';
    } else if (s.type === 'open') { shot = lt < 7 ? 'top' : 'host'; talk = 0; applause = lt < 7; lights = 'gold'; }
    else if (s.type === 'cand') { shot = lt < 8 ? 'host' : `cand${s.cand}`; talk = lt < 8 ? 0 : s.cand + 1; applause = lt > 11; if (lt > 11) poses[s.cand + 1] = 'clap'; }
    else if (s.type === 'chat') { shot = lt < 7.5 ? 'host' : `cand${s.cand}`; talk = lt < 7.5 ? 0 : s.cand + 1; }
    else if (s.type === 'round') { shot = 'top'; lights = 'gold'; talk = 0; }
    else if (s.type === 'elim') { shot = lt < 9 ? 'host' : `cand${s.cand}`; poses[s.cand + 1] = 'sad'; applause = lt > 12; talk = lt < 9 ? 0 : s.cand + 1; }
    else if (s.type === 'end') { shot = lt < 12 ? `cand${s.cand}` : lt < 22 ? 'host' : 'top'; lights = s.wins === 5 ? 'gold' : 'ok'; applause = true; poses[s.cand + 1] = 'joy'; talk = lt > 12 && lt < 22 ? 0 : -1; }
    const alive = s.alive;
    ep.cands.forEach((c, i) => {
      const out = !alive[i] || (s.type === 'elim' && s.cand === i && lt > 9);
      const st = out ? 'out' : i === active ? (verdict === null ? 'buzz' : verdict ? 'ok' : 'ko') : 'idle';
      v.setPodium(i, c.first, s.final || s.type === 'end' ? (i === ep.fin ? `${(s.type === 'end' ? s.wins : (lt >= s.reveal ? s.after[0] : s.before[0]))}/5` : '–') : sc[i], st);
      if (out && !poses[i + 1]) poses[i + 1] = 'sad';
    });
    if (this.sound) { this.sound.setVolume(applause ? 0.35 : 0.06); if (applause && !this._ap) this.sound.applause(4, 1); }
    this._ap = applause;
    // mur LED
    const wk = s.type === 'q' ? `q${s.t}${lt >= s.reveal ? 'r' : ''}` : s.type + s.t;
    if (wk !== this.wallKey) { this.wallKey = wk; this.drawQuizWall(v, s, lt); }
    v.render(dt, { shot, talk, poses, lights, applause, hostLook: 0 });
    this.drawQuizUI(s, lt, sc, active, verdict);
  }

  enterQuizSeg(s, lt, jumped) {
    if (lt > 1.5) return;
    if (s.type === 'open' || s.type === 'round' || s.type === 'end') this.music(QUIZ_THEME, s.type === 'end' ? 20 : 8);
    if (s.type === 'q') showSfx('whoosh');
    if (s.type === 'round') showSfx('reveal');
  }

  drawQuizWall(v, s, lt) {
    const ep = this.data;
    v.wall.draw((g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#12002e'); grd.addColorStop(0.5, '#2b0a66'); grd.addColorStop(1, '#00131f');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(124,77,255,0.35)'; g.lineWidth = 3;
      for (let i = 0; i < 24; i++) { g.beginPath(); g.arc(w / 2, h * 1.1, 80 + i * 60, Math.PI, 0); g.stroke(); }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = '#b388ff'; g.shadowBlur = 40;
      g.fillStyle = '#ffffff'; g.font = 'italic 900 150px Arial Black, Arial';
      g.fillText('LE GRAND QUIZ', w / 2, h * 0.36);
      g.shadowBlur = 20; g.font = 'bold 64px Arial'; g.fillStyle = '#ffd54f';
      const txt = s.type === 'q' ? (s.final ? 'LE COFFRE' : `${s.theme.toUpperCase()} · ${s.pts} POINTS`) : s.type === 'round' ? s.title.toUpperCase() : `CAGNOTTE ${fmtEur(ep.jackpot)}`;
      g.fillText(txt, w / 2, h * 0.62);
      g.shadowBlur = 0;
    });
  }

  drawQuizUI(s, lt, sc, active, verdict) {
    const ep = this.data;
    const showQ = s.type === 'q';
    const optsOn = showQ && lt >= 4;
    const firstBuzz = showQ && s.ev.length ? s.ev[0].at : (showQ ? s.reveal : 0);
    this.canPick = optsOn && lt < firstBuzz + 2 && lt < s.reveal;
    const pick = this.pickOpt && this.pickOpt.segT === s.t ? this.pickOpt.opt : -1;
    const revealed = showQ && lt >= s.reveal;
    // points du téléspectateur
    if (revealed && this.scoredT !== s.t) {
      this.scoredT = s.t;
      if (pick >= 0) {
        this.viewer.played++;
        if (pick === s.good) { this.viewer.good++; this.viewScore = (this.viewEp === ep.seed ? this.viewScore : 0) + (s.final ? 50 : s.pts); this.viewEp = ep.seed; this.viewer.best = Math.max(this.viewer.best, this.viewScore); }
        this.saveViewer();
      }
    }
    const vScore = this.viewEp === ep.seed ? this.viewScore : 0;
    const evShown = showQ ? s.ev.filter(e => lt >= e.at) : [];
    const timer = showQ && lt >= 6 && !evShown.length && lt < s.reveal ? Math.max(0, 1 - (lt - 6) / (s.reveal - 6)) : null;
    if (timer !== null && Math.floor(lt * 2) !== this._tick) { this._tick = Math.floor(lt * 2); if (lt > 12) showSfx('tick'); }
    const key = [s.t, optsOn, revealed, pick, evShown.map(e => e.cand + ':' + (lt >= e.at + 2.6)).join(','), sc.join('-'), vScore, this.canPick].join('|');
    if (this.keys.quiz !== key) {
      this.keys.quiz = key;
      const optCls = (i) => {
        const c = [];
        for (const e of evShown) if (e.opt === i) c.push(lt >= e.at + 2.6 ? (e.ok ? 'ok' : 'ko') : 'sel');
        if (revealed && i === s.good) c.push('ok');
        if (i === pick) c.push('mine');
        return c.join(' ');
      };
      const board = s.type === 'q' && s.final || s.type === 'end'
        ? `<div class="qz-board fin"><span>LE COFFRE</span><b>${esc(ep.cands[ep.fin].first)}</b><span>${s.type === 'end' ? s.wins : revealed ? s.after[0] : s.before[0]}/5</span><em>${fmtEur(ep.jackpot)}</em></div>`
        : `<div class="qz-board">${ep.cands.map((c, i) => `<div class="qz-c${s.alive[i] ? '' : ' out'}${i === active ? ' act' : ''}"><span>${esc(c.first)}</span><b>${sc[i]}</b></div>`).join('')}</div>`;
      let main = '';
      if (showQ) {
        main = `<div class="qz-q"><div class="qz-theme">${s.final ? 'FINALE · LE COFFRE' : esc(s.theme)}${s.final ? '' : ` · ${s.pts} pts`}</div><div class="qz-text">${esc(s.q)}</div>
          <div class="qz-opts${optsOn ? ' on' : ''}${this.canPick ? ' can' : ''}">${s.opts.map((o, i) => `<button class="qz-o ${optCls(i)}" data-opt="${i}"><i>${LETTERS[i]}</i><span>${esc(o)}</span></button>`).join('')}</div>
          <div class="qz-timer"><i></i></div>${this.canPick && pick < 0 ? '<div class="qz-hint">À vous de jouer : touchez une réponse !</div>' : ''}</div>`;
      } else if (s.type === 'round') {
        main = `<div class="qz-round"><div class="qr-t">${esc(s.title)}</div><div class="qr-s">${esc(s.sub)}</div>${s.themes ? `<div class="qr-th">${s.themes.map(esc).join(' · ')}</div>` : ''}</div>`;
      } else if (s.type === 'open') {
        main = `<div class="qz-logo"><b>LE GRAND QUIZ</b><span>Cagnotte : ${fmtEur(ep.jackpot)}</span></div>`;
      } else if (s.type === 'end') {
        main = `<div class="qz-round"><div class="qr-t">${esc(ep.cands[s.cand].name)}</div><div class="qr-s">${s.wins === 5 ? 'REMPORTE LA CAGNOTTE !' : `${s.wins}/5 bonnes réponses`}</div><div class="qr-prize">${fmtEur(s.prize)}</div></div>`;
      }
      const me = `<div class="qz-me">🏠 À la maison : <b>${vScore}</b> pts<small>record ${this.viewer.best}</small></div>`;
      this.quizEl.innerHTML = board + main + me;
      this.timerEl = this.quizEl.querySelector('.qz-timer i');
    }
    if (this.timerEl) { this.timerEl.style.width = `${(timer ?? 0) * 100}%`; this.timerEl.parentElement.style.opacity = timer === null ? 0 : 1; }
    // bandeau du bas : animateur ou candidat
    let l3 = null;
    if (s.type === 'open' && lt > 7) l3 = [HOST.name, 'Présentateur'];
    else if (s.type === 'cand' || s.type === 'chat' || s.type === 'elim') { const c = ep.cands[s.cand]; if (lt > 8) l3 = [c.name, `${c.age} ans · ${c.job} · ${c.city}`]; else if (s.type === 'cand') l3 = [HOST.name, 'Présentateur']; }
    this.lowerThird(l3);
  }

  lowerThird(l3, cls = '') {
    const key = l3 ? l3.join('|') + cls : null;
    this.html(this.l3, key, () => `<div class="l3 ${cls}"><b>${esc(l3[0])}</b><span>${esc(l3[1])}</span></div>`);
  }

  // ---------- JOURNAL ----------
  runJT(dt, ct, jumped) {
    const J = this.data;
    const s = segAt(J, ct);
    const lt = ct - s.t;
    const first = s !== this.curSeg;
    this.curSeg = s;
    const studio = s.type === 'hello' || s.type === 'lead' || s.type === 'sportIntro' || s.type === 'bye';
    this.app.canvasVisible(studio);
    if (s.type === 'gen' && first && lt < 1.5) this.music(JT_THEME, 9);
    if ((s.type === 'headline' || s.type === 'report') && first && lt < 1) showSfx('whoosh');
    if (studio) {
      const v = this.ensureView();
      const st = s.story;
      const wk = st ? st.title : s.type;
      if (this.wallKey !== wk) { this.wallKey = wk; this.drawNewsWall(v, st, s.type === 'sportIntro' ? 'SPORT' : s.type === 'bye' ? 'MÉTÉO' : null); }
      const idx = J.segs.indexOf(s);
      const shot = s.type === 'hello' ? (lt < 4 ? 'wide' : 'anchor') : s.type === 'bye' ? (lt < 8 ? 'anchor' : 'wide') : pickBy(['anchor', 'side', 'close', 'anchor'], idx);
      v.render(dt, { shot, talk: 0 });
      this.html(this.full, null, () => '');
    }
    // habillage
    if (s.type === 'gen') this.html(this.full, 'gen', () => `<div class="jt-gen"><div class="jg-rays"></div><div class="jg-logo"><span>★ ÉTOILE</span><b>${esc(J.title.toUpperCase())}</b></div><div class="jg-date">${esc(frDate(this.prog.start))}</div></div>`);
    else if (s.type === 'headline') this.html(this.full, 'h' + s.t, () => `<div class="jt-head" style="--c:${s.story.color}"><div class="jh-tag">LES TITRES</div><div class="jh-icon">${s.story.icon}</div><div class="jh-cat">${esc(s.story.cat)}</div><div class="jh-title">${esc(s.story.title)}</div></div>`);
    else if (s.type === 'report') this.drawReport(s, lt);
    else if (s.type === 'sport') this.drawSport(s, lt, first);
    // bandeaux
    let l3 = null;
    if (s.type === 'hello' && lt > 3) l3 = [ANCHOR, `${J.title} · ${frDate(this.prog.start)}`];
    else if (s.type === 'lead') l3 = [s.story.title.toUpperCase(), s.story.place];
    else if (s.type === 'report') l3 = lt < 7 ? [s.story.title, `Reportage : ${s.story.reporter}`] : lt >= (s.quoteAt ?? 1e9) && lt < (s.quoteAt ?? 0) + 7 ? [s.story.witness.split(',')[0], s.story.witness.split(', ')[1]] : null;
    else if (s.type === 'bye') l3 = ['À SUIVRE', `${fmtTime(this.prog.end)} · Météo`];
    this.lowerThird(l3, 'jt');
    // sous-titres pendant les reportages
    const cue = s.type === 'report' ? [...this.cues].reverse().find(c => c.T <= ct && c.T >= s.t) : null;
    const subKey = cue && ct - cue.T < 9 ? cue.text : null;
    this.html(this.sub, subKey, () => `<span>${esc(subKey)}</span>`);
    this.app.overlay.setTicker(this.prog.kind === 'jt' ? J.stories.slice(0, 8).map(x => x.title) : null);
  }

  drawNewsWall(v, st, word) {
    const [c1, c2] = v.palette;
    v.wall.draw((g, w, h) => {
      const col = st ? st.color : c1;
      const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#04070f'); grd.addColorStop(0.55, col); grd.addColorStop(1, '#04070f');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.globalAlpha = 0.18; g.strokeStyle = '#fff'; g.lineWidth = 2;
      for (let x = 0; x < w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y < h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.globalAlpha = 1;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      // le présentateur cache le centre : contenu sur les côtés
      if (st) {
        g.font = '120px serif'; g.fillText(st.icon, w * 0.39, h * 0.74);
        g.fillStyle = '#fff'; g.font = 'bold 40px Arial'; g.textAlign = 'left';
        const words = st.title.toUpperCase().split(' '); let line = ''; const lines = [];
        for (const wd of words) { if ((line + ' ' + wd).length > 13) { lines.push(line); line = wd; } else line = (line + ' ' + wd).trim(); }
        lines.push(line);
        lines.slice(0, 4).forEach((l, i) => g.fillText(l, w * 0.56, h * 0.66 + i * 46));
        g.fillStyle = c2; g.fillRect(w * 0.56, h * 0.58, 110, 7);
        g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = 'bold 26px Arial'; g.fillText(st.cat.toUpperCase(), w * 0.56, h * 0.545);
      } else {
        g.fillStyle = '#fff'; g.font = 'italic 900 60px Arial Black, Arial';
        g.textAlign = 'right'; g.fillText(word || '★ ÉTOILE', w * 0.445, h * 0.72);
        g.textAlign = 'left'; g.fillText(word ? '★ ÉTOILE' : this.prog.title.toUpperCase(), w * 0.555, h * 0.72);
      }
    });
    v.side.draw((g, w, h) => { g.fillStyle = c1; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'italic 900 64px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('★ ÉTOILE', w / 2, h / 2); });
  }

  drawReport(s, lt) {
    const st = s.story;
    this.html(this.full, 'r' + s.t, () => `<div class="jt-rep" style="--c:${st.color}"><div class="jr-bg"></div><div class="jr-pan"><div class="jr-icon">${st.icon}</div></div>
      <div class="jr-pin">📍 ${esc(st.place)}</div><div class="jr-fig"><b>${esc(st.fig[0])}</b><span>${esc(st.fig[1])}</span></div><div class="jr-cat">${esc(st.cat)}</div></div>`);
    const pan = this.full.querySelector('.jr-pan');
    if (pan) pan.style.transform = `scale(${1 + lt * 0.006}) translateX(${Math.sin(lt * 0.08) * 3}%)`;
    const fig = this.full.querySelector('.jr-fig');
    if (fig) fig.classList.toggle('on', lt > s.dur * 0.45 && lt < s.dur * 0.85);
  }

  sportData() {
    const info = this.app.channels.find(c => c.id === 'info');
    if (!info) return null;
    if (!info.data || Date.now() - (info._etAt || 0) > 120000) { info._etAt = Date.now(); info.refresh(); }
    return info.data;
  }

  drawSport(s, lt, first) {
    const d = this.sportData();
    const k = s.k ?? 0;
    const key = `sp${s.t}|${d ? (d.results || []).length + ':' + (d.table ? 1 : 0) : 0}`;
    let speech = null;
    this.html(this.full, key, () => {
      if (k === 0) {
        const list = (d?.results || []).slice(0, 6);
        const r = list[0];
        if (r) speech = `En football, ${r.info.home.name} ${r.res.score[0]}, ${r.info.away.name} ${r.res.score[1]}.${list[1] ? ` Et ${list[1].info.home.name} ${list[1].res.score[0]}, ${list[1].info.away.name} ${list[1].res.score[1]}.` : ''}`;
        return `<div class="js-wrap"><div class="jt-sport"><div class="js-h">⚽ LES RÉSULTATS</div>${list.map(({ info, res, comp }) => `<div class="js-r"><span class="js-c" style="background:${COMP[comp].color}">${esc(COMP[comp].short)}</span>${teamBadge(info.home, 20)}<span class="js-t">${esc(info.home.name)}</span><b>${res.score[0]} - ${res.score[1]}</b><span class="js-t r">${esc(info.away.name)}</span>${teamBadge(info.away, 20)}</div>`).join('') || '<div class="js-r">Résultats bientôt disponibles</div>'}</div></div>`;
      }
      if (k === 1 && d?.table) {
        const L = d.table[0];
        speech = L.j ? `En Ligue Élite, ${L.team.name} est leader avec ${L.pts} points, devant ${d.table[1].team.name}.` : 'La Ligue Élite reprend ses droits.';
        return `<div class="js-wrap"><div class="jt-sport"><div class="js-h">🏆 LIGUE ÉLITE · CLASSEMENT</div>${d.table.slice(0, 6).map((r, i) => `<div class="js-r"><span class="js-n">${i + 1}</span>${teamBadge(r.team, 20)}<span class="js-t">${esc(r.team.name)}</span><b>${r.pts} pts</b></div>`).join('')}</div></div>`;
      }
      const lives = this.app.channels.filter(c => c !== this && c.liveScore).map(c => ({ c, l: c.liveScore() })).filter(x => x.l);
      speech = lives.length ? `En ce moment sur nos chaînes de sport : ${lives.slice(0, 2).map(x => `${x.l.home.name} contre ${x.l.away.name}, ${x.l.score[0]} à ${x.l.score[1]}`).join(', et ')}.` : 'Retrouvez tous les matchs en direct sur nos chaînes de sport.';
      return `<div class="js-wrap"><div class="jt-sport"><div class="js-h">📺 EN CE MOMENT SUR NOS CHAÎNES</div>${lives.map(({ c, l }) => `<div class="js-r"><span class="js-c" style="background:${c.color}">${esc(c.name)}</span><span class="js-t">${esc(l.home.name)}</span><b>${l.score[0]} - ${l.score[1]}</b><span class="js-t r">${esc(l.away.name)}</span><small>${esc(l.minute)}</small></div>`).join('') || '<div class="js-r">Pas de match en cours</div>'}</div></div>`;
    });
    if (speech && first && lt < 3) voice.say('pbp', speech, 1, { channel: 'etoile', ttl: 20000 });
  }

  // ---------- MAGAZINE SPORTIF ----------
  runMag(dt, ct, jumped) {
    const M = this.data;
    const s = segAt(M, ct);
    const lt = ct - s.t;
    const first = s !== this.curSeg;
    this.curSeg = s;
    const d = this.sportData();
    const graphic = s.type !== 'open' && s.type !== 'bye' && s.type !== 'debat' && lt > 9 && lt < s.dur - 5;
    this.app.canvasVisible(!graphic);
    const say = (who, text, ttl = 25000) => voice.say(who, text, 1, { channel: 'etoile', ttl });
    if (first && lt < 2) {
      if (s.type === 'open') { this.music(MAG_THEME, 8); say('pbp', 'Bonjour à tous et bienvenue dans Le Mag du Sport ! Avec moi, comme toujours, Didier Lacombe.'); say('cons', 'Bonjour à tous, on a beaucoup de choses à se dire aujourd\'hui !'); }
      else if (s.type === 'bye') { say('pbp', 'C\'est la fin du Mag du Sport. Merci Didier !'); say('cons', 'Merci à vous, et bons matchs à tous sur nos chaînes !'); }
      else this.magSpeech(s, d, say);
    }
    if (!graphic) {
      const v = this.ensureView();
      if (this.wallKey !== s.type + s.t) { this.wallKey = s.type + s.t; this.drawNewsWall(v, null, s.type === 'open' || s.type === 'bye' ? 'LE MAG' : ({ res: 'RÉSULTATS', table: 'CLASSEMENT', debat: 'LE DÉBAT', scorers: 'BUTEURS', next: 'L\'AFFICHE', tennis: 'TENNIS', moteur: 'MOTEUR', prono: 'LE PRONO', live: 'EN DIRECT' }[s.type] || 'SPORT')); }
      const shot = s.type === 'open' ? (lt < 4 ? 'wide' : lt < 9 ? 'p0' : 'p1') : s.type === 'debat' ? pickBy(['p0', 'p1', 'wide', 'p0', 'p1', 'side'], Math.floor(lt / 6)) : lt < 5 ? 'p0' : 'p1';
      const talk = shot === 'p1' ? 1 : 0;
      v.render(dt, { shot, talk });
      this.html(this.full, null, () => '');
      this.lowerThird(s.type === 'open' && lt > 4 ? ['Le Mag du Sport', 'Jean-Marc Ferrand · Didier Lacombe'] : s.type === 'debat' ? ['LE DÉBAT', s.q || 'La question du jour'] : null, 'mag');
    } else {
      this.lowerThird(null);
      this.html(this.full, `mg${s.t}|${d ? 1 : 0}`, () => this.magGraphic(s, d));
    }
  }

  magSpeech(s, d, say) {
    const T = d?.table, S = d?.scorers, R = d?.results;
    const r = new RNG('ms-' + s.t + this.prog.seed);
    if (s.type === 'res' && R?.[0]) say('pbp', `Les résultats : ${R.slice(0, 3).map(x => `${x.info.home.name} ${x.res.score[0]}, ${x.info.away.name} ${x.res.score[1]}`).join('. ')}.`);
    else if (s.type === 'table' && T) { say('pbp', `Au classement de la Ligue Élite, ${T[0].team.name} est en tête avec ${T[0].pts} points.`); say('cons', r.pick([`${T[0].team.name} est très solide cette saison, difficile de voir qui peut les arrêter.`, `Attention à ${T[2].team.name}, troisième, qui revient très fort.`, `En bas de tableau, ${T[T.length - 1].team.name} est dans une situation très compliquée.`])); }
    else if (s.type === 'scorers' && S?.[0]) { say('pbp', `Chez les buteurs, ${S[0].player.name} mène avec ${S[0].goals} buts.`); say('cons', `Un joueur qui sent le but, il est toujours au bon endroit.`); }
    else if (s.type === 'debat' && T) {
      const a = T[r.int(0, 3)].team, b = T[r.int(4, 9)].team;
      s.q = `${b.name} peut-il viser le podium ?`;
      say('pbp', `Le débat du jour, Didier : est-ce que ${b.name} peut encore viser le podium ?`);
      say('cons', r.pick([`Honnêtement, je n'y crois pas. Ils manquent de régularité, surtout à l'extérieur.`, `Moi j'y crois ! L'équipe joue bien, il manque juste un peu de réussite devant le but.`]));
      say('pbp', r.pick([`Et ${a.name}, tu les vois champions ?`, `Pour toi, qui est le favori pour le titre ?`]));
      say('cons', `${a.name} a l'effectif pour, mais la saison est encore longue.`);
    } else if (s.type === 'next') say('pbp', 'L\'affiche à ne pas manquer, c\'est en direct sur Foot plus. Voici le programme de vos chaînes.');
    else if (s.type === 'tennis') { const tn = this.app.channels.find(c => c.id === 'tennis'); const m = tn?.matchup?.(tn.slotAt(this.app.now()).slot + 1); if (m) say('pbp', `Au tennis, prochain match sur Tennis plus : ${m.p1.name} face à ${m.p2.name}, au ${m.tournament}.`); }
    else if (s.type === 'moteur') say('pbp', 'Sur Moteur plus, un Grand Prix chaque heure ! Les pilotes sont prêts pour la prochaine course.');
    else if (s.type === 'prono' && T) { const a = T[r.int(0, 5)].team; say('pbp', `Didier, ton prono de la semaine ?`); say('cons', `Je vois bien une victoire de ${a.name}. Et n'oubliez pas, vous pouvez parier avec de l'argent fictif dans l'onglet Paris !`); }
    else if (s.type === 'live') say('pbp', 'Voici les scores en direct sur nos chaînes.');
  }

  magGraphic(s, d) {
    const T = d?.table, S = d?.scorers, R = d?.results;
    const box = (h, body) => `<div class="mg-wrap"><div class="mg-g"><div class="mg-h">${h}</div>${body}</div></div>`;
    if (s.type === 'res') return box('⚽ RÉSULTATS', (R || []).slice(0, 7).map(({ info, res, comp }) => `<div class="js-r"><span class="js-c" style="background:${COMP[comp].color}">${esc(COMP[comp].short)}</span>${teamBadge(info.home, 20)}<span class="js-t">${esc(info.home.name)}</span><b>${res.score[0]} - ${res.score[1]}</b><span class="js-t r">${esc(info.away.name)}</span>${teamBadge(info.away, 20)}</div>`).join('') || 'Chargement…');
    if (s.type === 'table' && T) return box('🏆 LIGUE ÉLITE', `<table class="tbl mg-tbl"><tbody>${T.slice(0, 10).map((r, i) => `<tr><td>${i + 1}</td><td class="tl">${teamBadge(r.team, 18)} ${esc(r.team.name)}</td><td>${r.j}</td><td>${r.bp - r.bc > 0 ? '+' : ''}${r.bp - r.bc}</td><td><b>${r.pts}</b></td></tr>`).join('')}</tbody></table>`);
    if (s.type === 'scorers' && S) return box('🥇 BUTEURS', S.slice(0, 8).map((x, i) => `<div class="js-r"><span class="js-n">${i + 1}</span><span class="js-t">${esc(x.player.name)}</span><small>${esc(this.app.world.teams[x.player.teamId].name)}</small><b>${x.goals}</b></div>`).join(''));
    if (s.type === 'next' || s.type === 'live' || !T) {
      const now = this.app.now();
      const rows = this.app.channels.filter(c => c !== this && c.id !== 'info').map(c => { const l = c.liveScore?.(); return `<div class="js-r"><span class="js-c" style="background:${c.color}">${esc(c.name)}</span>${l ? `<span class="js-t">${esc(l.home.name)}</span><b>${l.score[0]} - ${l.score[1]}</b><span class="js-t r">${esc(l.away.name)}</span><small>${esc(l.minute)}</small>` : '<span class="js-t">Programme en cours</span>'}</div>`; }).join('');
      void now;
      return box(s.type === 'live' ? '🔴 EN DIRECT' : '📺 SUR VOS CHAÎNES', rows);
    }
    if (s.type === 'tennis') { const tn = this.app.channels.find(c => c.id === 'tennis'); const sl = tn?.slotAt(this.app.now()); const ms = sl ? [0, 1, 2].map(i => ({ m: tn.matchup(sl.slot + i), at: sl.start + i * 7200000 + 300000 })) : []; return box('🎾 TENNIS+', ms.map(({ m, at }) => `<div class="js-r"><b>${fmtTime(at)}</b><span class="js-t">${esc(m.p1.name)} – ${esc(m.p2.name)}</span><small>${esc(m.tournament)} · ${esc(m.round)}</small></div>`).join('')); }
    if (s.type === 'moteur') { const rc = this.app.channels.find(c => c.id === 'racing'); return box('🏎️ MOTEUR+', `<div class="js-r"><span class="js-t">Un Grand Prix toutes les heures</span></div>${rc?.epg ? '<div class="js-r"><span class="js-t">Départ des courses à l\'heure pile</span></div>' : ''}`); }
    if (s.type === 'prono' && T) return box('🎯 LE PRONO', `<div class="js-r"><span class="js-t">Victoire de</span><b>${esc(T[new RNG('ms-' + s.t + this.prog.seed).int(0, 5)].team.name)}</b></div><div class="js-r"><small>Pariez avec de l'argent fictif dans l'onglet Paris</small></div>`);
    return box('LE MAG', 'Chargement…');
  }

  // ---------- MÉTÉO ----------
  runMeteo(dt, ct, jumped) {
    const M = this.data;
    const s = segAt(M, ct);
    const lt = ct - s.t;
    const first = s !== this.curSeg;
    this.curSeg = s;
    this.app.canvasVisible(false);
    this.lowerThird(null);
    const wx = M.wx;
    if (first && lt < 1.5 && s.type === 'now') this.music(METEO_THEME, 14);
    if (wx && this._wxSeg !== s.t + '|' + this.prog.start && lt < 4) { this._wxSeg = s.t + '|' + this.prog.start; this.meteoSpeech(s, wx); }
    const day = s.type === 'tomorrow' ? 1 : 0;
    const key = `wx${s.t}|${wx ? (wx.real ? 'r' : 'f') : 'x'}`;
    this.html(this.full, key, () => {
      if (!wx) return '<div class="wx"><div class="wx-h">MÉTÉO</div><div class="wx-load">Chargement des prévisions…</div></div>';
      const P = (lon, lat) => [(lon + 5.6) * 7.3 * 0.69 + 4, (51.6 - lat) * 7.3 + 3];
      const path = (pts) => 'M' + pts.map(([lo, la]) => P(lo, la).map(v => v.toFixed(1)).join(',')).join('L') + 'Z';
      const title = s.type === 'now' ? `Aujourd'hui · ${frDate(this.prog.start)}` : s.type === 'tomorrow' ? 'Demain' : s.type === 'temps' ? 'Températures maximales' : 'Les prochains jours';
      if (s.type === 'days') {
        const days = [1, 2, 3].map(k => new Date(this.prog.start + k * 86400000).toLocaleDateString('fr-FR', { weekday: 'long' }));
        return `<div class="wx"><div class="wx-h">${esc(title)}</div><div class="wx-days"><div class="wd-row wd-hd"><span></span>${days.map(d => `<b>${esc(d)}</b>`).join('')}</div>${wx.cities.filter((_, i) => i % 2 === 0 || i < 4).slice(0, 8).map(c => `<div class="wd-row"><span>${esc(c.name)}</span>${[1, 2, 3].map(k => `<i>${weatherIcon(c.days[k]?.code ?? 3)} <b>${c.days[k]?.max ?? '–'}°</b><small>${c.days[k]?.min ?? '–'}°</small></i>`).join('')}</div>`).join('')}</div>${wx.real ? '<div class="wx-src">Prévisions réelles · Open-Meteo</div>' : ''}</div>`;
      }
      const marks = wx.cities.map(c => {
        const [x, y] = P(c.lon, c.lat);
        const d = s.type === 'now' ? { code: c.now.code, t: c.now.temp } : { code: c.days[day]?.code ?? 3, t: c.days[day]?.max ?? '–' };
        const hot = typeof d.t === 'number' ? (d.t >= 25 ? '#e53935' : d.t >= 18 ? '#fb8c00' : d.t >= 10 ? '#fdd835' : d.t >= 3 ? '#4fc3f7' : '#1e88e5') : '#999';
        return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><text class="wm-i" y="-1.2">${s.type === 'temps' ? '' : weatherIcon(d.code)}</text><rect x="-3.2" y="${s.type === 'temps' ? -3 : 0.6}" width="6.4" height="3.6" rx="0.8" fill="${hot}"/><text class="wm-t" y="${s.type === 'temps' ? -0.3 : 3.3}">${d.t}°</text><text class="wm-n" y="${s.type === 'temps' ? 3.4 : 6}">${esc(c.name)}</text></g>`;
      }).join('');
      return `<div class="wx"><div class="wx-h">${esc(title)}</div><svg class="wx-map" viewBox="0 0 80 78" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="wxl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fbf73"/><stop offset="1" stop-color="#3d8b4a"/></linearGradient></defs><path d="${path(FRANCE)}" fill="url(#wxl)" stroke="#e8f5e9" stroke-width="0.4"/><path d="${path(CORSICA)}" fill="url(#wxl)" stroke="#e8f5e9" stroke-width="0.4"/>${marks}</svg>${wx.real ? '<div class="wx-src">Prévisions réelles · Open-Meteo</div>' : ''}</div>`;
    });
  }

  meteoSpeech(s, wx) {
    const C = wx.cities;
    const by = (n) => C.find(c => c.name === n);
    const say = (t) => voice.say('pbp', t, 1, { channel: 'etoile', ttl: 30000 });
    if (s.type === 'now') {
      const n = by('Lille'), m = by('Marseille'), pa = by('Paris');
      say(`Bonjour à tous. Aujourd'hui, on observe ${weatherWord(pa.now.code)} sur Paris, avec ${pa.now.temp} degrés en ce moment. Au nord, à Lille, ${weatherWord(n.now.code)}, et ${n.now.temp} degrés. Sur le pourtour méditerranéen, ${weatherWord(m.now.code)} à Marseille, ${m.now.temp} degrés.`);
    } else if (s.type === 'tomorrow') {
      const b = by('Brest'), l = by('Lyon'), t = by('Toulouse');
      say(`Pour demain, ${weatherWord(b.days[1].code)} attendu en Bretagne, avec ${b.days[1].max} degrés à Brest. Dans l'est, à Lyon, ${weatherWord(l.days[1].code)}, maximum ${l.days[1].max} degrés. Et à Toulouse, ${weatherWord(t.days[1].code)}, ${t.days[1].max} degrés l'après-midi.`);
    } else if (s.type === 'temps') {
      const sorted = [...C].sort((a, b) => b.days[0].max - a.days[0].max);
      say(`Côté températures, c'est à ${sorted[0].name} qu'il fera le plus chaud, avec ${sorted[0].days[0].max} degrés. Le plus frais, à ${sorted[sorted.length - 1].name} : ${sorted[sorted.length - 1].days[0].max} degrés.`);
    } else if (s.type === 'days') {
      const pa = by('Paris');
      say(`Et pour les prochains jours, à Paris : ${weatherWord(pa.days[2].code)} après-demain, avec ${pa.days[2].max} degrés. Très belle journée à tous, et à bientôt pour une nouvelle météo.`);
    }
  }

  // ---------- TÉLÉ-BOUTIQUE ----------
  runShop(dt, ct, jumped) {
    const S = this.data;
    const s = segAt(S, ct);
    const lt = ct - s.t;
    this.curSeg = s;
    this.app.canvasVisible(false);
    const it = s.it;
    const stage = getStage();
    const key = 'shop' + s.t;
    if (this.keys.full !== key || (stage && !this.full.contains(stage.canvas))) {
      this.keys.full = key;
      this.full.innerHTML = `<div class="shop" style="background:${it.bg};--fg:${it.fg}"><div class="sh-stage"></div>
        <div class="sh-tag">TÉLÉ-BOUTIQUE</div><div class="sh-name">${esc(it.name)}</div>
        <div class="sh-pts">${it.pts.map((x, i) => `<div class="sh-pt" data-i="${i}">✔ ${esc(x)}</div>`).join('')}</div>
        <div class="sh-price"><s>${fmtPrice(it.old)}</s><b>${fmtPrice(it.price)}</b><span>−${Math.round(100 - (it.price / it.old) * 100)} %</span></div>
        <div class="sh-call">📞 ${PHONE} <small>appel gratuit · numéro fictif</small></div>
        <div class="sh-stock">Plus que <b></b> en stock !</div></div>`;
      if (stage) { stage.setSpot({ brand: it.brand, product: it.kind, bg: it.bg, fg: it.fg, scenes: [it.name] }); this.full.querySelector('.sh-stage').appendChild(stage.canvas); }
      this.ptEls = [...this.full.querySelectorAll('.sh-pt')];
      this.stockEl = this.full.querySelector('.sh-stock b');
    }
    const pi = Math.floor(lt / 6) % it.pts.length;
    this.ptEls.forEach((e, i) => e.classList.toggle('on', i === pi));
    if (this.stockEl) this.stockEl.textContent = Math.max(3, Math.round(s.stock - lt * (s.stock / s.dur) * 0.9));
    if (stage) {
      const box = this.full.querySelector('.sh-stage');
      const r = box.getBoundingClientRect();
      if (r.width > 0) { stage.resize(Math.round(r.width), Math.round(r.height)); stage.render(lt % 8, Math.floor(lt / 8) % 4); }
    }
    this.lowerThird(null);
  }
}
