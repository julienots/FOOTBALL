// Circuit de tennis fictif : 24 joueurs inventés avec leurs caractéristiques.
import { RNG, clamp } from '../core/rng.js';
import { NATIONS, NATION_CODES } from '../data/names.js';

let TOUR = null;
export function getTennisTour() {
  if (TOUR) return TOUR;
  const rng = new RNG('TENNIS-TOUR-V1');
  const players = [];
  for (let i = 0; i < 24; i++) {
    const nat = rng.pick(NATION_CODES);
    const N = NATIONS[nat];
    const lvl = clamp(90 - i * 1.1 + rng.normal(0, 2), 60, 95);
    const f = (b) => Math.round(clamp(lvl + b + rng.normal(0, 6), 40, 99));
    const first = rng.pick(N.first), last = rng.pick(N.last);
    players.push({
      id: 'T' + i, name: `${first} ${last}`, short: last, nation: nat, rank: i + 1, age: rng.int(19, 34),
      serve: f(0), ret: f(-2), fh: f(2), bh: f(-3), spd: f(0), att: f(0), hand: rng.chance(0.85) ? 'droitier' : 'gaucher',
      height: rng.range(1.75, 2.02),
      look: { skin: clamp(rng.range(N.skin[0], N.skin[1]), 0, 1), hairStyle: rng.int(0, 4), hairColor: rng.pick(['#1a1410', '#3d2817', '#8a5a2b', '#d9b26f']), beard: rng.chance(0.25) },
      kit: rng.pick([['#ffffff', '#1a237e'], ['#d32f2f', '#ffffff'], ['#1565c0', '#ffffff'], ['#212121', '#ff6d00'], ['#2e7d32', '#ffffff'], ['#6a1b9a', '#ffd600'], ['#ffd600', '#212121'], ['#00acc1', '#ffffff']]),
    });
  }
  TOUR = { players };
  return TOUR;
}

export const TOURNAMENTS = ['Open de Valmont', 'Masters de Port-Azur', 'Trophée de Bellerive', 'Open International de Calvera', 'Grand Chelem de Nordhaven'];
export const ROUNDS = ['1er tour', '2e tour', 'Huitièmes de finale', 'Quarts de finale', 'Demi-finale', 'Finale'];
