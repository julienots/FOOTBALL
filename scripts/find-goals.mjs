// Affiche l'heure exacte des buts du match en cours (pour tester l'appli avec ?offset=)
import { footSlotAt, getSeason, quickSim } from '../src/data/season.js';
import { FootballMatch } from '../src/football/engine.js';
import { kitsFor } from '../src/data/world.js';
const k = 1;
const now = Date.now() + (+process.argv[2] || 0) * 60000;
const s = footSlotAt(now, k);
const fake = async (i) => quickSim(i.home, i.away, i.seed, i);
const { season, item } = getSeason(s.slot, k, fake);
const info = await season.matchInfo(item.comp, item.round, item.idx);
const m = new FootballMatch({ home: info.home, away: info.away, seed: info.seed, speed: k, knockout: info.knockout, h2Offset: s.timing.h2Offset, record: false, keepEvents: true });
m.syncTo(1e9);
for (const e of m.events.filter(e => e.type === 'goal')) {
  const wall = e.tick * 0.05; // approximation (pas de pas pendant la mi-temps)
  console.log(e.minute, e.name, new Date(s.kickoff + (e.period === 'h2' ? s.timing.h2Offset * 1000 + (e.clock - 2700) * 1000 : e.clock * 1000)).toLocaleTimeString('fr-FR'));
}
console.log('now', new Date().toLocaleTimeString('fr-FR'), info.home.name, m.score, info.away.name);
