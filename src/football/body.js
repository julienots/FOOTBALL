// Corps humain lisse et animé (maillage « skinné ») généré une seule fois à
// partir d'un champ de distance signée : muscles (deltoïdes, pectoraux,
// quadriceps, mollets...), visage sculpté (arcades, pommettes, nez, lèvres,
// menton), plis des vêtements, ourlets des manches et du short, occlusion
// ambiante précalculée. Chaque joueur partage la géométrie ; ses couleurs
// (maillot, short, chaussettes, peau, motif) passent par des uniforms.
import * as THREE from 'three';

// ---- primitives SDF (coordonnées du corps en pose de référence, pieds à y = 0) ----
const T = 1.02; // origine du torse
const H = T + 0.65; // origine de la tête
const SH = [0.205, T + 0.5]; // épaule (x, y)
const HIP = [0.095, 0.92];
const ARM_A = 0.42, LEG_A = 0.07; // écartement des bras / jambes en pose de liaison
export const BONES = ['root', 'pelvis', 'torso', 'head', 'uaL', 'faL', 'uaR', 'faR', 'thL', 'shL', 'thR', 'shR'];
const B = Object.fromEntries(BONES.map((b, i) => [b, i]));

function roundCone(px, py, pz, a, b, r1, r2) {
  // segment a→b, rayons r1 → r2 (iq)
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const xx = pax * l2 - bax * y, xy = pay * l2 - bay * y, xz = paz * l2 - baz * y;
  const x2 = xx * xx + xy * xy + xz * xz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
function ellipsoid(px, py, pz, c, r) {
  const x = (px - c[0]) / r[0], y = (py - c[1]) / r[1], z = (pz - c[2]) / r[2];
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const x1 = x / r[0], y1 = y / r[1], z1 = z / r[2];
  const k1 = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1);
  return k1 < 1e-9 ? -Math.min(...r) : k0 * (k0 - 1) / k1;
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);

// rotation d'un point (bras/jambes écartés) autour de l'axe z passant par o
function rotZ(o, ang, dx, dy, dz = 0) { const c = Math.cos(ang), s = Math.sin(ang); return [o[0] + dx * c - dy * s, o[1] + dx * s + dy * c, o[2] + dz]; }

