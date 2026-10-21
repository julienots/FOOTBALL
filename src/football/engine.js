// Moteur de simulation de football : 22 IA, ballon physique, arbitre.
// Entièrement déterministe (graine) pour que le "direct" soit reproductible :
// recalculer un match depuis le coup d'envoi donne exactement le même match.
import { RNG, clamp } from '../core/rng.js';
import { FORMATIONS, ROLE_LINE } from '../data/world.js';

export const HL = 52.5, HW = 34, GOAL_HW = 3.66, GOAL_H = 2.44, BALL_R = 0.11;
export const BOX_L = 16.5, BOX_HW = 20.16;
export const DT = 0.05;
const G = 9.81;

// Snapshot : par entité x, y, angle, vitesse, action, progression
export const ENT = 6;
export const N_ENT = 25; // 22 joueurs + arbitre + 2 assistants
export const SNAP_LEN = N_ENT * ENT + 3;

export const ACT = { NONE: 0, KICK: 1, HEAD: 2, DIVE_L: 3, DIVE_R: 4, CELEB: 5, THROW: 6, TACKLE: 7, FALL: 8, WALK: 9, HANDS: 10 };

const hyp = Math.hypot;

export class FootballMatch {
  constructor(opts) {
    const { home, away, seed, speed = 1, knockout = false, h2Offset = 64 * 60, record = true, kits } = opts;
    this.rng = new RNG(seed);
    this.k = speed;
    this.knockout = knockout;
    this.record = record;
    this.keepEvents = !!opts.keepEvents;
    // calibrage : en mode accéléré il y a moins de temps de jeu, on rend le jeu plus offensif
    const tune = { 1: [0.5, 0.05], 2: [0.4, 0.42], 3: [0.25, 0.65] }[speed] || [0.5, 0.05];
    this.SHOT_BIAS = opts.shotBias ?? tune[0];
    this.POS_NEAR = opts.posNear ?? tune[1];
    this.h2Offset = h2Offset; // secondes réelles entre coup d'envoi et 2e mi-temps
    this.teams = [this.mkTeam(home, 0, kits?.home), this.mkTeam(away, 1, kits?.away)];
    this.ball = { x: 0, y: 0, h: BALL_R, vx: 0, vy: 0, vh: 0, owner: null, inHands: false, shot: null, intended: null, lofted: false, spin: 0 };
    this.ref = { x: -6, y: 8, vx: 0, vy: 0, ang: 0, act: 0, actT: 0 };
    this.lines = [{ x: -20, y: HW + 1.2, vx: 0, vy: 0, ang: 0 }, { x: 20, y: -HW - 1.2, vx: 0, vy: 0, ang: 0 }];
    this.period = 'h1';
    this.time = 0; // temps réel écoulé dans la période
    this.wall = 0; // secondes réelles depuis le coup d'envoi
    this.tick = 0;
    this.score = [0, 0];
    this.pens = null;
    this.events = [];
    this.eventCursor = 0;
    this.stats = [this.mkStats(), this.mkStats()];
    this.stoppage = [0, 0];
    this.stoppageAnnounced = false;
    this.periodEndExtra = 0;
    this.lastTouch = null;
    this.prevTouch = null;
    this.possTeam = 0;
    this.state = 'kickoff';
    this.restart = null;
    this.halfEvents = 0;
    this.goalsLog = [];
    this.cards = [];
    this.highlights = [];
    this.excitement = 0;
    this.danger = 0;
    this.lastActionTick = 0;
    this.ring = record ? new Float32Array(SNAP_LEN * 260) : null;
    this.ringPos = 0;
    this.ringCount = 0;
    this.pendingClip = null;
    this.firstKickTeam = this.rng.chance(0.5) ? 0 : 1;
    this._presser = [null, null]; this._second = [null, null]; this._offLine = [0, 0];
    this.ballPred = [];
    for (let i = 0; i < 30; i++) this.ballPred.push({ x: 0, y: 0, h: 0 });
    this.setKickoff(this.firstKickTeam, true);
    this.emit('kickoff', { team: this.firstKickTeam, half: 1 });
  }

  mkStats() {
    return { poss: 0, shots: 0, onTarget: 0, passes: 0, passOk: 0, corners: 0, fouls: 0, yellow: 0, red: 0, offsides: 0, saves: 0, xg: 0, tackles: 0 };
  }

  mkTeam(data, idx, kit) {
    const form = FORMATIONS[data.formation];
    const players = form.map(([role, bx, by], i) => this.mkPlayer(data.squad[i], idx, i, role, bx, by));
    const bench = data.squad.slice(11).map((p) => p);
    return { idx, data, kit, players, bench, subsLeft: 3, subsMade: [] };
  }

  mkPlayer(data, team, slot, role, bx, by) {
    const a = data.attrs;
    return {
      data, team, slot, role, line: ROLE_LINE[role], isGK: role === 'GK',
      bx, by, x: 0, y: 0, vx: 0, vy: 0, ang: 0,
      vmax: 5.9 + (a.pac / 100) * 3.3,
      stamina: 1, yellow: 0, off: false,
      tx: 0, ty: 0, ts: 0.5,
      touchCd: 0, tackleCd: 0, decideCd: 0.3,
      act: 0, actT: 0, actDur: 0.4,
      plan: null, goals: 0, rating: 6.0,
    };
  }

