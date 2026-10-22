// Chaîne FOOT+ 2 : Coupe des Champions et matchs internationaux amicaux.
// Grille décalée d'une demi-case par rapport à FOOT+ : il y a presque toujours
// un match en direct sur l'une des deux chaînes.
import { FootChannel } from './foot.js';
import { footSlotAt, footTiming } from '../data/season.js';
import { RNG } from '../core/rng.js';

const ROUNDS = ['Huitièmes de finale', 'Huitièmes de finale', 'Huitièmes de finale', 'Huitièmes de finale', 'Quarts de finale', 'Quarts de finale', 'Demi-finale', 'Finale'];

export class Foot2Channel extends FootChannel {
  constructor(app, num) {
    super(app, { id: 'foot2', name: 'FOOT+ 2', color: '#00897b', num });
  }

  slotInfo(t) {
    const sh = footTiming(this.k).cycle * 500;
    const s = footSlotAt(t - sh, this.k);
    return { ...s, start: s.start + sh, kickoff: s.kickoff + sh, end: s.end + sh };
  }

  async infoForSlot(slot) {
    const W = this.app.world;
    const rng = new RNG(`foot2-${slot}`);
    const friendly = slot % 3 === 2;
    const pool = friendly ? [...W.nations] : [...W.clubs];
    rng.shuffle(pool);
    const [home, away] = pool;
    const round = ROUNDS[slot % ROUNDS.length];
    const final = !friendly && round === 'Finale';
    return {
      comp: friendly ? 'A' : 'E', key: `foot2-${slot}`,
      home, away, knockout: !friendly, neutral: friendly || final,
      seed: `foot2-${slot}-${home.id}-${away.id}-k${this.k}`,
      roundLabel: friendly ? 'Match amical' : round,
      compName: friendly ? 'Match international amical' : 'Coupe des Champions',
      compShort: friendly ? 'AMICAL INTERNATIONAL' : 'COUPE DES CHAMPIONS',
      compColor: friendly ? '#5d4037' : '#00897b',
      season: null, item: { comp: friendly ? 'A' : 'E', n: 0 },
    };
  }
}
