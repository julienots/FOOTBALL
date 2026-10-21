// Saison : calendrier des compétitions, grille de diffusion, résultats et classements.
// La grille est calculée à partir de l'heure réelle : comme une vraie chaîne,
// le programme continue même quand l'appli est fermée.
import { RNG } from '../core/rng.js';
import { getWorld } from './world.js';

export const EPOCH = Date.UTC(2026, 0, 5, 0, 0, 0);

export const SPEEDS = {
  1: { label: 'Temps réel (90 min)', short: '90 min' },
  2: { label: 'Accéléré ×2 (45 min)', short: '45 min' },
  3: { label: 'Accéléré ×3 (30 min)', short: '30 min' },
};

// Durées (secondes réelles) d'une case de programme football
export function footTiming(k) {
  const pre = k === 1 ? 360 : k === 2 ? 180 : 150;
  const h1Max = Math.round((48 * 60) / k) + 30;
  const ht = k === 1 ? 15 * 60 : k === 2 ? 8 * 60 : 6 * 60;
  const h2Offset = h1Max + ht; // depuis le coup d'envoi
  const h2Max = Math.round((50 * 60) / k) + 30;
  const pensReserve = k === 1 ? 6 * 60 : 4 * 60;
  const post = k === 1 ? 6 * 60 : 3 * 60;
  const raw = pre + h2Offset + h2Max + pensReserve + post;
  const cycle = Math.ceil(raw / 300) * 300;
  return { pre, h1Max, ht, h2Offset, h2Max, cycle };
}

export const COMP = {
  L: { name: 'Ligue Élite', short: 'LIGUE ÉLITE', color: '#1565c0' },
  C: { name: 'Coupe Nationale', short: 'COUPE NATIONALE', color: '#c62828' },
  N: { name: 'Coupe des Nations', short: 'COUPE DES NATIONS', color: '#f9a825' },
  S: { name: 'Supercoupe', short: 'SUPERCOUPE', color: '#6a1b9a' },
};

const ROUND_NAMES = { R16: 'Huitièmes de finale', QF: 'Quarts de finale', SF: 'Demi-finales', F: 'Finale' };

function roundRobin(ids, rng) {
  const t = rng.shuffle([...ids]);
  const n = t.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const ms = [];
    for (let i = 0; i < n / 2; i++) {
      const a = t[i], b = t[n - 1 - i];
      ms.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(ms);
    t.splice(1, 0, t.pop());
  }
  const back = rounds.map(ms => ms.map(([a, b]) => [b, a]));
  return rounds.concat(back);
}

function poisson(rng, lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p > L && k < 12);
  return k - 1;
}

export function quickSim(home, away, seed, { knockout = false, neutral = false } = {}) {
  const rng = new RNG(seed);
  const dr = home.strength - away.strength;
  const lh = 1.3 * Math.exp(dr / 34) + (neutral ? 0 : 0.2);
  const la = 1.15 * Math.exp(-dr / 34);
  const score = [poisson(rng, lh), poisson(rng, la)];
  const goals = [];
  [home, away].forEach((t, ti) => {
    const starters = t.squad.slice(0, 11).filter(p => p.line !== 'GK');
    for (let g = 0; g < score[ti]; g++) {
      const p = rng.weighted(starters, q => ({ FW: 5, MF: 2.2, DF: 0.6 }[q.line] || 0.1) * (q.attrs.sho / 75) ** 2);
      goals.push({ team: ti, scorer: p.id, minute: rng.int(2, 90) });
    }
  });
  goals.sort((a, b) => a.minute - b.minute);
  let pens = null, winner = score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : null;
  if (knockout && winner === null) {
    let a = 0, b = 0;
    for (let i = 0; i < 5; i++) { if (rng.chance(0.76)) a++; if (rng.chance(0.76)) b++; }
    while (a === b) { if (rng.chance(0.75)) a++; if (rng.chance(0.75)) b++; }
    pens = [a, b]; winner = a > b ? 0 : 1;
  }
  return { score, goals, pens, winner, quick: true };
}