function buildPrims() {
  const P = [];
  // e : ellipsoïde, c : cône arrondi ; reg : zone du vêtement ; k : douceur du raccord
  const E = (bone, c, r, reg, k = 0.03, extra = {}) => P.push({ t: 'e', bone: B[bone], c, r, reg, k, ...extra });
  const C = (bone, a, b, r1, r2, reg, k = 0.03, extra = {}) => P.push({ t: 'c', bone: B[bone], a, b, r1, r2, reg, k, ...extra });
  // tronc
  E('torso', [0, T + 0.39, 0.0], [0.178, 0.15, 0.112], 'shirt', 0.05); // cage thoracique
  E('torso', [0, T + 0.43, 0.035], [0.15, 0.085, 0.085], 'shirt', 0.04); // pectoraux
  E('torso', [0, T + 0.2, 0.0], [0.158, 0.21, 0.104], 'shirt', 0.06); // abdomen
  E('torso', [0, T + 0.4, -0.03], [0.17, 0.13, 0.1], 'shirt', 0.05); // dos (dorsaux)
  E('pelvis', [0, 0.95, -0.005], [0.168, 0.12, 0.11], 'shorts', 0.05); // bassin
  E('pelvis', [0.075, 0.88, -0.055], [0.085, 0.085, 0.075], 'shorts', 0.04); // fessiers
  E('pelvis', [-0.075, 0.88, -0.055], [0.085, 0.085, 0.075], 'shorts', 0.04);
  // cou et trapèzes
  C('torso', [0, T + 0.5, -0.01], [0, T + 0.61, 0.005], 0.062, 0.055, 'neck', 0.04);
  C('head', [0, T + 0.6, 0.005], [0, H + 0.06, 0.0], 0.054, 0.05, 'neck', 0.03);
  for (const sx of [1, -1]) C('torso', [sx * 0.05, T + 0.565, -0.03], [sx * 0.17, T + 0.52, -0.01], 0.05, 0.045, 'shirt', 0.05);
  // bras (pose de liaison écartée)
  for (const [sx, ua, fa] of [[1, 'uaL', 'faL'], [-1, 'uaR', 'faR']]) {
    const o = [sx * SH[0], SH[1], 0];
    const ang = sx * ARM_A;
    const at = (d, dx = 0, dz = 0) => rotZ(o, ang, dx * sx, -d, dz);
    E(ua, at(0.005, 0.0), [0.072, 0.075, 0.07], 'sleeve', 0.04, { len: 0.3, from: o, ang }); // deltoïde
    C(ua, at(0.02), at(0.28), 0.055, 0.043, 'arm', 0.03, { len: 0.3, from: o, ang, sleeve: 0.17 });
    E(ua, at(0.13, 0, 0.012), [0.045, 0.085, 0.048], 'arm', 0.03, { len: 0.3, from: o, ang, sleeve: 0.17 }); // biceps
    C(fa, at(0.3), at(0.545), 0.045, 0.03, 'arm', 0.025, { len: 0.3, from: o, ang });
    E(fa, at(0.37, 0, 0.004), [0.045, 0.07, 0.041], 'arm', 0.03, { len: 0.3, from: o, ang });
  }
  // jambes
  for (const [sx, th, sh] of [[1, 'thL', 'shL'], [-1, 'thR', 'shR']]) {
    const o = [sx * HIP[0], HIP[1], 0];
    const ang = sx * LEG_A;
    const at = (d, dx = 0, dz = 0) => rotZ(o, ang, dx * sx, -d, dz);
    C(th, at(0.0), at(0.44), 0.088, 0.056, 'thigh', 0.04, { from: o, ang, hem: 0.19 });
    E(th, at(0.17, 0.005, 0.025), [0.075, 0.16, 0.075], 'thigh', 0.04, { from: o, ang, hem: 0.19 }); // quadriceps
    C(sh, at(0.44), at(0.86), 0.055, 0.036, 'shin', 0.03, { from: o, ang });
    E(sh, at(0.57, 0, -0.028), [0.052, 0.1, 0.055], 'shin', 0.035, { from: o, ang }); // mollet
  }
  // tête
  E('head', [0, H + 0.13, -0.008], [0.09, 0.108, 0.1], 'skin', 0.04); // crâne
  E('head', [0, H + 0.068, 0.025], [0.07, 0.072, 0.074], 'skin', 0.04); // mâchoire
  E('head', [0, H + 0.022, 0.058], [0.03, 0.026, 0.028], 'skin', 0.025); // menton
  for (const sx of [1, -1]) E('head', [sx * 0.047, H + 0.1, 0.058], [0.03, 0.022, 0.028], 'skin', 0.025); // pommettes
  E('head', [0, H + 0.148, 0.074], [0.068, 0.018, 0.024], 'skin', 0.02); // arcades
  C('head', [0, H + 0.13, 0.094], [0, H + 0.088, 0.118], 0.009, 0.015, 'skin', 0.012); // nez
  for (const sx of [1, -1]) E('head', [sx * 0.015, H + 0.086, 0.104], [0.012, 0.01, 0.011], 'skin', 0.01); // ailes du nez
  E('head', [0, H + 0.064, 0.094], [0.024, 0.008, 0.012], 'lip', 0.008); // lèvre supérieure
  E('head', [0, H + 0.051, 0.092], [0.021, 0.009, 0.012], 'lip', 0.008); // lèvre inférieure
  return P;
}

const PRIMS = buildPrims();
// creux des orbites et commissure des lèvres
const SOCKETS = [[0.036, H + 0.128, 0.092], [-0.036, H + 0.128, 0.092]];

function primDist(p, x, y, z) {
  let d = p.t === 'e' ? ellipsoid(x, y, z, p.c, p.r) : roundCone(x, y, z, p.a, p.b, p.r1, p.r2);
  if (p.reg === 'shirt') d -= 0.006;
  // vêtements : manche et short un peu plus amples, avec un ourlet net
  if (p.sleeve || p.hem) {
    const dx = x - p.from[0], dy = y - p.from[1];
    const along = -(dx * Math.sin(p.ang) * -1 + dy * Math.cos(p.ang)) ;
    const lim = p.sleeve || p.hem;
    if (along < lim) d -= p.sleeve ? 0.011 : 0.02;
  }
  return d;
}

