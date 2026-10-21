import { getWorld } from '../src/data/world.js';
import { FootballMatch } from '../src/football/engine.js';
const w = getWorld();
const N = +process.argv[2] || 3;
const agg = {};
for (let i = 0; i < N; i++) {
  const m = new FootballMatch({ home: w.clubs[i], away: w.clubs[i + 5], seed: 'g' + i, speed: 1, h2Offset: 3840, record: false, keepEvents: true });
  m.syncTo(1e9);
  const evs = m.events;
  for (const e of evs) { const k = e.type + (e.rtype ? ':' + e.rtype : ''); agg[k] = (agg[k] || 0) + 1; }
  // pour chaque but, les 4 événements précédents
  evs.forEach((e, j) => { if (e.type === 'goal') console.log('GOAL', e.minute, evs.slice(Math.max(0, j - 4), j).map(x => x.type + (x.rtype||'') + (x.kind ? '/' + x.kind : '') + (x.dist ? '@' + x.dist : '') + (x.onTarget!==undefined ? (x.onTarget?'OT':'off') : '')).join(' > ')); });
  console.log(m.score, m.stats.map(s => `sh${s.shots} ot${s.onTarget} sv${s.saves} xg${s.xg.toFixed(1)} p${s.passOk}/${s.passes}`));
}
console.log(Object.entries(agg).map(([k, v]) => `${k}:${(v / N).toFixed(1)}`).join('  '));
