// Championnat automobile fictif : 8 écuries, 16 pilotes inventés.
import { RNG, clamp } from '../core/rng.js';
import { NATIONS, NATION_CODES } from '../data/names.js';

const TEAMS = [
  ['Valkyr Racing', '#d50000', '#ffffff'], ['Aurora GP', '#0d47a1', '#ffd600'], ['Nordline', '#00bfa5', '#212121'],
  ['Lumina Motorsport', '#ff6d00', '#0b1e4f'], ['Scuderia Calvera', '#b71c1c', '#ffd600'], ['Silverstorm', '#cfd8dc', '#00838f'],
  ['Kestrel F', '#2e7d32', '#ffffff'], ['Phantom Black', '#212121', '#ffeb3b'],
];
export const CIRCUITS = ['Grand Prix de Valmont', 'Grand Prix de Port-Azur', 'Grand Prix de Nordhaven', 'Grand Prix de Calvera', 'Grand Prix de Solenne', 'Grand Prix de Kervel'];

let GRID = null;
export function getRacing() {
  if (GRID) return GRID;
  const rng = new RNG('RACING-V1');
  const drivers = [];
  TEAMS.forEach(([team, c1, c2], ti) => {
    const car = Math.round(clamp(92 - ti * 1.6 + rng.normal(0, 1.5), 75, 95));
    for (let k = 0; k < 2; k++) {
      const nat = rng.pick(NATION_CODES), N = NATIONS[nat];
      const last = rng.pick(N.last);
      drivers.push({ id: 'R' + drivers.length, name: `${rng.pick(N.first)} ${last}`, short: last, code: last.normalize('NFD').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(), nation: nat, team, colors: [c1, c2], car, skill: Math.round(clamp(rng.normal(84, 5), 70, 97)), number: [1, 4, 7, 10, 11, 14, 16, 18, 22, 23, 27, 31, 44, 55, 63, 81][drivers.length] });
    }
  });
  GRID = { drivers };
  return GRID;
}