// ------------------------------------------------------------------
export class Season {
  constructor(seasonIdx, k, fullSim) {
    this.idx = seasonIdx;
    this.k = k;
    this.fullSim = fullSim; // async (params) => summary
    this.world = getWorld();
    this.results = new Map();
    const rng = new RNG(`saison-${seasonIdx}`);
    this.rng = rng;
    const W = this.world;
    // Championnat
    this.league = roundRobin(W.clubs.map(c => c.id), rng);
    // Coupe : tirage des huitièmes
    this.cupDraw = rng.shuffle(W.clubs.map(c => c.id));
    // Coupe des nations : 16 sélections, 4 groupes
    const nat = [...W.nations].sort((a, b) => b.rating - a.rating);
    const chosen = nat.slice(0, 12).concat(rng.shuffle(nat.slice(12)).slice(0, 4));
    const pots = [0, 1, 2, 3].map(i => rng.shuffle(chosen.slice(i * 4, i * 4 + 4).map(t => t.id)));
    this.groups = [0, 1, 2, 3].map(g => pots.map(p => p[g]));
    this.items = this.buildItems();
  }

  buildItems() {
    const items = [];
    const rng = new RNG(`grille-${this.idx}`);
    const W = this.world;
    const featured = (matches, n) => {
      const scored = matches.map((m, i) => ({ m, i, s: W.teams[m[0]].strength + W.teams[m[1]].strength + rng.range(0, 14) }));
      return scored.sort((a, b) => b.s - a.s).slice(0, n).map(x => x.i).sort((a, b) => a - b);
    };
    const L = (r) => featured(this.league[r], 2).forEach(i => items.push({ comp: 'L', round: r, idx: i }));
    const KO = (comp, round, n) => { for (let i = 0; i < n; i++) items.push({ comp, round, idx: i, ko: true }); };
    const NG = (md) => featured(this.groupMatches(md), 2).forEach(i => items.push({ comp: 'N', round: 'G' + md, idx: i }));
    items.push({ comp: 'S', round: 'F', idx: 0, ko: true });
    for (let r = 0; r < 3; r++) L(r);
    KO('C', 'R16', 2);
    for (let r = 3; r < 7; r++) L(r);
    NG(0); NG(1); NG(2);
    for (let r = 7; r < 12; r++) L(r);
    KO('C', 'QF', 2);
    for (let r = 12; r < 16; r++) L(r);
    KO('N', 'QF', 4);
    for (let r = 16; r < 20; r++) L(r);
    KO('N', 'SF', 2);
    KO('C', 'SF', 2);
    for (let r = 20; r < 25; r++) L(r);
    KO('N', 'F', 1);
    for (let r = 25; r < 29; r++) L(r);
    KO('C', 'F', 1);
    L(29);
    items.forEach((it, i) => (it.n = i));
    return items;
  }

