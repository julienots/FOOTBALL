import { getWorld } from '../src/data/world.js';
import { FootballMatch } from '../src/football/engine.js';
const w = getWorld();
const H = {};
for (let i = 0; i < 3; i++) {
  const m = new FootballMatch({ home: w.clubs[i], away: w.clubs[i + 6], seed: 'h' + i, speed: 1, h2Offset: 3840, record: false, keepEvents: true });
  m.syncTo(1e9);
  const ev = m.events;
  ev.forEach((e, j) => {
    if (e.type !== 'shot') return;
    const b = e.kind + ':' + (e.dist < 8 ? '<8' : e.dist < 12 ? '8-12' : e.dist < 18 ? '12-18' : e.dist < 25 ? '18-25' : '25+');
    H[b] = H[b] || { n: 0, ot: 0, goal: 0, xg: 0 };
    H[b].n++; H[b].xg += e.xg; if (e.onTarget) H[b].ot++;
    const nx = ev.slice(j + 1, j + 4).find(x => x.type === 'goal' || x.type === 'shot');
    if (nx && nx.type === 'goal') H[b].goal++;
  });
}
for (const k of Object.keys(H).sort()) console.log(k.padEnd(14), H[k].n, 'ot', H[k].ot, 'g', H[k].goal, 'xg', H[k].xg.toFixed(1));
