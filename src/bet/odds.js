// Cotes de paris calculées à partir du niveau des équipes (modèle de Poisson),
// avec ajustement en direct selon le score et le temps restant.

const fact = [1];
for (let i = 1; i < 20; i++) fact[i] = fact[i - 1] * i;
const pois = (l, k) => Math.exp(-l) * Math.pow(l, k) / fact[k];

export function lambdas(home, away, neutral = false) {
  const dr = home.strength - away.strength;
  return [1.55 * Math.exp(dr / 28) + (neutral ? 0 : 0.18), 1.4 * Math.exp(-dr / 28)];
}

// Probabilités des scores finaux (score actuel + buts restants)
export function scoreMatrix(lh, la, cur = [0, 0], frac = 1) {
  const M = [];
  for (let a = 0; a <= 9; a++) for (let b = 0; b <= 9; b++) {
    const p = pois(lh * frac, a) * pois(la * frac, b);
    if (p > 1e-7) M.push({ h: cur[0] + a, a: cur[1] + b, p });
  }
  return M;
}

export const EXACT = ['1-0', '2-0', '2-1', '3-0', '3-1', '3-2', '0-0', '1-1', '2-2', '3-3', '0-1', '0-2', '1-2', '0-3', '1-3', '2-3'];

export function evaluate(market, pick, score) {
  const [h, a] = score, t = h + a;
  switch (market) {
    case '1N2': return pick === '1' ? h > a : pick === 'N' ? h === a : a > h;
    case 'DC': return pick === '1N' ? h >= a : pick === 'N2' ? a >= h : h !== a;
    case 'OU': return pick === 'O' ? t > 2.5 : t < 2.5;
    case 'OU15': return pick === 'O' ? t > 1.5 : t < 1.5;
    case 'BTTS': return pick === 'O' ? h > 0 && a > 0 : !(h > 0 && a > 0);
    case 'CS': return pick === `${h}-${a}`;
    default: return false;
  }
}

const toOdd = (p) => Math.min(80, Math.max(1.02, Math.round((0.93 / Math.max(p, 0.0005)) * 100) / 100));

// Toutes les cotes d'un match
export function marketOdds(lh, la, cur = [0, 0], frac = 1) {
  const M = scoreMatrix(lh, la, cur, frac);
  const P = (fn) => M.reduce((s, x) => s + (fn(x) ? x.p : 0), 0);
  const odds = {
    '1N2': { '1': toOdd(P(x => x.h > x.a)), N: toOdd(P(x => x.h === x.a)), '2': toOdd(P(x => x.a > x.h)) },
    DC: { '1N': toOdd(P(x => x.h >= x.a)), N2: toOdd(P(x => x.a >= x.h)), '12': toOdd(P(x => x.h !== x.a)) },
    OU: { O: toOdd(P(x => x.h + x.a > 2.5)), U: toOdd(P(x => x.h + x.a < 2.5)) },
    OU15: { O: toOdd(P(x => x.h + x.a > 1.5)), U: toOdd(P(x => x.h + x.a < 1.5)) },
    BTTS: { O: toOdd(P(x => x.h > 0 && x.a > 0)), N: toOdd(P(x => !(x.h > 0 && x.a > 0))) },
    CS: {},
  };
  for (const s of EXACT) {
    const [h, a] = s.split('-').map(Number);
    if (h < cur[0] || a < cur[1]) continue; // déjà impossible
    odds.CS[s] = toOdd(P(x => x.h === h && x.a === a));
  }
  return odds;
}

export const MARKET_LABEL = {
  '1N2': 'Résultat du match', DC: 'Double chance', OU: 'Nombre de buts (2,5)', OU15: 'Nombre de buts (1,5)', BTTS: 'Les deux équipes marquent', CS: 'Score exact',
};

export function pickLabel(market, pick, home, away) {
  if (market === '1N2') return pick === '1' ? home.name : pick === '2' ? away.name : 'Match nul';
  if (market === 'DC') return pick === '1N' ? `${home.short} ou nul` : pick === 'N2' ? `Nul ou ${away.short}` : `${home.short} ou ${away.short}`;
  if (market === 'OU') return pick === 'O' ? '+ de 2,5 buts' : '- de 2,5 buts';
  if (market === 'OU15') return pick === 'O' ? '+ de 1,5 but' : '- de 1,5 but';
  if (market === 'BTTS') return pick === 'O' ? 'Les deux marquent : oui' : 'Les deux marquent : non';
  if (market === 'CS') return `Score exact ${pick}`;
  return pick;
}