function sdf(x, y, z) {
  let d = 1e9;
  for (const p of PRIMS) {
    if (Math.abs(x - p.cx) > p.ex || Math.abs(y - p.cy) > p.ey || Math.abs(z - p.cz) > p.ez) continue;
    d = smin(d, primDist(p, x, y, z), p.k);
  }
  for (const [sx, sy, sz] of SOCKETS) {
    if (Math.abs(x - sx) < 0.05 && Math.abs(y - sy) < 0.05 && Math.abs(z - sz) < 0.05) {
      d = smax(d, -ellipsoid(x, y, z, [sx, sy + 0.001, sz], [0.0172, 0.0078, 0.0145]), 0.004); // fente des paupières
      d = smax(d, -ellipsoid(x, y, z, [sx, sy + 0.012, sz + 0.004], [0.022, 0.006, 0.01]) * 0.3, 0.006); // pli de la paupière
    }
  }
  // fente de la bouche
  { const dx = x / 0.022, dy = (y - H - 0.0575) / 0.0022, dz = z - 0.1; if (Math.abs(dz) < 0.02 && Math.abs(dx) < 1.2) d = smax(d, -(Math.sqrt(dx * dx + dy * dy) - 1) * 0.0022, 0.003); }
  return d;
}

// boîtes englobantes des primitives (pour accélérer l'évaluation)
for (const p of PRIMS) {
  let mn, mx;
  if (p.t === 'e') { mn = p.c.map((v, i) => v - p.r[i]); mx = p.c.map((v, i) => v + p.r[i]); }
  else { const r = Math.max(p.r1, p.r2); mn = p.a.map((v, i) => Math.min(v, p.b[i]) - r); mx = p.a.map((v, i) => Math.max(v, p.b[i]) + r); }
  const pad = p.k + 0.03;
  p.cx = (mn[0] + mx[0]) / 2; p.cy = (mn[1] + mx[1]) / 2; p.cz = (mn[2] + mx[2]) / 2;
  p.ex = (mx[0] - mn[0]) / 2 + pad; p.ey = (mx[1] - mn[1]) / 2 + pad; p.ez = (mx[2] - mn[2]) / 2 + pad;
}

// ---- maillage par « surface nets » ----
let sdfImpl = sdf;
function surfaceNets(lo, hi, h, out) {
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nz);
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F[idx(i, j, k)] = sdfImpl(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  const vid = new Int32Array(nx * ny * nz).fill(-1);
  const base = out.pos.length / 3;
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const [a, b, d] = corners[c]; cv[c] = F[idx(i + a, j + b, k + d)]; if (cv[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [e0, e1] of edges) {
      const a = cv[e0], b = cv[e1];
      if ((a < 0) === (b < 0)) continue;
      const t = a / (a - b);
      const c0 = corners[e0], c1 = corners[e1];
      sx += c0[0] + (c1[0] - c0[0]) * t; sy += c0[1] + (c1[1] - c0[1]) * t; sz += c0[2] + (c1[2] - c0[2]) * t; n++;
    }
    vid[idx(i, j, k)] = out.pos.length / 3;
    out.pos.push(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h);
  }
  // quadrilatères sur les arêtes qui traversent la surface
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = F[idx(i, j, k)];
    const q = (b, v0, v1, v2, v3) => {
      if ((a < 0) === (b < 0)) return;
      if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return;
      if (a < 0) out.idx.push(v0, v1, v2, v0, v2, v3); else out.idx.push(v0, v3, v2, v0, v2, v1);
    };
    q(F[idx(i + 1, j, k)], vid[idx(i, j - 1, k - 1)], vid[idx(i, j, k - 1)], vid[idx(i, j, k)], vid[idx(i, j - 1, k)]);
    q(F[idx(i, j + 1, k)], vid[idx(i - 1, j, k - 1)], vid[idx(i - 1, j, k)], vid[idx(i, j, k)], vid[idx(i, j, k - 1)]);
    q(F[idx(i, j, k + 1)], vid[idx(i - 1, j - 1, k)], vid[idx(i, j - 1, k)], vid[idx(i, j, k)], vid[idx(i - 1, j, k)]);
  }
  return base;
}

