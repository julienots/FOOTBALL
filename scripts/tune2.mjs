import { getWorld } from '../src/data/world.js';
import { FootballMatch } from '../src/football/engine.js';
const w = getWorld();
const m = new FootballMatch({ home: w.clubs[1], away: w.clubs[8], seed: 'x', speed: 1, h2Offset: 3840, record: false, keepEvents: true });
const P = FootballMatch.prototype; const kinds = {}; const src = {};
const o = P.shoot; P.shoot = function (p, k) { kinds[k] = (kinds[k] || 0) + 1; const st = new Error().stack.split('\n')[2].trim().split(' ')[1]; src[st] = (src[st] || 0) + 1; return o.apply(this, arguments); };
m.syncTo(2700);
console.log(kinds, src);