  groupMatches(md) {
    // 4 équipes : J1 0-1 2-3 ; J2 0-2 1-3 ; J3 0-3 1-2
    const pairs = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]][md];
    const out = [];
    this.groups.forEach(g => pairs.forEach(([a, b]) => out.push([g[a], g[b]])));
    return out;
  }

  // Liste des matches d'un tour (toutes compétitions)
  async roundMatches(comp, round) {
    if (comp === 'L') return this.league[round];
    if (comp === 'N' && String(round).startsWith('G')) return this.groupMatches(+round.slice(1));
    if (comp === 'S') {
      // les deux meilleures équipes sur le papier
      const top = [...this.world.clubs].sort((a, b) => b.strength - a.strength);
      return [[top[0].id, top[1].id]];
    }
    if (comp === 'C') {
      if (round === 'R16') { const d = this.cupDraw; return [0, 1, 2, 3, 4, 5, 6, 7].map(i => [d[2 * i], d[2 * i + 1]]); }
      const prev = { QF: 'R16', SF: 'QF', F: 'SF' }[round];
      const winners = await this.roundWinners('C', prev);
      const out = [];
      for (let i = 0; i < winners.length; i += 2) out.push([winners[i], winners[i + 1]]);
      return out;
    }
    if (comp === 'N') {
      if (round === 'QF') {
        const t = await Promise.all([0, 1, 2, 3].map(g => this.groupTable(g)));
        // A1-B2, B1-A2, C1-D2, D1-C2
        return [[t[0][0].id, t[1][1].id], [t[1][0].id, t[0][1].id], [t[2][0].id, t[3][1].id], [t[3][0].id, t[2][1].id]];
      }
      const prev = { SF: 'QF', F: 'SF' }[round];
      const winners = await this.roundWinners('N', prev);
      const out = [];
      for (let i = 0; i < winners.length; i += 2) out.push([winners[i], winners[i + 1]]);
      return out;
    }
    return [];
  }

  isFeatured(comp, round, idx) {
    return this.items.find(it => it.comp === comp && it.round === round && it.idx === idx) || null;
  }

  matchKey(comp, round, idx) { return `${comp}-${round}-${idx}`; }

  async matchInfo(comp, round, idx) {
    const ms = await this.roundMatches(comp, round);
    const [h, a] = ms[idx];
    const W = this.world;
    const ko = comp !== 'L' && !String(round).startsWith('G');
    return {
      comp, round, idx, key: this.matchKey(comp, round, idx),
      home: W.teams[h], away: W.teams[a], knockout: ko, neutral: comp === 'N' || comp === 'S' || (comp === 'C' && round === 'F'),
      seed: `m-${this.idx}-${comp}-${round}-${idx}-${h}-${a}-k${this.k}`,
      roundLabel: this.roundLabel(comp, round),
    };
  }

  roundLabel(comp, round) {
    if (comp === 'L') return `${round + 1}e journée`;
    if (String(round).startsWith('G')) return `Phase de groupes · ${+round.slice(1) + 1}e journée`;
    return ROUND_NAMES[round] || round;
  }

  // Résultat d'un match (simulation complète si le match est télévisé)
  async result(comp, round, idx) {
    const key = this.matchKey(comp, round, idx);
    if (this.results.has(key)) return this.results.get(key);
    const info = await this.matchInfo(comp, round, idx);
    let res;
    if (this.isFeatured(comp, round, idx)) {
      res = await this.fullSim(info);
    } else {
      res = quickSim(info.home, info.away, info.seed, { knockout: info.knockout, neutral: info.neutral });
    }
    res = { ...res, home: info.home.id, away: info.away.id };
    this.results.set(key, res);
    return res;
  }

  setResult(comp, round, idx, res, info) {
    this.results.set(this.matchKey(comp, round, idx), { ...res, home: info.home.id, away: info.away.id });
  }

  async roundWinners(comp, round) {
    const ms = await this.roundMatches(comp, round);
    const out = [];
    for (let i = 0; i < ms.length; i++) {
      const r = await this.result(comp, round, i);
      out.push(r.winner === 0 ? ms[i][0] : ms[i][1]);
    }
    return out;
  }

  async groupTable(g, n = null) {
    const rows = {};
    for (const id of this.groups[g]) rows[id] = { id, team: this.world.teams[id], j: 0, g: 0, n: 0, p: 0, bp: 0, bc: 0, pts: 0 };
    const done = n == null ? null : this.playedRoundsBefore(n);
    for (let md = 0; md < 3; md++) {
      if (done && !done.has(`N|G${md}`)) continue;
      const ms = this.groupMatches(md);
      for (let i = 0; i < ms.length; i++) {
        if (!this.groups[g].includes(ms[i][0])) continue;
        const r = await this.result('N', 'G' + md, i);
        addResult(rows, ms[i][0], ms[i][1], r.score);
      }
    }
    return sortTable(Object.values(rows));
  }

  // ---- Classements à un instant donné (n = élément de grille en cours) ----
  playedRoundsBefore(n) {
    const done = new Set();
    for (const it of this.items) if (it.n < n) done.add(`${it.comp}|${it.round}`);
    // un tour n'est terminé que si tous ses matches télévisés sont passés
    for (const it of this.items) if (it.n >= n) done.delete(`${it.comp}|${it.round}`);
    return done;
  }

  async leagueTable(n, onlyCached = false) {
    const rows = {};
    for (const c of this.world.clubs) rows[c.id] = { id: c.id, team: c, j: 0, g: 0, n: 0, p: 0, bp: 0, bc: 0, pts: 0, form: [] };
    const done = this.playedRoundsBefore(n);
    for (let r = 0; r < 30; r++) {
      if (!done.has(`L|${r}`)) continue;
      const ms = this.league[r];
      for (let i = 0; i < ms.length; i++) {
        const key = this.matchKey('L', r, i);
        if (onlyCached && !this.results.has(key) && this.isFeatured('L', r, i)) continue;
        const res = await this.result('L', r, i);
        addResult(rows, ms[i][0], ms[i][1], res.score);
      }
    }
    return sortTable(Object.values(rows));
  }

  async topScorers(n, limit = 10) {
    const done = this.playedRoundsBefore(n);
    const tally = {};
    for (const key of this.results.keys()) {
      const [comp, round] = key.split('-');
      const rr = isNaN(+round) ? round : +round;
      if (!done.has(`${comp}|${rr}`)) continue;
      const res = this.results.get(key);
      for (const g of res.goals || []) if (!g.ownGoal && g.scorer) tally[g.scorer] = (tally[g.scorer] || 0) + 1;
    }
    return Object.entries(tally).map(([id, g]) => ({ player: this.world.players[id], goals: g }))
      .filter(x => x.player).sort((a, b) => b.goals - a.goals || a.player.id - b.player.id).slice(0, limit);
  }

  async recentResults(n, count = 8) {
    const out = [];
    for (let j = n - 1; j >= 0 && out.length < count; j--) {
      const it = this.items[j];
      const info = await this.matchInfo(it.comp, it.round, it.idx);
      const r = await this.result(it.comp, it.round, it.idx);
      out.push({ info, res: r });
    }
    return out;
  }

  async roundResults(comp, round) {
    const ms = await this.roundMatches(comp, round);
    const out = [];
    for (let i = 0; i < ms.length; i++) {
      out.push({ info: await this.matchInfo(comp, round, i), res: await this.result(comp, round, i) });
    }
    return out;
  }
}

