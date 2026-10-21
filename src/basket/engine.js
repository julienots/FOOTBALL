// Moteur de basket 5 contre 5 déterministe : montée de balle, attaque placée,
// passes, pénétrations, tirs (2/3 pts), dunks, contres, rebonds, fautes et
// lancers francs, horloge des 24 secondes, 4 quart-temps de 10 minutes.
import { RNG, clamp } from '../core/rng.js';
import { ENT, SNAP_LEN } from '../football/engine.js';

export const CL = 14, CW = 7.5; // demi-longueur / demi-largeur du terrain
export const HOOP_X = 14 - 1.575, RIM_H = 3.05;
export const BDT = 0.05;
const G = 9.81;
const hyp = Math.hypot;

export const BACT = { NONE: 0, SHOOT: 11, DUNK: 12, PASS: 14, REBOUND: 15, DEFEND: 16, CELEB: 5, FALL: 8 };
// index dans le snapshot (compatible avec le rendu des joueurs)
export const SLOT = (team, i) => team * 11 + i;

export class BasketMatch {
  constructor({ home, away, seed, quarterLen = 600, breakLen = 120, halfLen = 480 }) {
    this.rng = new RNG(seed);
    this.home = home; this.away = away;
    this.qLen = quarterLen; this.breakLen = breakLen; this.halfLen = halfLen;
    this.teams = [home, away].map((t, ti) => ({
      data: t, idx: ti,
      players: t.roster.slice(0, 5).map((p, i) => this.mkPlayer(p, ti, i)),
      bench: t.roster.slice(5),
    }));
    this.refs = [0, 1, 2].map(i => ({ x: [-4, 4, 0][i], y: [CW + 0.8, CW + 0.8, -CW - 0.8][i], vx: 0, vy: 0, ang: 0, act: 0, actT: 0 }));
    this.ball = { x: 0, y: 0, h: 1.2, vx: 0, vy: 0, vh: 0, owner: null, flight: null };
    this.score = [0, 0];
    this.stats = [0, 1].map(() => ({ fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, fouls: 0 }));
    this.quarter = 1;
    this.qTime = 0; // secondes écoulées dans le quart-temps
    this.wall = 0;
    this.tick = 0;
    this.period = 'play'; // play | break | end
    this.events = []; this.cursor = 0;
    this.excitement = 0.4;
    this.ring = new Float32Array(SNAP_LEN * 4);
    this.ringPos = 0; this.ringCount = 0;
    this.lastScorer = null;
    this.jumpBall();
  }

  mkPlayer(d, team, i) {
    return { d, team, i, x: 0, y: 0, vx: 0, vy: 0, ang: 0, tx: 0, ty: 0, ts: 0.5, act: 0, actT: 0, pts: 0, reb: 0, ast: 0, fouls: 0, cd: 0 };
  }

  emit(type, data = {}) { const e = { type, q: this.quarter, clock: this.clockLabel(), ...data }; this.events.push(e); if (this.events.length > 400) { this.events.splice(0, 200); this.cursor = Math.max(0, this.cursor - 200); } }
  pullEvents() { const o = this.events.slice(this.cursor); this.cursor = this.events.length; return o; }
  all() { return this.teams[0].players.concat(this.teams[1].players); }

  // l'équipe 0 attaque vers +x aux 1re et 2e quart-temps
  dir(team) { const d = team === 0 ? 1 : -1; return this.quarter <= 2 ? d : -d; }
  hoopOf(team) { return { x: this.dir(team) * HOOP_X, y: 0 }; }

