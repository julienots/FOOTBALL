// Course automobile déterministe : 16 monoplaces sur un circuit fermé.
// Profil de vitesse selon les virages, talent du pilote, usure des pneus,
// arrêt au stand, dépassements, accrochages, abandons, meilleur tour.
import { RNG, clamp } from '../core/rng.js';

export const RDT = 0.05;

// Circuit : points de contrôle (mètres), courbe fermée lissée
const CTRL = [
  [0, 0], [420, 0], [560, 40], [600, 160], [540, 260], [400, 300], [330, 420], [380, 560], [300, 650],
  [120, 640], [-40, 560], [-120, 430], [-60, 320], [-200, 250], [-330, 300], [-420, 220], [-380, 80], [-220, 10],
];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

export function buildTrack() {
  const n = CTRL.length;
  const pts = [];
  for (let i = 0; i < n; i++) for (let k = 0; k < 40; k++) pts.push(catmull(CTRL[(i - 1 + n) % n], CTRL[i], CTRL[(i + 1) % n], CTRL[(i + 2) % n], k / 40));
  // ré-échantillonnage tous les 2 m
  const seg = []; let L = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const d = Math.hypot(b[0] - a[0], b[1] - a[1]); seg.push(d); L += d; }
  const step = 2, N = Math.floor(L / step);
  const S = [];
  let si = 0, acc = 0;
  for (let j = 0; j < N; j++) {
    const target = j * step;
    while (acc + seg[si] < target) { acc += seg[si]; si = (si + 1) % pts.length; }
    const f = (target - acc) / seg[si];
    const a = pts[si], b = pts[(si + 1) % pts.length];
    S.push({ x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f });
  }
  const len = N * step;
  // tangentes, normales, courbure
  for (let j = 0; j < N; j++) {
    const a = S[(j - 3 + N) % N], b = S[(j + 3) % N];
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz);
    S[j].tx = tx / tl; S[j].tz = tz / tl; S[j].nx = -S[j].tz; S[j].nz = S[j].tx;
  }
  for (let j = 0; j < N; j++) {
    const a = S[(j - 5 + N) % N], b = S[(j + 5) % N];
    let da = Math.atan2(b.tz, b.tx) - Math.atan2(a.tz, a.tx);
    while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    S[j].k = da / (10 * step);
  }
  // profil de vitesse : virage → vitesse max, puis freinage / accélération
  const aLat = 32, vTop = 92, brake = 40, accel = 11;
  const v = S.map(p => Math.min(vTop, Math.sqrt(aLat / Math.max(1e-4, Math.abs(p.k)))));
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < 2 * N; j++) { const i = j % N, nx = (i + 1) % N; v[nx] = Math.min(v[nx], Math.sqrt(v[i] * v[i] + 2 * accel * step)); }
    for (let j = 2 * N; j > 0; j--) { const i = j % N, pv = (i - 1 + N) % N; v[pv] = Math.min(v[pv], Math.sqrt(v[i] * v[i] + 2 * brake * step)); }
  }
  S.forEach((p, i) => (p.v = v[i]));
  return { S, len, step };
}

let TRACK = null;
export function getTrack() { return TRACK || (TRACK = buildTrack()); }

export class RaceSim {
  constructor({ drivers, seed, laps = 38 }) {
    this.rng = new RNG(seed);
    this.T = getTrack();
    this.laps = laps;
    // grille de départ : qualifications (talent + hasard)
    const order = drivers.map(d => ({ d, q: d.skill + d.car + this.rng.normal(0, 3) })).sort((a, b) => b.q - a.q);
    this.cars = order.map((o, i) => ({
      d: o.d, grid: i + 1, s: -i * 9 - 4, lap: 0, lane: i % 2 ? -2.2 : 2.2, laneT: i % 2 ? -2.2 : 2.2,
      v: 0, tyre: 1, pitLap: Math.round(laps * this.rng.range(0.38, 0.62)), pitted: false, pitT: 0,
      out: false, best: Infinity, lapStart: 0, lastLap: null, pace: 1 + (o.d.skill - 80) / 900 + (o.d.car - 80) / 600,
    }));
    this.t = 0; this.wall = 0; this.started = false; this.finished = false; this.leaderLap = 0;
    this.events = []; this.cursor = 0;
    this.fastest = { t: Infinity, car: null };
    this.lightsT = 6; // séquence des feux
    this.results = [];
  }

  emit(type, d = {}) { this.events.push({ type, ...d }); if (this.events.length > 300) { this.events.splice(0, 150); this.cursor = Math.max(0, this.cursor - 150); } }
  pullEvents() { const o = this.events.slice(this.cursor); this.cursor = this.events.length; return o; }

  syncTo(target, maxSteps = Infinity) {
    let n = 0;
    while (n < maxSteps) {
      if (this.wall >= target) return false;
      if (this.finished && target - this.wall > 600) return true;
      this.step(); n++;
    }
    return false;
  }