// partie du corps (tronc/tête, bras gauche/droit, jambe gauche/droite) ; les zones
// de vêtement sont calculées au pixel près dans le shader (ourlets nets)
function part(x, y, z) {
  let best = null, bd = 1e9;
  for (const p of PRIMS) {
    if (Math.abs(x - p.cx) > p.ex || Math.abs(y - p.cy) > p.ey || Math.abs(z - p.cz) > p.ez) continue;
    const d = primDist(p, x, y, z);
    if (d < bd) { bd = d; best = p; }
  }
  if (!best) return 0;
  const n = BONES[best.bone];
  return n === 'uaL' || n === 'faL' ? 1 : n === 'uaR' || n === 'faR' ? 2 : n === 'thL' || n === 'shL' ? 3 : n === 'thR' || n === 'shR' ? 4 : 0;
}

function weights(x, y, z) {
  const acc = new Float32Array(BONES.length);
  let dmin = 1e9;
  const ds = [];
  for (const p of PRIMS) {
    if (Math.abs(x - p.cx) > p.ex + 0.05 || Math.abs(y - p.cy) > p.ey + 0.05 || Math.abs(z - p.cz) > p.ez + 0.05) continue;
    const d = primDist(p, x, y, z);
    ds.push([p.bone, d]); if (d < dmin) dmin = d;
  }
  for (const [b, d] of ds) acc[b] += Math.exp(-(d - dmin) / 0.014);
  const order = [...acc.keys()].sort((a, b) => acc[b] - acc[a]).slice(0, 4);
  let s = 0; for (const b of order) s += acc[b];
  return order.map(b => [b, s > 0 ? acc[b] / s : (b === order[0] ? 1 : 0)]);
}

const cache = {};
// h : pas de la grille du corps (m), hh : pas pour la tête
export function bodyGeometry(quality = 'medium') {
  if (cache[quality]) return cache[quality];
  const h = { high: 0.014, medium: 0.018, low: 0.024, far: 0.032 }[quality] || 0.018;
  const hh = { high: 0.0058, medium: 0.0075, low: 0.0095, far: 0.015 }[quality] || 0.0075;
  const out = { pos: [], idx: [] };
  const neckCut = H + 0.005;
  surfaceNets([-0.62, 0.02, -0.24], [0.62, neckCut + 0.02, 0.24], h, out);
  const headStart = out.pos.length / 3;
  const headIdx0 = out.idx.length;
  surfaceNets([-0.12, neckCut - 0.02, -0.14], [0.12, H + 0.26, 0.16], hh, out);
  const nV = out.pos.length / 3;
  // affinage : projection sur la surface + normales par gradient
  const pos = new Float32Array(out.pos), nor = new Float32Array(nV * 3);
  const e = 0.0015;
  for (let v = 0; v < nV; v++) {
    let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    for (let it = 0; it < 2; it++) {
      const d = sdf(x, y, z);
      const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) / (2 * e) || 1;
      const nx = gx / (2 * e) / gl, ny = gy / (2 * e) / gl, nz = gz / (2 * e) / gl;
      x -= nx * d; y -= ny * d; z -= nz * d;
      if (it === 1) { nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz; }
    }
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
  }
  // on ne garde du maillage du corps que ce qui est sous la coupe du cou, et de la tête ce qui est au-dessus
  const keepTri = [];
  for (let t = 0; t < out.idx.length; t += 3) {
    const a = out.idx[t], b = out.idx[t + 1], c = out.idx[t + 2];
    const cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
    const head = t >= headIdx0;
    if (head ? cy >= neckCut - 0.012 : cy < neckCut) keepTri.push(a, b, c);
  }
  // zone par face, puis duplication des sommets aux frontières de zones
  const vReg = new Int8Array(nV);
  for (let v = 0; v < nV; v++) vReg[v] = part(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
  const map = new Map();
  const P = [], N = [], R = [], I = [];
  for (let t = 0; t < keepTri.length; t += 3) {
    const tri = [keepTri[t], keepTri[t + 1], keepTri[t + 2]];
    const rs = tri.map(v => vReg[v]);
    const r = rs[0] === rs[1] || rs[0] === rs[2] ? rs[0] : rs[1] === rs[2] ? rs[1] : rs[0];
    for (const v of tri) {
      const key = v * 8 + r;
      let ni = map.get(key);
      if (ni === undefined) { ni = P.length / 3; map.set(key, ni); P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); N.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]); R.push(r); }
      I.push(ni);
    }
  }
  const n = P.length / 3;
  const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4), ao = new Float32Array(n), uv = new Float32Array(n * 2);
  for (let v = 0; v < n; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    weights(x, y, z).forEach(([b, w], k) => { skinIndex[v * 4 + k] = b; skinWeight[v * 4 + k] = w; });
    let u = Math.atan2(x, z) / (Math.PI * 2); if (u < 0) u += 1;
    uv[v * 2] = u * 3; uv[v * 2 + 1] = y * 2.2;
    // occlusion ambiante (aisselles, entrejambe, orbites, plis)
    const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    let occ = 0;
    for (let s = 1; s <= 4; s++) { const dd = s * 0.018; const sd = Math.min(dd, Math.max(0, sdf(x + nx * dd, y + ny * dd, z + nz * dd))); occ += (dd - sd) / dd / s; }
    ao[v] = Math.min(1, Math.max(0.35, 1 - occ * 0.55));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(R, 1));
  g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  g.setIndex(I);
  g.computeBoundingSphere();
  cache[quality] = g;
  void headStart;
  return g;
}

