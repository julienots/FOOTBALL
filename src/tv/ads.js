// Coupures publicitaires : spots animés (marques fictives), voix off et jingle.
import { el, esc } from './overlay.js';
import { voice } from '../audio/voice.js';
import { jingle, sting } from '../audio/audio.js';

export const SPOTS = [
  {
    brand: 'VOLTA', dur: 15, bg: 'radial-gradient(circle at 30% 40%, #2a3a00, #050505 70%)', fg: '#c6ff00', icon: '⚡',
    scenes: ['Fatigue ?', 'Une canette.', 'VOLTA', 'L\'énergie des champions'],
    vo: ['Coup de fatigue avant le match ?', 'Volta. L\'énergie des champions. À consommer avec modération... de sommeil !'],
    music: { tempo: 128, key: 62, melody: [0, 0, 7, 0, 12, 0, 10, 7], bass: [0, 0, 5, 7], lead: 'sawtooth' },
  },
  {
    brand: 'AUTO LUMINA', dur: 20, bg: 'linear-gradient(160deg, #0d47a1, #001233)', fg: '#fff', icon: '🚘',
    scenes: ['Nouvelle Lumina E-Sport', '600 km d\'autonomie', 'Recharge en 18 minutes', 'AUTO LUMINA · Électrique. Évidemment.'],
    vo: ['Nouvelle Lumina E-Sport. Six cents kilomètres d\'autonomie, recharge en dix-huit minutes.', 'Auto Lumina. Électrique. Évidemment.'],
    music: { tempo: 96, key: 57, melody: [7, 0, 12, 0, 14, 12, 7, 0], bass: [0, 0, -2, -4], lead: 'triangle' },
  },
  {
    brand: 'CRISPYMAX', dur: 15, bg: 'linear-gradient(135deg, #ffca28, #ff6f00)', fg: '#b71c1c', icon: '🥔',
    scenes: ['CRUNCH !', 'Le croustillant', 'des champions', 'CRISPYMAX · Goût barbecue fumé'],
    vo: ['Crunch ! Le croustillant des champions. Crispymax, nouveau goût barbecue fumé !'],
    music: { tempo: 140, key: 64, melody: [0, 4, 7, 12, 7, 4, 0, 0], bass: [0, 5, 7, 5], lead: 'square' },
  },
  {
    brand: 'BANQUE HORIZON', dur: 20, bg: 'linear-gradient(180deg, #004d40, #00251a)', fg: '#fff', icon: '🏦',
    scenes: ['Votre projet', 'mérite un partenaire', 'Prêt immobilier dès 2,9 %', 'BANQUE HORIZON · Votre avenir, notre métier'],
    vo: ['Votre projet mérite un vrai partenaire.', 'Banque Horizon. Votre avenir, notre métier. Un crédit vous engage et doit être remboursé.'],
    music: { tempo: 84, key: 60, melody: [0, 0, 4, 0, 7, 0, 5, 4], bass: [0, -3, -5, -7], lead: 'sine' },
  },
  {
    brand: 'NEO MOBILE 5G', dur: 15, bg: 'linear-gradient(120deg, #6a1b9a, #ad1457)', fg: '#fff', icon: '📱',
    scenes: ['Le match en 4K', 'partout, tout le temps', '200 Go · 9,99 €/mois', 'NEO MOBILE · Le réseau qui va plus vite'],
    vo: ['Le match en 4K, partout, tout le temps. Deux cents gigas pour neuf euros quatre-vingt-dix-neuf par mois. Neo Mobile, le réseau qui va plus vite !'],
    music: { tempo: 124, key: 65, melody: [0, 12, 0, 10, 0, 7, 5, 7], bass: [0, 0, 3, 5], lead: 'sawtooth' },
  },
  {
    brand: 'AQUAPURA', dur: 15, bg: 'linear-gradient(180deg, #e1f5fe, #81d4fa)', fg: '#01579b', icon: '💧',
    scenes: ['Hydratez-vous', 'comme un pro', 'AQUAPURA', 'Eau minérale naturelle des Alpes'],
    vo: ['Hydratez-vous comme un pro. Aquapura, l\'eau minérale naturelle des Alpes.'],
    music: { tempo: 100, key: 67, melody: [0, 7, 12, 7, 4, 7, 12, 16], bass: [0, 5, 0, 7], lead: 'sine' },
  },
  {
    brand: 'KAPPA FIT', dur: 15, bg: 'linear-gradient(135deg, #212121, #000)', fg: '#ff6d00', icon: '👟',
    scenes: ['Nouvelle chaussure', 'STRIKE PRO', 'Plus légère. Plus rapide.', 'KAPPA FIT · Équipementier officiel'],
    vo: ['Nouvelle Strike Pro. Plus légère, plus rapide. Kappa Fit, équipementier officiel.'],
    music: { tempo: 132, key: 59, melody: [0, 0, 12, 0, 0, 10, 0, 7], bass: [0, 0, 0, 3], lead: 'square' },
  },
  {
    brand: 'PIZZA ROMA EXPRESS', dur: 15, bg: 'linear-gradient(135deg, #1b5e20, #b71c1c)', fg: '#fff', icon: '🍕',
    scenes: ['Le match commence ?', 'La pizza arrive !', 'Livrée en 25 min', 'PIZZA ROMA EXPRESS · Code MATCH = -20 %'],
    vo: ['Le match commence ? Votre pizza arrive ! Pizza Roma Express, livrée en vingt-cinq minutes. Code match, moins vingt pour cent !'],
    music: { tempo: 116, key: 62, melody: [0, 4, 7, 4, 9, 7, 4, 0], bass: [0, 5, 7, 0], lead: 'triangle' },
  },
];

