import { getWorld } from '../src/data/world.js';
import { FootballMatch, SNAP_LEN, ENT } from '../src/football/engine.js';
const w = getWorld();
const m = new FootballMatch({ home: w.clubs[1], away: w.clubs[8], seed: 'x', speed: 1, h2Offset: 3840, record: true });
const P = FootballMatch.prototype; const o = P.shoot; let n = 0; const skip = +process.argv[2] || 0;
function draw(m, T, snap) {
  const W = 70, H = 22; const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const d = m.dirOf(T);
  const put = (x, y, c) => { const fx = x * d, fy = y * d; const cx = Math.round((fx + 52.5) / 105 * (W - 1)), cy = Math.round((34 - fy) / 68 * (H - 1)); if (cy >= 0 && cy < H && cx >= 0 && cx < W) g[cy][cx] = c; };
  for (let i = 0; i < 22; i++) { const x = snap[i * ENT]; if (x > 9000) continue; const team = i < 11 ? 0 : 1; const gk = i % 11 === 0; put(x, snap[i * ENT + 1], team === T ? (gk ? 'G' : String.fromCharCode(65 + i % 11)) : (gk ? 'K' : String.fromCharCode(97 + i % 11))); }
  put(snap[25 * ENT], snap[25 * ENT + 1], '*');
  return g.map(r => r.join('')).join('\n');
}
P.shoot = function (p, k) {
  if (k === 'open' && n++ === skip) {
    console.log('shooter', p.role, 'team', p.team, 'attacking uppercase ->');
    for (let back = 100; back >= 0; back -= 20) { const idx = (this.ringPos - 1 - back + 260) % 260; console.log('t-' + back * 0.05 + 's'); console.log(draw(this, p.team, this.ring.subarray(idx * SNAP_LEN, (idx + 1) * SNAP_LEN))); }
    process.exit(0);
  }
  return o.apply(this, arguments);
};
m.syncTo(2700);
