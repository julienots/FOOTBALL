// Moteur de tennis déterministe : service (aces, fautes, doubles fautes),
// échanges de coups droits / revers, points gagnants, fautes directes,
// jeux, sets, tie-break, changements de côté. 2 sets gagnants.
import { RNG, clamp } from '../core/rng.js';
import { ENT, SNAP_LEN } from '../football/engine.js';

export const TL = 11.885, TW = 4.115, NET_H = 0.914;
export const TDT = 0.05;
export const TACT = { NONE: 0, SERVE: 17, FH: 18, BH: 19, CELEB: 5 };
const G = 9.81;
const hyp = Math.hypot;
const PTS = ['0', '15', '30', '40'];

export class TennisMatch {
  constructor({ p1, p2, seed, bestOf = 3 }) {
    this.rng = new RNG(seed);
    this.pl = [p1, p2].map((d, i) => ({ d, i, x: i ? TL + 1 : -TL - 1, y: 0, vx: 0, vy: 0, ang: 0, tx: 0, ty: 0, ts: 0.5, act: 0, actT: 0 }));
    this.bestOf = bestOf;
    this.sets = [];          // scores des sets terminés [[6,4], ...]
    this.games = [0, 0];
    this.points = [0, 0];
    this.tb = false;
    this.setsWon = [0, 0];
    this.server = this.rng.chance(0.5) ? 0 : 1;
    this.tbFirstServer = 0;
    this.ends = 0;           // 0 : joueur 0 côté -x
    this.ball = { x: 0, y: 0, h: 1, vis: false };
    this.flight = null;
    this.wall = 0; this.tick = 0;
    this.events = []; this.cursor = 0;
    this.stats = [0, 1].map(() => ({ aces: 0, df: 0, winners: 0, errors: 0, firstIn: 0, firstTot: 0, pts: 0, breaks: 0 }));
    this.phase = 'prep'; this.phaseT = 0; this.wait = 6;
    this.done = false; this.winner = null;
    this.ring = new Float32Array(SNAP_LEN * 4); this.ringPos = 0;
    this.excitement = 0.3;
    this.rally = 0;
    this.placeForServe();
  }

  emit(type, d = {}) { this.events.push({ type, ...d }); if (this.events.length > 300) { this.events.splice(0, 150); this.cursor = Math.max(0, this.cursor - 150); } }
  pullEvents() { const o = this.events.slice(this.cursor); this.cursor = this.events.length; return o; }
  side(i) { return (i === 0 ? -1 : 1) * (this.ends ? -1 : 1); } // signe du demi-terrain du joueur i

  syncTo(target, maxSteps = Infinity) {
    let n = 0;
    while (n < maxSteps) {
      if (this.done && (this.wall >= target || target - this.wall > 600)) return true;
      if (this.wall >= target) return false;
      this.step(); n++;
    }
    return false;
  }

  // ---------- Score ----------
  pointLabel(i) {
    if (this.tb) return String(this.points[i]);
    const [a, b] = this.points, me = i ? b : a, ot = i ? a : b;
    if (me >= 3 && ot >= 3) return me === ot ? '40' : me > ot ? 'AV' : '40';
    return PTS[Math.min(3, me)];
  }

  totalPointsInGame() { return this.points[0] + this.points[1]; }

  winPoint(w, how) {
    const l = 1 - w;
    this.stats[w].pts++;
    this.points[w]++;
    this.emit('point', { winner: w, how, server: this.server, score: this.scoreText(), rally: this.rally });
    const p = this.points;
    let gameWon = false;
    if (this.tb) gameWon = p[w] >= 7 && p[w] - p[l] >= 2;
    else gameWon = p[w] >= 4 && p[w] - p[l] >= 2;
    if (!gameWon) {
      // balles importantes
      const bp = !this.tb && p[1 - this.server] >= 3 && p[1 - this.server] > p[this.server];
      if (bp) this.emit('breakpoint', { player: 1 - this.server });
      if (this.tb && this.server !== undefined) { if ((p[0] + p[1]) % 2 === 1) this.switchServer(); }
      if (this.tb && (p[0] + p[1]) % 6 === 0) this.changeEnds();
      return;
    }
    const wasTb = this.tb;
    if (!wasTb && w !== this.server) { this.stats[w].breaks++; this.emit('break', { player: w }); }
    this.games[w]++;
    this.points = [0, 0];
    this.emit('game', { winner: w, games: [...this.games], sets: this.sets.map(s => [...s]) });
    const g = this.games;
    let setWon = false;
    if (wasTb) setWon = true;
    else if (g[w] >= 6 && g[w] - g[l] >= 2) setWon = true;
    if (setWon) {
      this.sets.push([...g]);
      this.setsWon[w]++;
      this.tb = false;
      this.emit('set', { winner: w, set: [...g], setsWon: [...this.setsWon] });
      this.games = [0, 0];
      if (this.setsWon[w] > this.bestOf / 2) {
        this.done = true; this.winner = w;
        this.emit('match', { winner: w, sets: this.sets.map(s => [...s]) });
        this.phase = 'over'; this.phaseT = 0;
        return;
      }
    } else if (g[0] === 6 && g[1] === 6) { this.tb = true; this.tbFirstServer = 1 - this.server; this.emit('tiebreak', {}); }
    // service suivant
    if (wasTb) this.server = 1 - this.tbFirstServer; else this.switchServer();
    if (wasTb) this.server = 1 - this.tbFirstServer;
    const tot = this.games[0] + this.games[1] + (setWon ? 1 : 0);
    if (tot % 2 === 1 || setWon) { this.changeEnds(); this.changeover = setWon ? 100 : 70; }
  }

