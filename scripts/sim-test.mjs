import { getWorld } from '../src/data/world.js';
import { FootballMatch } from '../src/football/engine.js';
const w = getWorld();
const N = +process.argv[2] || 6;
const speed = +process.argv[3] || 1;
let goals = 0, t0 = Date.now();
const tally = {};
for (let i = 0; i < N; i++) {
  const h = w.clubs[i % 16], a = w.clubs[(i * 5 + 3) % 16];
  const m = new FootballMatch({ home: h, away: a, seed: 'test' + i, speed, knockout: i % 3 === 0, h2Offset: 64 * 60 / speed, record: false });
  const s = Date.now();
  m.syncTo(1e9);
  const ev = {};
  for (const e of m.events) ev[e.type] = (ev[e.type] || 0) + 1;
  for (const k in ev) tally[k] = (tally[k] || 0) + ev[k];
  goals += m.score[0] + m.score[1];
  const st = m.stats;
  console.log(`${h.short}(${h.strength}) ${m.score[0]}-${m.score[1]} ${a.short}(${a.strength})`, m.pens ? `pens ${m.pens.score}` : '', `${Date.now() - s}ms ticks=${m.tick}`,
    `shots ${st[0].shots}/${st[1].shots} ot ${st[0].onTarget}/${st[1].onTarget} pass ${st[0].passOk}/${st[0].passes} ${st[1].passOk}/${st[1].passes} poss ${Math.round(100 * st[0].poss / (st[0].poss + st[1].poss))}% corners ${st[0].corners}/${st[1].corners} fouls ${st[0].fouls}/${st[1].fouls} off ${st[0].offsides}/${st[1].offsides}`);
}
console.log('avg goals', goals / N, 'total ms', Date.now() - t0);
console.log(tally);