  dist(c) { return c.lap * this.T.len + c.s; }
  sample(s) { const S = this.T.S, N = S.length; const i = Math.floor((((s % this.T.len) + this.T.len) % this.T.len) / this.T.step); return S[i % N]; }

  order() { return this.cars.filter(c => !c.out).sort((a, b) => (b.finish ? 1e9 - b.finishPos : this.dist(b)) - (a.finish ? 1e9 - a.finishPos : this.dist(a))); }

  step() {
    this.wall += RDT;
    if (!this.started) {
      this.lightsT -= RDT;
      if (this.lightsT <= 0) { this.started = true; this.emit('start', {}); }
      return;
    }
    this.t += RDT;
    const rng = this.rng;
    const ord = this.order();
    ord.forEach((c, pos) => {
      if (c.finish) { c.v = Math.max(20, c.v - 10 * RDT); c.s += c.v * RDT; return; }
      if (c.pitT > 0) {
        c.pitT -= RDT; c.v = 22; c.s += c.v * RDT * 0.5;
        if (c.pitT <= 0) { c.tyre = 1; this.emit('pitout', { car: c.d.code }); }
        return;
      }
      const p = this.sample(c.s);
      const wear = 1 - (1 - c.tyre) * 0.06;
      let target = p.v * c.pace * wear * (1 + Math.sin(this.t * 0.1 + c.grid) * 0.004);
      // voiture devant : aspiration ou blocage
      const ahead = ord[pos - 1];
      if (ahead && !ahead.finish) {
        const gap = this.dist(ahead) - this.dist(c);
        if (gap < 40 && gap > 0) {
          const faster = target > ahead.v * 1.004;
          const straight = Math.abs(p.k) < 0.004;
          if (gap < 14 && faster && straight && rng.chance(0.012 * (c.d.skill / 85))) {
            c.laneT = -ahead.lane || 2.2; c.overtaking = ahead;
          }
          if (c.overtaking === ahead) target *= 1.035;
          else if (gap < 9) target = Math.min(target, ahead.v * 0.995);
        }
      }
      if (c.overtaking && this.dist(c) > this.dist(c.overtaking) + 8) {
        this.emit('overtake', { car: c.d.code, name: c.d.name, victim: c.overtaking.d.name, pos: pos + 1 });
        c.overtaking = null;
      }
      const acc = target > c.v ? 11 : 38;
      c.v += clamp(target - c.v, -acc * RDT, acc * RDT);
      if (!this.startedFull) c.v = Math.min(c.v, 50 + this.t * 6);
      c.s += c.v * RDT;
      c.lane += (c.laneT - c.lane) * Math.min(1, RDT * 1.5);
      if (!c.overtaking && Math.abs(p.k) > 0.01) c.laneT = clamp(-Math.sign(p.k) * 3, -4, 4);
      else if (!c.overtaking) c.laneT *= 0.995;
      c.tyre = Math.max(0.2, c.tyre - RDT * c.v / this.T.len / 30);
      // tour terminé
      if (c.s >= this.T.len) {
        c.s -= this.T.len; c.lap++;
        const lt = this.t - c.lapStart; c.lapStart = this.t;
        if (c.lap > 1) {
          c.lastLap = lt;
          if (lt < c.best) c.best = lt;
          if (lt < this.fastest.t) { this.fastest = { t: lt, car: c }; if (c.lap > 2) this.emit('fastest', { car: c.d.code, name: c.d.name, time: lt }); }
        }
        if (c.lap > this.leaderLap) { this.leaderLap = c.lap; if (c.lap <= this.laps) this.emit('lap', { lap: c.lap, leader: c.d.name }); }
        if (c.lap === c.pitLap && !c.pitted) { c.pitted = true; c.pitT = rng.range(20, 26); this.emit('pit', { car: c.d.code, name: c.d.name }); }
        if (c.lap >= this.laps + 1 || (this.winner && c.lap >= this.winner.lap)) {
          c.finish = true; c.finishPos = this.results.length + 1; this.results.push(c);
          if (!this.winner) { this.winner = c; this.emit('win', { car: c.d.code, name: c.d.name, team: c.d.team }); }
          if (this.results.length >= this.cars.filter(x => !x.out).length) { this.finished = true; this.emit('end', {}); }
        }
      }
      // incident rare
      if (!c.out && rng.chance(0.00000006 * (100 - c.d.skill + 10))) {
        c.out = true; this.emit('dnf', { car: c.d.code, name: c.d.name, reason: rng.pick(['sortie de piste', 'problème moteur', 'crevaison', 'accrochage']) });
      }
    });
    this.startedFull = this.startedFull || this.t > 6;
  }

  gapToLeader(c, leader) {
    if (c === leader) return 0;
    const d = this.dist(leader) - this.dist(c);
    return d / Math.max(30, c.v || 60);
  }
}
