import { getWorld } from '../src/data/world.js';
import { FootballMatch } from '../src/football/engine.js';
const w = getWorld();
const m = new FootballMatch({ home: w.clubs[1], away: w.clubs[8], seed: 'x', speed: 1, h2Offset: 3840, record: false, keepEvents: true });
const P = FootballMatch.prototype; const o = P.shoot; const lines = [];
P.shoot = function (p, k) { if (k === 'open' && this.possStart) { const [fx] = this.frameOf(p.team, this.possStart.x, this.possStart.y); if (fx > -99) { const ps = this.possStart.tick; const prev = this.events.filter(e => e.tick <= ps).slice(-4).map(e => e.type + (e.rtype||'') + '(' + (e.team) + ')' + (e.fromName ? e.fromName+'>'+e.toName : e.name || '')); lines.push(`shooter team ${p.team} | ` + prev.join(' , ')); } } return o.apply(this, arguments); };
m.syncTo(2700);
console.log(lines.join('\n'));
