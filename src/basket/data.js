// Ligue de basket fictive : 12 clubs, effectifs générés (graine fixe).
import { RNG, clamp } from '../core/rng.js';
import { NATIONS, NATION_CODES } from '../data/names.js';

const CLUBS = [
  ['Lions de Valmont', 'LVA', '#f9a825', '#1a237e'], ['Titans Port-Azur', 'TPA', '#00838f', '#ffffff'],
  ['Rocheval Thunder', 'RTH', '#c62828', '#212121'], ['Bellerive Hawks', 'BEH', '#2e7d32', '#ffd600'],
  ['Montclair Royals', 'MCR', '#4527a0', '#ffffff'], ['Nordhaven Wolves', 'NWO', '#37474f', '#4fc3f7'],
  ['Calvera Sharks', 'CSH', '#0277bd', '#ff7043'], ['Solenne Suns', 'SSU', '#ef6c00', '#4a148c'],
  ['Kervel Knights', 'KKN', '#212121', '#bdbdbd'], ['Aubrac Bisons', 'ABI', '#6d4c41', '#ffcc80'],
  ['Lusiane Phoenix', 'LPH', '#ad1457', '#ffd54f'], ['Talmont Mariners', 'TMA', '#1565c0', '#e0e0e0'],
];
const POS = ['MJ', 'ARR', 'AIL', 'AF', 'PIV'];
const POS_LABEL = { MJ: 'meneur', ARR: 'arrière', AIL: 'ailier', AF: 'ailier fort', PIV: 'pivot' };

let LEAGUE = null;
export function getBasketLeague() {
  if (LEAGUE) return LEAGUE;
  const rng = new RNG('BASKET-LIGUE-V1');
  let id = 1;
  const teams = CLUBS.map(([name, short, c1, c2], ti) => {
    const rating = Math.round(clamp(84 - ti * 1.3 + rng.normal(0, 2), 66, 88));
    const roster = [];
    for (let i = 0; i < 10; i++) {
      const pos = POS[i % 5];
      const nat = rng.chance(0.6) ? 'FRA' : rng.pick(NATION_CODES);
      const N = NATIONS[nat];
      const ovr = Math.round(clamp(rng.normal(rating - (i >= 5 ? 4 : 0), 4) + (i < 5 && rng.chance(0.15) ? 7 : 0), 50, 97));
      const big = i % 5 >= 3;
      const height = big ? rng.range(2.03, 2.18) : i % 5 === 0 ? rng.range(1.83, 1.95) : rng.range(1.93, 2.04);
      const f = (base) => Math.round(clamp(ovr + base + rng.normal(0, 6), 25, 99));
      const first = rng.pick(N.first), last = rng.pick(N.last);
      roster.push({
        id: id++, name: `${first} ${last}`, short: last, nation: nat, pos, posLabel: POS_LABEL[pos], number: [0, 1, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14, 15, 21, 22, 23, 24, 30, 33, 35][(i * 7 + ti) % 20],
        ovr, height, age: rng.int(19, 35),
        tp: f(big ? -18 : 2), mid: f(big ? -6 : 0), ins: f(big ? 6 : -4), def: f(big ? 3 : -2), reb: f(big ? 12 : -10), spd: f(big ? -10 : 6), ft: f(big ? -10 : 4),
        look: { skin: clamp(rng.range(N.skin[0], N.skin[1]), 0, 1), hairStyle: rng.int(0, 4), hairColor: rng.pick(['#111', '#2b1d14', '#5a3a1e', '#b8894a']) },
      });
    }
    // numéros uniques
    const used = new Set();
    roster.forEach(p => { while (used.has(p.number)) p.number = (p.number + 1) % 100; used.add(p.number); });
    return { id: 'B' + ti, name, short, colors: [c1, c2], rating, roster, city: name.split(' ').pop(), arena: `${name.split(' ').pop()} Arena` };
  });
  LEAGUE = { teams };
  return LEAGUE;
}
