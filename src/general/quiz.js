// Le Grand Quiz : génération déterministe d'un épisode complet (candidats,
// manches, questions, buzzers, réponses des candidats IA, scores), pour que
// l'émission soit identique quel que soit le moment où l'on allume la télé.
import { RNG } from '../core/rng.js';
import { QUESTIONS, THEMES } from './questions.js';

export const HOST = { name: 'Bruno Valmont', look: { skin: 0.25, hair: '#4a3b30', hairStyle: 1, beard: 0, height: 1.84 } };

const FIRST = ['Thomas', 'Nicolas', 'Julien', 'Karim', 'Sébastien', 'Mathieu', 'Olivier', 'Romain', 'Yannick', 'Mehdi', 'Pascal', 'Christophe', 'Lucas', 'Antoine', 'Jérôme', 'Franck', 'Hugo', 'Damien', 'Cédric', 'Patrick', 'Samuel', 'Bertrand', 'Vincent', 'Moussa', 'Florian', 'Grégory'];
const LAST = ['Martin', 'Bernard', 'Durand', 'Lefèvre', 'Moreau', 'Girard', 'Roux', 'Fournier', 'Morel', 'Garnier', 'Chevalier', 'Perrin', 'Blanc', 'Guérin', 'Muller', 'Faure', 'André', 'Mercier', 'Lambert', 'Bonnet', 'Rousseau', 'Brun', 'Gauthier', 'Masson', 'Diallo', 'Benali'];
const CITIES = ['Rennes', 'Lille', 'Toulouse', 'Bordeaux', 'Nantes', 'Strasbourg', 'Montpellier', 'Clermont-Ferrand', 'Dijon', 'Brest', 'Limoges', 'Annecy', 'Perpignan', 'Reims', 'Tours', 'Metz', 'Caen', 'Pau', 'Grenoble', 'Amiens', 'Avignon', 'Nancy'];
const JOBS = ['boulanger', 'professeur des écoles', 'infirmier', 'ingénieur', 'agriculteur', 'pompier', 'chauffeur de bus', 'bibliothécaire', 'comptable', 'électricien', 'kinésithérapeute', 'étudiant en histoire', 'retraité de la SNCF', 'facteur', 'pharmacien', 'menuisier', 'cuisinier', 'informaticien', 'vendeur en librairie', 'moniteur d\'auto-école'];
const HOBBIES = ['la randonnée', 'les mots croisés', 'la pêche', 'le jardinage', 'les échecs', 'la guitare', 'le cyclisme', 'la photographie', 'la cuisine', 'le théâtre amateur', 'la course à pied', 'les vieux films', 'la lecture', 'le football du dimanche', 'la généalogie'];
const DREAMS = ['emmener ma famille en voyage', 'refaire ma cuisine', 'partir au Japon', 'aider mon fils pour ses études', 'm\'acheter un camping-car', 'faire le tour de la Corse en moto', 'offrir une croisière à mes parents'];
const HAIR = ['#1b1b1b', '#3b2a20', '#6b4a2b', '#a07a4a', '#d9c08a', '#8a8a8a', '#cfcfcf'];
const LETTERS = ['A', 'B', 'C', 'D'];

