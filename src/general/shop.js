// Télé-boutique : produits (marques fictives) présentés en studio 3D.
import { RNG } from '../core/rng.js';

export const SHOP = [
  { brand: 'CUISIPRO', kind: 'pan', name: 'Poêle CuisiPro Titanium 28 cm', price: 39.9, old: 79.9, bg: 'linear-gradient(135deg, #bf360c, #3e2723)', fg: '#ff7043',
    pts: ['Revêtement titane ultra-résistant', 'Rien n\'attache, même sans matière grasse', 'Compatible tous feux, induction comprise', 'Garantie 10 ans'],
    pitch: ['Regardez bien : l\'œuf glisse tout seul, sans une goutte d\'huile !', 'Avec son revêtement titane, la poêle CuisiPro ne raye pas, même avec une fourchette en métal.', 'Elle passe au lave-vaisselle et fonctionne sur tous les feux, induction comprise.', 'Et pour toute commande aujourd\'hui, la deuxième poêle vous est offerte !'] },
  { brand: 'VITAMIX', kind: 'blender', name: 'Blender VitaMix Turbo 2000', price: 59.9, old: 119.9, bg: 'linear-gradient(135deg, #880e4f, #1a0010)', fg: '#ff4081',
    pts: ['Moteur 2000 watts', 'Bol de 2 litres incassable', '6 programmes automatiques', 'Lames en acier inoxydable'],
    pitch: ['Smoothies, soupes, glace pilée : le blender VitaMix fait tout en quelques secondes.', 'Son moteur de deux mille watts réduit les fruits les plus durs en un velouté parfait.', 'Six programmes automatiques : vous appuyez, il s\'occupe de tout.', 'Aujourd\'hui seulement, il est à moitié prix !'] },
  { brand: 'CHRONOS', kind: 'watch', name: 'Montre Chronos Élégance', price: 79, old: 189, bg: 'linear-gradient(135deg, #263238, #000000)', fg: '#ffd54f',
    pts: ['Mouvement automatique', 'Étanche jusqu\'à 100 mètres', 'Verre saphir anti-rayures', 'Bracelet cuir véritable'],
    pitch: ['Élégante, précise, intemporelle : voici la montre Chronos Élégance.', 'Son mouvement automatique se remonte tout seul au rythme de votre poignet.', 'Le verre saphir résiste aux rayures, et elle est étanche jusqu\'à cent mètres.', 'Livrée dans son coffret, c\'est l\'idée cadeau parfaite.'] },
  { brand: 'ROBONET', kind: 'robot', name: 'Aspirateur robot RoboNet X5', price: 149, old: 299, bg: 'linear-gradient(135deg, #0d47a1, #000814)', fg: '#40c4ff',
    pts: ['Cartographie laser de la maison', '150 minutes d\'autonomie', 'Pilotable depuis le téléphone', 'Retour automatique à la base'],
    pitch: ['Fini la corvée d\'aspirateur : RoboNet X5 nettoie pendant que vous vous reposez.', 'Grâce à son laser, il cartographie toute la maison et n\'oublie aucun recoin.', 'Il passe sous les meubles, évite les escaliers et retourne seul à sa base.', 'Cent cinquante minutes d\'autonomie, de quoi faire tout un appartement !'] },
  { brand: 'KAPPA FIT', kind: 'shoe', name: 'Baskets Kappa Fit Cloud Run', price: 49.9, old: 99.9, bg: 'linear-gradient(135deg, #ff6d00, #1a0a00)', fg: '#ff9100',
    pts: ['Semelle à mémoire de forme', 'Ultra-légères : 210 grammes', 'Tissu respirant', 'Du 36 au 47'],
    pitch: ['Marcher sur un nuage, c\'est possible avec les Cloud Run de Kappa Fit.', 'La semelle à mémoire de forme épouse parfaitement votre pied.', 'Deux cent dix grammes seulement : vous les oublierez une fois aux pieds.', 'Disponibles en quatre coloris, du trente-six au quarante-sept.'] },
  { brand: 'NEO', kind: 'phone', name: 'Smartphone Neo Ultra 5G', price: 199, old: 349, bg: 'linear-gradient(135deg, #4a148c, #12001f)', fg: '#e040fb',
    pts: ['Écran 6,7 pouces', 'Triple capteur photo 108 Mpx', 'Batterie 5000 mAh', '256 Go de stockage'],
    pitch: ['Le Neo Ultra, c\'est la puissance d\'un grand smartphone à un prix incroyable.', 'Son triple capteur photo vous offre des clichés dignes d\'un professionnel.', 'Avec sa batterie de cinq mille milliampères, il tient facilement deux jours.', 'Et en ce moment, la coque et le chargeur rapide sont offerts !'] },
];

export const PHONE = '0 800 00 00 00';
export const fmtPrice = (p) => p.toFixed(2).replace('.', ',') + ' €';
const sayPrice = (p) => { const e = Math.floor(p), c = Math.round((p - e) * 100); return c ? `${e} euros ${c}` : `${e} euros`; };

// Enchaînement des produits pour une émission
export function makeShop(seed, contentLen) {
  const r = new RNG('shop-' + seed);
  const order = r.shuffle(SHOP.map((_, i) => i));
  const segs = [];
  let t = 0, k = 0;
  while (t < contentLen - 30) {
    const it = SHOP[order[k % order.length]];
    const dur = Math.min(contentLen - t, r.int(180, 260));
    const cues = [];
    let at = 1;
    for (let rep = 0; at < dur - 12; rep++) {
      for (const line of it.pitch) { if (at > dur - 12) break; cues.push({ at, who: rep % 2 ? 'cons' : 'pbp', text: line }); at += 5 + line.length / 15; }
      if (at < dur - 14) { cues.push({ at, who: 'pbp', text: `Pour commander, appelez vite le ${PHONE.replace(/ /g, ', ')}, appel gratuit, ou rendez-vous sur notre site. Seulement ${sayPrice(it.price)} au lieu de ${sayPrice(it.old)} !` }); at += 14; }
      at += 6;
    }
    segs.push({ t, dur, it, cues, stock: r.int(60, 200) });
    t += dur; k++;
  }
  if (segs.length) segs[segs.length - 1].dur += contentLen - t;
  return { segs, len: contentLen };
}
