import { getWorld } from '../src/data/world.js';
import { FootballMatch } from '../src/football/engine.js';
const w = getWorld();
const m = new FootballMatch({ home: w.clubs[1], away: w.clubs[8], seed: 'x', speed: 1, h2Offset: 3840, record: false });
const P = FootballMatch.prototype; const o = P.shoot; let n = 0;
function draw(m, T) {
  const W = 70, H = 24; const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const put = (x, y, c) => { const [fx, fy] = m.frameOf(T, x, y); const cx = Math.round((fx + 52.5) / 105 * (W - 1)), cy = Math.round((34 - fy) / 68 * (H - 1)); if (cy >= 0 && cy < H && cx >= 0 && cx < W) g[cy][cx] = c; };
  for (const p of m.allPlayers()) put(p.x, p.y, p.team === T ? (p.isGK ? 'G' : 'A') : (p.isGK ? 'K' : 'd'));
  put(m.ball.x, m.ball.y, 'o');
  return g.map(r => r.join('')).join('\n');
}
P.shoot = function (p, k) { if (k === 'open' && n++ < 4) { console.log(`shot by ${p.role} t=${(this.tick*.05).toFixed(1)} poss=${this.possTeam}`); console.log(draw(this, p.team)); } return o.apply(this, arguments); };
m.syncTo(900);
