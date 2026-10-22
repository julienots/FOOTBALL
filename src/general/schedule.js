// Grille des programmes de la chaîne généraliste ÉTOILE (heure locale du téléphone).
// Chaque journée suit la même grille, comme une vraie chaîne : journaux, météo,
// jeu télévisé, magazine sportif, télé-achat et rediffusions la nuit.

// [heure de début (min), durée (min), type, titre, sous-titre]
const DAY = [
  [0, 35, 'quiz', 'Le Grand Quiz', 'Rediffusion'],
  [35, 35, 'quiz', 'Le Grand Quiz', 'Rediffusion'],
  [70, 50, 'shop', 'Télé-boutique', 'Les bonnes affaires de la nuit'],
  [120, 15, 'jt', 'Le Journal de la nuit', 'L\'essentiel de l\'actualité'],
  [135, 5, 'meteo', 'Météo', 'Prévisions pour demain'],
  [140, 30, 'mag', 'Le Mag du Sport', 'Rediffusion'],
  [170, 70, 'shop', 'Télé-boutique', 'Les bonnes affaires de la nuit'],
  [240, 35, 'quiz', 'Le Grand Quiz', 'Rediffusion'],
  [275, 35, 'quiz', 'Le Grand Quiz', 'Rediffusion'],
  [310, 50, 'shop', 'Télé-boutique', 'Les offres du matin'],
  [360, 15, 'jt', 'Le 6H', 'Le journal du matin'],
  [375, 5, 'meteo', 'Météo', 'Prévisions de la journée'],
  [380, 25, 'mag', 'Le Mag du Sport', 'Résultats et classements'],
  [405, 15, 'shop', 'Télé-boutique', 'L\'offre du matin'],
  [420, 20, 'jt', 'Le 7H', 'Le journal du matin'],
  [440, 5, 'meteo', 'Météo', 'Prévisions de la journée'],
  [445, 65, 'shop', 'Télé-boutique', 'Les offres du matin'],
  [510, 35, 'quiz', 'Le Grand Quiz', 'Inédit'],
  [545, 35, 'quiz', 'Le Grand Quiz', 'Inédit'],
  [580, 50, 'shop', 'Télé-boutique', 'Les offres du jour'],
  [630, 35, 'quiz', 'Le Grand Quiz', 'Inédit'],
  [665, 35, 'quiz', 'Le Grand Quiz', 'Inédit'],
  [700, 20, 'mag', 'Le Mag du Sport', 'Le point avant midi'],
  [720, 35, 'quiz', 'Le Grand Quiz', 'Inédit'],
  [755, 5, 'meteo', 'Météo', 'Prévisions de l\'après-midi'],
  [760, 20, 'shop', 'Télé-boutique', 'L\'offre du midi'],
  [780, 30, 'jt', 'Le 13H', 'Le journal de la mi-journée'],
  [810, 5, 'meteo', 'Météo', 'Prévisions de l\'après-midi'],
  [815, 30, 'mag', 'Le Mag du Sport', 'Le grand format'],
  [845, 55, 'shop', 'Télé-boutique', 'Les offres de l\'après-midi'],
  [900, 35, 'quiz', 'Le Grand Quiz', 'Inédit'],
  [935, 35, 'quiz', 'Le Grand Quiz', 'Inédit'],
  [970, 35, 'quiz', 'Le Grand Quiz', 'Inédit'],
  [1005, 30, 'mag', 'Le Mag du Sport', 'Avant les matchs du soir'],
  [1035, 35, 'quiz', 'Le Grand Quiz', 'Inédit'],
  [1070, 35, 'quiz', 'Le Grand Quiz', 'Inédit'],
  [1105, 25, 'shop', 'Télé-boutique', 'Les offres du soir'],
  [1130, 5, 'meteo', 'Météo', 'Prévisions pour la soirée'],
  [1135, 35, 'quiz', 'Le Grand Quiz', 'Inédit'],
  [1170, 25, 'mag', 'Le Mag du Sport', 'L\'essentiel'],
  [1195, 5, 'meteo', 'Météo', 'Prévisions pour demain'],
  [1200, 30, 'jt', 'Le 20H', 'Le grand journal du soir'],
  [1230, 5, 'meteo', 'Météo', 'Prévisions pour demain'],
  [1235, 85, 'quiz', 'Le Grand Quiz', 'Spéciale prime · Inédit'],
  [1320, 40, 'mag', 'Le Mag du Sport', 'Le débrief de la soirée'],
  [1360, 15, 'jt', 'Le Soir', 'Le journal de la fin de soirée'],
  [1375, 5, 'meteo', 'Météo', 'Prévisions pour demain'],
  [1380, 35, 'quiz', 'Le Grand Quiz', 'Rediffusion'],
  [1415, 25, 'shop', 'Télé-boutique', 'Les bonnes affaires de la nuit'],
];

export const KIND_LABEL = { quiz: 'Jeu', jt: 'Information', meteo: 'Météo', mag: 'Sport', shop: 'Télé-achat' };

// Coupures publicitaires : fin de programme (secondes) et coupure au milieu
export function breaksFor(kind, durMin) {
  const end = kind === 'quiz' ? 180 : kind === 'mag' ? 120 : kind === 'shop' ? 60 : 0;
  const mid = (kind === 'quiz' && durMin >= 30) || (kind === 'mag' && durMin >= 40) ? (durMin >= 80 ? 240 : 150) : 0;
  return { brEnd: end, brMid: mid };
}

function midnight(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

// Programme diffusé à l'instant `ms`
export function programAt(ms) {
  const day0 = midnight(ms);
  const min = (ms - day0) / 60000;
  let i = DAY.findIndex(p => min >= p[0] && min < p[0] + p[1]);
  if (i < 0) i = DAY.length - 1;
  return mk(day0, i);
}

function mk(day0, i) {
  const [m0, dur, kind, title, sub] = DAY[i];
  // numéro de jour stable (indépendant du fuseau) pour les graines
  const dayNo = Math.round(day0 / 86400000);
  const start = day0 + m0 * 60000;
  // un épisode inédit diffusé le matin est rediffusé la nuit suivante
  const rerun = /Rediffusion/.test(sub);
  const seed = rerun ? `${dayNo - 1}-${(i * 7) % 19}` : `${dayNo}-${i}`;
  return { idx: i, kind, title, sub, start, end: start + dur * 60000, dur: dur * 60, seed, dayNo, ...breaksFor(kind, dur) };
}

export function programsFrom(ms, count) {
  const out = [];
  let p = programAt(ms);
  for (let k = 0; k < count; k++) {
    out.push(p);
    const day0 = midnight(p.start);
    p = p.idx + 1 < DAY.length ? mk(day0, p.idx + 1) : mk(midnight(day0 + 36 * 3600000), 0);
  }
  return out;
}
