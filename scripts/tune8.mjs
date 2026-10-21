import { getWorld } from '../src/data/world.js';
import { FootballMatch } from '../src/football/engine.js';
const w = getWorld();
const P = FootballMatch.prototype; const og = P.goal;
P.goal = function (side) { const s = this.ball.shot; console.log('GOAL', s ? `kind=${s.kind} ot=${s.onTarget} p0=${s.p0} save=${!!s.save} block=${!!s.block} trav=${s.travelled.toFixed(1)}/${s.dist.toFixed(1)}` : 'noshot', 'ball', this.ball.x.toFixed(1), this.ball.y.toFixed(1), this.ball.h.toFixed(2)); return og.call(this, side); };
const m = new FootballMatch({ home: w.clubs[1], away: w.clubs[8], seed: 'x', speed: 1, h2Offset: 3840, record: false }); m.syncTo(5400);