// Pose de liaison des os (même hiérarchie et mêmes positions que le squelette d'animation)
export function makeSkeleton() {
  const b = {};
  for (const n of BONES) { b[n] = new THREE.Bone(); b[n].name = n; }
  b.root.add(b.pelvis); b.pelvis.position.y = 0.98;
  b.pelvis.add(b.torso); b.torso.position.y = 0.04;
  b.torso.add(b.head); b.head.position.y = 0.65;
  b.torso.add(b.uaL); b.uaL.position.set(0.205, 0.5, 0); b.uaL.rotation.z = ARM_A;
  b.torso.add(b.uaR); b.uaR.position.set(-0.205, 0.5, 0); b.uaR.rotation.z = -ARM_A;
  b.uaL.add(b.faL); b.faL.position.y = -0.3;
  b.uaR.add(b.faR); b.faR.position.y = -0.3;
  b.pelvis.add(b.thL); b.thL.position.set(0.095, -0.06, 0); b.thL.rotation.z = LEG_A;
  b.pelvis.add(b.thR); b.thR.position.set(-0.095, -0.06, 0); b.thR.rotation.z = -LEG_A;
  b.thL.add(b.shL); b.shL.position.y = -0.44;
  b.thR.add(b.shR); b.shR.position.y = -0.44;
  return { bones: BONES.map(n => b[n]), map: b };
}