  switchServer() { this.server = 1 - this.server; }
  changeEnds() { this.ends = 1 - this.ends; }

  scoreText() { return `${this.sets.map(s => s.join('-')).join(' ')} ${this.games.join('-')} ${this.pointLabel(0)}-${this.pointLabel(1)}`; }

  // ---------- Déroulé d'un point ----------
  placeForServe() {
    const s = this.server, r = 1 - s;
    const deuce = (this.points[0] + this.points[1]) % 2 === 0;
    const ss = this.side(s), rs = this.side(r);
    // côté droit (égalité) / gauche (avantage) vu par le serveur
    const lat = (deuce ? -1 : 1) * ss;
    this.serveLat = lat;
    Object.assign(this.pl[s], { tx: ss * (TL + 0.3), ty: lat * 0.9, ts: 0.4 });
    Object.assign(this.pl[r], { tx: rs * (TL + 0.8), ty: -lat * 2.6, ts: 0.4 });
  }

  step() {
    this.tick++; this.wall += TDT; this.phaseT += TDT;
    for (const p of this.pl) if (p.actT > 0) { p.actT -= TDT; if (p.actT <= 0) p.act = 0; }
    switch (this.phase) {
      case 'prep': this.stepPrep(); break;
      case 'flight': this.stepFlight(); break;
      case 'after': this.stepAfter(); break;
      case 'over': for (const p of this.pl) { p.tx = this.side(p.i) * 3; p.ty = 5; p.ts = 0.3; } break;
    }
    this.move();
    this.excitement += ((this.phase === 'flight' ? 0.35 + Math.min(0.4, this.rally * 0.04) : 0.2) - this.excitement) * 0.03;
    this.snap();
  }

  stepPrep() {
    const s = this.server;
    const b = this.ball;
    const sp = this.pl[s];
    b.vis = true;
    // rebonds de balle avant le service
    b.x = sp.x - this.side(s) * 0.3; b.y = sp.y + 0.3;
    b.h = this.phaseT < this.wait - 1 ? 0.1 + Math.abs(Math.sin(this.phaseT * 3)) * 0.9 : 1.0 + (this.phaseT - (this.wait - 1)) * 2.4;
    if (this.phaseT >= this.wait - 1 && sp.act !== TACT.SERVE) { sp.act = TACT.SERVE; sp.actT = 1.2; }
    if (this.phaseT >= this.wait) this.serve(this.secondServe ? 2 : 1);
  }

  serve(n) {
    const rng = this.rng, s = this.server, r = 1 - s;
    const a = this.pl[s].d, rd = this.pl[r].d;
    const ss = this.side(s);
    const pIn = n === 1 ? 0.5 + a.serve / 400 : 0.86 + a.serve / 1200;
    if (n === 1) this.stats[s].firstTot++;
    const inside = rng.chance(pIn);
    if (n === 1 && inside) this.stats[s].firstIn++;
    const speed = n === 1 ? 46 + a.serve / 4 + rng.range(-3, 4) : 36 + a.serve / 6;
    // cible dans le carré de service adverse
    const lat = this.serveLat;
    let tx = -ss * rng.range(3.5, 6.2), ty = -lat * rng.range(0.4, TW - 0.25);
    if (!inside) { if (rng.chance(0.5)) tx = -ss * rng.range(6.6, 7.6); else ty = -lat * rng.range(TW + 0.05, TW + 0.6); if (rng.chance(0.25)) tx = -ss * 0.2; }
    const ace = inside && rng.chance(n === 1 ? clamp((a.serve - rd.ret) / 220 + 0.07, 0.02, 0.25) : 0.01);
    this.rally = 0;
    this.launch(s, tx, ty, speed, 2.9, 'serve', { inside, ace, n });
  }

