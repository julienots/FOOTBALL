// Génère tout l'univers sportif (joueurs, clubs, sélections) à partir d'une
// graine fixe : chaque lancement de l'appli retrouve exactement les mêmes joueurs.
import { RNG, clamp } from '../core/rng.js';
import { NATIONS, NATION_CODES, CLUB_DEFS } from './names.js';

export const FORMATIONS = {
  '4-4-2': [
    ['GK', -50, 0], ['DG', -35, 22], ['DC', -38, 7], ['DC', -38, -7], ['DD', -35, -22],
    ['MG', -13, 24], ['MC', -16, 7], ['MC', -16, -7], ['MD', -13, -24], ['BU', 3, 7], ['BU', 3, -7],
  ],
  '4-3-3': [
    ['GK', -50, 0], ['DG', -35, 23], ['DC', -38, 8], ['DC', -38, -8], ['DD', -35, -23],
    ['MDC', -22, 0], ['MC', -13, 14], ['MC', -13, -14], ['AG', 0, 24], ['BU', 3, 0], ['AD', 0, -24],
  ],
  '4-2-3-1': [
    ['GK', -50, 0], ['DG', -35, 23], ['DC', -38, 8], ['DC', -38, -8], ['DD', -35, -23],
    ['MDC', -22, 8], ['MDC', -22, -8], ['MG', -6, 23], ['MOC', -5, 0], ['MD', -6, -23], ['BU', 3, 0],
  ],
  '3-5-2': [
    ['GK', -50, 0], ['DC', -38, 14], ['DC', -40, 0], ['DC', -38, -14],
    ['PG', -15, 28], ['MDC', -22, 0], ['MC', -12, 12], ['MC', -12, -12], ['PD', -15, -28], ['BU', 3, 7], ['BU', 3, -7],
  ],
};

export const ROLE_LINE = {
  GK: 'GK', DG: 'DF', DC: 'DF', DD: 'DF', PG: 'MF', PD: 'MF', MDC: 'MF', MC: 'MF', MG: 'MF', MD: 'MF',
  MOC: 'MF', AG: 'FW', AD: 'FW', BU: 'FW',
};

export const ROLE_LABEL = {
  GK: 'gardien', DG: 'latéral gauche', DD: 'latéral droit', DC: 'défenseur central', PG: 'piston gauche',
  PD: 'piston droit', MDC: 'milieu défensif', MC: 'milieu central', MG: 'milieu gauche', MD: 'milieu droit',
  MOC: 'meneur de jeu', AG: 'ailier gauche', AD: 'ailier droit', BU: 'avant-centre',
};

const PROFILES = {
  GK: { pac: -25, sho: -40, pas: -15, dri: -30, def: -20, phy: 0, gk: 4 },
  DF: { pac: -2, sho: -22, pas: -6, dri: -10, def: 5, phy: 4, gk: -60 },
  MF: { pac: 0, sho: -4, pas: 5, dri: 3, def: -6, phy: -2, gk: -60 },
  FW: { pac: 4, sho: 5, pas: -4, dri: 4, def: -28, phy: 0, gk: -60 },
};

const HAIR_COLORS = ['#1a1410', '#2b1d14', '#3d2817', '#5a3a1e', '#8a5a2b', '#b8894a', '#d9b26f', '#141414', '#6b4a2f'];
const STYLES = ['possession', 'contre', 'direct', 'pressing', 'équilibré'];

function makePlayer(rng, nationCode, line, role, teamRating, idSeq, star = false) {
  const nat = NATIONS[nationCode];
  const first = rng.pick(nat.first);
  const last = rng.pick(nat.last);
  let ovr = Math.round(clamp(rng.normal(teamRating - 2, 3.5) + (star ? rng.range(5, 10) : 0), 45, 95));
  const prof = PROFILES[line];
  const attrs = {};
  for (const k of Object.keys(prof)) attrs[k] = Math.round(clamp(ovr + prof[k] + rng.normal(0, 5), 20, 99));
  if (line === 'GK') attrs.gk = Math.round(clamp(ovr + rng.normal(2, 2), 40, 97));
  if (role === 'AG' || role === 'AD' || role === 'DG' || role === 'DD' || role === 'PG' || role === 'PD') attrs.pac = Math.min(99, attrs.pac + 5);
  if (role === 'MOC') { attrs.pas = Math.min(99, attrs.pas + 4); attrs.dri = Math.min(99, attrs.dri + 3); }
  if (role === 'MDC') { attrs.def = Math.min(99, attrs.def + 10); }
  const skinRange = nat.skin;
  const skin = clamp(rng.range(skinRange[0], skinRange[1]), 0, 1);
  const hairStyle = rng.int(0, 4);
  const height = line === 'GK' ? rng.range(1.86, 1.98) : rng.range(1.68, 1.94);
  return {
    id: idSeq.n++, first, last, name: `${first} ${last}`, short: last, nation: nationCode,
    age: rng.int(18, 35), line, role, ovr, attrs, star,
    look: {
      skin, height,
      hairStyle, hairColor: skin > 0.7 ? '#120d0a' : rng.pick(HAIR_COLORS),
      beard: rng.chance(0.3),
    },
    foot: rng.chance(0.25) ? 'gauche' : 'droit',
  };
}