// Matériau partagé (un programme GPU) avec couleurs par joueur
export function bodyMaterial(hi, maps) {
  const u = {
    uShirt: { value: new THREE.Color() }, uShirt2: { value: new THREE.Color() }, uShorts: { value: new THREE.Color() }, uSocks: { value: new THREE.Color() },
    uSkin: { value: new THREE.Color() }, uPat: { value: 0 }, uFlags: { value: new THREE.Vector4() },
  };
  const m = hi
    ? new THREE.MeshPhysicalMaterial({ roughness: 0.62, sheen: 0.45, sheenRoughness: 0.55, sheenColor: new THREE.Color(0.45, 0.45, 0.45), normalMap: maps.knit, normalScale: new THREE.Vector2(0.22, 0.22) })
    : new THREE.MeshStandardMaterial({ roughness: 0.65, normalMap: maps.knit, normalScale: new THREE.Vector2(0.2, 0.2) });
  m.userData.u = u;
  m.customProgramCacheKey = () => 'smooth-body-' + (hi ? 1 : 0);
  const C = `const float T = ${T.toFixed(3)}; const float HH = ${H.toFixed(3)}; const float ARM_A = ${ARM_A.toFixed(3)}; const float LEG_A = ${LEG_A.toFixed(3)};`;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aPart; attribute float aAO; varying vec3 vB; varying float vPart; varying float vAO;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n vB = position; vPart = aPart; vAO = aAO;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec3 uShirt; uniform vec3 uShirt2; uniform vec3 uShorts; uniform vec3 uSocks; uniform vec3 uSkin; uniform float uPat; uniform vec4 uFlags;
      varying vec3 vB; varying float vPart; varying float vAO;
      ${C}
      float ell(vec3 p, vec3 c, vec3 r) { return length((p - c) / r); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 b = vB; float part = floor(vPart + 0.5);
        float reg = 0.0, al = 0.0;
        if (part < 0.5) {
          float rad = length(b.xz - vec2(0.0, -0.005));
          float nl = T + 0.578 - 0.022 * clamp(b.z / 0.06, 0.0, 1.0);
          if (b.y > HH - 0.03 || (b.y > nl && rad < 0.072)) {
            reg = 0.0;
            if (b.y > HH + 0.035 && b.y < HH + 0.075 && (ell(b, vec3(0.0, HH + 0.064, 0.094), vec3(0.026, 0.0105, 0.016)) < 1.0 || ell(b, vec3(0.0, HH + 0.051, 0.092), vec3(0.023, 0.0115, 0.016)) < 1.0)) reg = 7.0;
          } else reg = b.y > 0.915 ? 1.0 : 2.0;
        } else if (part < 2.5) {
          float sx = part < 1.5 ? 1.0 : -1.0; float a = sx * ARM_A;
          al = (b.x - sx * 0.205) * sin(a) - (b.y - (T + 0.5)) * cos(a);
          reg = al < 0.17 ? 6.0 : 4.0;
        } else {
          float sx = part < 3.5 ? 1.0 : -1.0; float a = sx * LEG_A;
          al = (b.x - sx * 0.095) * sin(a) - (b.y - 0.92) * cos(a);
          reg = al < 0.19 ? 2.0 : al < 0.52 ? 5.0 : 3.0;
        }
        vec3 col = uSkin; float cloth = 1.0;
        float u = atan(b.x, b.z) / 6.2831853; if (u < 0.0) u += 1.0;
        float fx = u < 0.5 ? u : u - 1.0;
        if (reg < 0.5) { col = uSkin; cloth = 0.0; }
        else if (reg < 1.5) {
          col = uShirt;
          float v = clamp((b.y - 0.9) / (T + 0.6 - 0.9), 0.0, 1.0), pm = 0.0, tie = 0.0;
          if (uPat > 0.5 && uPat < 1.5) pm = step(0.5, fract(u * 12.0));
          else if (uPat > 1.5 && uPat < 2.5) pm = step(0.5, fract(v * 7.0)) * step(v, 0.93);
          else if (uPat > 2.5 && uPat < 3.5) pm = step(0.5, u);
          else if (uPat > 3.5 && uPat < 4.5) pm = step(abs(fx * 2.4 - (v - 0.5)), 0.1) * step(abs(fx), 0.27);
          else if (uPat > 4.5 && uPat < 5.5) pm = step(0.86, fract(u * 26.0));
          else if (uPat > 5.5 && uPat < 6.5) pm = step(abs(abs(fx) * 1.7 - (0.86 - v)), 0.06) * step(abs(fx), 0.3);
          else if (uPat > 6.5) { pm = step(abs(fx), (v - 0.5) * 0.36) * step(0.5, v); tie = pm * step(abs(fx), 0.016 + step(0.86, v) * 0.006) * step(v, 0.93); }
          col = mix(col, uShirt2, pm);
          col = mix(col, vec3(0.38, 0.05, 0.08), tie);
          col *= 1.0 - 0.1 * step(abs(abs(fx) - 0.25), 0.005);
          col *= 1.0 - 0.18 * step(b.y, 0.93);
        }
        else if (reg < 2.5) { col = uShorts; col *= 1.0 - 0.14 * step(abs(abs(fx) - 0.25), 0.004) * step(part, 0.5); if (part > 2.5) col *= 1.0 - 0.15 * step(0.175, al); }
        else if (reg < 3.5) { col = uFlags.y > 0.5 ? uShorts : uSocks; if (uFlags.y < 0.5) col *= 1.0 - 0.18 * step(al, 0.56) - 0.06 * step(0.62, al) * step(al, 0.78); }
        else if (reg < 4.5) { if (uFlags.x > 0.5) col = uShirt; else { col = uSkin; cloth = 0.0; } }
        else if (reg < 5.5) { if (uFlags.y > 0.5) col = uShorts; else { col = uSkin; cloth = 0.0; } }
        else if (reg < 6.5) { if (uFlags.z > 0.5) { col = uSkin; cloth = 0.0; } else { col = uShirt; col *= 1.0 - 0.15 * step(0.155, al); } }
        else { col = uSkin * vec3(0.72, 0.5, 0.48); cloth = 0.0; }
        diffuseColor.rgb *= col * vAO;
        float vCloth = cloth;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(0.46, roughnessFactor, vCloth);')
      .replace('#include <normal_fragment_maps>', 'vec3 nrmBase = normal;\n#include <normal_fragment_maps>\n normal = normalize(mix(nrmBase, normal, vCloth));');
  };
  return m;
}