  // lance le ballon du joueur `from` vers (tx, ty)
  launch(from, tx, ty, speed, h0, kind, info = {}) {
    const p = this.pl[from];
    const x0 = p.x - this.side(from) * 0.2, y0 = p.y;
    const d = hyp(tx - x0, ty - y0);
    const T = d / (speed * 0.82);
    // hauteur au filet suffisante : parabole avec apex
    const apex = kind === 'serve' ? 0.4 : this.rng.range(0.9, 2.3);
    this.flight = { from, x0, y0, h0, tx, ty, T, t: 0, apex, kind, ...info, bounced: false };
    this.phase = 'flight'; this.phaseT = 0;
    this.emit('hit', { player: from, kind, speed: Math.round(speed * 3.6) });
    // le receveur se déplace vers le point de frappe
    const r = 1 - from;
    const rp = this.pl[r];
    const after = 0.55;
    const vx = (tx - x0) / T, vy = (ty - y0) / T;
    const hx = tx + vx * after * 0.45, hy = ty + vy * after * 0.45;
    this.flight.hit = { x: clamp(hx, -TL - 4, TL + 4), y: clamp(hy, -TW - 3, TW + 3) };
    rp.tx = this.flight.hit.x + this.side(r) * 0.6; rp.ty = this.flight.hit.y; rp.ts = 1;
    const fp = this.pl[from];
    fp.tx = this.side(from) * (TL + 0.5); fp.ty = clamp(-ty * 0.25, -2, 2); fp.ts = 0.7;
  }

  stepFlight() {
    const f = this.flight, b = this.ball;
    f.t += TDT;
    if (!f.bounced) {
      const u = Math.min(1, f.t / f.T);
      b.x = f.x0 + (f.tx - f.x0) * u; b.y = f.y0 + (f.ty - f.y0) * u;
      b.h = f.h0 * (1 - u) + f.apex * 4 * u * (1 - u) + 0.07;
      if (u >= 1) {
        f.bounced = true; f.tb = f.t;
        this.emit('bounce', {});
        // résultat au rebond
        const inCourt = Math.abs(f.tx) <= TL + 0.02 && Math.abs(f.ty) <= TW + 0.02 && Math.sign(f.tx) === -this.side(f.from);
        if (f.kind === 'serve') {
          if (!f.inside) return this.fault();
        } else if (!inCourt || f.net) {
          return this.endPoint(1 - f.from, f.net ? 'net' : 'out');
        }
      }
    } else {
      // après le rebond, la balle file vers le receveur
      const dt = f.t - f.tb;
      const vx = (f.tx - f.x0) / f.T, vy = (f.ty - f.y0) / f.T;
      b.x = f.tx + vx * dt * 0.8; b.y = f.ty + vy * dt * 0.8;
      b.h = 0.07 + Math.max(0, 5.2 * dt - 0.5 * G * dt * dt);
      const r = 1 - f.from, rp = this.pl[r];
      const near = hyp(rp.x - b.x, rp.y - b.y) < 1.4;
      if (f.ace || (f.winner && dt > 0.35)) {
        if (dt > 0.9) return this.endPoint(f.from, f.ace ? 'ace' : 'winner');
        return;
      }
      if (dt > 0.42 && (near || dt > 0.75)) this.returnShot(r);
      if (dt > 1.4) return this.endPoint(f.from, 'winner');
    }
  }

  returnShot(r) {
    const rng = this.rng;
    const p = this.pl[r], o = this.pl[1 - r];
    const a = p.d, f = this.flight;
    const fh = (p.y * this.side(r) >= 0) === (a.hand === 'droitier');
    const skill = fh ? a.fh : a.bh;
    const stretched = clamp(hyp(p.x - this.ball.x, p.y - this.ball.y) / 2, 0, 1);
    const pressure = f.kind === 'serve' ? (this.pl[f.from].d.serve - a.ret) / 300 + 0.05 : f.aggressive ? 0.12 : 0;
    p.act = fh ? TACT.FH : TACT.BH; p.actT = 0.5;
    this.rally++;
    const pErr = clamp(0.03 + stretched * 0.14 + pressure - (skill - 70) / 500 + this.rally * 0.002, 0.02, 0.6);
    const aggressive = rng.chance(0.18 + (a.att - 70) / 200 + (o.y * this.side(1 - r) > 1.5 ? 0.1 : 0));
    const speed = aggressive ? 30 + skill / 6 + rng.range(0, 6) : 21 + skill / 9 + rng.range(-2, 3);
    const side = -this.side(r);
    // vise l'endroit le plus éloigné de l'adversaire
    const oppY = o.y;
    let ty = clamp((oppY > 0 ? -1 : 1) * rng.range(1.2, aggressive ? 3.9 : 3.2), -TW + 0.15, TW - 0.15);
    if (rng.chance(0.3)) ty = clamp(oppY + rng.normal(0, 1.5), -TW + 0.2, TW - 0.2);
    let tx = side * rng.range(aggressive ? 8.5 : 6.5, aggressive ? 11.6 : 10.8);
    const err = rng.chance(pErr);
    let net = false;
    if (err) {
      const kind = rng.next();
      if (kind < 0.35) { net = true; tx = side * 0.5; }
      else if (kind < 0.7) tx = side * rng.range(TL + 0.1, TL + 1.5);
      else ty = Math.sign(ty || 1) * rng.range(TW + 0.05, TW + 1.2);
    }
    this.launch(r, tx, ty, speed, 1.0, aggressive ? 'attack' : 'rally', { net });
    const fl = this.flight;
    fl.aggressive = aggressive;
    // l'adversaire peut-il atteindre la balle ?
    if (!err) {
      const od = this.pl[1 - r].d;
      const distRun = hyp(o.x - fl.hit.x, o.y - fl.hit.y);
      const tAvail = fl.T + 0.35;
      const reach = (4.2 + od.spd / 50) * (tAvail - 0.3) + 0.9;
      const pW = clamp((distRun - reach * 0.55) / (reach * 0.7), 0, 0.9) + (aggressive ? 0.06 : 0);
      if (rng.chance(pW)) fl.winner = true;
    }
  }