export class AdBreak {
  constructor(root, channelName) {
    this.root = root;
    this.channelName = channelName;
    this.box = el('div', 'adbreak hidden');
    root.appendChild(this.box);
    this.current = null;
    this.stopMusic = null;
  }

  // t = secondes écoulées depuis le début de la coupure ; seq = liste de spots
  update(t, seq, active) {
    if (!active) { if (this.current !== null) this.close(); return; }
    this.box.classList.remove('hidden');
    // bumper d'entrée 4 s, spots, bumper de sortie 4 s
    let acc = 4;
    if (t < 4) { this.show('in'); return; }
    for (let i = 0; i < seq.length; i++) {
      const s = SPOTS[seq[i] % SPOTS.length];
      if (t < acc + s.dur) { this.show(i, s, t - acc); return; }
      acc += s.dur;
    }
    this.show('out');
  }

  show(id, spot, local) {
    if (this.current === id) { if (spot) this.animate(spot, local); return; }
    this.current = id;
    if (this.stopMusic) { this.stopMusic(); this.stopMusic = null; }
    voice.clear('ad');
    if (id === 'in' || id === 'out') {
      this.box.innerHTML = `<div class="ad-bumper ${id}"><div class="ab-logo">${esc(this.channelName)}</div><div class="ab-txt">${id === 'in' ? 'PUBLICITÉ' : 'FIN DE LA PUBLICITÉ'}</div></div>`;
      sting(id === 'in' ? 'break' : 'ident');
      return;
    }
    this.box.innerHTML = `<div class="ad-spot" style="background:${spot.bg};color:${spot.fg}">
      <div class="ad-icon">${spot.icon}</div>
      <div class="ad-scenes">${spot.scenes.map((s, i) => `<div class="ad-scene" data-i="${i}">${esc(s)}</div>`).join('')}</div>
      <div class="ad-brand">${esc(spot.brand)}</div>
      <div class="ad-tag">PUBLICITÉ</div>
    </div>`;
    this.scenes = [...this.box.querySelectorAll('.ad-scene')];
    this.stopMusic = jingle(spot.music, spot.dur);
    if (local < 2) spot.vo.forEach(line => voice.say('ad', line, 2, { channel: 'ad', ttl: spot.dur * 1000 }));
  }

  animate(spot, local) {
    const n = spot.scenes.length;
    const per = spot.dur / n;
    const idx = Math.min(n - 1, Math.floor(local / per));
    this.scenes.forEach((s, i) => s.classList.toggle('on', i === idx));
    const icon = this.box.querySelector('.ad-icon');
    if (icon) icon.style.transform = `scale(${1 + 0.08 * Math.sin(local * 3)}) rotate(${Math.sin(local * 1.3) * 8}deg)`;
  }

  close() {
    this.current = null;
    if (this.stopMusic) { this.stopMusic(); this.stopMusic = null; }
    voice.clear('ad');
    this.box.classList.add('hidden');
    this.box.innerHTML = '';
  }
}

// Durée totale d'une coupure
export function breakLength(seq) { return 8 + seq.reduce((a, i) => a + SPOTS[i % SPOTS.length].dur, 0); }

// Sélectionne des spots pour une durée donnée (déterministe)
export function pickSpots(seed, seconds) {
  const out = [];
  let tot = 8, k = seed;
  while (tot < seconds - 10) {
    k = (k * 1103515245 + 12345) >>> 0;
    const i = k % SPOTS.length;
    if (out.length && out[out.length - 1] === i) continue;
    out.push(i); tot += SPOTS[i].dur;
    if (out.length > 20) break;
  }
  return out;
}
