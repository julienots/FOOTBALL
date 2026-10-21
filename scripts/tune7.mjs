import { getWorld } from '../src/data/world.js';
import { FootballMatch } from '../src/football/engine.js';
const w = getWorld();
const P = FootballMatch.prototype; const og = P.goal; const C = {};
P.goal = function (side) { const s = this.ball.shot; const k = !s ? 'noshot:' + (this.lastTouch?.p.isGK ? 'gk' : this.lastTouch?.team === (this.dirOf(0) === side ? 0 : 1) ? 'att' : 'def') : s.save ? 'save-planned' : s.onTarget ? 'ot-nosave' : 'offtarget?'; C[k] = (C[k] || 0) + 1; return og.call(this, side); };
const os = P.shoot; let gkInfo = [];
for (let i = 0; i < 4; i++) { const m = new FootballMatch({ home: w.clubs[i], away: w.clubs[i + 6], seed: 'h' + i, speed: 1, h2Offset: 3840, record: false }); m.syncTo(1e9); }
console.log(C);