  fault() {
    const s = this.server;
    if (this.secondServe) {
      this.secondServe = false;
      this.stats[s].df++;
      this.emit('doublefault', { player: s });
      return this.endPoint(1 - s, 'double');
    }
    this.secondServe = true;
    this.emit('fault', { player: s });
    this.phase = 'prep'; this.phaseT = 0; this.wait = 4;
    this.placeForServe();
  }

  endPoint(w, how) {
    const f = this.flight;
    if (how === 'ace') this.stats[w].aces++;
    if (how === 'winner') this.stats[w].winners++;
    if (how === 'net' || how === 'out') this.stats[1 - w].errors++;
    this.secondServe = false;
    this.flight = null;
    this.lastHow = how;
    this.changeover = 0;
    this.winPoint(w, how);
    if (this.done) return;
    this.phase = 'after'; this.phaseT = 0;
    this.afterLen = this.changeover || this.rng.range(12, 18);
    this.pl[w].act = this.rally > 6 || how === 'ace' ? TACT.CELEB : 0; this.pl[w].actT = 1.2;
    this.ball.vis = false;
  }

  stepAfter() {
    if (this.phaseT > Math.min(5, this.afterLen - 4)) this.placeForServe();
    else { for (const p of this.pl) { p.tx = this.side(p.i) * (TL + 2.5); p.ty = p.y * 0.95; p.ts = 0.25; } }
    if (this.phaseT >= this.afterLen) { this.phase = 'prep'; this.phaseT = 0; this.wait = this.rng.range(4, 7); }
  }

  move() {
    for (const p of this.pl) {
      const sp0 = 5.5 + p.d.spd / 40;
      const dx = p.tx - p.x, dy = p.ty - p.y, d = hyp(dx, dy);
      let des = sp0 * p.ts; if (d < 1.2) des = Math.min(des, d * 2);
      const dvx = d > 0.03 ? dx / d * des : 0, dvy = d > 0.03 ? dy / d * des : 0;
      const acc = 12 * TDT;
      let ax = dvx - p.vx, ay = dvy - p.vy; const al = hyp(ax, ay); if (al > acc) { ax *= acc / al; ay *= acc / al; }
      p.vx += ax; p.vy += ay; p.x += p.vx * TDT; p.y += p.vy * TDT;
      // face au filet sauf en course
      const facing = -this.side(p.i) > 0 ? 0 : Math.PI;
      const ta = hyp(p.vx, p.vy) > 2.5 ? Math.atan2(p.vy, p.vx) : facing;
      let da = ta - p.ang; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      p.ang += da * Math.min(1, 8 * TDT);
    }
  }

  snap() {
    const arr = this.ring, off = this.ringPos * SNAP_LEN;
    for (let i = 0; i < 25; i++) arr[off + i * ENT] = 9999;
    this.pl.forEach((p, k) => {
      const o = off + (k * 11) * ENT;
      arr[o] = p.x; arr[o + 1] = p.y; arr[o + 2] = p.ang; arr[o + 3] = hyp(p.vx, p.vy); arr[o + 4] = p.act; arr[o + 5] = p.actT;
    });
    // arbitre de chaise
    const u = off + 22 * ENT;
    arr[u] = 0; arr[u + 1] = -TW - 2.2; arr[u + 2] = Math.PI / 2; arr[u + 3] = 0; arr[u + 4] = 0; arr[u + 5] = 0;
    const bo = off + 25 * ENT;
    arr[bo] = this.ball.vis ? this.ball.x : 9999; arr[bo + 1] = this.ball.y; arr[bo + 2] = this.ball.h;
    this.ringPos = (this.ringPos + 1) % 4;
  }
}