  // ---------- Utilitaires ----------
  dirOf(team) {
    if (this.period === 'pens') return 1;
    const d = team === 0 ? 1 : -1;
    return this.period === 'h2' ? -d : d;
  }
  get clock() {
    const base = this.period === 'h2' || this.period === 'ft' || this.period === 'pens' || this.period === 'end' ? 2700 : 0;
    if (this.period === 'ht') return 2700 + this.stoppage[0] * 60;
    if (this.period === 'ft' || this.period === 'pens' || this.period === 'end') return this.ftClock || 5400;
    return base + this.time * this.k;
  }
  minute() {
    const c = this.clock;
    if (this.period === 'h1') return Math.min(45, Math.floor(c / 60) + 1);
    return Math.min(90, Math.floor(c / 60) + 1);
  }
  clockLabel() {
    const c = this.clock;
    const m = Math.floor(c / 60), s = Math.floor(c % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  allPlayers() {
    if (this._rosterDirty !== false) this.refreshRoster();
    return this._all;
  }
  onPitch(team) {
    if (this._rosterDirty !== false) this.refreshRoster();
    return this._on[team];
  }
  refreshRoster() {
    this._on = [this.teams[0].players.filter(p => !p.off), this.teams[1].players.filter(p => !p.off)];
    this._all = this._on[0].concat(this._on[1]);
    this._rosterDirty = false;
  }
  emit(type, data = {}) {
    const ev = { type, tick: this.tick, clock: this.clock, minute: this.minute(), period: this.period, ...data };
    this.events.push(ev);
    if (!this.keepEvents && this.events.length > 600) { this.events.splice(0, 200); this.eventCursor = Math.max(0, this.eventCursor - 200); }
    return ev;
  }
  pullEvents() {
    const out = this.events.slice(this.eventCursor);
    this.eventCursor = this.events.length;
    return out;
  }
  frameOf(team, x, y) { const d = this.dirOf(team); return [x * d, y * d]; }
  worldOf(team, fx, fy) { const d = this.dirOf(team); return [fx * d, fy * d]; }

  // ---------- Avance temporelle pilotée par la grille TV ----------
  // target = secondes réelles depuis le coup d'envoi ; renvoie true si terminé.
  syncTo(target, maxSteps = Infinity) {
    let n = 0;
    while (n < maxSteps) {
      if (this.period === 'end') return true;
      if (this.period === 'ht') {
        if (target >= this.h2Offset) { this.wall = this.h2Offset; this.startSecondHalf(); continue; }
        this.wall = target; return false;
      }
      if (this.period === 'ft') {
        if (this.knockout && this.score[0] === this.score[1]) {
          const startP = this.ftWall + (this.k === 1 ? 90 : 25);
          if (target >= startP) { this.wall = startP; this.startPens(); continue; }
          this.wall = target; return false;
        }
        this.period = 'end';
        this.emit('end', {});
        return true;
      }
      if (this.wall >= target) return false;
      this.step();
      n++;
    }
    return false;
  }

  step() {
    this.tick++;
    this.time += DT;
    this.wall += DT;
    for (const p of this.allPlayers()) {
      if (p.touchCd > 0) p.touchCd -= DT;
      if (p.tackleCd > 0) p.tackleCd -= DT;
      if (p.actT > 0) { p.actT -= DT; if (p.actT <= 0) p.act = 0; }
    }
    if (this.ref.actT > 0) { this.ref.actT -= DT; if (this.ref.actT <= 0) this.ref.act = 0; }
    if (this.period === 'pens') { this.stepPens(); this.snapshot(); return; }

    if (this.state === 'play') this.stepPlay();
    else if (this.state === 'celebrate') this.stepCelebrate();
    else this.stepDead();

    this.moveOfficials();
    this.stepBallPhysics();
    if (this.state === 'play') {
      this.checkControl();
      this.checkTackles();
      this.checkOut();
    }
    // statistiques de possession
    if (this.possTeam !== this._lastPoss) { this._lastPoss = this.possTeam; this.possStart = { x: this.ball.x, y: this.ball.y, tick: this.tick, team: this.possTeam }; }
    this.stats[this.possTeam].poss++;
    this.updateExcitement();
    this.checkPeriodEnd();
    this.snapshot();
  }

  // ---------- Coup d'envoi / mi-temps ----------
  setKickoff(team, immediate = false) {
    this.state = 'kickoff';
    const b = this.ball;
    Object.assign(b, { x: 0, y: 0, h: BALL_R, vx: 0, vy: 0, vh: 0, owner: null, inHands: false, shot: null, intended: null });
    for (const t of this.teams) {
      for (const p of t.players) {
        if (p.off) continue;
        const [fx, fy] = this.kickoffPos(p, t.idx === team);
        const [x, y] = this.worldOf(t.idx, fx, fy);
        if (immediate) { p.x = x; p.y = y; p.vx = p.vy = 0; }
        p.tx = x; p.ty = y; p.plan = null;
      }
    }
    const kt = this.onPitch(team);
    const taker = kt.find(p => p.line === 'FW') || kt[kt.length - 1];
    const d = this.dirOf(team);
    const mate = kt.filter(p => p !== taker).sort((a, c) => hyp(a.x, a.y) - hyp(c.x, c.y))[0];
    this.restart = { type: 'kickoff', team, x: 0, y: 0, taker, mate, timer: immediate ? 4 : 7 };
    taker.tx = -0.4 * d; taker.ty = 0.3;
    if (immediate) { taker.x = taker.tx; taker.y = taker.ty; }
    this.possTeam = team;
  }

  kickoffPos(p, kicking) {
    if (p.isGK) return [-HL + 3, 0];
    let fx = p.bx * 0.85 - 4;
    let fy = p.by * 0.9;
    fx = Math.min(fx, -1.2);
    if (!kicking) {
      const r = hyp(fx, fy);
      if (r < 9.6) { const s = 9.6 / Math.max(0.1, r); fx *= s; fy *= s; if (fx > -1) fx = -9.6; }
    }
    return [fx, fy];
  }

  startSecondHalf() {
    this.period = 'h2';
    this.time = 0;
    this.halfEvents = 0;
    this.stoppageAnnounced = false;
    this.periodEndExtra = 0;
    for (const p of this.allPlayers()) p.stamina = Math.min(1, p.stamina + 0.12);
    this.setKickoff(1 - this.firstKickTeam, true);
    this.emit('kickoff', { team: 1 - this.firstKickTeam, half: 2 });
  }

  checkPeriodEnd() {
    if (this.period !== 'h1' && this.period !== 'h2') return;
    const base = this.period === 'h1' ? 2700 : 5400;
    const c = this.clock;
    if (!this.stoppageAnnounced && c >= base - 60 * 1) {
      const idx = this.period === 'h1' ? 0 : 1;
      const raw = (this.period === 'h1' ? 1 : 2) + Math.floor(this.halfEvents / 3);
      this.stoppage[idx] = clamp(raw + (this.rng.chance(0.4) ? 1 : 0), this.period === 'h1' ? 1 : 2, this.period === 'h1' ? 3 : 5);
      this.stoppageAnnounced = true;
      this.emit('stoppage', { minutes: this.stoppage[idx] });
    }
    const idx = this.period === 'h1' ? 0 : 1;
    const end = base + this.stoppage[idx] * 60;
    if (c >= end) {
      this.periodEndExtra += DT;
      const b = this.ball;
      const calm = this.state !== 'play' || (Math.abs(b.x) < HL - 30) || this.periodEndExtra > 25;
      if (this.state === 'celebrate') return;
      if (calm) this.endPeriod();
    }
  }

  endPeriod() {
    this.refWhistle(3);
    this.stopWall = this.wall;
    if (this.period === 'h1') {
      this.period = 'ht';
      this.emit('halftime', { score: [...this.score] });
      this.state = 'dead';
      this.restart = null;
    } else {
      this.ftClock = this.clock;
      this.period = 'ft';
      this.ftWall = this.wall;
      this.state = 'dead';
      this.restart = null;
      this.emit('fulltime', { score: [...this.score] });
    }
    this.ball.owner = null;
  }

  refWhistle(n = 1) { this.ref.act = 1; this.ref.actT = 0.6; this.emit('whistle', { n }); }

  // ---------- Jeu courant ----------
  stepPlay() {
    const b = this.ball;
    // Prédiction de trajectoire pour les interceptions
    if (!b.owner) this.predictBall();
    const carrier = b.owner;
    if (carrier) {
      carrier.decideCd -= DT;
      if (carrier.decideCd <= 0) this.decideCarrier(carrier);
    }
    if (!b.owner && (this.tick % 2 === 0 || !this.chasers || this._chaseWasOwned)) this.assignChasers();
    else if (b.owner) { this.chasers = [null, null]; }
    this._chaseWasOwned = !!b.owner;
    for (let t = 0; t < 2; t++) {
      this._presser[t] = this.findPresser(t);
      this._second[t] = this._presser[t] ? this.findPresser(t, this._presser[t]) : null;
      this._offLine[t] = this.offsideLine(t);
    }
    for (const p of this.allPlayers()) {
      if (p === carrier) this.carrierMove(p);
      else this.offBallTarget(p);
    }
    this.movePlayers();
  }

  predictBall() {
    const b = this.ball;
    let x = b.x, y = b.y, h = b.h, vx = b.vx, vy = b.vy, vh = b.vh;
    const sub = 2, dt = 0.1 / sub;
    for (let i = 0; i < 30; i++) {
      for (let s = 0; s < sub; s++) {
        if (h > BALL_R + 0.01 || vh > 0) { vh -= G * dt; vx *= 0.999; vy *= 0.999; }
        else {
          const sp = hyp(vx, vy);
          if (sp > 0) { const ns = Math.max(0, sp - (1.6 + 0.28 * sp) * dt); vx *= ns / sp; vy *= ns / sp; }
        }
        x += vx * dt; y += vy * dt; h += vh * dt;
        if (h < BALL_R) { h = BALL_R; vh = vh < -1.5 ? -vh * 0.45 : 0; }
      }
      const P = this.ballPred[i]; P.x = x; P.y = y; P.h = h;
    }
  }

  // Pour chaque équipe : qui va chercher le ballon libre ?
  assignChasers() {
    const b = this.ball;
    this.chasers = [null, null];
    this.chaseAt = [null, null];
    if (b.owner) return;
    for (let t = 0; t < 2; t++) {
      let best = null, bestT = 99, bestPt = null;
      const cands = this.nearestN(t, b.x, b.y, 4);
      if (b.intended && b.intended.team === t && !b.intended.off && !cands.includes(b.intended)) cands.push(b.intended);
      for (const p of cands) {
        if (p.isGK && !this.inOwnBox(p.team, b.x, b.y) && hyp(p.x - b.x, p.y - b.y) > 6) continue;
        const sp = p.vmax * (0.75 + 0.25 * p.stamina);
        for (let i = 0; i < 30; i++) {
          const P = this.ballPred[i];
          const inBox = Math.abs(P.x) > HL - BOX_L - 2 && Math.abs(P.y) < BOX_HW + 2;
          const hLim = p.isGK && this.inOwnBox(p.team, P.x, P.y) ? 2.6 : inBox ? 2.3 : 1.15;
          if (P.h > hLim && i < 29) continue;
          const tt = (i + 1) * 0.1;
          const need = hyp(P.x - p.x, P.y - p.y) / sp + 0.15;
          if (p.isGK) { const [pfx, pfy] = this.frameOf(t, P.x, P.y); if (pfx > -HL + 8 || Math.abs(pfy) > 10) continue; }
          if (need <= tt || i === 29) {
            let tPen = tt + (i === 29 ? need : 0);
            if (b.intended === p) tPen -= 0.35;
            if (tPen < bestT) { bestT = tPen; best = p; bestPt = P; }
            break;
          }
        }
      }
      this.chasers[t] = best;
      this.chaseAt[t] = bestPt ? { x: bestPt.x, y: bestPt.y, t: bestT } : null;
    }
  }

  nearestN(t, x, y, n) {
    const arr = this.onPitch(t);
    const out = [];
    const ds = [];
    for (const p of arr) {
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      let i = out.length;
      while (i > 0 && ds[i - 1] > d) i--;
      if (i < n) { out.splice(i, 0, p); ds.splice(i, 0, d); if (out.length > n) { out.pop(); ds.pop(); } }
    }
    return out;
  }

  inOwnBox(team, x, y) {
    const [fx, fy] = this.frameOf(team, x, y);
    return fx < -HL + BOX_L && Math.abs(fy) < BOX_HW;
  }
  inOppBox(team, x, y) {
    const [fx, fy] = this.frameOf(team, x, y);
    return fx > HL - BOX_L && Math.abs(fy) < BOX_HW;
  }

  // Ligne du hors-jeu vue par l'équipe attaquante (dans son repère)
  offsideLine(team) {
    const d = this.dirOf(team);
    let m1 = -1e9, m2 = -1e9;
    for (const o of this.onPitch(1 - team)) {
      const v = o.x * d;
      if (v > m1) { m2 = m1; m1 = v; } else if (v > m2) m2 = v;
    }
    const second = m2 > -1e8 ? m2 : 0;
    return Math.max(second, this.ball.x * d, 0);
  }

  offBallTarget(p) {
    const b = this.ball;
    const T = p.team;
    const inPoss = this.possTeam === T;
    const [bfx, bfy] = this.frameOf(T, b.x, b.y);
    const [pfx, pfy] = this.frameOf(T, p.x, p.y);
    let fx, fy, speed = 0.5;

    if (!b.owner && this.chasers[T] === p && this.chaseAt[T]) {
      p.tx = this.chaseAt[T].x; p.ty = this.chaseAt[T].y; p.ts = 1.0;
      if (b.intended === p) p.ts = 0.9;
      return;
    }

    if (p.isGK) {
      this.gkTarget(p, inPoss, bfx, bfy);
      return;
    }

    const compress = inPoss ? 1.0 : 0.72;
    const offset = inPoss ? clamp(bfx * 0.62 + 13, -9, 40) : clamp(bfx * 0.72 + 2, -17, 30);
    fx = p.bx * compress + offset;
    fy = p.by * (inPoss ? 1.08 : 0.72) + bfy * (inPoss ? 0.18 : 0.38);
    if (p.line === 'DF' && !inPoss) fx = Math.min(fx, bfx - 3);

    if (inPoss) {
      const carrier = b.owner;
      // Appels en profondeur des attaquants
      if (p.line === 'FW') {
        const off = this._offLine[T] - 0.6 + (p.data.attrs.pac > 82 ? 0.3 : 0) + Math.sin(this.tick * 0.013 + p.slot) * 0.9;
        if (carrier && carrier !== p) {
          const [cfx] = this.frameOf(T, carrier.x, carrier.y);
          if (cfx > -10) fx = Math.max(fx, Math.min(off, HL - 6));
        }
        fx = Math.min(fx, off);
        speed = 0.8;
      }
      // Soutien court au porteur
      if (carrier && carrier !== p && p.line === 'MF') {
        const [cfx, cfy] = this.frameOf(T, carrier.x, carrier.y);
        const dd = hyp(cfx - fx, cfy - fy);
        if (dd > 18) { fx = fx * 0.6 + (cfx + 4) * 0.4; fy = fy * 0.6 + cfy * 0.4; }
      }
      // Montées des latéraux
      if ((p.role === 'DG' || p.role === 'DD' || p.role === 'PG' || p.role === 'PD') && bfx > 5 && Math.sign(bfy) === Math.sign(p.by)) {
        fx += 10; speed = 0.75;
      }
    } else {
      // Défense : pressing et marquage
      const carrier = b.owner;
      const presser = this._presser[T];
      const second = this._second[T];
      if (second === p && carrier && bfx < -20) {
        // couverture : se place entre le porteur et le but
        const [cfx, cfy] = this.frameOf(T, carrier.x, carrier.y);
        const dx = -HL - cfx, dy = -cfy, dl = hyp(dx, dy) || 1;
        const cov = Math.min(4, dl * 0.4);
        fx = cfx + dx / dl * cov; fy = cfy + dy / dl * cov;
        speed = 0.95;
      } else if (second === p && carrier && bfx < 15) {
        // second joueur : coupe la ligne de passe la plus proche
        const mate = this.nearestMate(carrier);
        const [cfx, cfy] = this.frameOf(T, carrier.x, carrier.y);
        if (mate) {
          const [mfx, mfy] = this.frameOf(T, mate.x, mate.y);
          fx = cfx * 0.55 + mfx * 0.45 - 1; fy = cfy * 0.55 + mfy * 0.45;
        } else { fx = cfx - 4; fy = cfy; }
        speed = 0.8;
      } else if (presser === p && carrier) {
        const gx = -HL;
        const ax = carrier.x, ay = carrier.y;
        const [cfx, cfy] = this.frameOf(T, ax, ay);
        const dx = gx - cfx, dy = -cfy, dl = hyp(dx, dy) || 1;
        fx = cfx + (dx / dl) * 0.9; fy = cfy + (dy / dl) * 0.9;
        speed = 0.95;
      } else {
        // Marquage : attaquant adverse le plus proche de la zone
        let best = null, bd = 13;
        const dT = this.dirOf(T);
        for (const o of this.onPitch(1 - T)) {
          if (o.isGK || o === carrier) continue;
          const ofx = o.x * dT, ofy = o.y * dT;
          const dz = hyp(ofx - fx, ofy - fy);
          if (dz < bd) { bd = dz; best = this._mk || (this._mk = [0, 0]); best[0] = ofx; best[1] = ofy; }
        }
        if (best && (p.line === 'DF' || p.line === 'MF')) {
          const danger = best[0] < -HL + 28;
          const w = danger ? 0.82 : p.line === 'DF' ? 0.55 : 0.4;
          const gx = best[0] - 2.2, gy = best[1] * 0.92;
          fx = fx * (1 - w) + gx * w; fy = fy * (1 - w) + gy * w;
        }
        speed = 0.65;
      }
    }

    fx = clamp(fx, -HL + 2, HL - 2);
    fy = clamp(fy, -HW + 1.2, HW - 1.2);
    // Petites variations pour éviter un placement trop mécanique
    if (speed < 0.9) {
      fy += Math.sin(this.tick * 0.021 + p.data.id) * 0.8;
      fx += Math.cos(this.tick * 0.017 + p.data.id * 1.7) * 0.8;
    }
    const [x, y] = this.worldOf(T, fx, fy);
    p.tx = x; p.ty = y;
    const dist = hyp(x - p.x, y - p.y);
    p.ts = speed >= 0.9 ? speed : dist > 10 ? Math.max(speed, 0.85) : dist > 4 ? Math.max(speed, 0.6) : speed * 0.7;
  }

  nearestMate(c) {
    let best = null, bd = 1e9;
    for (const m of this.onPitch(c.team)) {
      if (m === c || m.isGK) continue;
      const d = hyp(m.x - c.x, m.y - c.y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  // urgence de tirer : équipe menée en fin de match
  shotUrgency(T) {
    if (this.period !== 'h2') return 0;
    const diff = this.score[T] - this.score[1 - T];
    const min = this.clock / 60;
    return diff < 0 && min > 75 ? 0.08 : 0;
  }

  findPresser(T, exclude = null) {
    const b = this.ball;
    if (!b.owner || b.owner.team === T) return null;
    if (b.inHands) return null;
    let best = null, bd = 1e9;
    for (const p of this.onPitch(T)) {
      if (p.isGK || p === exclude) continue;
      const d = hyp(p.x - b.x, p.y - b.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  gkTarget(p, inPoss, bfx, bfy) {
    const b = this.ball;
    const T = p.team;
    let fx, fy;
    if (inPoss) {
      fx = -HL + (bfx > 0 ? 10 : 5); fy = bfy * 0.1;
    } else {
      const gx = -HL, gy = 0;
      const dx = bfx - gx, dy = bfy - gy, dl = hyp(dx, dy) || 1;
      const dist = clamp(0.8 + dl * 0.06, 0.8, 7);
      fx = gx + (dx / dl) * dist; fy = gy + (dy / dl) * dist;
      fy = clamp(fy, -GOAL_HW - 0.5, GOAL_HW + 0.5);
    }
    const [x, y] = this.worldOf(T, fx, fy);
    p.tx = x; p.ty = y;
    p.ts = hyp(x - p.x, y - p.y) > 3 ? 0.8 : 0.45;
  }

  // ---------- Porteur du ballon ----------
  carrierMove(p) {
    const b = this.ball;
    if (b.inHands) { p.ts = 0; p.tx = p.x; p.ty = p.y; this.movePlayer(p); return; }
    const plan = p.plan;
    if (plan && plan.type === 'dribble') {
      p.tx = plan.x; p.ty = plan.y;
      p.ts = plan.speed;
      // un défenseur bien placé devant ferme le chemin
      const dl = hyp(plan.x - p.x, plan.y - p.y) || 1;
      const ux = (plan.x - p.x) / dl, uy = (plan.y - p.y) / dl;
      for (const o of this.onPitch(1 - p.team)) {
        const dx = o.x - p.x, dy = o.y - p.y, dd = hyp(dx, dy);
        if (dd < 2.0 && (dx * ux + dy * uy) / (dd || 1) > 0.35) {
          p.ts = Math.min(p.ts, 0.42 + (p.data.attrs.dri - 70) / 200);
          // tentative d'élimination sur le côté
          const side = (dx * uy - dy * ux) > 0 ? 1 : -1;
          p.tx = p.x + ux * 2 + uy * side * 2.5; p.ty = p.y + uy * 2 - ux * side * 2.5;
          break;
        }
      }
    } else {
      p.tx = p.x + p.vx * 0.2; p.ty = p.y + p.vy * 0.2; p.ts = 0.3;
    }
  }

  decideCarrier(p) {
    const b = this.ball;
    const T = p.team, d = this.dirOf(T);
    const rng = this.rng;
    const [fx, fy] = this.frameOf(T, p.x, p.y);
    const opps = this.onPitch(1 - T);
    const mates = this.onPitch(T).filter(m => m !== p);
    let pressure = 99;
    for (const o of opps) pressure = Math.min(pressure, hyp(o.x - p.x, o.y - p.y));

    if (b.inHands) {
      // Le gardien relance à la main ou au pied
      if (!p.plan || p.plan.type !== 'hold') { p.plan = { type: 'hold', t: rng.range(2.5, 5) }; p.decideCd = 0.2; return; }
      p.plan.t -= 0.2;
      if (p.plan.t > 0) { p.decideCd = 0.2; return; }
      b.inHands = false;
    }

    const options = [];
    const a = p.data.attrs;
    const distG = hyp(HL - fx, fy);
    // Tir
    if (distG < 33 && fx > 10) {
      let q = this.shotQuality(fx, fy);
      if (fx > HL - 6 && Math.abs(fy) > 6) q *= 0.45; // angle trop fermé
      let blockers = 0;
      for (const o of opps) {
        if (o.isGK) continue;
        const [ofx, ofy] = this.frameOf(T, o.x, o.y);
        if (ofx < fx) continue;
        const t = clamp(((ofx - fx) * (HL - fx) + (ofy - fy) * (0 - fy)) / (distG * distG), 0, 1);
        const px = fx + (HL - fx) * t, py = fy + (0 - fy) * t;
        if (hyp(ofx - px, ofy - py) < 1.1) blockers++;
      }
      const s = q * Math.pow(0.5, blockers) * (0.7 + a.sho / 180) * 2.6 + (distG < 11 ? 0.2 : 0) - this.SHOT_BIAS - (distG > 25 ? 0.15 : 0) + (distG > 15 && distG < 25 && pressure > 3 ? 0.12 * a.sho / 85 : 0) - (pressure < 1.5 ? 0.1 : 0) + this.shotUrgency(T);
      options.push({ type: 'shoot', score: s });
    }
    // Passes
    for (const m of mates) {
      const [mfx, mfy] = this.frameOf(T, m.x, m.y);
      if (m.isGK && (fx > -25 || pressure > 4 || opps.some(o => hyp(o.x - m.x, o.y - m.y) < 14))) continue;
      const leads = [[m.x + m.vx * 0.45, m.y + m.vy * 0.45, false]];
      // passe en profondeur
      if (mfx > fx - 3 && (m.line === 'FW' || m.line === 'MF') && mfx > -5) {
        const space = this.spaceAhead(m, T);
        if (space > 6) {
          const [tx, ty] = this.worldOf(T, Math.min(mfx + Math.min(space - 3, 12), HL - 4), mfy * 0.9);
          leads.push([tx, ty, true]);
        }
      }
      for (const [tx, ty, through] of leads) {
        const dist = hyp(tx - p.x, ty - p.y);
        if (dist < 5 || dist > 55) continue;
        const [tfx, tfy] = this.frameOf(T, tx, ty);
        if (tfx > HL - 0.5 || Math.abs(tfy) > HW - 0.5) continue;
        const lofted = dist > 30 || (this.isCrossZone(fx, fy) && Math.abs(tfy) < 12 && tfx > HL - 16);
        const risk = this.passRisk(p, tx, ty, dist, lofted, opps);
        const gain = this.posValue(tfx, tfy) - this.posValue(fx, fy);
        let open = 99;
        for (const o of opps) open = Math.min(open, hyp(o.x - tx, o.y - ty));
        const succ = (1 - risk) * (0.82 + a.pas / 600) * (lofted ? 0.72 : 1) * (dist > 35 ? 0.85 : 1);
        const lossCost = tfx < -30 ? 2.6 : fx < -15 ? 1.4 : fx < 0 ? 0.95 : 0.6;
        if (tfx < -32) { let dz = 99; for (const o of opps) dz = Math.min(dz, hyp(o.x - tx, o.y - ty)); if (dz < 7) continue; }
        let s = succ * (0.42 + gain * 1.6 + Math.min(open, 9) * 0.025) - (1 - succ) * lossCost;
        if (through) s += 0.08 * (a.pas / 80);
        // centre en retrait depuis la ligne de but
        if (fx > HL - 12 && Math.abs(fy) > 7 && tfx > HL - 20 && tfx < fx && Math.abs(tfy) < 10) s += 0.25;
        if (tfx < fx - 8) s -= 0.12; // passe en retrait : moins prioritaire
        options.push({ type: 'pass', score: s, m, tx, ty, lofted, through, dist });
      }
    }
    // Dribble / conduite de balle
    {
      let dirx = HL - fx, diry = -fy * 0.6;
      let dl = hyp(dirx, diry) || 1; dirx /= dl; diry /= dl;
      let rx = 0, ry = 0, near = 0;
      for (const o of opps) {
        const [ofx, ofy] = this.frameOf(T, o.x, o.y);
        const dx = fx - ofx, dy = fy - ofy, dd = hyp(dx, dy);
        if (dd < 7 && dd > 0.01) { rx += (dx / dd) * (7 - dd) / 7; ry += (dy / dd) * (7 - dd) / 7; if (ofx > fx) near++; }
      }
      dirx += rx * 0.9; diry += ry * 1.3;
      dl = hyp(dirx, diry) || 1; dirx /= dl; diry /= dl;
      const step = 7;
      let nfx = clamp(fx + dirx * step, -HL + 1, HL - 1), nfy = clamp(fy + diry * step, -HW + 1, HW - 1);
      const gain = this.posValue(nfx, nfy) - this.posValue(fx, fy);
      let s = 0.25 + gain * 1.2 + (pressure > 5 ? 0.3 : pressure > 2.5 ? 0.05 : -0.3 + (a.dri - 70) / 120) - near * 0.14;
      const [wx, wy] = this.worldOf(T, nfx, nfy);
      options.push({ type: 'dribble', score: s, x: wx, y: wy, speed: pressure < 3 ? 0.88 : 0.78 });
    }
    // Dégagement
    if (fx < -HL + 30 && pressure < 4 && !p.isGK) {
      options.push({ type: 'clear', score: 0.28 + (4 - pressure) * 0.2 });
    }
    if (p.isGK) options.push({ type: 'clear', score: 0.35 + (pressure < 6 ? 0.4 : 0) });
    // Choix avec une part d'imprévisibilité
    const temp = 0.16 - (a.pas - 60) / 900;
    let best = null, bs = -1e9;
    for (const o of options) {
      const s = o.score + rng.normal(0, Math.max(0.05, temp));
      if (s > bs) { bs = s; best = o; }
    }
    if (this.debugDecisions && best.type === 'shoot') this.debugDecisions.push({ dist: Math.round(distG), pressure: +pressure.toFixed(1), opts: options.map(o => o.type[0] + o.score.toFixed(2)).sort((x, y) => parseFloat(y.slice(1)) - parseFloat(x.slice(1))).slice(0, 5).join(' ') });
    p.decideCd = pressure < 3 ? rng.range(0.18, 0.35) : rng.range(0.35, 0.75);
    if (best.type === 'shoot') this.shoot(p, 'open');
    else if (best.type === 'pass') this.pass(p, best.m, best.tx, best.ty, best.lofted, false, best.through);
    else if (best.type === 'clear') this.clearBall(p);
    else p.plan = { type: 'dribble', x: best.x, y: best.y, speed: best.speed };
  }

  isCrossZone(fx, fy) { return fx > HL - 22 && Math.abs(fy) > 12; }

  spaceAhead(m, T) {
    const [mfx, mfy] = this.frameOf(T, m.x, m.y);
    let sp = HL - mfx;
    for (const o of this.onPitch(1 - T)) {
      if (o.isGK) continue;
      const [ofx, ofy] = this.frameOf(T, o.x, o.y);
      if (ofx > mfx && Math.abs(ofy - mfy) < 6) sp = Math.min(sp, ofx - mfx);
    }
    return sp;
  }

  shotQuality(fx, fy) {
    const dist = hyp(HL - fx, fy);
    const ang = Math.atan2(GOAL_HW * 2 * (HL - fx), (HL - fx) * (HL - fx) + fy * fy - GOAL_HW * GOAL_HW);
    const a = ang < 0 ? ang + Math.PI : ang;
    return clamp(1.05 * a * Math.exp(-dist / 14), 0.005, 0.8);
  }

  posValue(fx, fy) {
    const t = clamp((fx + HL) / (2 * HL), 0, 1);
    const distG = hyp(HL - fx, fy);
    return t * t * 0.55 + (distG < 26 ? (26 - distG) / 26 * this.POS_NEAR : 0) - Math.abs(fy) / HW * 0.05;
  }

  passRisk(p, tx, ty, dist, lofted, opps) {
    const b = this.ball;
    const speed = lofted ? 18 : clamp(dist * 0.85 + 6, 9, 24);
    let keep = 1;
    const sx = b.x, sy = b.y;
    const dx = tx - sx, dy = ty - sy;
    for (const o of opps) {
      const ov = o.vmax * 0.9;
      if (!lofted) {
        const tr = ((o.x - sx) * dx + (o.y - sy) * dy) / (dist * dist);
        if (tr > 0.04) {
          const t = Math.min(1, tr);
          const px = sx + dx * t, py = sy + dy * t;
          const perp = hyp(o.x - px, o.y - py);
          const ballT = (t * dist) / speed + 0.05;
          const oppT = Math.max(0, perp - 0.8) / ov + 0.32;
          const r = oppT < ballT ? 0.6 : 0.6 * Math.exp(-(oppT - ballT) * 4);
          keep *= 1 - r;
        }
      }
      const dT = hyp(o.x - tx, o.y - ty);
      if (dT < 4) keep *= 1 - (lofted ? 0.42 : 0.3) * (1 - dT / 4);
    }
    return 1 - keep;
  }

  // Calcule la vitesse initiale d'une passe au sol pour arriver à vArr.
  groundSpeedFor(dist, vArr) {
    let lo = 2, hi = 40;
    for (let i = 0; i < 14; i++) {
      const v0 = (lo + hi) / 2;
      // intégration rapide
      let v = v0, s = 0;
      while (v > vArr && s < dist + 1) { const dt = 0.05; s += v * dt; v -= (1.6 + 0.28 * v) * dt; }
      if (s < dist) lo = v0; else hi = v0;
    }
    return (lo + hi) / 2;
  }

  kickBall(p, vx, vy, vh, act = ACT.KICK) {
    const b = this.ball;
    b.owner = null; b.inHands = false;
    b.vx = vx; b.vy = vy; b.vh = vh;
    b.h = Math.max(b.h, BALL_R);
    b.spin = hyp(vx, vy);
    this.prevTouch = this.lastTouch;
    this.lastTouch = { team: p.team, p };
    p.touchCd = 0.45;
    p.act = act; p.actT = 0.4;
    p.plan = null;
    this.lastActionTick = this.tick;
  }

  pass(p, m, tx, ty, lofted, setPiece = false, through = false) {
    const b = this.ball;
    const rng = this.rng;
    const a = p.data.attrs;
    const T = p.team;
    // Hors-jeu (vérifié au moment de la passe)
    if (!setPiece || (this.restart && this.restart.type === 'free')) {
      if (this.isOffside(m, T)) {
        const linesmanSees = rng.chance(0.93);
        if (linesmanSees) {
          this.kickBall(p, 0, 0, 0);
          this.stats[T].offsides++;
          this.emit('offside', { team: T, player: m.data.id, name: m.data.short });
          this.refWhistle();
          this.setRestart('free', 1 - T, m.x, m.y, { indirect: true });
          return;
        }
      }
    }
    const dist = hyp(tx - b.x, ty - b.y);
    const pressure = this.pressureOn(p);
    const err = (1 - a.pas / 100) * 0.11 * (pressure < 2 ? 1.5 : 1) * (lofted ? 1.25 : 1) + 0.008;
    const ang = Math.atan2(ty - b.y, tx - b.x) + rng.normal(0, err);
    const dd = dist * (1 + rng.normal(0, lofted ? 0.08 : 0.05));
    let vx, vy, vh;
    if (lofted) {
      const T0 = clamp(dd / 19, 0.9, 2.6);
      const sp = dd / T0;
      const hT = this.isCrossZone(...this.frameOf(T, b.x, b.y)) || setPiece ? 1.5 : 0.4;
      vh = (hT - b.h + 0.5 * G * T0 * T0) / T0;
      vx = Math.cos(ang) * sp; vy = Math.sin(ang) * sp;
    } else {
      const sp = clamp(this.groundSpeedFor(dd, through ? 5 : 6.5), 6, 26);
      vx = Math.cos(ang) * sp; vy = Math.sin(ang) * sp; vh = 0;
    }
    this.kickBall(p, vx, vy, vh);
    b.intended = m;
    b.passFrom = p;
    b.lofted = lofted;
    this.stats[T].passes++;
    const cross = lofted && this.isCrossZone(...this.frameOf(T, p.x, p.y));
    this.emit(cross ? 'cross' : 'pass', { team: T, from: p.data.id, to: m.data.id, fromName: p.data.short, toName: m.data.short, lofted, through, long: dist > 30, zone: this.zoneOf(T, tx, ty) });
  }

  isOffside(m, T) {
    const [mfx] = this.frameOf(T, m.x, m.y);
    if (mfx <= 0) return false;
    const [bfx] = this.frameOf(T, this.ball.x, this.ball.y);
    if (mfx <= bfx) return false;
    const opps = this.onPitch(1 - T).map(o => this.frameOf(T, o.x, o.y)[0]).sort((a, c) => c - a);
    const second = opps.length > 1 ? opps[1] : 0;
    return mfx > second + 0.3;
  }

  zoneOf(T, x, y) {
    const [fx] = this.frameOf(T, x, y);
    if (this.inOppBox(T, x, y)) return 'box';
    if (fx > HL - 30) return 'final';
    if (fx > 0) return 'opp';
    if (fx > -HL + 30) return 'own';
    return 'deep';
  }

  pressureOn(p) {
    let m = 99;
    for (const o of this.onPitch(1 - p.team)) m = Math.min(m, hyp(o.x - p.x, o.y - p.y));
    return m;
  }

  clearBall(p) {
    const rng = this.rng;
    const T = p.team;
    const [fx, fy] = this.frameOf(T, p.x, p.y);
    const [tx, ty] = this.worldOf(T, fx + rng.range(35, 55), clamp(fy + rng.range(-15, 15), -HW + 3, HW - 3));
    const dist = hyp(tx - p.x, ty - p.y);
    const T0 = clamp(dist / 21, 1.6, 2.8);
    const ang = Math.atan2(ty - p.y, tx - p.x);
    this.kickBall(p, Math.cos(ang) * dist / T0, Math.sin(ang) * dist / T0, 0.5 * G * T0);
    this.ball.intended = null;
    this.emit('clearance', { team: T, player: p.data.id, name: p.data.short });
  }

  shoot(p, kind = 'open') {
    const b = this.ball;
    const rng = this.rng;
    const a = p.data.attrs;
    const T = p.team, d = this.dirOf(T);
    const [fx, fy] = this.frameOf(T, b.x, b.y);
    const dist = hyp(HL - fx, fy);
    const pressure = kind === 'pen' ? 99 : this.pressureOn(p);
    const header = kind === 'header';
    const side = rng.chance(0.5) ? 1 : -1;
    let aimY = side * rng.range(1.0, 3.2);
    let aimH = header ? rng.range(0.3, 2.0) : (rng.chance(0.6) ? rng.range(0.15, 0.8) : rng.range(0.8, 2.2));
    if (kind === 'pen') { aimY = side * rng.range(1.4, 3.3); aimH = rng.chance(0.65) ? rng.range(0.2, 0.9) : rng.range(0.9, 2.2); }
    const skill = header ? (a.sho * 0.6 + a.phy * 0.4) : a.sho;
    const sd = (0.55 + dist * 0.085) * (1.45 - skill / 100) * (pressure < 1.5 ? 1.35 : 1) * (header ? 1.4 : 1) * (kind === 'pen' ? 0.55 : 1);
    const realY = aimY + rng.normal(0, sd);
    const realH = Math.max(0.05, aimH + rng.normal(0, sd * 0.55));
    const speed = header ? rng.range(11, 16) : (kind === 'pen' ? rng.range(19, 27) : 15 + (skill / 100) * 12 + rng.range(0, 4) - (dist < 10 ? 3 : 0));
    const gxW = d * HL, gyW = realY * d;
    const dx = gxW - b.x, dy = gyW - b.y;
    const hd = hyp(dx, dy);
    const T0 = hd / speed;
    const vh = (realH - b.h + 0.5 * G * T0 * T0) / T0;
    this.kickBall(p, (dx / hd) * speed, (dy / hd) * speed, vh, header ? ACT.HEAD : ACT.KICK);
    b.intended = null;
    // trajectoire réelle (rebonds, frottements) jusqu'à la ligne de but
    const cross = this.simulateCrossing(d);
    const onTarget = cross && Math.abs(cross.y) < GOAL_HW - 0.1 && cross.h < GOAL_H - 0.08;
    const T0c = cross ? cross.t : T0;
    const crossY = cross ? cross.y * d : realY, crossH = cross ? cross.h : realH;
    const xg = kind === 'pen' ? 0.76 : this.shotQuality(fx, fy) * (header ? 0.6 : 1);
    this.stats[T].shots++;
    this.stats[T].xg += xg * 0.5;
    b.shot = { team: T, p, onTarget, xg, kind, save: null, block: null, travelled: 0, dist: hd };
    this.danger = 1;
    // Contre d'un défenseur
    if (kind !== 'pen') {
      for (const o of this.onPitch(1 - T)) {
        if (o.isGK) continue;
        const t = clamp(((o.x - b.x) * dx + (o.y - b.y) * dy) / (hd * hd), 0, 1);
        if (t > 0.6 || t <= 0) continue;
        const px = b.x + dx * t, py = b.y + dy * t;
        if (hyp(o.x - px, o.y - py) < 1.25 && rng.chance(0.38 + o.data.attrs.def / 300)) {
          b.shot.block = { at: t * hd, o };
          break;
        }
      }
    }
    // Parade du gardien
    if (onTarget && !b.shot.block) {
      const gk = this.onPitch(1 - T).find(o => o.isGK);
      if (gk) {
        const tLine = T0c;
        const gkReach = 0.9 + 1.3 + (gk.data.attrs.gk / 100) * 1.5;
        const move = Math.max(0, tLine - 0.26) * 5.5;
        const [gfx, gfy] = this.frameOf(T, gk.x, gk.y);
        const need = hyp(crossY - gfy, Math.max(0, crossH - 1.1) * 0.7);
        let p0 = clamp((gkReach + move - need) / 1.4 + 0.62 - Math.max(0, 0.75 - tLine) * 0.4, 0.02, 0.95);
        // angle fermé : arrêt plus facile
        if (Math.abs(fy) > 8 && fx > HL - 8) p0 = Math.min(0.97, p0 + 0.15);
        if (kind === 'pen') p0 = clamp(0.22 + (gk.data.attrs.gk - 75) / 200 - (Math.abs(crossY) > 2.6 ? 0.15 : 0), 0.05, 0.4);
        if (gfx < HL - 8) p0 *= 0.4;
        b.shot.p0 = p0;
        if (this.debugSaves) this.debugSaves.push({ p0: +p0.toFixed(2), need: +need.toFixed(1), reach: +(gkReach + move).toFixed(1), gfx: +gfx.toFixed(1), t: +tLine.toFixed(2), dist: Math.round(dist) });
        if (rng.chance(p0)) {
          const catchIt = speed < 20 && need < 1.2 ? rng.chance(0.6) : rng.chance(0.2);
          b.shot.save = { gk, catchIt, y: crossY * d, h: crossH };
          const dirSide = crossY - gfy;
          gk.act = Math.abs(crossY - gfy) < 0.9 ? ACT.HANDS : (dirSide > 0 ? ACT.DIVE_L : ACT.DIVE_R);
          gk.actT = 1.1;
          const [wx, wy] = this.worldOf(T, HL - 0.6, crossY);
          gk.diveTo = { x: wx, y: wy, t: tLine };
        } else if (rng.chance(0.4)) {
          const dirSide = crossY - gfy;
          gk.act = dirSide > 0 ? ACT.DIVE_L : ACT.DIVE_R; gk.actT = 1.0;
          const [wx, wy] = this.worldOf(T, HL - 0.6, clamp(gfy + Math.sign(dirSide) * 1.6, -3.5, 3.5));
          gk.diveTo = { x: wx, y: wy, t: tLine };
        }
      }
    }
    this.emit('shot', { team: T, player: p.data.id, name: p.data.short, dist: Math.round(dist), onTarget, kind, xg, header });
  }

  // Simule le ballon libre jusqu'au franchissement de la ligne de but adverse
  simulateCrossing(d) {
    const b = this.ball;
    let x = b.x, y = b.y, h = b.h, vx = b.vx, vy = b.vy, vh = b.vh;
    for (let i = 0; i < 80; i++) {
      if (h > BALL_R + 0.01 || vh > 0) { vh -= G * DT; vx *= 0.9985; vy *= 0.9985; }
      else { const sp = hyp(vx, vy); if (sp > 0) { const ns = Math.max(0, sp - (1.6 + 0.28 * sp) * DT); vx *= ns / sp; vy *= ns / sp; } }
      const px = x;
      x += vx * DT; y += vy * DT; h += vh * DT;
      if (h < BALL_R) { h = BALL_R; if (vh < -1.5) { vh = -vh * 0.42; vx *= 0.68; vy *= 0.68; } else vh = 0; }
      if (x * d > HL) {
        const f = (HL - px * d) / ((x - px) * d || 1);
        return { y: y - vy * DT * (1 - f), h, t: (i + f) * DT };
      }
      if (Math.abs(y) > HW + 2) return null;
    }
    return null;
  }

  // ---------- Déplacements ----------
  movePlayers() {
    for (const p of this.allPlayers()) this.movePlayer(p);
    // séparation pour éviter que les joueurs se superposent
    const all = this.allPlayers();
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      for (let j = i + 1; j < all.length; j++) {
        const c = all[j];
        const dx = c.x - a.x, dy = c.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 0.64 && d2 > 1e-6) {
          const dd = Math.sqrt(d2), push = (0.8 - dd) * 0.5;
          const ux = dx / dd, uy = dy / dd;
          a.x -= ux * push; a.y -= uy * push; c.x += ux * push; c.y += uy * push;
        }
      }
    }
  }

  movePlayer(p) {
    if (p.diveTo && p.actT > 0 && (p.act === ACT.DIVE_L || p.act === ACT.DIVE_R || p.act === ACT.HANDS)) {
      const dx = p.diveTo.x - p.x, dy = p.diveTo.y - p.y;
      const dl = hyp(dx, dy);
      const sp = Math.min(dl / DT, 7.5);
      if (dl > 0.05) { p.vx = dx / dl * sp; p.vy = dy / dl * sp; } else { p.vx *= 0.5; p.vy *= 0.5; }
      p.x += p.vx * DT; p.y += p.vy * DT;
      return;
    }
    if (p.act === ACT.FALL && p.actT > 0) { p.vx *= 0.85; p.vy *= 0.85; p.x += p.vx * DT; p.y += p.vy * DT; return; }
    const vmax = p.vmax * (0.72 + 0.28 * p.stamina) * (this.ball.owner === p ? 0.9 : 1);
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const dist = hyp(dx, dy);
    let desired = vmax * p.ts;
    if (dist < 2.5) desired = Math.min(desired, dist * 1.4);
    let dvx = 0, dvy = 0;
    if (dist > 0.05) { dvx = (dx / dist) * desired; dvy = (dy / dist) * desired; }
    const acc = 7.5 * DT;
    let ax = dvx - p.vx, ay = dvy - p.vy;
    const al = hyp(ax, ay);
    if (al > acc) { ax = ax / al * acc; ay = ay / al * acc; }
    p.vx += ax; p.vy += ay;
    p.x += p.vx * DT; p.y += p.vy * DT;
    p.x = clamp(p.x, -HL - 4, HL + 4); p.y = clamp(p.y, -HW - 4, HW + 4);
    const sp = hyp(p.vx, p.vy);
    // orientation : vers la course, sinon vers le ballon
    let ta;
    if (sp > 0.8) ta = Math.atan2(p.vy, p.vx);
    else ta = Math.atan2(this.ball.y - p.y, this.ball.x - p.x);
    let da = ta - p.ang;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    p.ang += da * Math.min(1, 9 * DT);
    // fatigue (normalisée sur 90 minutes quel que soit le rythme)
    const r = sp / p.vmax;
    p.stamina = Math.max(0.35, p.stamina - (0.2 + r * r) * 1.15e-4 * this.k * DT * (1.15 - p.data.attrs.phy / 250));
  }

  moveOfficials() {
    const b = this.ball;
    const r = this.ref;
    // L'arbitre suit l'action en diagonale
    const tx = b.x * 0.85 - Math.sign(b.x || 1) * 6, ty = b.y * 0.6 + (b.y > 0 ? -9 : 9);
    this.moveSimple(r, tx, ty, 6.5);
    // Assistants : alignés sur l'avant-dernier défenseur de leur moitié
    for (let i = 0; i < 2; i++) {
      const L = this.lines[i];
      const sideX = i === 0 ? -1 : 1;
      let lineX = 0;
      // équipe qui défend cette moitié
      const defTeam = this.dirOf(0) === -sideX ? 0 : 1;
      let m1 = -1e9, m2 = -1e9;
      for (const o of this.onPitch(defTeam)) { const v = o.x * sideX; if (v > m1) { m2 = m1; m1 = v; } else if (v > m2) m2 = v; }
      lineX = Math.max(m2 > -1e8 ? m2 : 0, b.x * sideX, 0) * sideX;
      this.moveSimple(L, clamp(lineX, -HL, HL), L.y, 7);
    }
  }

  moveSimple(o, tx, ty, vmax) {
    const dx = tx - o.x, dy = ty - o.y, dist = hyp(dx, dy);
    let des = Math.min(vmax, dist * 1.2);
    let dvx = dist > 0.05 ? dx / dist * des : 0, dvy = dist > 0.05 ? dy / dist * des : 0;
    const acc = 5 * DT;
    let ax = dvx - o.vx, ay = dvy - o.vy;
    const al = hyp(ax, ay);
    if (al > acc) { ax = ax / al * acc; ay = ay / al * acc; }
    o.vx += ax; o.vy += ay;
    o.x += o.vx * DT; o.y += o.vy * DT;
    const sp = hyp(o.vx, o.vy);
    const ta = sp > 0.6 ? Math.atan2(o.vy, o.vx) : Math.atan2(this.ball.y - o.y, this.ball.x - o.x);
    let da = ta - o.ang;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    o.ang += da * Math.min(1, 6 * DT);
  }

  // ---------- Ballon ----------
  stepBallPhysics() {
    const b = this.ball;
    if (b.owner) {
      const p = b.owner;
      if (b.inHands) {
        b.x = clamp(p.x + Math.cos(p.ang) * 0.35, -HL + 0.3, HL - 0.3); b.y = p.y + Math.sin(p.ang) * 0.35; b.h = 1.1;
      } else {
        const sp = hyp(p.vx, p.vy);
        const lead = 0.45 + Math.min(0.6, sp * 0.09) + Math.sin(this.tick * 0.9) * 0.12 * Math.min(1, sp / 3);
        b.x = clamp(p.x + Math.cos(p.ang) * lead, -HL + 0.2, HL - 0.2); b.y = clamp(p.y + Math.sin(p.ang) * lead, -HW + 0.2, HW - 0.2); b.h = BALL_R;
      }
      b.vx = p.vx; b.vy = p.vy; b.vh = 0;
      return;
    }
    const px = b.x;
    if (b.h > BALL_R + 0.01 || b.vh > 0) {
      b.vh -= G * DT;
      b.vx *= 0.9985; b.vy *= 0.9985;
    } else {
      const sp = hyp(b.vx, b.vy);
      if (sp > 0) {
        const ns = Math.max(0, sp - (1.6 + 0.28 * sp) * DT);
        b.vx *= ns / sp; b.vy *= ns / sp;
      }
    }
    const stepLen = hyp(b.vx, b.vy) * DT;
    b.x += b.vx * DT; b.y += b.vy * DT; b.h += b.vh * DT;
    if (b.h < BALL_R) {
      b.h = BALL_R;
      if (b.vh < -1.5) { b.vh = -b.vh * 0.42; b.vx *= 0.68; b.vy *= 0.68; } else b.vh = 0;
    }
    // Filet : le ballon s'arrête dans le but
    if (Math.abs(b.x) > HL + 0.2 && Math.abs(b.y) < GOAL_HW && b.h < GOAL_H && this.state !== 'play') {
      if (Math.abs(b.x) > HL + 1.7) { b.x = Math.sign(b.x) * (HL + 1.7); b.vx *= -0.15; b.vy *= 0.5; }
    }
    // Contre / parade programmés
    const s = b.shot;
    if (s && this.state === 'play') {
      s.travelled += stepLen;
      if (s.block && s.travelled >= s.block.at) {
        const o = s.block.o;
        const rng = this.rng;
        b.vx = -b.vx * rng.range(0.1, 0.35) + rng.normal(0, 4); b.vy = b.vy * 0.3 + rng.normal(0, 5); b.vh = rng.range(0, 5);
        this.prevTouch = this.lastTouch; this.lastTouch = { team: o.team, p: o };
        o.act = ACT.TACKLE; o.actT = 0.4;
        this.emit('block', { team: o.team, player: o.data.id, name: o.data.short, shooter: s.p.data.short });
        b.shot = null;
      } else if (s.save) {
        const d = this.dirOf(s.team);
        if (b.x * d > HL - 0.75 || Math.sign(b.x - px) !== d) {
          const gk = s.save.gk;
          const rng = this.rng;
          this.stats[gk.team].saves++;
          this.stats[s.team].onTarget++;
          this.prevTouch = this.lastTouch; this.lastTouch = { team: gk.team, p: gk };
          if (s.save.catchIt) {
            b.owner = gk; b.inHands = true; b.vx = b.vy = b.vh = 0; b.intended = null;
            gk.plan = null; gk.decideCd = 0.3;
            this.possTeam = gk.team;
            this.emit('save', { team: gk.team, player: gk.data.id, name: gk.data.short, shooter: s.p.data.short, caught: true });
          } else {
            const r = rng.next();
            if (r < 0.3 && b.h > 0.9) { b.vx = d * 2.5; b.vy = rng.normal(0, 1.5); b.vh = Math.max(7, (3.5 - b.h) / 0.34 + 0.5); } // par-dessus la barre
            else if (r < 0.55) {
              const sy = Math.sign(b.y) || 1;
              const tCross = (HL - b.x * d + 0.1) / 3;
              b.vx = d * 3; b.vy = sy * Math.max(9, (4.6 - Math.abs(b.y)) / tCross + 3); b.vh = rng.range(1, 3);
            } // à côté du poteau
            else { b.vx = -d * rng.range(5, 11); b.vy = rng.normal(0, 7); b.vh = rng.range(0, 3); }
            this.emit('save', { team: gk.team, player: gk.data.id, name: gk.data.short, shooter: s.p.data.short, caught: false });
            this.captureClip('save', { team: gk.team, name: gk.data.short });
          }
          b.shot = null;
        }
      }
    }
  }

  checkControl() {
    const b = this.ball;
    if (b.owner) return;
    const rng = this.rng;
    const sp = hyp(b.vx, b.vy);
    // une frappe rapide n'est arrêtée que par la logique contre/parade
    if (b.shot && sp > 11) return;
    let best = null, bd = 1e9;
    for (const p of this.allPlayers()) {
      if (p.touchCd > 0) continue;
      const d = hyp(p.x - b.x, p.y - b.y);
      const reach = p.isGK && this.inOwnBox(p.team, b.x, b.y) ? 1.5 : 1.0;
      if (d > reach) continue;
      const hMax = p.isGK && this.inOwnBox(p.team, b.x, b.y) ? 2.7 : 2.5;
      if (b.h > hMax) continue;
      const score = d - (b.intended === p ? 0.5 : 0);
      if (score < bd) { bd = score; best = p; }
    }
    if (!best) return;
    const p = best;
    const a = p.data.attrs;
    const gkHands = p.isGK && this.inOwnBox(p.team, b.x, b.y) && !(this.lastTouch && this.lastTouch.team === p.team && this.lastTouch.p !== p && b.passFrom && b.passFrom.team === p.team);
    // tête (ou contrôle de la poitrine pour le receveur hors des surfaces)
    const boxZone = Math.abs(b.x) > HL - BOX_L - 2 && Math.abs(b.y) < BOX_HW + 2;
    if (b.h > 1.3 && !gkHands && (boxZone || b.h > 1.9 || b.intended !== p)) {
      this.header(p);
      return;
    }
    let pc;
    if (gkHands) pc = clamp(0.98 - Math.max(0, sp - 18) * 0.03 - (b.h > 2.2 ? 0.15 : 0) + (a.gk - 75) / 300, 0.45, 0.99);
    else pc = clamp(1.05 - Math.max(0, sp - 9) * 0.045 + (a.dri - 70) / 220 - (b.intended && b.intended.team !== p.team ? 0.05 : 0), 0.18, 0.99);
    if (rng.chance(pc)) {
      const prevTeam = this.lastTouch ? this.lastTouch.team : -1;
      b.owner = p; b.inHands = gkHands; b.vh = 0;
      if (b.shot && gkHands) {
        // arrêt "facile" en se plaçant bien
        this.stats[p.team].saves++; this.stats[b.shot.team].onTarget++;
        this.emit('save', { team: p.team, player: p.data.id, name: p.data.short, shooter: b.shot.p.data.short, caught: true });
      }
      b.shot = null;
      if (b.intended && b.intended.team === p.team && b.passFrom && b.passFrom.team === p.team && prevTeam === p.team) {
        this.stats[p.team].passOk++;
        this.lastPassTo = { from: b.passFrom, to: p, tick: this.tick };
      } else if (prevTeam !== -1 && prevTeam !== p.team) {
        this.emit('intercept', { team: p.team, player: p.data.id, name: p.data.short, zone: this.zoneOf(p.team, b.x, b.y) });
      }
      b.intended = null; b.passFrom = null;
      this.prevTouch = this.lastTouch;
      this.lastTouch = { team: p.team, p };
      this.possTeam = p.team;
      p.plan = null;
      p.decideCd = gkHands ? 0.4 : this.pressureOn(p) < 3 ? rng.range(0.15, 0.4) : rng.range(0.5, 1.3);
      if (gkHands) p.vx = p.vy = 0;
    } else {
      // contrôle raté : le ballon rebondit
      if (p.isGK && this.inOwnBox(p.team, b.x, b.y)) {
        const d = this.dirOf(p.team);
        b.vx = d * rng.range(3, 8); b.vy = rng.normal(0, 5); b.vh = rng.range(0.5, 3);
      } else {
        b.vx = b.vx * 0.4 + rng.normal(0, 2.5); b.vy = b.vy * 0.4 + rng.normal(0, 2.5); b.vh = rng.range(0, 1.5);
      }
      p.touchCd = 0.5;
      this.prevTouch = this.lastTouch;
      this.lastTouch = { team: p.team, p };
      b.shot = null;
    }
  }

  header(p) {
    const b = this.ball;
    const rng = this.rng;
    const T = p.team;
    const [fx, fy] = this.frameOf(T, b.x, b.y);
    this.emit('header', { team: T, player: p.data.id, name: p.data.short });
    if (fx > HL - 18 && Math.abs(fy) < 14 && rng.chance(0.75)) { this.shoot(p, 'header'); return; }
    if (fx < -HL + 25) {
      const [tx, ty] = this.worldOf(T, fx + rng.range(15, 28), fy + rng.range(-12, 12));
      const ang = Math.atan2(ty - b.y, tx - b.x), sp = rng.range(9, 14);
      this.kickBall(p, Math.cos(ang) * sp, Math.sin(ang) * sp, rng.range(3, 6), ACT.HEAD);
      b.intended = null;
      return;
    }
    // déviation vers un partenaire
    const mates = this.onPitch(T).filter(m => m !== p && !m.isGK);
    let m = mates.sort((a, c) => hyp(a.x - b.x, a.y - b.y) - hyp(c.x - b.x, c.y - b.y))[rng.int(0, 2)];
    const ang = Math.atan2(m.y - b.y, m.x - b.x) + rng.normal(0, 0.3);
    const sp = clamp(hyp(m.x - b.x, m.y - b.y) * 0.7, 5, 12);
    this.kickBall(p, Math.cos(ang) * sp, Math.sin(ang) * sp, rng.range(1, 3), ACT.HEAD);
    b.intended = m; b.passFrom = p;
  }

  checkTackles() {
    const b = this.ball;
    const c = b.owner;
    if (!c || b.inHands) return;
    const rng = this.rng;
    for (const o of this.onPitch(1 - c.team)) {
      if (o.tackleCd > 0 || o.isGK && !this.inOwnBox(o.team, b.x, b.y)) continue;
      const d = hyp(o.x - c.x, o.y - c.y);
      if (d > 1.35) continue;
      const boxDef = this.inOwnBox(o.team, c.x, c.y) || this.frameOf(o.team, c.x, c.y)[0] < -HL + 24;
      if (!rng.chance(boxDef ? 0.06 : 0.03)) continue;
      o.tackleCd = 1.3;
      o.act = ACT.TACKLE; o.actT = 0.5;
      this.stats[o.team].tackles++;
      const da = o.data.attrs, ca = c.data.attrs;
      // tacle par derrière ?
      const behind = Math.cos(c.ang) * (o.x - c.x) + Math.sin(c.ang) * (o.y - c.y) < -0.2;
      const style = this.teams[o.team].data.style === 'pressing' ? 0.025 : 0;
      const pFoul = clamp(0.06 + (100 - da.def) / 800 + (behind ? 0.08 : 0) + style + (c.data.star ? 0.02 : 0), 0.03, 0.25) * (o.yellow ? 0.5 : 1);
      if (rng.chance(pFoul * (this.inOwnBox(o.team, c.x, c.y) ? 0.2 : 1))) { this.foul(o, c, behind); return; }
      const pWin = clamp(0.5 + (da.def - ca.dri) / 100 - (behind ? 0.12 : 0) + (boxDef ? 0.14 : 0), 0.15, 0.88);
      if (rng.chance(pWin)) {
        this.prevTouch = this.lastTouch;
        this.lastTouch = { team: o.team, p: o };
        if (rng.chance(0.55)) {
          b.owner = o; o.decideCd = 0.2; o.plan = null; this.possTeam = o.team;
        } else {
          b.owner = null;
          const ang = rng.range(0, Math.PI * 2);
          b.vx = Math.cos(ang) * rng.range(3, 7); b.vy = Math.sin(ang) * rng.range(3, 7); b.vh = rng.range(0, 1.2);
          b.intended = null;
        }
        c.touchCd = 0.6;
        this.emit('tackle', { team: o.team, player: o.data.id, name: o.data.short, victim: c.data.short, zone: this.zoneOf(o.team, o.x, o.y) });
      } else {
        o.tackleCd = 1.0;
        this.emit('dribble', { team: c.team, player: c.data.id, name: c.data.short, victim: o.data.short });
      }
      return;
    }
  }

  foul(o, c, behind) {
    const rng = this.rng;
    const b = this.ball;
    this.stats[o.team].fouls++;
    this.halfEvents++;
    c.act = ACT.FALL; c.actT = 1.4;
    b.owner = null; b.vx = b.vy = 0;
    this.refWhistle();
    const inBox = this.inOwnBox(o.team, c.x, c.y);
    const [cfx, cfy] = this.frameOf(c.team, c.x, c.y);
    const lastMan = cfx > HL - 30 && Math.abs(cfy) < 20 && this.onPitch(o.team).filter(q => !q.isGK && this.frameOf(c.team, q.x, q.y)[0] > cfx).length === 0;
    this.emit('foul', { team: o.team, player: o.data.id, name: o.data.short, victim: c.data.short, victimId: c.data.id, inBox, zone: this.zoneOf(c.team, c.x, c.y) });
    let card = null;
    if (lastMan && rng.chance(0.3)) card = 'red';
    else if (rng.chance(behind ? 0.24 : 0.1)) card = 'yellow';
    else if (rng.chance(0.002)) card = 'red';
    if (card === 'yellow' && o.yellow >= 1) card = 'red2';
    if (card) this.giveCard(o, card);
    if (inBox) this.setRestart('penalty', c.team, 0, 0);
    else this.setRestart('free', c.team, c.x, c.y);
  }

  giveCard(p, card) {
    const T = p.team;
    this.ref.act = 2; this.ref.actT = 2.5; // carton brandi
    if (card === 'yellow') { p.yellow++; this.stats[T].yellow++; }
    else { this.stats[T].red++; p.off = true; p.sentOff = true; this._rosterDirty = true; if (this.ball.owner === p) this.ball.owner = null; }
    this.cards.push({ team: T, player: p.data.id, name: p.data.name, card, minute: this.minute() });
    this.emit('card', { team: T, player: p.data.id, name: p.data.short, fullName: p.data.name, card });
    this.halfEvents++;
  }

  // ---------- Sorties de balle ----------
  checkOut() {
    const b = this.ball;
    if (b.owner) return;
    // But ?
    if (Math.abs(b.x) > HL) {
      const side = Math.sign(b.x);
      const inGoal = Math.abs(b.y) < GOAL_HW - BALL_R && b.h < GOAL_H - BALL_R;
      const post = !inGoal && ((Math.abs(Math.abs(b.y) - GOAL_HW) < 0.22 && b.h < GOAL_H + 0.1) || (Math.abs(b.y) < GOAL_HW + 0.1 && Math.abs(b.h - GOAL_H) < 0.2));
      if (post && b.shot) {
        const shooter = b.shot.p;
        b.x = side * (HL - 0.05);
        b.vx = -b.vx * 0.55; b.vy = b.vy * 0.8 + this.rng.normal(0, 2); b.vh = Math.abs(b.vh) * 0.5;
        this.emit('post', { team: shooter.team, player: shooter.data.id, name: shooter.data.short, bar: Math.abs(b.h - GOAL_H) < 0.25 });
        this.captureClip('post', { team: shooter.team, name: shooter.data.short });
        this.stats[shooter.team].onTarget += 0;
        b.shot = null;
        return;
      }
      if (inGoal) { this.goal(side); return; }
      // sortie derrière la ligne de but
      const defTeam = this.dirOf(0) === side ? 1 : 0; // équipe qui défend ce but
      const lt = this.lastTouch ? this.lastTouch.team : 1 - defTeam;
      if (b.shot) {
        this.emit('miss', { team: b.shot.team, player: b.shot.p.data.id, name: b.shot.p.data.short, wide: Math.abs(b.y) > GOAL_HW, xg: b.shot.xg });
        if (b.shot.xg > 0.2) this.captureClip('miss', { team: b.shot.team, name: b.shot.p.data.short });
      }
      b.shot = null;
      this.refWhistle();
      if (lt === defTeam) {
        this.stats[1 - defTeam].corners++;
        this.setRestart('corner', 1 - defTeam, side * HL, Math.sign(b.y || 1) * HW);
      } else {
        this.setRestart('goalkick', defTeam, side * (HL - 5.5), Math.sign(b.y || 1) * 4);
      }
      return;
    }
    if (Math.abs(b.y) > HW) {
      const lt = this.lastTouch ? this.lastTouch.team : 0;
      b.shot = null;
      this.setRestart('throw', 1 - lt, clamp(b.x, -HL + 1, HL - 1), Math.sign(b.y) * HW);
    }
  }

  goal(side) {
    const b = this.ball;
    const scoringTeam = this.dirOf(0) === side ? 0 : 1;
    const lt = this.lastTouch;
    const ownGoal = lt && lt.team !== scoringTeam;
    const scorer = lt ? lt.p : null;
    this.score[scoringTeam]++;
    this.halfEvents += 2;
    if (b.shot) this.stats[scoringTeam].onTarget++;
    let assist = null;
    if (!ownGoal && this.lastPassTo && this.lastPassTo.to === scorer && this.tick - this.lastPassTo.tick < 300 && this.lastPassTo.from.team === scoringTeam) assist = this.lastPassTo.from;
    if (scorer && !ownGoal) { scorer.goals++; scorer.rating += 1.0; }
    if (assist) assist.rating += 0.5;
    const rec = {
      team: scoringTeam, scorer: scorer ? scorer.data.id : null, name: scorer ? scorer.data.short : '?',
      fullName: scorer ? scorer.data.name : '?', ownGoal, assist: assist ? assist.data.short : null,
      minute: this.minute(), clock: this.clock, period: this.period, score: [...this.score], header: b.shot && b.shot.kind === 'header', pen: b.shot && b.shot.kind === 'pen',
      dist: b.shot ? Math.round(b.shot.dist) : 0,
    };
    this.goalsLog.push(rec);
    b.shot = null; b.intended = null;
    b.vx *= 0.4; b.vy *= 0.4;
    this.emit('goal', rec);
    this.state = 'celebrate';
    this.celebT = this.k === 1 ? 42 : 16;
    this.celebScorer = ownGoal ? null : scorer;
    this.celebTeam = scoringTeam;
    this.celebCorner = { x: side * (HL - 1), y: (b.y >= 0 ? 1 : -1) * (HW - 1) };
    this.excitement = 1;
    this.captureClip('goal', rec);
  }

  // ---------- Coups de pied arrêtés ----------
  setRestart(type, team, x, y, extra = {}) {
    const b = this.ball;
    b.owner = null; b.inHands = false; b.vx = b.vy = b.vh = 0; b.shot = null; b.intended = null;
    const d = this.dirOf(team);
    if (type === 'penalty') { x = d * (HL - 11); y = 0; }
    if (type === 'free') {
      // ne pas tirer un coup franc dans le but adverse depuis la ligne
      x = clamp(x, -HL + 1, HL - 1); y = clamp(y, -HW + 0.5, HW - 0.5);
    }
    b.x = x; b.y = y; b.h = BALL_R;
    const mates = this.onPitch(team);
    let taker;
    if (type === 'goalkick') taker = mates.find(p => p.isGK);
    else if (type === 'penalty') taker = [...mates].filter(p => !p.isGK).sort((a, c) => c.data.attrs.sho - a.data.attrs.sho)[0];
    else if (type === 'corner' || (type === 'free' && this.isDangerousFK(team, x, y))) taker = [...mates].filter(p => !p.isGK).sort((a, c) => (c.data.attrs.pas + c.data.attrs.sho) - (a.data.attrs.pas + a.data.attrs.sho))[0];
    else taker = [...mates].filter(p => !p.isGK || type === 'free' && this.inOwnBox(team, x, y)).sort((a, c) => hyp(a.x - x, a.y - y) - hyp(c.x - x, c.y - y))[0];
    if (!taker) taker = [...mates].sort((a, c) => hyp(a.x - x, a.y - y) - hyp(c.x - x, c.y - y))[0];
    const wait = { throw: [3, 6], corner: [9, 14], goalkick: [6, 10], free: [8, 14], penalty: [18, 26], kickoff: [5, 8] }[type];
    const timer = this.rng.range(wait[0], wait[1]) * (this.k === 1 ? 1 : 0.6);
    this.state = 'dead';
    this.restart = { type, team, x, y, taker, timer, ...extra };
    this.possTeam = team;
    if (type !== 'throw') this.halfEvents += type === 'penalty' ? 1 : 0;
    this.emit('restart', { rtype: type, team, x, y, taker: taker.data.short, takerId: taker.data.id, dangerous: type === 'free' && this.isDangerousFK(team, x, y) });
    if (type === 'corner') this.emit('corner', { team, taker: taker.data.short });
    if (type === 'penalty') this.emit('penalty', { team, taker: taker.data.short, takerId: taker.data.id });
    this.trySub();
  }

  isDangerousFK(team, x, y) {
    const [fx, fy] = this.frameOf(team, x, y);
    return hyp(HL - fx, fy) < 30 && fx > HL - 32;
  }

  stepDead() {
    const r = this.restart;
    if (this.period === 'ht' || this.period === 'ft' || this.period === 'end') {
      // Joueurs qui rentrent au vestiaire / se regroupent
      for (const p of this.allPlayers()) {
        p.tx = p.bx * 0.15 * this.dirOf(p.team); p.ty = -HW - 6; p.ts = 0.25;
        if (this.period !== 'ht') { p.tx = p.x * 0.98; p.ty = p.y * 0.98; p.ts = 0.1; }
        this.movePlayer(p);
      }
      return;
    }
    if (!r) { this.state = 'play'; return; }
    const b = this.ball;
    const taker = r.taker;
    if (taker.off) { r.taker = this.onPitch(r.team)[1]; return; }
    for (const p of this.allPlayers()) {
      if (p === taker) continue;
      this.setPieceTarget(p, r);
    }
    // le tireur se place
    const d = this.dirOf(r.team);
    let sx = r.x, sy = r.y;
    if (r.type === 'throw') { sy = r.y + Math.sign(r.y) * 0.4; }
    else if (r.type === 'corner') { sx = r.x + Math.sign(r.x) * 0.6; sy = r.y + Math.sign(r.y) * 0.6; }
    else if (r.type === 'kickoff') { sx = r.x - d * 0.4; }
    else { sx = r.x - d * 1.2; sy = r.y - Math.sign(r.y || 1) * 0.4; }
    if (r.type === 'penalty') { sx = r.x - d * 2.2; sy = 0.6; }
    taker.tx = sx; taker.ty = sy; taker.ts = 0.6;
    this.movePlayers();
    r.timer -= DT;
    b.owner = null;
    if (r.type === 'throw') { b.x = taker.x; b.y = Math.sign(r.y) * (HW - 0.15); b.h = 2.0; }
    if (r.timer <= 0 && hyp(taker.x - sx, taker.y - sy) < 1.2) this.executeRestart(r);
    else if (r.timer < -6) this.executeRestart(r);
  }

  setPieceTarget(p, r) {
    const T = p.team;
    const atk = T === r.team;
    const [bfx, bfy] = this.frameOf(T, r.x, r.y);
    let fx, fy, ts = 0.55;
    if (r.type === 'kickoff') {
      [fx, fy] = this.kickoffPos(p, atk);
      if (atk && p === r.mate) { fx = -1.5; fy = 3; }
    } else if (r.type === 'corner') {
      const s = Math.sign(bfy) || 1;
      if (atk) {
        const spots = [[HL - 4, 1.5 * s], [HL - 6, -2.5 * s], [HL - 11, 0], [HL - 8, 4 * s], [HL - 9, -6 * s], [HL - 18, 6], [HL - 19, -7], [6, 12], [4, -12], [-5, 0]];
        const order = this.onPitch(T).filter(q => !q.isGK && q !== r.taker).sort((a, c) => (c.data.attrs.phy + c.data.look.height * 30) - (a.data.attrs.phy + a.data.look.height * 30) || c.data.id - a.data.id);
        const i = order.indexOf(p);
        if (p.isGK) { fx = -HL + 18; fy = 0; } else [fx, fy] = spots[Math.min(i, spots.length - 1)];
      } else {
        const spots = [[-HL + 1, 2.8 * s], [-HL + 1.5, -3.3 * s], [-HL + 5, 2], [-HL + 5.5, -2], [-HL + 6, 5 * s], [-HL + 9, 0], [-HL + 7, -6 * s], [-HL + 11, 4], [-HL + 12, -4], [-HL + 18, 0], [-10, 8]];
        const order = this.onPitch(T).filter(q => !q.isGK).sort((a, c) => c.data.attrs.def - a.data.attrs.def || c.data.id - a.data.id);
        const i = order.indexOf(p);
        if (p.isGK) { fx = -HL + 0.8; fy = 0.5 * s; } else [fx, fy] = spots[Math.min(i + 0, spots.length - 1)];
      }
    } else if (r.type === 'penalty') {
      if (p.isGK && !atk) { fx = -HL + 0.2; fy = 0; }
      else {
        const k = (p.slot * 37 + p.team * 11) % 20 - 10;
        fx = atk ? HL - 20 - (p.slot % 3) : -HL + 20 + (p.slot % 3);
        fy = k * 1.7;
        if (p.isGK) { fx = -HL + 12; fy = 0; }
      }
    } else if (r.type === 'goalkick') {
      if (atk) { fx = p.bx * 0.9 + (p.line === 'DF' ? 4 : 10); fy = p.by * 1.15; if (p.isGK) { fx = -HL + 5; fy = bfy; } }
      else { fx = clamp(p.bx * 0.8 + 22, -10, HL - 20); fy = p.by; if (p.isGK) { fx = -HL + 6; fy = 0; } }
    } else {
      // touche / coup franc : placement normal, adversaires à distance
      this.offBallTarget(p);
      [fx, fy] = this.frameOf(T, p.tx, p.ty);
      if (r.type === 'free' && !atk) {
        const dangerous = this.isDangerousFK(r.team, r.x, r.y);
        const [gfx, gfy] = this.frameOf(T, r.x, r.y); // repère défenseur
        if (dangerous && !p.isGK) {
          // mur
          const wallers = this.onPitch(T).filter(q => !q.isGK).sort((a, c) => (hyp(a.x - r.x, a.y - r.y) - hyp(c.x - r.x, c.y - r.y)) || a.data.id - c.data.id).slice(0, 4);
          const wi = wallers.indexOf(p);
          if (wi >= 0) {
            const dx = -HL - gfx, dy = 0 - gfy, dl = hyp(dx, dy) || 1;
            const ux = dx / dl, uy = dy / dl;
            fx = gfx + ux * 9.15 + (-uy) * (wi - 1.5) * 0.7;
            fy = gfy + uy * 9.15 + ux * (wi - 1.5) * 0.7;
          }
        }
        const dd = hyp(fx - gfx, fy - gfy);
        if (dd < 9.15) { const s = 9.2 / Math.max(0.1, dd); fx = gfx + (fx - gfx) * s; fy = gfy + (fy - gfy) * s; }
      }
      if (r.type === 'free' && atk && this.isDangerousFK(r.team, r.x, r.y) && !p.isGK && p.line !== 'DF') {
        fx = Math.max(fx, HL - 15); fy = clamp(fy, -14, 14);
      }
    }
    fx = clamp(fx, -HL + 0.3, HL - 0.3); fy = clamp(fy, -HW + 0.4, HW - 0.4);
    const [x, y] = this.worldOf(T, fx, fy);
    p.tx = x; p.ty = y;
    const dist = hyp(x - p.x, y - p.y);
    p.ts = dist > 8 ? 0.75 : ts;
  }

  executeRestart(r) {
    const b = this.ball;
    const p = r.taker;
    const rng = this.rng;
    const T = r.team;
    this.state = 'play';
    this.restart = null;
    b.x = r.type === 'throw' ? p.x : r.x; b.y = r.type === 'throw' ? Math.sign(r.y) * (HW - 0.15) : r.y;
    b.h = r.type === 'throw' ? 2.0 : BALL_R;
    if (r.type === 'kickoff') {
      const m = r.mate;
      this.pass(p, m, m.x, m.y, false, true);
      return;
    }
    if (r.type === 'penalty') { this.refWhistle(); this.shoot(p, 'pen'); return; }
    const mates = this.onPitch(T).filter(m => m !== p);
    if (r.type === 'corner') {
      const targets = mates.filter(m => this.inOppBox(T, m.x, m.y));
      const m = targets.length ? rng.pick(targets) : rng.pick(mates);
      if (rng.chance(0.12)) { const short = mates.sort((a, c) => hyp(a.x - b.x, a.y - b.y) - hyp(c.x - b.x, c.y - b.y))[0]; this.pass(p, short, short.x, short.y, false, true); return; }
      this.pass(p, m, m.x + rng.normal(0, 1), m.y + rng.normal(0, 1), true, true);
      return;
    }
    if (r.type === 'free' && this.isDangerousFK(T, r.x, r.y) && !r.indirect && rng.chance(0.55)) {
      this.shoot(p, 'fk');
      const s = this.ball.shot;
      if (s && !s.block && rng.chance(0.3)) {
        const wall = this.onPitch(1 - T).filter(q => !q.isGK).sort((a, c) => hyp(a.x - b.x, a.y - b.y) - hyp(c.x - b.x, c.y - b.y))[0];
        if (wall) { s.block = { at: 9, o: wall }; s.save = null; }
      }
      return;
    }
    if (r.type === 'goalkick' && rng.chance(0.55)) {
      const fwd = mates.filter(m => m.line === 'FW' || m.line === 'MF');
      const m = rng.pick(fwd.length ? fwd : mates);
      this.pass(p, m, m.x, m.y, true, true);
      return;
    }
    // passe courte vers le partenaire le mieux placé
    let best = null, bs = -1e9;
    for (const m of mates) {
      const dist = hyp(m.x - b.x, m.y - b.y);
      if (r.type === 'throw' && dist > 22) continue;
      if (m.isGK && r.type !== 'free') continue;
      const risk = this.passRisk(p, m.x, m.y, dist, dist > 30, this.onPitch(1 - T));
      const [mfx, mfy] = this.frameOf(T, m.x, m.y);
      const s = (1 - risk) - dist * 0.004 + this.posValue(mfx, mfy) * 0.5 + rng.normal(0, 0.08);
      if (s > bs) { bs = s; best = m; }
    }
    if (!best) best = mates[0];
    const dist = hyp(best.x - b.x, best.y - b.y);
    if (r.type === 'throw') {
      const T0 = clamp(dist / 13, 0.5, 1.4);
      const ang = Math.atan2(best.y - b.y, best.x - b.x);
      this.kickBall(p, Math.cos(ang) * dist / T0, Math.sin(ang) * dist / T0, (0.6 - 2.0 + 0.5 * G * T0 * T0) / T0, ACT.THROW);
      b.intended = best; b.passFrom = p; this.stats[T].passes++;
      this.emit('throw', { team: T, player: p.data.id, name: p.data.short });
      return;
    }
    this.pass(p, best, best.x, best.y, dist > 32, true);
  }

  // ---------- Célébration ----------
  stepCelebrate() {
    const T = this.celebTeam;
    const s = this.celebScorer;
    const c = this.celebCorner;
    this.celebT -= DT;
    for (const p of this.allPlayers()) {
      if (p.team === T && !p.isGK) {
        if (p === s) { p.tx = c.x * 0.97; p.ty = c.y * 0.94; p.ts = 0.85; p.act = ACT.CELEB; p.actT = 0.3; }
        else {
          const ref = s || { x: c.x, y: c.y };
          const ang = p.slot * 0.6;
          p.tx = ref.x + Math.cos(ang) * 1.6; p.ty = ref.y + Math.sin(ang) * 1.6;
          p.ts = hyp(p.tx - p.x, p.ty - p.y) > 4 ? 0.8 : 0.3;
          if (hyp(p.tx - p.x, p.ty - p.y) < 3) { p.act = ACT.CELEB; p.actT = 0.3; }
        }
      } else {
        const [fx, fy] = this.kickoffPos(p, false);
        const [x, y] = this.worldOf(p.team, fx, fy);
        p.tx = x; p.ty = y; p.ts = 0.22;
      }
    }
    // dans la seconde moitié de la fête, retour vers le rond central
    if (this.celebT < (this.k === 1 ? 18 : 7)) {
      for (const p of this.onPitch(T)) {
        const [fx, fy] = this.kickoffPos(p, false);
        const [x, y] = this.worldOf(T, fx, fy);
        p.tx = x; p.ty = y; p.ts = 0.35; p.act = 0;
      }
    }
    this.movePlayers();
    if (this.celebT <= 0) {
      this.setKickoff(1 - T);
      this.emit('restart', { rtype: 'kickoff', team: 1 - T, x: 0, y: 0 });
    }
  }

  // ---------- Remplacements ----------
  trySub() {
    if (this.period !== 'h2') return;
    const min = this.clock / 60;
    if (min < 55 || min > 88) return;
    const rng = this.rng;
    for (const t of this.teams) {
      if (t.subsLeft <= 0 || !t.bench.length) continue;
      const window = t.subsLeft === 3 ? 58 : t.subsLeft === 2 ? 68 : 78;
      if (min < window || !rng.chance(0.35)) continue;
      const cands = t.players.filter(p => !p.off && !p.isGK && p !== this.restart?.taker && p !== this.ball.owner);
      if (!cands.length) continue;
      const out = cands.sort((a, c) => (a.stamina - c.stamina) || a.data.id - c.data.id)[0];
      const losing = this.score[t.idx] < this.score[1 - t.idx];
      let inIdx = t.bench.findIndex(b => b.line === out.line && b.line !== 'GK');
      if (losing) { const fw = t.bench.findIndex(b => b.line === 'FW'); if (fw >= 0) inIdx = fw; }
      if (inIdx < 0) inIdx = t.bench.findIndex(b => b.line !== 'GK');
      if (inIdx < 0) continue;
      const inData = t.bench.splice(inIdx, 1)[0];
      const np = this.mkPlayer(inData, t.idx, out.slot, out.role, out.bx, out.by);
      np.x = 0; np.y = (this.dirOf(t.idx) > 0 ? -1 : -1) * (HW + 0.5); np.ang = Math.PI / 2;
      t.players[out.slot] = np;
      this._rosterDirty = true;
      t.subsLeft--;
      t.subsMade.push({ out: out.data.name, in: inData.name, minute: this.minute() });
      this.halfEvents++;
      if (this.restart) this.restart.timer += 6;
      this.emit('sub', { team: t.idx, out: out.data.short, outFull: out.data.name, in: inData.short, inFull: inData.name, inId: inData.id });
    }
  }

  // ---------- Tirs au but ----------
  startPens() {
    this.period = 'pens';
    this.time = 0;
    this.pens = { score: [0, 0], kicks: [[], []], turn: this.rng.chance(0.5) ? 0 : 1, n: 0, timer: 6, phase: 'walk', done: false, winner: null };
    this.emit('pens_start', {});
    const b = this.ball;
    Object.assign(b, { x: HL - 11, y: 0, h: BALL_R, vx: 0, vy: 0, vh: 0, owner: null, shot: null });
    this.state = 'pens';
  }

  stepPens() {
    const P = this.pens;
    const b = this.ball;
    if (P.done) { this.moveOfficials(); return; }
    const T = P.turn;
    const shooters = this.onPitch(T).filter(p => !p.isGK).sort((a, c) => (c.data.attrs.sho - a.data.attrs.sho) || a.data.id - c.data.id);
    const shooter = shooters[P.kicks[T].length % shooters.length];
    const gk = this.onPitch(1 - T).find(p => p.isGK) || this.onPitch(1 - T)[0];
    // placement : tous dans le rond central sauf tireur et gardien
    for (const p of this.allPlayers()) {
      if (p === shooter || p === gk) continue;
      const ang = (p.slot + p.team * 11) / 22 * Math.PI * 2;
      if (p.isGK) { p.tx = HL - 20; p.ty = p.team ? 18 : -18; }
      else { p.tx = Math.cos(ang) * 6; p.ty = Math.sin(ang) * 6; }
      p.ts = 0.4;
    }
    gk.tx = HL - 0.2; gk.ty = 0; gk.ts = 0.5;
    if (P.phase === 'walk') {
      shooter.tx = HL - 13.5; shooter.ty = 0.8; shooter.ts = 0.4;
      b.x = HL - 11; b.y = 0; b.h = BALL_R; b.vx = b.vy = b.vh = 0; b.owner = null;
      P.timer -= DT;
      if (P.timer <= 0) {
        P.phase = 'shot'; P.timer = 3.5;
        this.ball.x = HL - 11; this.ball.y = 0;
        this.shoot(shooter, 'pen');
        P.current = { team: T, p: shooter };
      }
    } else if (P.phase === 'shot') {
      P.timer -= DT;
      // résolution
      let res = null;
      if (b.owner === gk || (!b.shot && b.x < HL - 2 && b.owner !== shooter)) res = 'saved';
      if (Math.abs(b.x) > HL) {
        if (Math.abs(b.y) < GOAL_HW - BALL_R && b.h < GOAL_H - BALL_R) res = 'goal';
        else res = 'miss';
      }
      if (!res && P.timer <= 0) res = 'saved';
      if (res) {
        P.kicks[T].push(res === 'goal');
        if (res === 'goal') P.score[T]++;
        this.emit('pen_kick', { team: T, name: shooter.data.short, result: res, pens: [...P.score] });
        P.phase = 'wait'; P.timer = res === 'goal' ? 4 : 3;
        b.shot = null;
      }
    } else if (P.phase === 'wait') {
      P.timer -= DT;
      if (P.timer <= 0) {
        // fin de séance ?
        const k0 = P.kicks[0].length, k1 = P.kicks[1].length;
        const rem0 = Math.max(0, 5 - k0), rem1 = Math.max(0, 5 - k1);
        let winner = null;
        if (k0 <= 5 && k1 <= 5) {
          if (P.score[0] > P.score[1] + rem1) winner = 0;
          else if (P.score[1] > P.score[0] + rem0) winner = 1;
        }
        if (winner === null && k0 >= 5 && k1 >= 5 && k0 === k1 && P.score[0] !== P.score[1]) winner = P.score[0] > P.score[1] ? 0 : 1;
        if (winner !== null) {
          P.done = true; P.winner = winner;
          this.emit('pens_end', { winner, pens: [...P.score] });
          this.stopWall = this.wall;
          this.period = 'end';
          this.emit('end', {});
          return;
        }
        P.turn = 1 - P.turn;
        P.phase = 'walk'; P.timer = this.k === 1 ? 9 : 5;
        b.owner = null; b.inHands = false;
        Object.assign(b, { x: HL - 11, y: 0, h: BALL_R, vx: 0, vy: 0, vh: 0 });
      }
    }
    this.movePlayers();
    this.stepBallPhysics();
    if (P.phase === 'shot') {
      // le gardien peut capter
      const d = hyp(gk.x - b.x, gk.y - b.y);
      if (!b.owner && d < 1.3 && b.h < 2.6 && !b.shot) { b.owner = gk; b.inHands = true; }
      if (Math.abs(b.x) > HL + 1.7) { b.vx = 0; b.vy *= 0.5; }
    }
  }

  // ---------- Ambiance ----------
  updateExcitement() {
    const b = this.ball;
    const distGoal = HL - Math.abs(b.x);
    const target = this.state === 'celebrate' ? 1 : clamp(1 - distGoal / 45, 0.12, 0.85) * (this.state === 'play' ? 1 : 0.6);
    this.excitement += (target - this.excitement) * 0.02;
    this.danger *= 0.97;
  }

  // ---------- Enregistrement (ralentis) ----------
  snapshot() {
    if (!this.ring) return;
    const off = this.ringPos * SNAP_LEN;
    this.writeSnap(this.ring, off);
    this.ringPos = (this.ringPos + 1) % 260;
    this.ringCount = Math.min(260, this.ringCount + 1);
    if (this.pendingClip) {
      const c = this.pendingClip;
      c.frames.push(this.ring.slice(off, off + SNAP_LEN));
      if (--c.after <= 0) { c.tickEnd = this.tick; this.highlights.push(c); this.pendingClip = null; if (this.highlights.length > 40) this.highlights.splice(0, this.highlights.findIndex(h => h.kind !== 'goal') + 1 || 1); }
    }
  }

  writeSnap(arr, off) {
    let i = off;
    for (let t = 0; t < 2; t++) {
      for (let s = 0; s < 11; s++) {
        const p = this.teams[t].players[s];
        if (!p || p.off) { arr[i] = 9999; i += ENT; continue; }
        arr[i] = p.x; arr[i + 1] = p.y; arr[i + 2] = p.ang; arr[i + 3] = hyp(p.vx, p.vy);
        arr[i + 4] = p.act; arr[i + 5] = p.actT;
        i += ENT;
      }
    }
    for (const o of [this.ref, this.lines[0], this.lines[1]]) {
      arr[i] = o.x; arr[i + 1] = o.y; arr[i + 2] = o.ang; arr[i + 3] = hyp(o.vx, o.vy); arr[i + 4] = o.act || 0; arr[i + 5] = o.actT || 0;
      i += ENT;
    }
    arr[i] = this.ball.x; arr[i + 1] = this.ball.y; arr[i + 2] = this.ball.h;
  }

  captureClip(kind, info) {
    if (!this.ring) return;
    if (this.pendingClip) {
      if (kind !== 'goal') return;
      this.pendingClip = null; // le but remplace l'action précédente
    }
    const n = Math.min(this.ringCount, 200);
    const frames = [];
    for (let k = n; k > 0; k--) {
      const idx = (this.ringPos - k + 260) % 260;
      frames.push(this.ring.slice(idx * SNAP_LEN, (idx + 1) * SNAP_LEN));
    }
    this.pendingClip = { kind, info, frames, after: 50, slots: this.teams.map(t => t.players.map(p => p.data.id)) };
  }

  summary() {
    return {
      score: [...this.score], pens: this.pens ? [...this.pens.score] : null,
      winner: this.pens ? this.pens.winner : (this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : null),
      goals: this.goalsLog.map(g => ({ team: g.team, scorer: g.scorer, ownGoal: g.ownGoal, minute: g.minute })),
      stats: this.stats.map(s => ({ ...s })),
    };
  }
}