// ---- cheveux et barbe (maillages fixes accrochés à la tête) ----
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hairSdf(style, x, y, z) {
  // ligne d'implantation selon l'angle autour de la tête : front, tempes, pattes, nuque
  const th = Math.abs(Math.atan2(x, z));
  const K = [[0, 0.19], [0.5, 0.182], [0.9, 0.16], [1.2, 0.108], [1.45, 0.142], [1.75, 0.142], [2.3, 0.075], [Math.PI, 0.035]];
  let lv = K[K.length - 1][1];
  for (let i = 0; i < K.length - 1; i++) if (th <= K[i + 1][0]) { const t = sstep(0, 1, (th - K[i][0]) / (K[i + 1][0] - K[i][0])); lv = K[i][1] + (K[i + 1][1] - K[i][1]) * t; break; }
  let line = H + lv - (style === 2 ? 0.035 * sstep(1.0, 2.2, th) : 0) - (style === 3 ? 0.008 : 0);
  // épaisseur : fine sur les côtés, plus fournie sur le dessus, nulle à la lisière
  const side = [0.003, 0.005, 0.013, 0.03, 0.005][style], top = [0.004, 0.016, 0.022, 0.05, 0.014][style];
  const off = (side + (top - side) * sstep(H + 0.13, H + 0.23, y)) * (0.25 + 0.75 * sstep(line, line + 0.035, y));
  let d = ellipsoid(x, y, z, [0, H + 0.13, -0.008], [0.09, 0.108, 0.1]) - off;
  if (style === 2) d = smin(d, ellipsoid(x, y, z, [0, H + 0.12, -0.045], [0.098, 0.1, 0.085]), 0.04);
  if (style === 4) d = smin(d, ellipsoid(x, y, z, [0, H + 0.222, 0.05], [0.058, 0.038, 0.058]), 0.035);
  if (style === 3) d = smin(d, ellipsoid(x, y, z, [0, H + 0.19, -0.01], [0.13, 0.1, 0.13]), 0.05);
  return smax(d, line - y, 0.006);
}
function beardSdf(x, y, z) {
  let d = smin(ellipsoid(x, y, z, [0, H + 0.068, 0.025], [0.077, 0.079, 0.081]), ellipsoid(x, y, z, [0, H + 0.022, 0.058], [0.037, 0.033, 0.035]), 0.03);
  d = smax(d, y - (H + 0.096 - 0.02 * sstep(0.0, 0.06, Math.abs(x)) * 0), 0.008);
  d = smax(d, -(z + 0.015), 0.01);
  d = smax(d, -ellipsoid(x, y, z, [0, H + 0.057, 0.096], [0.028, 0.013, 0.03]), 0.006);
  return d;
}
function meshFrom(fn, lo, hi, h, offset) {
  const out = { pos: [], idx: [] };
  const save = sdfImpl; sdfImpl = fn;
  surfaceNets(lo, hi, h, out);
  sdfImpl = save;
  const n = out.pos.length / 3, pos = new Float32Array(out.pos), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const e = 0.001;
  for (let v = 0; v < n; v++) {
    let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const d = fn(x, y, z);
    const gx = fn(x + e, y, z) - fn(x - e, y, z), gy = fn(x, y + e, z) - fn(x, y - e, z), gz = fn(x, y, z + e) - fn(x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    x -= gx / gl * d; y -= gy / gl * d; z -= gz / gl * d;
    pos[v * 3] = x; pos[v * 3 + 1] = y - offset; pos[v * 3 + 2] = z;
    nor[v * 3] = gx / gl; nor[v * 3 + 1] = gy / gl; nor[v * 3 + 2] = gz / gl;
    uv[v * 2] = Math.atan2(x, z) / Math.PI + 1; uv[v * 2 + 1] = (y - H) * 6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(out.idx);
  return g;
}
const hairCache = {};
export function hairGeometries(quality = 'medium') {
  if (hairCache[quality]) return hairCache[quality];
  const h = { high: 0.0075, medium: 0.0095, low: 0.012, far: 0.017 }[quality] || 0.0095;
  const res = {};
  for (let st = 0; st < 5; st++) res['hair' + st] = meshFrom((x, y, z) => hairSdf(st, x, y, z), [-0.2, H - 0.05, -0.2], [0.2, H + 0.35, 0.2], h, H + 0.125);
  res.beard = meshFrom(beardSdf, [-0.1, H - 0.03, -0.05], [0.1, H + 0.12, 0.15], h * 0.8, H);
  hairCache[quality] = res;
  return res;
}

// ---- géométries précalculées à la compilation (évite ~1 s de calcul au lancement) ----
const TYPES = { Float32Array, Uint16Array, Uint32Array, Int8Array, Uint8Array };
export function packGeometries(geos) {
  const meta = {}, chunks = [];
  let off = 0;
  const add = (arr) => { const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); off += pad; } const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); chunks.push(b); const o = off; off += b.byteLength; return o; };
  for (const [name, g] of Object.entries(geos)) {
    const m = { attrs: [] };
    for (const [n, a] of Object.entries(g.attributes)) m.attrs.push({ n, size: a.itemSize, type: a.array.constructor.name, norm: a.normalized, off: add(a.array), len: a.array.length });
    if (g.index) m.index = { type: g.index.array.constructor.name, off: add(g.index.array), len: g.index.array.length };
    meta[name] = m;
  }
  const js = new TextEncoder().encode(JSON.stringify(meta));
  const head = new Uint32Array([js.length]);
  const hpad = (4 - ((4 + js.length) % 4)) % 4;
  const out = new Uint8Array(4 + js.length + hpad + off);
  out.set(new Uint8Array(head.buffer), 0); out.set(js, 4);
  let p = 4 + js.length + hpad;
  for (const c of chunks) { out.set(c, p); p += c.byteLength; }
  return out;
}
export function unpackGeometries(buf) {
  const len = new Uint32Array(buf, 0, 1)[0];
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
  const base = 4 + len + ((4 - ((4 + len) % 4)) % 4);
  const out = {};
  for (const [name, m] of Object.entries(meta)) {
    const g = new THREE.BufferGeometry();
    for (const a of m.attrs) g.setAttribute(a.n, new THREE.BufferAttribute(new TYPES[a.type](buf, base + a.off, a.len), a.size, a.norm));
    if (m.index) g.setIndex(new THREE.BufferAttribute(new TYPES[m.index.type](buf, base + m.index.off, m.index.len), 1));
    g.computeBoundingSphere();
    out[name] = g;
  }
  return out;
}
export async function preloadBodies(levels) {
  await Promise.all(levels.map(async (q) => {
    if (cache[q] && hairCache[q]) return;
    try {
      const res = await fetch(`./body/${q}.bin`);
      if (!res.ok) return;
      const g = unpackGeometries(await res.arrayBuffer());
      cache[q] = g.body;
      hairCache[q] = { hair0: g.hair0, hair1: g.hair1, hair2: g.hair2, hair3: g.hair3, hair4: g.hair4, beard: g.beard };
    } catch (e) { /* calcul à la volée */ }
  }));
}
