import { getWorld } from '../src/data/world.js';
import { FootballMatch } from '../src/football/engine.js';
const w = getWorld();
const m = new FootballMatch({ home: w.clubs[1], away: w.clubs[8], seed: 'x', speed: 1, h2Offset: 3840, record: false });
m.debugDecisions = [];
m.syncTo(1500);
for (const d of m.debugDecisions) console.log(d);
