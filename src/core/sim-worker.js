// Worker : simule des matches complets en arrière-plan (résultats et classements)
import { getWorld } from '../data/world.js';
import { FootballMatch } from '../football/engine.js';

self.onmessage = (e) => {
  const { id, homeId, awayId, seed, speed, knockout, h2Offset } = e.data;
  const w = getWorld();
  const m = new FootballMatch({ home: w.teams[homeId], away: w.teams[awayId], seed, speed, knockout, h2Offset, record: false });
  m.syncTo(1e9);
  self.postMessage({ id, summary: m.summary() });
};
