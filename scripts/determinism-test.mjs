// Le match regardé en direct (avancé image par image) doit être identique
// au match calculé d'un seul coup en arrière-plan (classements).
import { getWorld } from '../src/data/world.js';
import { FootballMatch } from '../src/football/engine.js';
const w = getWorld();
const opts = { home: w.clubs[2], away: w.clubs[9], seed: 'det', speed: 1, knockout: true, h2Offset: 3810 };
const a = new FootballMatch({ ...opts, record: false });
a.syncTo(1e9);
const b = new FootballMatch({ ...opts, record: true });
let t = 0;
while (!b.syncTo(t, 400)) t += 0.016 + Math.random() * 0.05;
const sa = JSON.stringify(a.summary()), sb = JSON.stringify(b.summary());
console.log(sa === sb ? 'OK identique' : 'DIFFERENT', a.score, b.score, a.pens?.score, b.pens?.score);
process.exit(sa === sb ? 0 : 1);