function addResult(rows, h, a, score) {
  const H = rows[h], A = rows[a];
  if (!H || !A) return;
  H.j++; A.j++;
  H.bp += score[0]; H.bc += score[1]; A.bp += score[1]; A.bc += score[0];
  if (score[0] > score[1]) { H.g++; A.p++; H.pts += 3; H.form?.push('V'); A.form?.push('D'); }
  else if (score[0] < score[1]) { A.g++; H.p++; A.pts += 3; H.form?.push('D'); A.form?.push('V'); }
  else { H.n++; A.n++; H.pts++; A.pts++; H.form?.push('N'); A.form?.push('N'); }
}

function sortTable(rows) {
  return rows.sort((x, y) => y.pts - x.pts || (y.bp - y.bc) - (x.bp - x.bc) || y.bp - x.bp || x.team.name.localeCompare(y.team.name));
}

// ------------------------------------------------------------------
// Grille : quel programme passe à l'instant t (ms) ?
export function footSlotAt(t, k) {
  const T = footTiming(k);
  const cycleMs = T.cycle * 1000;
  const slot = Math.floor((t - EPOCH) / cycleMs);
  const start = EPOCH + slot * cycleMs;
  return { slot, start, kickoff: start + T.pre * 1000, end: start + cycleMs, timing: T };
}

const seasonCache = new Map();
let ITEMS_N = 0;
export function getSeason(slot, k, fullSim) {
  if (!ITEMS_N) ITEMS_N = new Season(0, k, fullSim).items.length;
  const N = ITEMS_N;
  const sIdx = Math.floor(slot / N);
  const key = `${sIdx}-${k}`;
  if (!seasonCache.has(key)) seasonCache.set(key, new Season(sIdx, k, fullSim));
  const season = seasonCache.get(key);
  return { season, item: season.items[((slot % N) + N) % N], N, sIdx };
}
