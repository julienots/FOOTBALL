import { getSeason, footSlotAt, quickSim } from '../src/data/season.js';
const fake = async (info) => quickSim(info.home, info.away, info.seed + 'F', { knockout: info.knockout, neutral: info.neutral });
const now = Date.now();
const s = footSlotAt(now, 1);
const { season, item, N } = getSeason(s.slot, 1, fake);
console.log('slot', s.slot, 'N', N, 'item', item, new Date(s.start).toISOString(), s.timing);
for (const it of season.items) { const info = await season.matchInfo(it.comp, it.round, it.idx); const r = await season.result(it.comp, it.round, it.idx); if (it.ko || it.n % 10 === 0) console.log(it.n, it.comp, info.roundLabel, info.home.name, r.score.join('-'), info.away.name, r.pens ? `(tab ${r.pens.join('-')})` : ''); }
const t = await season.leagueTable(N);
console.log(t.slice(0, 5).map(r => `${r.team.name} ${r.pts}pts ${r.j}j ${r.bp}-${r.bc}`));
console.log((await season.topScorers(N, 5)).map(x => `${x.player.name} ${x.goals}`));
