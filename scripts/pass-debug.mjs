import { getWorld } from '../src/data/world.js';
import { FootballMatch } from '../src/football/engine.js';
const w = getWorld();
const P = FootballMatch.prototype;
const origPass = P.pass, origEmit = P.emit;
const out = { };
let cur = null;
function close(res) { if (!cur) return; const k = `${cur.lofted ? 'L' : 'G'}${cur.dist > 30 ? '>30' : cur.dist > 15 ? '15-30' : '<15'}${cur.through?'T':''}`; out[k] = out[k] || {}; out[k][res] = (out[k][res] || 0) + 1; cur = null; }
P.pass = function (p, m, tx, ty, lofted, sp, through) { close('repass?'); cur = { lofted, dist: Math.hypot(tx - this.ball.x, ty - this.ball.y), through, m, team: p.team }; return origPass.apply(this, arguments); };
const origCC = P.checkControl;
P.checkControl = function () {
  const before = this.ball.owner;
  origCC.call(this);
  const o = this.ball.owner;
  if (cur && o && o !== before) close(o === cur.m ? 'ok' : o.team === cur.team ? 'mate' : 'opp');
};
const origHeader = P.header;
P.header = function (p) { if (cur) close(p === cur.m ? 'head-ok' : p.team === cur.team ? 'head-mate' : 'head-opp'); return origHeader.call(this, p); };
const origRestart = P.setRestart;
P.setRestart = function (t) { close('out-' + t); return origRestart.apply(this, arguments); };
const m = new FootballMatch({ home: w.clubs[0], away: w.clubs[4], seed: 'pd', speed: 1, h2Offset: 3840, record: false });
m.syncTo(2700);
for (const k of Object.keys(out).sort()) console.log(k, JSON.stringify(out[k]));