// Lignes du présentateur
const H = {
  open: (prime) => [prime ? 'Bonsoir à tous, et bienvenue dans cette grande soirée spéciale du Grand Quiz !' : 'Bonjour à tous et bienvenue dans Le Grand Quiz !', 'Trois candidats, une seule place pour la finale, et une cagnotte qui ne demande qu\'à être gagnée. On accueille tout de suite nos candidats !'],
  good: ['Bonne réponse !', 'C\'est exact !', 'Bravo, c\'est ça !', 'Parfait !', 'Exactement !', 'Oui, très bien !'],
  bad: (ans) => [`Eh non, la bonne réponse était ${ans}.`, `Ah, dommage ! Il fallait répondre ${ans}.`, `Non, c'était ${ans}.`],
  nobody: (ans) => [`Personne ne buzze ? La réponse était ${ans}.`, `Le temps est écoulé. Il fallait trouver ${ans}.`],
  chat: [
    (c) => `${c.first}, qu'est-ce que vous feriez si vous gagniez ce soir ?|J'aimerais ${c.dream}, ce serait formidable !`,
    (c) => `${c.first}, on m'a dit que vous étiez passionné de ${c.hobby.replace(/^(la|le|les|l') ?/, '')} ?|Oui, c'est vrai, j'en fais depuis des années, ça me détend complètement.`,
    (c) => `Alors ${c.first}, comment vous sentez-vous ?|Un peu de stress, mais je suis venu pour gagner !`,
    (c) => `${c.first}, vous avez révisé avant de venir ?|Un petit peu, je lis beaucoup, et je regarde l'émission tous les jours !`,
  ],
};

