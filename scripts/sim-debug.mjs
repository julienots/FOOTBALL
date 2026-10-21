import { getWorld } from '../src/data/world.js';
import { FootballMatch } from '../src/football/engine.js';
const w = getWorld();
const m = new FootballMatch({ home: w.clubs[0], away: w.clubs[3], seed: 'dbg', speed: 1, h2Offset: 3840, record: false, keepEvents: true });
const until = +process.argv[2] || 120;
m.syncTo(until);
for (const e of m.events) {
  const { type, clock, tick, period, minute, ...rest } = e;
  console.log((tick*0.05).toFixed(1), type, JSON.stringify(rest).slice(0, 150));
}
