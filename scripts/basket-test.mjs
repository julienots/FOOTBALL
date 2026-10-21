import { getBasketLeague } from '../src/basket/data.js';
import { BasketMatch } from '../src/basket/engine.js';
const L = getBasketLeague();
for (let i = 0; i < 4; i++) {
  const t0 = Date.now();
  const m = new BasketMatch({ home: L.teams[i], away: L.teams[i + 4], seed: 'bt' + i });
  m.syncTo(1e9);
  const c = {}; for (const e of m.events) c[e.type] = (c[e.type] || 0) + 1;
  console.log(c.steal, c.shotclock, m.score, 'q', m.quarter, Date.now() - t0 + 'ms', 'wall', Math.round(m.wall), JSON.stringify(m.stats.map(s => `${s.fgm}/${s.fga} 3p ${s.tpm}/${s.tpa} ft ${s.ftm}/${s.fta} reb ${s.reb} to ${s.to}`)));
}