export function makeEpisode(seed, contentLen, prime = false) {
  const rng = new RNG('quiz-' + seed);
  const cands = [0, 1, 2].map(i => {
    const first = rng.pick(FIRST.filter(f => f !== 'Bruno'));
    return {
      i, first, name: `${first} ${rng.pick(LAST)}`, age: rng.int(22, 67), city: rng.pick(CITIES), job: rng.pick(JOBS), hobby: rng.pick(HOBBIES), dream: rng.pick(DREAMS),
      skill: rng.range(0.42, 0.86), speed: rng.range(0.7, 1.3),
      look: { skin: rng.range(0.05, 0.95), hair: rng.pick(HAIR), hairStyle: rng.int(0, 4), beard: rng.chance(0.3) ? 1 : 0, height: rng.range(1.68, 1.92) },
      shirt: rng.pick(['#1565c0', '#2e7d32', '#6a1b9a', '#c62828', '#37474f', '#ef6c00', '#00838f', '#f5f5f5', '#4e342e']),
    };
  });
  // ordre des questions (sans répétition tant que la banque n'est pas épuisée)
  const order = rng.shuffle(QUESTIONS.map((_, i) => i));
  let qi = 0;
  const nextQ = (filter) => {
    for (let k = 0; k < order.length; k++) {
      const idx = order[(qi + k) % order.length];
      if (!filter || filter(QUESTIONS[idx])) { order.splice((qi + k) % order.length, 1); order.push(idx); return QUESTIONS[idx]; }
    }
    return QUESTIONS[order[qi++ % order.length]];
  };
  const jackpot = 5000 + (Math.abs(hashNum(seed)) % 40) * 500 + (prime ? 20000 : 0);

  const segs = [];
  let t = 0;
  const push = (s) => { s.t = t; segs.push(s); t += s.dur; return s; };
  const scores = [0, 0, 0];
  const alive = [true, true, true];

  push({ type: 'open', dur: 22, lines: H.open(prime), jackpot });
  for (const c of cands) push({ type: 'cand', dur: 13, cand: c.i, lines: [`Notre ${c.i === 0 ? 'premier' : c.i === 1 ? 'deuxième' : 'troisième'} candidat s'appelle ${c.first}. Il a ${c.age} ans, il est ${c.job} à ${c.city}, et il adore ${c.hobby}.`, `Bonjour Bruno, bonjour à tous ! Un grand bonjour à ma famille à ${c.city} !`] });

  const fixed = 22 + 39 + 8 * 3 + 16 * 2 + 12 + 5 * 24 + 32;
  const qLen = 30;
  const chatEvery = prime ? 3 : 8;
  const room = Math.max(300, contentLen - fixed);
  const nQ = Math.min(prime ? 80 : 70, Math.floor(room / (qLen + 18 / chatEvery)));
  const n1 = Math.max(4, Math.round(nQ * 0.58)), n2 = Math.max(3, nQ - n1);

  const question = (q, pts, players, theme) => {
    const opts = rng.shuffle([q[3], q[4], q[5], q[6]]);
    const good = opts.indexOf(q[3]);
    const diff = q[1];
    const ev = [];
    // chaque candidat en lice : connaît-il la réponse ? à quel moment buzze-t-il ?
    const tries = players.map(i => {
      const c = cands[i];
      const know = rng.chance(Math.max(0.12, c.skill - (diff - 1) * 0.16));
      const bold = rng.chance(0.3);
      const tb = 8.5 + (know ? rng.range(0.5, 4.5) : rng.range(3.5, 8)) * c.speed;
      return { i, know, buzz: know || bold, tb: Math.min(17.5, tb) };
    }).filter(x => x.buzz).sort((a, b) => a.tb - b.tb);
    let tt = null, solved = false;
    for (const b of tries.slice(0, 2)) {
      const at = tt === null ? b.tb : Math.max(b.tb, tt + 4.5);
      if (at > 19) break;
      const opt = b.know ? good : rng.pick([0, 1, 2, 3].filter(o => o !== good));
      ev.push({ at, kind: 'buzz', cand: b.i, opt, ok: opt === good });
      tt = at;
      if (opt === good) { solved = true; break; }
    }
    const reveal = (tt === null ? 19 : tt + 3);
    return { type: 'q', dur: Math.max(qLen, reveal + 8), q: q[2], theme: theme || q[0], diff, opts, good, pts, ev, reveal, solved, players: [...players] };
  };

  const applyScores = (seg) => { seg.before = [...scores]; for (const e of seg.ev) scores[e.cand] += e.ok ? seg.pts : 0; seg.after = [...scores]; };

  // Manche 1 : le Sprint
  push({ type: 'round', dur: 8, round: 1, title: 'Manche 1 · Le Sprint', sub: '10 points par bonne réponse', lines: ['Première manche, le Sprint ! Dix points par bonne réponse, attention au buzzer.'] });
  for (let k = 0; k < n1; k++) {
    const s = push(question(nextQ(), 10, [0, 1, 2]));
    applyScores(s);
    if (k > 0 && k % chatEvery === 0) { const c = cands[rng.int(0, 2)]; push({ type: 'chat', dur: 18, cand: c.i, lines: rng.pick(H.chat)(c).split('|'), scores: [...scores] }); }
  }
  const out1 = [0, 1, 2].sort((a, b) => scores[a] - scores[b] || cands[a].skill - cands[b].skill)[0];
  alive[out1] = false;
  push({ type: 'elim', dur: 16, cand: out1, scores: [...scores], lines: [`C'est la fin de la première manche. ${cands[out1].first}, malheureusement, l'aventure s'arrête ici pour vous. Merci pour votre participation !`, 'Merci Bruno, c\'était un plaisir !'] });
  // Manche 2 : les Thèmes
  const duo = [0, 1, 2].filter(i => alive[i]);
  const leader = scores[duo[0]] >= scores[duo[1]] ? duo[0] : duo[1];
  scores[duo[0]] = 0; scores[duo[1]] = 0;
  const themes = rng.shuffle([...THEMES]).slice(0, 3);
  push({ type: 'round', dur: 8, round: 2, title: 'Manche 2 · Les Thèmes', sub: '20 points par bonne réponse', themes, lines: [`Deuxième manche, les Thèmes ! Les scores sont remis à zéro. ${cands[leader].first}, vous étiez en tête, à vous de choisir : ${themes.join(', ')}.`] });
  let th = themes[0];
  for (let k = 0; k < n2; k++) {
    if (k > 0 && k % Math.ceil(n2 / 3) === 0) th = themes[Math.min(2, Math.floor(k / Math.ceil(n2 / 3)))];
    const s = push(question(nextQ(q => q[0] === th) , 20, duo, th));
    applyScores(s);
    if (k > 0 && k % chatEvery === 0) { const c = cands[duo[rng.int(0, 1)]]; push({ type: 'chat', dur: 18, cand: c.i, lines: rng.pick(H.chat)(c).split('|'), scores: [...scores] }); }
  }
  const fin = scores[duo[0]] === scores[duo[1]] ? (cands[duo[0]].skill > cands[duo[1]].skill ? duo[0] : duo[1]) : (scores[duo[0]] > scores[duo[1]] ? duo[0] : duo[1]);
  const out2 = duo.find(i => i !== fin);
  alive[out2] = false;
  push({ type: 'elim', dur: 16, cand: out2, scores: [...scores], lines: [`Et notre finaliste est ${cands[fin].first} ! ${cands[out2].first}, vous repartez avec nos félicitations et un beau cadeau.`, 'Merci, bravo à lui, il le mérite !'] });
  // Finale : le Coffre
  push({ type: 'round', dur: 12, round: 3, title: 'Finale · Le Coffre', sub: `5 questions · ${fmtEur(jackpot)} à gagner`, lines: [`${cands[fin].first}, c'est la finale ! Cinq questions, mille euros par bonne réponse, et si vous faites un sans-faute, vous remportez la cagnotte de ${spellEur(jackpot)} !`] });
  let wins = 0;
  const finalQs = [];
  for (let k = 0; k < 5; k++) {
    const q = nextQ(x => x[1] >= (k < 2 ? 1 : 2));
    const opts = rng.shuffle([q[3], q[4], q[5], q[6]]);
    const good = opts.indexOf(q[3]);
    const c = cands[fin];
    const know = rng.chance(Math.max(0.2, c.skill + 0.08 - (q[1] - 1) * 0.15));
    const opt = know ? good : rng.pick([0, 1, 2, 3].filter(o => o !== good));
    const at = 9 + rng.range(1, 6);
    if (opt === good) wins++;
    finalQs.push(push({ type: 'q', final: true, dur: 24, q: q[2], theme: q[0], diff: q[1], opts, good, pts: 1000, ev: [{ at, kind: 'say', cand: fin, opt, ok: opt === good }], reveal: at + 3, players: [fin], before: [wins - (opt === good ? 1 : 0)], after: [wins] }));
  }
  const prize = wins === 5 ? jackpot : wins * 1000;
  push({ type: 'end', dur: 32, cand: fin, wins, prize, jackpot, lines: [wins === 5 ? `Incroyable ! Un sans-faute ! ${cands[fin].first}, vous remportez la cagnotte de ${spellEur(jackpot)} !` : `${cands[fin].first}, ${wins} bonne${wins > 1 ? 's' : ''} réponse${wins > 1 ? 's' : ''} sur cinq, vous repartez avec ${spellEur(prize)}. Bravo !`, 'Merci à tous de nous avoir suivis, on se retrouve très vite pour un nouveau Grand Quiz. À bientôt !'] });
  // ajuste le rythme (plus de temps entre les questions) pour remplir exactement la case
  const flex = segs.filter(x => (x.type === 'q' && !x.final) || x.type === 'chat');
  const flexLen = flex.reduce((a, x) => a + x.dur, 0);
  const f = Math.min(1.6, Math.max(1, (contentLen - (t - flexLen)) / flexLen));
  let tt = 0;
  for (const x of segs) { if (flex.includes(x)) x.dur = Math.round(x.dur * f * 10) / 10; x.t = tt; tt += x.dur; }
  const last = segs[segs.length - 1];
  if (tt < contentLen) { last.dur += contentLen - tt; tt = contentLen; }
  return { seed, cands, segs, len: tt, jackpot, prime, fin, prize };
}

function hashNum(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }
export function fmtEur(n) { return n.toLocaleString('fr-FR') + ' €'; }
function spellEur(n) { return n >= 1000 && n % 1000 === 0 ? `${n / 1000} mille euros` : `${n} euros`; }
export { LETTERS };

// Segment actif à l'instant t (secondes de contenu)
export function segAt(ep, t) {
  const S = ep.segs;
  let lo = 0, hi = S.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m].t <= t) lo = m; else hi = m - 1; }
  return S[lo];
}