  clockLabel() {
    const rem = Math.max(0, this.qLen - this.qTime);
    const sc = rem * (600 / this.qLen);
    const m = Math.floor(sc / 60), s = Math.floor(sc % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // temps réel depuis le début du match ; renvoie true quand le match est fini
  syncTo(target, maxSteps = Infinity) {
    let n = 0;
    while (n < maxSteps) {
      if (this.period === 'end') return true;
      if (this.wall >= target) return false;
      this.step(); n++;
    }
    return false;
  }

  step() {
    this.tick++;
    this.wall += BDT;
    for (const p of this.all()) { if (p.actT > 0) { p.actT -= BDT; if (p.actT <= 0) p.act = 0; } if (p.cd > 0) p.cd -= BDT; }
    if (this.period === 'break') {
      this.breakT -= BDT;
      for (const p of this.all()) { p.tx = (p.team ? 1 : -1) * (3 + p.i * 0.6); p.ty = -CW - 1.5; p.ts = 0.3; }
      this.move();
      if (this.breakT <= 0) this.startQuarter();
      this.snap();
      return;
    }
    this.qTime += BDT;
    this.shotClock -= BDT;
    this.phaseT += BDT;
    switch (this.phase) {
      case 'jump': this.stepJump(); break;
      case 'inbound': this.stepInbound(); break;
      case 'advance': case 'setup': this.stepOffense(); break;
      case 'flight': this.stepFlight(); break;
      case 'rebound': this.stepRebound(); break;
      case 'ft': this.stepFT(); break;
      case 'dead': this.stepDead(); break;
    }
    this.moveRefs();
    this.move();
    if (this.ball.owner && this.phase !== 'flight') this.attachBall();
    this.excitement += ((this.phase === 'flight' ? 0.9 : Math.abs(this.score[0] - this.score[1]) < 6 ? 0.55 : 0.4) - this.excitement) * 0.02;
    if (this.qTime >= this.qLen && this.phase !== 'flight' && this.phase !== 'ft') this.endQuarter();
    this.snap();
  }

  endQuarter() {
    this.emit('quarter_end', { quarter: this.quarter, score: [...this.score] });
    if (this.quarter >= 4 && this.score[0] !== this.score[1]) { this.period = 'end'; this.emit('end', { score: [...this.score] }); return; }
    if (this.quarter >= 4) { this.qLen = this.qLen / 2; } // prolongation (5 min)
    this.period = 'break';
    this.breakT = this.quarter === 2 ? this.halfLen : this.breakLen;
    this.ball.owner = null;
  }

  startQuarter() {
    this.quarter++;
    this.qTime = 0;
    this.period = 'play';
    this.emit('quarter_start', { quarter: this.quarter });
    // alternance de possession
    this.inbound(this.quarter % 2 === 0 ? 1 - this.firstPoss : this.firstPoss, 'side');
  }

  jumpBall() {
    this.phase = 'jump'; this.phaseT = 0; this.shotClock = 24;
    const b = this.ball;
    Object.assign(b, { x: 0, y: 0, h: 1.8, vx: 0, vy: 0, vh: 0, owner: null, flight: null });
    for (const t of this.teams) for (const p of t.players) {
      const d = this.dir(t.idx);
      if (p.i === 4) { p.x = -d * 0.6; p.y = 0; } else { p.x = -d * (3 + (p.i % 2) * 1.5); p.y = (p.i - 1.5) * 2.4; }
      p.tx = p.x; p.ty = p.y;
    }
  }

  stepJump() {
    const b = this.ball;
    if (this.phaseT < 1.5) return;
    if (this.phaseT < 2.2) { b.h = 1.8 + Math.sin((this.phaseT - 1.5) / 0.7 * Math.PI) * 2.2; const c = this.teams.map(t => t.players[4]); c.forEach(p => { p.act = BACT.REBOUND; p.actT = 0.5; }); return; }
    const a = this.teams[0].players[4].d, c = this.teams[1].players[4].d;
    const win = this.rng.chance(0.5 + (a.reb - c.reb) / 200) ? 0 : 1;
    this.firstPoss = win;
    this.emit('jump', { team: win });
    this.give(this.teams[win].players[0]);
    this.phase = 'advance'; this.phaseT = 0; this.shotClock = 24;
  }

  give(p) { const b = this.ball; b.owner = p; b.flight = null; this.poss = p.team; p.cd = 0.4; }

  attachBall() {
    const b = this.ball, p = b.owner;
    const dribbling = (this.phase === 'advance' || this.phase === 'setup') && hyp(p.vx, p.vy) > 0.4;
    b.x = p.x + Math.cos(p.ang) * 0.35 + Math.cos(p.ang - 1.2) * 0.15;
    b.y = p.y + Math.sin(p.ang) * 0.35 + Math.sin(p.ang - 1.2) * 0.15;
    b.h = dribbling ? 0.15 + Math.abs(Math.sin(this.tick * 0.32)) * 0.85 : 1.15;
  }

  inbound(team, where = 'base') {
    const d = this.dir(team);
    const b = this.ball;
    const tm = this.teams[team].players;
    const thrower = tm[3];
    const recv = tm[0];
    const bx = where === 'base' ? -d * (CL + 0.4) : 0;
    const by = where === 'base' ? 1.2 : CW + 0.4;
    thrower.x = bx; thrower.y = by;
    this.phase = 'inbound'; this.phaseT = 0; this.shotClock = 24;
    this.inb = { thrower, recv, team };
    this.give(thrower);
    this.poss = team;
  }

  stepInbound() {
    const { thrower, recv, team } = this.inb;
    const d = this.dir(team);
    recv.tx = thrower.x + d * 4; recv.ty = clamp(thrower.y * 0.4, -CW + 1, CW - 1); recv.ts = 0.7;
    this.positionDefense();
    for (const p of this.teams[team].players) if (p !== thrower && p !== recv) { p.tx = d * (2 + p.i * 1.5); p.ty = (p.i - 2) * 2.5; p.ts = 0.6; }
    if (this.phaseT > 1.6) this.passTo(thrower, recv);
  }

  // positions d'attaque placée (repère : panier attaqué en +x)
  spots(team) {
    const d = this.dir(team);
    const S = [[HOOP_X - 7.3, 0], [HOOP_X - 5.6, 5.0], [HOOP_X - 5.6, -5.0], [HOOP_X - 0.6, 6.95], [HOOP_X - 2.2, -1.8]];
    const t = this.tick * 0.01;
    return S.map(([x, y], i) => [(x + Math.sin(t + i * 2) * 0.8) * d, (y + Math.cos(t * 1.3 + i) * 0.8) * d]);
  }

  positionDefense() {
    const off = this.poss;
    const def = 1 - off;
    const hoop = this.hoopOf(off);
    const attackers = this.teams[off].players;
    for (const p of this.teams[def].players) {
      const m = attackers[p.i];
      const dx = hoop.x - m.x, dy = hoop.y - m.y, dl = hyp(dx, dy) || 1;
      const gap = this.ball.owner === m ? 1.0 : 1.8;
      p.tx = m.x + (dx / dl) * Math.min(gap, dl * 0.5); p.ty = m.y + (dy / dl) * Math.min(gap, dl * 0.5);
      p.ts = 0.85;
      if (this.ball.owner === m && hyp(p.x - m.x, p.y - m.y) < 1.4) { p.act = BACT.DEFEND; p.actT = 0.2; }
    }
  }

  stepOffense() {
    const b = this.ball, p = b.owner;
    const team = this.poss, d = this.dir(team);
    const rng = this.rng;
    if (!p) { this.phase = 'rebound'; return; }
    const sp = this.spots(team);
    const tm = this.teams[team].players;
    // montée de balle
    if (this.phase === 'advance') {
      tm.forEach((q, i) => { q.tx = sp[i][0] * 0.85; q.ty = sp[i][1]; q.ts = 0.75; });
      p.tx = d * (HOOP_X - 7); p.ty = p.y * 0.5; p.ts = 0.8;
      if (p.x * d > HOOP_X - 9) { this.phase = 'setup'; this.phaseT = 0; this.decT = 0.6; }
    } else {
      tm.forEach((q, i) => { if (q !== p) { q.tx = sp[i][0]; q.ty = sp[i][1]; q.ts = 0.55; } });
      this.decT -= BDT;
      if (this.decT <= 0) this.decide(p);
      if (p.drive) { const h = this.hoopOf(team); p.tx = h.x - d * 0.9; p.ty = h.y + p.drive.side * 0.4; p.ts = 0.95; }
      else { p.tx = p.x; p.ty = p.y; p.ts = 0.2; }
    }
    this.positionDefense();
    // interceptions sur le porteur
    for (const o of this.teams[1 - team].players) {
      if (o.cd > 0 || hyp(o.x - p.x, o.y - p.y) > 1.1) continue;
      if (rng.chance(0.0007 * (o.d.def / 75))) {
        this.stats[o.team].stl++; this.stats[team].to++;
        this.emit('steal', { team: o.team, name: o.d.short, victim: p.d.short });
        this.give(o); this.phase = 'advance'; this.phaseT = 0; this.shotClock = 24; p.cd = 1;
        return;
      }
    }
    if (this.shotClock <= 0) {
      this.emit('shotclock', { team });
      this.stats[team].to++;
      this.inbound(1 - team, 'side');
    }
  }

  decide(p) {
    const rng = this.rng, team = p.team, d = this.dir(team);
    const h = this.hoopOf(team);
    const dist = hyp(h.x - p.x, h.y - p.y);
    const def = this.teams[1 - team].players[p.i];
    const open = hyp(def.x - p.x, def.y - p.y);
    const a = p.d;
    this.decT = rng.range(0.6, 1.4);
    if (p.drive) {
      if (dist < 1.6) { this.shoot(p, a.ins > 80 && a.height > 1.95 && rng.chance(0.6) ? 'dunk' : 'layup'); p.drive = null; }
      return;
    }
    const urgency = this.shotClock < 5 ? 0.5 : 0;
    const three = dist > 6.75;
    const shootQ = (three ? a.tp + 8 : a.mid) / 100 * clamp(open / 2.5, 0.3, 1.3) + urgency - (dist > 8 ? 0.4 : 0);
    const driveQ = a.ins / 100 * (open > 1.6 ? 1 : 0.7) * (dist < 9 ? 1 : 0.6) + rng.next() * 0.2;
    const r = rng.next();
    if (this.phaseT > 1.5 && shootQ > 0.5 + r * 0.3) { this.shoot(p, three ? 'three' : 'jumper'); return; }
    if (this.phaseT > 1 && driveQ > 0.62 + r * 0.25) { p.drive = { side: rng.chance(0.5) ? 1 : -1 }; this.emit('drive', { team, name: p.d.short }); return; }
    if (this.shotClock < 2.5) { this.shoot(p, three ? 'three' : 'jumper'); return; }
    // passe au partenaire le plus démarqué
    let best = null, bs = -1;
    for (const m of this.teams[team].players) {
      if (m === p) continue;
      const md = this.teams[1 - team].players[m.i];
      const s = hyp(md.x - m.x, md.y - m.y) + rng.next() * 1.5 - hyp(m.x - p.x, m.y - p.y) * 0.05;
      if (s > bs) { bs = s; best = m; }
    }
    this.passTo(p, best);
  }

  passTo(p, m) {
    const b = this.ball;
    const rng = this.rng;
    const dx = m.x - p.x, dy = m.y - p.y, dist = hyp(dx, dy);
    const T = dist / 10 + 0.1;
    b.owner = null;
    b.flight = { kind: 'pass', from: p, to: m, t: 0, T, x0: b.x, y0: b.y, h0: 1.3, x1: m.x + m.vx * T, y1: m.y + m.vy * T, h1: 1.2 };
    p.act = BACT.PASS; p.actT = 0.35;
    // interception sur la trajectoire
    for (const o of this.teams[1 - p.team].players) {
      const t = clamp(((o.x - p.x) * dx + (o.y - p.y) * dy) / (dist * dist), 0, 1);
      if (t < 0.15 || t > 0.9) continue;
      const perp = hyp(o.x - (p.x + dx * t), o.y - (p.y + dy * t));
      if (perp < 0.6 && rng.chance(0.1 * o.d.def / 80)) { b.flight.steal = o; b.flight.T = T * t; b.flight.x1 = o.x; b.flight.y1 = o.y; break; }
    }
    this.lastPasser = p;
    this.prevPhase = this.phase === 'inbound' ? 'advance' : this.phase;
    this.phase = 'flight';
  }

  shoot(p, kind) {
    const rng = this.rng;
    const b = this.ball;
    const team = p.team;
    const h = this.hoopOf(team);
    const dist = hyp(h.x - p.x, h.y - p.y);
    const def = this.teams[1 - team].players[p.i];
    const open = hyp(def.x - p.x, def.y - p.y);
    const a = p.d;
    const pts = kind === 'three' ? 3 : 2;
    let pct;
    if (kind === 'dunk') pct = 0.9;
    else if (kind === 'layup') pct = 0.5 + a.ins / 400;
    else if (kind === 'three') pct = 0.12 + a.tp / 340;
    else pct = 0.22 + a.mid / 300 - dist * 0.012;
    pct *= clamp(0.65 + open * 0.17, 0.6, 1.1);
    // contre ?
    const blocked = open < 1.2 && kind !== 'three' && rng.chance(0.06 + def.d.def / 1500 + (def.d.height - a.height) * 0.15);
    // faute sur le tir ?
    const fouled = open < 1.3 && rng.chance(kind === 'dunk' || kind === 'layup' ? 0.16 : 0.06);
    const made = !blocked && rng.chance(clamp(pct, 0.05, 0.95));
    this.stats[team].fga++; if (pts === 3) this.stats[team].tpa++;
    p.act = kind === 'dunk' ? BACT.DUNK : BACT.SHOOT; p.actT = kind === 'dunk' ? 0.9 : 0.7;
    const T = kind === 'dunk' ? 0.45 : kind === 'layup' ? 0.6 : 0.85 + dist * 0.04;
    b.owner = null;
    b.flight = { kind: 'shot', shooter: p, pts, made, blocked, fouled, shot: kind, t: 0, T, x0: b.x, y0: b.y, h0: kind === 'dunk' ? 3.2 : 2.3, x1: h.x, y1: h.y, h1: RIM_H, apex: kind === 'dunk' ? 0.1 : 1.2 + dist * 0.08, blocker: blocked ? def : null };
    if (blocked) { b.flight.T = 0.25; b.flight.x1 = p.x + (h.x - p.x) * 0.15; b.flight.y1 = p.y + (h.y - p.y) * 0.15; b.flight.h1 = 3.0; def.act = BACT.REBOUND; def.actT = 0.6; }
    this.emit('shot', { team, name: p.d.short, kind, pts, dist: Math.round(dist * 10) / 10 });
    this.phase = 'flight';
    this.shotTeam = team;
  }

  stepFlight() {
    const b = this.ball, f = b.flight;
    if (!f) { this.phase = 'rebound'; return; }
    f.t += BDT;
    const u = Math.min(1, f.t / f.T);
    b.x = f.x0 + (f.x1 - f.x0) * u; b.y = f.y0 + (f.y1 - f.y0) * u;
    b.h = f.h0 + (f.h1 - f.h0) * u + (f.apex || 0.15) * 4 * u * (1 - u);
    this.positionDefense();
    if (f.kind === 'shot') {
      // les rebondeurs se placent
      for (const t of this.teams) for (const p of t.players) if (p !== f.shooter && p.i >= 3) { const h = this.hoopOf(this.shotTeam); p.tx = h.x - this.dir(this.shotTeam) * 1.8; p.ty = (p.i - 3.5) * 2 + (t.idx ? 0.6 : -0.6); p.ts = 0.7; }
    }
    if (u < 1) return;
    if (f.kind === 'pass') {
      if (f.steal) {
        this.stats[f.steal.team].stl++; this.stats[f.from.team].to++;
        this.emit('steal', { team: f.steal.team, name: f.steal.d.short, victim: f.from.d.short });
        this.give(f.steal); this.phase = 'advance'; this.phaseT = 0; this.shotClock = 24;
      } else { this.give(f.to); this.phase = this.prevPhase || 'setup'; if (this.phase === 'setup') this.decT = 0.5 + this.rng.next(); }
      return;
    }
    const s = f.shooter, team = s.team;
    if (f.blocked) {
      this.stats[1 - team].blk++;
      this.emit('block', { team: 1 - team, name: f.blocker.d.short, victim: s.d.short });
      b.flight = null; b.vx = this.rng.normal(0, 3); b.vy = this.rng.normal(0, 3); b.vh = 2;
      this.phase = 'rebound'; this.phaseT = 0;
      return;
    }
    if (f.made) {
      this.score[team] += f.pts;
      this.stats[team].fgm++; if (f.pts === 3) this.stats[team].tpm++;
      s.pts += f.pts;
      const assist = this.lastPasser && this.lastPasser.team === team && this.lastPasser !== s ? this.lastPasser : null;
      if (assist) { assist.ast++; this.stats[team].ast++; }
      this.lastScorer = s;
      this.emit('score', { team, name: s.d.short, full: s.d.name, pts: f.pts, kind: f.shot, score: [...this.score], assist: assist ? assist.d.short : null, playerPts: s.pts });
      this.excitement = 1;
      b.flight = null; b.x = f.x1; b.y = f.y1; b.h = RIM_H - 0.3; b.vx = 0; b.vy = 0; b.vh = -2;
      if (f.fouled) { this.foulShot(s, 1, true); return; }
      this.phase = 'dead'; this.phaseT = 0; this.deadNext = () => this.inbound(1 - team, 'base');
      return;
    }
    this.emit('miss', { team, name: s.d.short, kind: f.shot, pts: f.pts });
    if (f.fouled) { this.foulShot(s, f.pts, false); return; }
    // rebond sur le cercle
    b.flight = null;
    const ang = this.rng.range(0, Math.PI * 2);
    b.vx = Math.cos(ang) * this.rng.range(1.5, 4); b.vy = Math.sin(ang) * this.rng.range(1.5, 4); b.vh = this.rng.range(1, 3);
    b.x = f.x1; b.y = f.y1; b.h = RIM_H + 0.1;
    this.phase = 'rebound'; this.phaseT = 0;
  }

  stepRebound() {
    const b = this.ball;
    b.vh -= G * BDT; b.x += b.vx * BDT; b.y += b.vy * BDT; b.h += b.vh * BDT;
    if (b.h < 0.12) { b.h = 0.12; b.vh = Math.abs(b.vh) * 0.6; b.vx *= 0.8; b.vy *= 0.8; }
    let best = null, bd = 1e9;
    for (const p of this.all()) {
      p.tx = b.x; p.ty = b.y; p.ts = p.i >= 2 ? 0.9 : 0.4;
      const d = hyp(p.x - b.x, p.y - b.y) - p.d.reb / 120 - (p.team !== this.shotTeam ? 0.35 : 0);
      if (d < bd && b.h < 3.3) { bd = d; best = p; }
    }
    if (best && bd < 0.3 && b.h < 3.2) {
      const off = best.team === this.shotTeam;
      best.reb++; this.stats[best.team].reb++;
      best.act = BACT.REBOUND; best.actT = 0.5;
      this.emit('rebound', { team: best.team, name: best.d.short, offensive: off });
      this.give(best);
      this.phase = off ? 'setup' : 'advance'; this.phaseT = 0; this.shotClock = off ? 14 : 24; this.decT = 0.4;
      return;
    }
    if (Math.abs(b.x) > CL || Math.abs(b.y) > CW) {
      const lt = this.shotTeam;
      this.emit('out', { team: 1 - lt });
      this.inbound(1 - lt, 'side');
    }
  }

  foulShot(shooter, n, andOne) {
    const team = shooter.team;
    const fouler = this.teams[1 - team].players[shooter.i];
    fouler.fouls++; this.stats[1 - team].fouls++;
    this.emit('foul', { team: 1 - team, name: fouler.d.short, victim: shooter.d.short, shots: n, andOne, fouls: fouler.fouls });
    shooter.act = BACT.FALL; shooter.actT = 1.0;
    this.ft = { shooter, left: n, team, made: 0 };
    this.phase = 'ft'; this.phaseT = 0; this.ball.flight = null; this.ball.owner = null;
    this.refs[0].act = 1; this.refs[0].actT = 0.6;
  }

  stepFT() {
    const ft = this.ft, s = ft.shooter, team = ft.team, d = this.dir(team);
    const h = this.hoopOf(team);
    // placement autour de la raquette
    const lane = [[-1, 2.2], [-1, -2.2], [-2.5, 2.2], [-2.5, -2.2], [-4, 2.2], [-4, -2.2]];
    let li = 0;
    for (const p of this.all()) {
      if (p === s) { p.tx = h.x - d * 4.6; p.ty = 0; p.ts = 0.5; continue; }
      const L = lane[li++ % lane.length] || [-8, 0];
      p.tx = h.x + d * L[0] * (li > 4 ? 1.8 : 1); p.ty = L[1] * (li > 4 ? 1.5 : 1); p.ts = 0.4;
    }
    const b = this.ball;
    if (this.phaseT < 3.5) { b.owner = s; return; }
    if (!ft.inAir) {
      const made = this.rng.chance(0.5 + s.d.ft / 250);
      ft.inAir = { made, t: 0 };
      s.act = BACT.SHOOT; s.actT = 0.6;
      b.owner = null;
      b.flight = { kind: 'ft', t: 0, T: 0.9, x0: s.x + d * 0.3, y0: 0, h0: 2.2, x1: h.x, y1: h.y, h1: RIM_H, apex: 1.4 };
    }
    const f = b.flight;
    f.t += BDT;
    const u = Math.min(1, f.t / f.T);
    b.x = f.x0 + (f.x1 - f.x0) * u; b.y = f.y0 + (f.y1 - f.y0) * u; b.h = f.h0 + (f.h1 - f.h0) * u + f.apex * 4 * u * (1 - u);
    if (u < 1) return;
    const made = ft.inAir.made;
    this.stats[team].fta++;
    if (made) { this.score[team]++; this.stats[team].ftm++; s.pts++; }
    ft.left--;
    this.emit('ft', { team, name: s.d.short, made, left: ft.left, score: [...this.score] });
    ft.inAir = null;
    if (ft.left > 0) { this.phaseT = 1.5; b.owner = s; return; }
    b.flight = null;
    if (made) { this.phase = 'dead'; this.phaseT = 0; this.deadNext = () => this.inbound(1 - team, 'base'); }
    else { b.vx = this.rng.normal(0, 2); b.vy = this.rng.normal(0, 2); b.vh = 2; this.shotTeam = team; this.phase = 'rebound'; this.phaseT = 0; }
  }

  stepDead() {
    const b = this.ball;
    b.vh -= G * BDT; b.h += b.vh * BDT; if (b.h < 0.12) { b.h = 0.12; b.vh = Math.abs(b.vh) * 0.5; }
    if (this.lastScorer && this.phaseT < 1.5) { this.lastScorer.act = BACT.CELEB; this.lastScorer.actT = 0.2; }
    for (const p of this.all()) { if (p.team !== this.poss) continue; p.tx = p.x - this.dir(p.team) * 2; p.ty = p.y; p.ts = 0.4; }
    if (this.phaseT > 1.6) this.deadNext();
  }

  move() {
    for (const p of this.all()) {
      const sp0 = 4.8 + p.d.spd / 100 * 2.8;
      const dx = p.tx - p.x, dy = p.ty - p.y, dist = hyp(dx, dy);
      let des = sp0 * p.ts; if (dist < 1.5) des = Math.min(des, dist * 1.6);
      const dvx = dist > 0.05 ? dx / dist * des : 0, dvy = dist > 0.05 ? dy / dist * des : 0;
      const acc = 9 * BDT;
      let ax = dvx - p.vx, ay = dvy - p.vy; const al = hyp(ax, ay);
      if (al > acc) { ax = ax / al * acc; ay = ay / al * acc; }
      p.vx += ax; p.vy += ay; p.x += p.vx * BDT; p.y += p.vy * BDT;
      p.x = clamp(p.x, -CL - 1, CL + 1); p.y = clamp(p.y, -CW - 2, CW + 1);
      const sp = hyp(p.vx, p.vy);
      const ta = sp > 0.6 ? Math.atan2(p.vy, p.vx) : Math.atan2(this.ball.y - p.y, this.ball.x - p.x);
      let da = ta - p.ang; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      p.ang += da * Math.min(1, 10 * BDT);
    }
    const all = this.all();
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], c = all[j]; const dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy;
      if (d2 < 0.36 && d2 > 1e-6) { const d = Math.sqrt(d2), push = (0.6 - d) * 0.5; a.x -= dx / d * push; a.y -= dy / d * push; c.x += dx / d * push; c.y += dy / d * push; }
    }
  }