function buildSquad(rng, team, nationPicker, idSeq) {
  const form = FORMATIONS[team.formation];
  const squad = [];
  const starIdx = new Set();
  const nStars = team.rating > 80 ? rng.int(1, 3) : rng.int(0, 1);
  while (starIdx.size < nStars) starIdx.add(rng.int(5, 10));
  form.forEach(([role], i) => squad.push(makePlayer(rng, nationPicker(), ROLE_LINE[role], role, team.rating, idSeq, starIdx.has(i))));
  // Banc : gardien, 2 défenseurs, 2 milieux, 2 attaquants
  const bench = [['GK', 'GK'], ['DF', 'DC'], ['DF', 'DD'], ['MF', 'MC'], ['MF', 'MDC'], ['FW', 'BU'], ['FW', 'AG']];
  for (const [line, role] of bench) squad.push(makePlayer(rng, nationPicker(), line, role, team.rating - 3, idSeq));
  // Numéros de maillot
  const used = new Set();
  const pref = { GK: [1, 16, 30], DF: [2, 3, 4, 5, 6, 12, 13, 15, 22, 23], MF: [6, 8, 10, 14, 17, 18, 20, 21, 24, 26], FW: [7, 9, 11, 19, 27, 29, 99] };
  squad.forEach((p, i) => {
    let n = (i === 0) ? 1 : null;
    if (p.role === 'BU' && i < 11 && !used.has(9)) n = 9;
    if (p.role === 'MOC' && !used.has(10)) n = 10;
    if (!n) n = pref[p.line].find(v => !used.has(v));
    while (!n || used.has(n)) n = rng.int(2, 40);
    used.add(n); p.number = n;
  });
  team.squad = squad;
  const starters = squad.slice(0, 11);
  team.strength = Math.round(starters.reduce((a, p) => a + p.ovr, 0) / 11);
  team.attack = Math.round(starters.filter(p => p.line !== 'GK').reduce((a, p) => a + (p.attrs.sho + p.attrs.dri + p.attrs.pas) / 3, 0) / 10);
  team.defense = Math.round(starters.filter(p => p.line !== 'FW').reduce((a, p) => a + (p.line === 'GK' ? p.attrs.gk : p.attrs.def), 0) / starters.filter(p => p.line !== 'FW').length);
}

const NATION_RATING = {
  FRA: 86, BRA: 86, ESP: 85, ARG: 85, ENG: 84, GER: 83, POR: 83, NED: 81, ITA: 81, BEL: 79,
  CRO: 78, MAR: 78, SEN: 76, JPN: 75, USA: 74, MEX: 74, NGA: 73, CIV: 74, ALG: 73, CMR: 72,
};

function awayKit(primary, secondary) {
  const lum = hexLum(primary);
  if (lum > 0.6) return [secondary, primary];
  return ['#f2f2f2', primary];
}
export function hexLum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

let WORLD = null;
export function getWorld() {
  if (WORLD) return WORLD;
  const rng = new RNG('SPORT-TV-UNIVERS-V1');
  const idSeq = { n: 1 };
  const formations = Object.keys(FORMATIONS);
  const clubs = CLUB_DEFS.map((c, i) => {
    const rating = Math.round(clamp(86 - i * 1.4 + rng.normal(0, 1.5), 64, 88));
    const t = {
      id: 'C' + i, kind: 'club', name: c.name, short: c.short, city: c.city, stadium: c.stadium,
      colors: c.colors, away: awayKit(c.colors[0], c.colors[1]), rating,
      formation: rng.pick(formations), style: rng.pick(STYLES),
      capacity: Math.round(rng.range(22, 68)) * 1000,
    };
    const domestic = 'FRA';
    buildSquad(rng, t, () => (rng.chance(0.55) ? domestic : rng.pick(NATION_CODES)), idSeq);
    t.coach = makeCoach(rng, domestic);
    return t;
  });
  const nations = NATION_CODES.map((code) => {
    const n = NATIONS[code];
    const t = {
      id: 'N' + code, kind: 'nation', code, name: n.name, short: code, city: n.name,
      stadium: 'Stade International', colors: n.kit, away: awayKit(n.kit[0], n.kit[1]),
      rating: NATION_RATING[code] || 72, formation: rng.pick(formations), style: rng.pick(STYLES),
      flag: n.flag, capacity: 60000,
    };
    buildSquad(rng, t, () => code, idSeq);
    t.coach = makeCoach(rng, code);
    return t;
  });
  const teams = {};
  [...clubs, ...nations].forEach(t => (teams[t.id] = t));
  const players = {};
  Object.values(teams).forEach(t => t.squad.forEach(p => { players[p.id] = p; p.teamId = t.id; }));
  WORLD = { clubs, nations, teams, players };
  return WORLD;
}

function makeCoach(rng, code) {
  const nat = NATIONS[code];
  return `${rng.pick(nat.first)} ${rng.pick(nat.last)}`;
}

// Choix des couleurs : si les maillots se ressemblent, l'extérieur passe en tenue alternative.
export function kitsFor(home, away) {
  const h = { shirt: home.colors[0], shorts: home.colors[1] };
  let a = { shirt: away.colors[0], shorts: away.colors[1] };
  if (colorDist(h.shirt, a.shirt) < 120) a = { shirt: away.away[0], shorts: away.away[1] };
  if (colorDist(h.shirt, a.shirt) < 120) a = { shirt: '#222222', shorts: '#222222' };
  const gkH = colorDist(h.shirt, '#2bd14a') > 150 && colorDist(a.shirt, '#2bd14a') > 150 ? '#2bd14a' : '#ff8a00';
  const gkA = colorDist(h.shirt, '#7b1fa2') > 150 && colorDist(a.shirt, '#7b1fa2') > 150 && gkH !== '#7b1fa2' ? '#7b1fa2' : '#d4e157';
  return { home: { ...h, gk: gkH }, away: { ...a, gk: gkA } };
}
export function colorDist(a, b) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const dr = ((x >> 16) & 255) - ((y >> 16) & 255);
  const dg = ((x >> 8) & 255) - ((y >> 8) & 255);
  const db = (x & 255) - (y & 255);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
