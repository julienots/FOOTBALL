import { getTennisTour } from '../src/tennis/data.js';
import { TennisMatch } from '../src/tennis/engine.js';
const T = getTennisTour();
for (let i = 0; i < 4; i++) {
  const t0 = Date.now();
  const m = new TennisMatch({ p1: T.players[i], p2: T.players[i + 5], seed: 'tt' + i });
  m.syncTo(1e9);
  const c = {}; for (const e of m.events) c[e.type] = (c[e.type] || 0) + 1;
  console.log(m.sets.map(s => s.join('-')).join(' '), 'winner', m.winner, 'durée', Math.round(m.wall / 60) + 'min', Date.now() - t0 + 'ms', JSON.stringify(m.stats), c.point);
}