  moveRefs() {
    const b = this.ball;
    this.refs.forEach((r, i) => {
      const tx = clamp(b.x + [-5, 5, 0][i], -CL, CL), ty = [CW + 0.8, CW + 0.8, -CW - 0.8][i];
      const dx = tx - r.x; r.vx = clamp(dx * 1.2, -4, 4); r.x += r.vx * BDT; r.vy = 0;
      r.ang = Math.atan2(b.y - r.y, b.x - r.x);
      if (r.actT > 0) { r.actT -= BDT; if (r.actT <= 0) r.act = 0; }
    });
  }

  snap() {
    const arr = this.ring;
    const off = this.ringPos * SNAP_LEN;
    for (let i = 0; i < 25; i++) arr[off + i * ENT] = 9999;
    for (const p of this.all()) {
      const o = off + SLOT(p.team, p.i) * ENT;
      arr[o] = p.x; arr[o + 1] = p.y; arr[o + 2] = p.ang; arr[o + 3] = hyp(p.vx, p.vy); arr[o + 4] = p.act; arr[o + 5] = p.actT;
    }
    this.refs.forEach((r, i) => { const o = off + (22 + i) * ENT; arr[o] = r.x; arr[o + 1] = r.y; arr[o + 2] = r.ang; arr[o + 3] = Math.abs(r.vx); arr[o + 4] = r.act; arr[o + 5] = r.actT; });
    const bo = off + 25 * ENT;
    arr[bo] = this.ball.x; arr[bo + 1] = this.ball.y; arr[bo + 2] = this.ball.h;
    this.ringPos = (this.ringPos + 1) % 4; this.ringCount = Math.min(4, this.ringCount + 1);
  }

  topScorer(team) { return [...this.teams[team].players].sort((a, b) => b.pts - a.pts)[0]; }
}
