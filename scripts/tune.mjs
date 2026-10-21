import { getWorld } from '../src/data/world.js';
import { FootballMatch } from '../src/football/engine.js';
const w = getWorld();
const N = +process.argv[2] || 4; const bias = +process.argv[3];
let G = 0, S = 0, P = 0, PO = 0, OT = 0, XG = 0, T = Date.now();
for (let i = 0; i < N; i++) {
  const m = new FootballMatch({ home: w.clubs[i % 16], away: w.clubs[(i + 7) % 16], seed: 't' + i, speed: +(process.env.K||1), h2Offset: 3840/(process.env.K||1), record: false, ...(bias ? { shotBias: bias, posNear: +process.argv[4] } : {}) });
  m.syncTo(1e9);
  G += m.score[0] + m.score[1]; for (const s of m.stats) { S += s.shots; P += s.passes; PO += s.passOk; OT += s.onTarget; XG += s.xg; }
}
console.log(`bias ${bias} goals/m ${(G / N).toFixed(2)} shots/m ${(S / N).toFixed(1)} OT ${(OT / N).toFixed(1)} xG ${(XG / N).toFixed(2)} passes/m ${(P / N).toFixed(0)} acc ${(100 * PO / P).toFixed(0)}% ${(Date.now() - T) / N | 0}ms/m`);
