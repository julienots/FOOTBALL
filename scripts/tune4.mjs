import { getWorld } from '../src/data/world.js';
import { FootballMatch } from '../src/football/engine.js';
const w = getWorld();
const m = new FootballMatch({ home: w.clubs[1], away: w.clubs[8], seed: 'x', speed: 1, h2Offset: 3840, record: false });
const P = FootballMatch.prototype; const o = P.shoot; const zones = {}; const durs = [];
P.shoot = function (p, k) { if (k === 'open' && this.possStart) { const [fx] = this.frameOf(p.team, this.possStart.x, this.possStart.y); const z = Math.floor((fx + 52.5) / 15) * 15 - 52; zones[z] = (zones[z] || 0) + 1; durs.push(((this.tick - this.possStart.tick) * 0.05).toFixed(0)); } return o.apply(this, arguments); };
m.syncTo(2700);
console.log(zones, durs.join(' '));
