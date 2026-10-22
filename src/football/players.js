// Joueurs 3D : squelettes procéduraux animés (course, frappe, tête, plongeon,
// tacle, chute, célébration) rendus avec des InstancedMesh (peu d'appels GPU).
import * as THREE from 'three';
import { ENT, ACT } from './engine.js';
import { canvasTex } from './stadium.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bodyGeometry, makeSkeleton, bodyMaterial, hairGeometries, BONES } from './body.js';

// pièces remplacées par le corps lisse animé
const SMOOTH_EYE_Z = 0.074;
const SMOOTH_SKIP = new Set(['torso', 'neck', 'head', 'nose', 'mouth', 'sleeve', 'upperArm', 'forearm', 'shortsTop', 'shortLeg', 'thigh', 'shin', 'hair0', 'hair1', 'hair2', 'hair3', 'hair4', 'beard']);
const LOD_FAR = 24; // m : au-delà, maillage allégé

const N = 25;

function capsule(r, len, radial = 8) {
  const g = new THREE.CapsuleGeometry(r, len, 3, radial);
  g.translate(0, -len / 2 - r * 0.6, 0);
  return g;
}

function numberAtlas() {
  return canvasTex(1024, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 70px Arial Black, Arial, sans-serif';
    for (let n = 0; n < 100; n++) {
      const cx = (n % 10) * 102.4 + 51.2, cy = Math.floor(n / 10) * 102.4 + 54;
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.strokeText(String(n), cx, cy);
      g.fillText(String(n), cx, cy);
    }
  }, { aniso: 4 });
}

function skinColor(s) {
  const a = new THREE.Color('#f3d0b4'), b = new THREE.Color('#c68a55'), c = new THREE.Color('#3f2516');
  return s < 0.5 ? a.clone().lerp(b, s * 2) : b.clone().lerp(c, (s - 0.5) * 2);
}

function ballTexture() {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#f7f7f7'; g.fillRect(0, 0, w, h);
    // pentagones aux sommets d'un icosaèdre (projection équirectangulaire)
    const phi = (1 + Math.sqrt(5)) / 2;
    const v = [[-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0], [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi], [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1]];
    for (const [x, y, z] of v) {
      const L = Math.hypot(x, y, z);
      const lat = Math.asin(y / L), lon = Math.atan2(z, x);
      const px = ((lon + Math.PI) / (2 * Math.PI)) * w, py = ((Math.PI / 2 - lat) / Math.PI) * h;
      const sx = 22 / Math.max(0.35, Math.cos(lat));
      g.fillStyle = '#151515';
      g.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        g.lineTo(px + Math.cos(a) * sx, py + Math.sin(a) * 22);
      }
      g.closePath(); g.fill();
      g.strokeStyle = '#c62828'; g.lineWidth = 3; g.stroke();
    }
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(0, (i + 0.5) * h / 6); g.bezierCurveTo(w / 3, (i * h) / 6, (2 * w) / 3, ((i + 1) * h) / 6, w, (i + 0.5) * h / 6); g.stroke(); }
  });
}

// ---------- Géométries du corps (proportions humaines, ~1,92 m) ----------
const V2 = (x, y) => new THREE.Vector2(x, y);
function lathe(pts, seg = 20, flatZ = 1) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), seg);
  g.scale(1, 1, flatZ);
  return g;
}
function cyl(rt, rb, h, seg = 14) { const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, false); g.translate(0, -h / 2, 0); return g; }
function sph(r, sx = 1, sy = 1, sz = 1, x = 0, y = 0, z = 0, ws = 16, hs = 12) { const g = new THREE.SphereGeometry(r, ws, hs); g.scale(sx, sy, sz); g.translate(x, y, z); return g; }
const merge = (...gs) => mergeGeometries(gs.map(g => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); return n; }));

function bodyGeometries() {
  const torso = lathe([[0.001, -0.005], [0.135, 0.0], [0.15, 0.06], [0.152, 0.18], [0.163, 0.29], [0.18, 0.39], [0.19, 0.47], [0.188, 0.52], [0.168, 0.555], [0.12, 0.59], [0.06, 0.607], [0.001, 0.612]], 28, 0.64);
  const head = merge(sph(0.104, 0.9, 1.08, 1.0, 0, 0.125, 0, 26, 18), sph(0.078, 0.86, 0.82, 0.92, 0, 0.055, 0.022, 20, 14), sph(0.03, 1.4, 0.7, 0.6, 0, 0.026, 0.06, 10, 8));
  // coiffures
  const cap = (r, theta, tilt, sx = 0.95, sy = 1, sz = 1.05, y = 0.006, z = -0.01) => {
    const g = new THREE.SphereGeometry(r, 22, 12, 0, Math.PI * 2, 0, Math.PI * theta);
    g.rotateX(tilt); g.scale(sx, sy, sz); g.translate(0, y, z); return g;
  };
  const hair0 = cap(0.107, 0.58, -0.72); // rasé
  const hair1 = cap(0.112, 0.6, -0.72); // court
  const hair2 = merge(cap(0.115, 0.62, -0.75), sph(0.1, 1.05, 1.2, 0.62, 0, -0.045, -0.06, 16, 10)); // mi-long
  const hair3 = cap(0.14, 0.66, -0.68, 1, 0.95, 1.05, 0.015, -0.015); // afro
  const hair4 = merge(cap(0.11, 0.56, -0.72), sph(0.075, 0.7, 0.5, 1.0, 0, 0.085, 0.02, 14, 8)); // houppe
  const beardG = new THREE.SphereGeometry(0.083, 20, 10, 0, Math.PI, Math.PI * 0.42, Math.PI * 0.56);
  beardG.scale(0.9, 0.86, 0.98); beardG.translate(0, 0.058, 0.02);
  const nose = merge(new THREE.ConeGeometry(0.017, 0.045, 10).rotateX(Math.PI / 2 + 0.35).translate(0, 0.098, 0.1), sph(0.012, 1.3, 0.8, 1, 0, 0.083, 0.111, 10, 6));
  const mouth = sph(0.024, 1, 0.22, 0.45, 0, 0.062, 0.084, 12, 6);
  const brow = new THREE.BoxGeometry(0.034, 0.0075, 0.01).translate(0, 0.02, 0.019);
  const eye = sph(0.0135, 1, 0.78, 0.6, 0, 0, 0, 12, 8);
  const pupil = sph(0.0072, 1, 1, 0.5, 0, 0, 0.0075, 10, 6);
  const ear = sph(0.026, 0.38, 1, 0.68, 0, 0, 0, 10, 8);
  const neck = lathe([[0.058, -0.0], [0.052, 0.04], [0.05, 0.1]], 14); neck.translate(0, 0, 0);
  const collar = new THREE.TorusGeometry(0.062, 0.013, 8, 22); collar.rotateX(Math.PI / 2); collar.scale(1, 1, 0.85);
  const sleeve = merge(sph(0.074, 1, 0.9, 0.9, 0, -0.01, 0, 16, 10), lathe([[0.062, -0.17], [0.066, -0.12], [0.072, -0.04], [0.072, 0]], 16));
  const upperArm = merge(sph(0.055, 1, 1, 1, 0, -0.02, 0, 14, 10), lathe([[0.041, -0.29], [0.046, -0.22], [0.053, -0.14], [0.052, -0.06], [0.05, 0]], 14));
  const forearm = merge(sph(0.044, 1, 1, 1, 0, 0, 0, 12, 8), lathe([[0.03, -0.25], [0.033, -0.2], [0.042, -0.1], [0.046, -0.05], [0.043, 0]], 14));
  const hand = merge(sph(0.04, 0.72, 1.15, 0.5, 0, -0.045, 0, 14, 10), sph(0.016, 1, 1.4, 1, 0.03, -0.035, 0.012, 8, 6), sph(0.03, 0.8, 0.9, 0.45, 0, -0.09, 0.004, 10, 6));
  const shortsTop = lathe([[0.178, -0.2], [0.18, -0.15], [0.172, -0.08], [0.16, -0.02], [0.148, 0.03], [0.136, 0.06]], 24, 0.7);
  const shortLeg = new THREE.CylinderGeometry(0.098, 0.09, 0.2, 16, 1, true).translate(0, -0.14, 0);
  const thigh = merge(lathe([[0.057, -0.44], [0.062, -0.38], [0.074, -0.27], [0.083, -0.15], [0.085, -0.07], [0.078, 0]], 16), sph(0.059, 1, 1, 1, 0, -0.44, 0.004, 14, 10));
  const shin = lathe([[0.001, -0.43], [0.04, -0.43], [0.038, -0.38], [0.047, -0.29], [0.061, -0.17], [0.064, -0.09], [0.056, 0.0], [0.001, 0.0]], 18, 1);
  const boot = merge(sph(1, 0.052, 0.045, 0.128, 0, -0.03, 0.045, 16, 12), new THREE.BoxGeometry(0.098, 0.016, 0.255).translate(0, -0.068, 0.045));
  const num = new THREE.PlaneGeometry(0.2, 0.2);
  const numF = new THREE.PlaneGeometry(0.075, 0.075);
  const sponsor = new THREE.PlaneGeometry(0.21, 0.07);
  const badge = new THREE.PlaneGeometry(0.06, 0.07);
  const shadow = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2).translate(0, 0.015, 0);
  return { mouth, brow, torso, head, hair0, hair1, hair2, hair3, hair4, beard: beardG, nose, eye, pupil, ear, neck, collar, sleeve, upperArm, forearm, hand, shortsTop, shortLeg, thigh, shin, boot, num, numF, sponsor, badge, shadow };
}

// Carte de relief (maille du maillot / peau) générée à partir d'un bruit
function normalTex(kind) {
  const S = 128;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v;
    if (kind === 'knit') v = Math.sin(x * 1.6) * 0.5 + Math.sin(y * 1.6 + (x % 4 < 2 ? 1.2 : 0)) * 0.5 + Math.random() * 0.3;
    else v = Math.random();
    h[y * S + x] = v;
  }
  return canvasTex(S, S, (g) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x + S - 1) % S)];
      const dy = h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x];
      const i = (y * S + x) * 4;
      img.data[i] = 128 - dx * 60; img.data[i + 1] = 128 - dy * 60; img.data[i + 2] = 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { linear: true, repeat: kind === 'knit' ? [10, 8] : [6, 6] });
}

function sponsorAtlas() {
  return canvasTex(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const names = ['VOLTA', 'LUMINA', 'CRISPYMAX', 'HORIZON', 'NEO 5G', 'AQUAPURA', 'KAPPA FIT', 'ROMA'];
    names.forEach((n, i) => {
      const cx = (i % 2) * 256 + 128, cy = Math.floor(i / 2) * 128 + 64;
      g.font = 'italic 900 62px Arial Black, Arial';
      g.fillText(n, cx, cy, 236);
    });
  }, { aniso: 4 });
}

function badgeTex() {
  return canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(8, 6); g.lineTo(56, 6); g.lineTo(56, 30); g.quadraticCurveTo(54, 52, 32, 60); g.quadraticCurveTo(10, 52, 8, 30); g.closePath(); g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.lineWidth = 4; g.strokeStyle = '#000'; g.beginPath(); g.moveTo(14, 12); g.lineTo(50, 12); g.lineTo(50, 30); g.quadraticCurveTo(48, 47, 32, 53); g.quadraticCurveTo(16, 47, 14, 30); g.closePath(); g.stroke();
    g.fillRect(29, 16, 6, 30);
  });
}

function shadowTex() {
  return canvasTex(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.45, 'rgba(0,0,0,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

// Textures "tissu" en niveaux de gris, teintées par la couleur de chaque joueur
function fabricTex(kind) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    if (kind === 'shirt') {
      for (const u of [0.25, 0.75]) {
        const grd = g.createLinearGradient((u - 0.07) * w, 0, (u + 0.07) * w, 0);
        grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.5, 'rgba(0,0,0,0.16)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect((u - 0.07) * w, 0, 0.14 * w, h);
      }
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, h * 0.9, w, h * 0.1);
    } else if (kind === 'shorts') {
      for (const u of [0.25, 0.75]) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect((u - 0.015) * w, 0, 0.03 * w, h); }
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, w, h * 0.12);
    } else if (kind === 'sock') {
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, w, h * 0.08);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, h * 0.12, w, h * 0.05);
      g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, h * 0.6, w, h * 0.4); // protège-tibia
    } else if (kind === 'skin') {
      for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${120 + Math.random() * 60},60,40,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    } else if (kind === 'face') {
      // joues rosées, ombres des orbites, lèvres
      const blob = (x, y, r, c) => { const grd = g.createRadialGradient(x, y, 0, x, y, r); grd.addColorStop(0, c); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2); };
      blob(w * 0.35, h * 0.55, 40, 'rgba(200,70,60,0.18)'); blob(w * 0.65, h * 0.55, 40, 'rgba(200,70,60,0.18)');
      blob(w * 0.5, h * 0.7, 60, 'rgba(0,0,0,0.12)');
      for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(120,60,40,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    } else if (kind === 'hair') {
      for (let x = 0; x < w; x += 2) { g.fillStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.3})`; g.fillRect(x, 0, 1, h); }
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 8); }
    } else if (kind === 'boot') {
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, w, h * 0.3);
      g.fillStyle = 'rgba(255,255,255,0.9)'; for (let i = 0; i < 3; i++) g.fillRect(w * (0.2 + i * 0.12), h * 0.35, w * 0.05, h * 0.4);
    }
  }, { repeat: [1, 1] });
}

// Pièces du corps : [géométrie, nœuds du squelette, couleur, condition d'affichage]
const PARTS = [
  ['shadow', ['root'], 'shadow'],
  ['torso', ['torso'], 'shirt'], ['collar', ['collar'], 'trim'], ['neck', ['neck'], 'skin'],
  ['head', ['head'], 'face'], ['nose', ['head'], 'skin'],
  ['hair0', ['hair'], 'hair', m => m.hairStyle === 0], ['hair1', ['hair'], 'hair', m => m.hairStyle === 1], ['hair2', ['hair'], 'hair', m => m.hairStyle === 2],
  ['hair3', ['hair'], 'hair', m => m.hairStyle === 3], ['hair4', ['hair'], 'hair', m => m.hairStyle === 4 || m.hairStyle == null],
  ['beard', ['head'], 'hair', m => !!m.beard],
  ['eye', ['eyeL', 'eyeR'], 'sclera'], ['pupil', ['eyeL', 'eyeR'], 'eye'], ['mouth', ['head'], 'lip'], ['brow', ['eyeL', 'eyeR'], 'hair'], ['ear', ['earL', 'earR'], 'skin'],
  ['sleeve', ['uaL', 'uaR'], 'shirt'], ['upperArm', ['uaL', 'uaR'], 'arm'], ['forearm', ['faL', 'faR'], 'arm'], ['hand', ['hdL', 'hdR'], 'hand'],
  ['shortsTop', ['pelvis'], 'shorts'], ['shortLeg', ['slL', 'slR'], 'shorts'], ['thigh', ['thL', 'thR'], 'leg'],
  ['shin', ['shL', 'shR'], 'socks'], ['boot', ['ftL', 'ftR'], 'boot'], ['num', ['num'], 'num'], ['numF', ['numF'], 'num', m => !m.official],
  ['sponsor', ['sponsor'], 'sponsorCol', m => m.sponsor >= 0 && !m.official], ['badge', ['badge'], 'badgeCol', m => !m.official],
];

class Rig {
  constructor() {
    const o = () => new THREE.Object3D();
    const names = ['root', 'pelvis', 'torso', 'neck', 'collar', 'head', 'hair', 'eyeL', 'eyeR', 'earL', 'earR', 'num', 'numF', 'sponsor', 'badge', 'uaL', 'uaR', 'faL', 'faR', 'hdL', 'hdR', 'thL', 'thR', 'slL', 'slR', 'shL', 'shR', 'ftL', 'ftR'];
    for (const n of names) this[n] = o();
    this.root.add(this.pelvis); this.pelvis.position.y = 0.98;
    this.pelvis.add(this.torso); this.torso.position.y = 0.04;
    this.torso.add(this.neck); this.neck.position.y = 0.55;
    this.torso.add(this.collar); this.collar.position.y = 0.572;
    this.torso.add(this.head); this.head.position.y = 0.65;
    this.head.add(this.hair); this.hair.position.y = 0.125;
    this.head.add(this.eyeL); this.eyeL.position.set(0.036, 0.128, SMOOTH_EYE_Z);
    this.head.add(this.eyeR); this.eyeR.position.set(-0.036, 0.128, SMOOTH_EYE_Z);
    this.head.add(this.earL); this.earL.position.set(0.094, 0.115, -0.005);
    this.head.add(this.earR); this.earR.position.set(-0.094, 0.115, -0.005);
    this.torso.add(this.num); this.num.position.set(0, 0.34, -0.118); this.num.rotation.y = Math.PI;
    this.torso.add(this.numF); this.numF.position.set(0.075, 0.44, 0.12); this.numF.rotation.x = -0.12;
    this.torso.add(this.sponsor); this.sponsor.position.set(0, 0.33, 0.123); this.sponsor.rotation.x = -0.05;
    this.torso.add(this.badge); this.badge.position.set(-0.075, 0.44, 0.12); this.badge.rotation.x = -0.12;
    this.torso.add(this.uaL); this.uaL.position.set(0.205, 0.5, 0);
    this.torso.add(this.uaR); this.uaR.position.set(-0.205, 0.5, 0);
    this.uaL.add(this.faL); this.faL.position.y = -0.3;
    this.uaR.add(this.faR); this.faR.position.y = -0.3;
    this.faL.add(this.hdL); this.hdL.position.y = -0.255;
    this.faR.add(this.hdR); this.hdR.position.y = -0.255;
    this.pelvis.add(this.thL); this.thL.position.set(0.095, -0.06, 0);
    this.pelvis.add(this.thR); this.thR.position.set(-0.095, -0.06, 0);
    this.thL.add(this.slL); this.thR.add(this.slR);
    this.thL.add(this.shL); this.shL.position.y = -0.44;
    this.thR.add(this.shR); this.shR.position.y = -0.44;
    this.shL.add(this.ftL); this.ftL.position.y = -0.43;
    this.shR.add(this.ftR); this.ftR.position.y = -0.43;
    this.phase = Math.random() * 6;
    this.yaw = 0;
  }
}

export class Players {
  constructor(scene, quality, opts = {}) {
    this.scene = scene;
    this.smooth = opts.smooth !== false;
    const G = bodyGeometries();
    const tex = { shirt: fabricTex('shirt'), shorts: fabricTex('shorts'), socks: fabricTex('sock'), skin: fabricTex('skin'), face: fabricTex('face'), hair: fabricTex('hair'), boot: fabricTex('boot') };
    const knit = normalTex('knit'), pores = normalTex('skin');
    const numTex = numberAtlas(), spTex = sponsorAtlas();
    const hi = quality !== 'low';
    this.meshes = {};
    this.parts = this.smooth ? PARTS.filter(p => !SMOOTH_SKIP.has(p[0])) : PARTS;
    const atlasShader = (cols, rows) => (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aNum;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = (vMapUv + vec2(mod(aNum, ${cols}.0), ${rows - 1}.0 - floor(aNum / ${cols}.0))) / vec2(${cols}.0, ${rows}.0);\n#endif`);
    };
    for (const [k, nodes, col] of this.parts) {
      const geo = G[k];
      const count = N * nodes.length;
      let mat;
      if (k === 'num' || k === 'numF' || k === 'sponsor') {
        mat = new THREE.MeshStandardMaterial({ map: k === 'sponsor' ? spTex : numTex, transparent: true, alphaTest: 0.4, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
        mat.onBeforeCompile = k === 'sponsor' ? atlasShader(2, 4) : atlasShader(10, 10);
        mat.customProgramCacheKey = () => (k === 'sponsor' ? 'atlas-2x4' : 'atlas-10x10');
        geo.setAttribute('aNum', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
      } else if (k === 'badge') {
        mat = new THREE.MeshStandardMaterial({ map: badgeTex(), transparent: true, alphaTest: 0.4, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      } else if (k === 'shadow') {
        mat = new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false, color: 0x000000 });
      } else if (col === 'shirt' || col === 'shorts' || col === 'socks') {
        const map = col === 'shirt' ? tex.shirt : col === 'shorts' ? tex.shorts : tex.socks;
        mat = hi ? new THREE.MeshPhysicalMaterial({ map, normalMap: knit, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.72, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.6, 0.6, 0.6), side: k === 'shortLeg' ? THREE.DoubleSide : THREE.FrontSide })
          : new THREE.MeshStandardMaterial({ map, roughness: 0.7, side: k === 'shortLeg' ? THREE.DoubleSide : THREE.FrontSide });
        if (k === 'torso') mat.customProgramCacheKey = () => 'kit-pattern';
        if (k === 'torso') mat.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aCol2; attribute float aPat; varying vec3 vCol2; varying float vPat; varying vec2 vKit;')
            .replace('#include <uv_vertex>', '#include <uv_vertex>\n vCol2 = aCol2; vPat = aPat; vKit = uv;');
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCol2; varying float vPat; varying vec2 vKit;')
            .replace('#include <color_fragment>', `#include <color_fragment>
              float u = vKit.x, v = vKit.y, fx = u < 0.5 ? u : u - 1.0, pm = 0.0;
              if (vPat > 0.5 && vPat < 1.5) pm = step(0.5, fract(u * 12.0));
              else if (vPat < 2.5 && vPat > 1.5) pm = step(0.5, fract(v * 7.0)) * step(v, 0.93);
              else if (vPat < 3.5 && vPat > 2.5) pm = step(0.5, u);
              else if (vPat < 4.5 && vPat > 3.5) pm = step(abs(fx * 2.4 - (v - 0.5)), 0.1) * step(abs(fx), 0.27);
              else if (vPat < 5.5 && vPat > 4.5) pm = step(0.86, fract(u * 26.0));
              else if (vPat < 6.5 && vPat > 5.5) pm = step(abs(abs(fx) * 1.7 - (0.86 - v)), 0.06) * step(abs(fx), 0.3);
              float tie = 0.0;
              if (vPat > 6.5) { pm = step(abs(fx), (v - 0.5) * 0.36) * step(0.5, v); tie = pm * step(abs(fx), 0.016 + step(0.86, v) * 0.006) * step(v, 0.93); }
              #ifdef USE_MAP
              diffuseColor.rgb = mix(diffuseColor.rgb, vCol2 * sampledDiffuseColor.rgb, pm);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.38, 0.05, 0.08) * sampledDiffuseColor.rgb, tie);
              #endif`);
        };
        if (k === 'torso') {
          geo.setAttribute('aCol2', new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3));
          geo.setAttribute('aPat', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
        }
      } else {
        const skinLike = col === 'skin' || col === 'arm' || col === 'hand' || col === 'face' || col === 'leg';
        const map = col === 'face' ? tex.face : skinLike ? tex.skin : col === 'hair' ? tex.hair : col === 'boot' ? tex.boot : null;
        mat = new THREE.MeshStandardMaterial({
          map, normalMap: skinLike && hi ? pores : null, normalScale: new THREE.Vector2(0.12, 0.12),
          roughness: col === 'boot' ? 0.3 : col === 'eye' || col === 'sclera' ? 0.12 : skinLike ? 0.5 : col === 'hair' ? 0.8 : 0.68,
          metalness: col === 'boot' ? 0.2 : 0,
        });
      }
      const m = new THREE.InstancedMesh(geo, mat, count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const small = ['num', 'numF', 'sponsor', 'badge', 'shadow', 'eye', 'pupil', 'ear', 'nose', 'collar', 'mouth', 'brow', 'beard'].includes(k) || k.startsWith('hair');
      m.castShadow = !small && quality !== 'low';
      m.frustumCulled = false;
      if (k === 'shadow') m.renderOrder = -1;
      for (let i = 0; i < count; i++) m.setColorAt(i, new THREE.Color(1, 1, 1));
      this.meshes[k] = m;
      scene.add(m);
    }
    this.rigs = Array.from({ length: N }, () => new Rig());
    // corps lisses (un maillage animé par personnage, géométrie partagée) + cheveux/barbe
    if (this.smooth) {
      this.geo = { near: bodyGeometry(quality), far: bodyGeometry('far'), hairNear: hairGeometries(quality), hairFar: hairGeometries('far') };
      const hairTex = tex.hair;
      this.bodies = Array.from({ length: N }, () => {
        const { bones, map } = makeSkeleton();
        const mat = bodyMaterial(quality === 'high', { knit });
        const mesh = new THREE.SkinnedMesh(this.geo.near, mat);
        mesh.add(map.root);
        mesh.updateMatrixWorld(true);
        const skel = new THREE.Skeleton(bones);
        mesh.bind(skel);
        mesh.frustumCulled = false;
        mesh.castShadow = quality !== 'low';
        mesh.visible = false;
        scene.add(mesh);
        const hairMat = new THREE.MeshStandardMaterial({ map: hairTex, roughness: 0.75 });
        const hair = new THREE.Mesh(this.geo.hairNear.hair1, hairMat);
        hair.position.y = 0.125; hair.castShadow = quality !== 'low'; hair.frustumCulled = false;
        map.head.add(hair);
        const beard = new THREE.Mesh(this.geo.hairNear.beard, hairMat);
        beard.frustumCulled = false; beard.visible = false;
        map.head.add(beard);
        return { mesh, mat, bones: map, hair, beard, hairMat, far: false, style: 1 };
      });
    }
    this.meta = new Array(N).fill(null);
    this.hidden = new Array(N).fill(false);
    // ballon
    this.ballTex = ballTexture();
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), new THREE.MeshStandardMaterial({ map: this.ballTex, roughness: 0.45 }));
    this.ball.castShadow = true;
    scene.add(this.ball);
    this.ballQuat = new THREE.Quaternion();
    this.lastBall = new THREE.Vector3();
    // drapeaux des arbitres assistants
    this.flags = [0, 1].map(() => {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshStandardMaterial({ color: 0xffeb3b, side: THREE.DoubleSide }));
      scene.add(f); return f;
    });
    this._m = new THREE.Matrix4();
  }

  // meta : { shirt, shorts, socks, skin, hair, hairStyle, height, number, boot, gloves, tank }
  setMeta(i, meta) {
    this.meta[i] = meta;
    const skin = skinColor(meta.skin);
    const lum = (c) => { const x = new THREE.Color(c); return 0.299 * x.r + 0.587 * x.g + 0.114 * x.b; };
    const colors = {
      shirt: meta.shirt, shorts: meta.shorts, socks: meta.socks, skin, face: skin, hair: meta.hair, eye: '#1d140e', sclera: '#efe9e2',
      trim: meta.trim || meta.shorts, lip: skin.clone().multiplyScalar(0.62), boot: meta.boot || '#111111', num: meta.numColor || '#ffffff',
      arm: meta.gloves || meta.longSleeves ? meta.shirt : skin, hand: meta.gloves || skin, shadow: '#000000', leg: meta.trousers ? meta.shorts : skin,
      sponsorCol: meta.sponsorColor || (lum(meta.shirt) > 0.55 ? '#1a1a1a' : '#ffffff'), badgeCol: meta.badgeColor || '#d4af37',
    };
    for (const [k, nodes, col] of this.parts) {
      const m = this.meshes[k];
      let c = colors[col];
      if (meta.tank && k === 'sleeve') c = skin;
      for (let j = 0; j < nodes.length; j++) m.setColorAt(i * nodes.length + j, new THREE.Color(c));
      m.instanceColor.needsUpdate = true;
    }
    for (const k of ['num', 'numF']) {
      const a = this.meshes[k].geometry.attributes.aNum;
      a.array[i] = meta.number ?? 0; a.needsUpdate = true;
    }
    const sp = this.meshes.sponsor.geometry.attributes.aNum; sp.array[i] = Math.max(0, meta.sponsor ?? 0); sp.needsUpdate = true;
    const c2 = new THREE.Color(meta.shirt2 || meta.shirt);
    if (this.meshes.torso) {
      const tg = this.meshes.torso.geometry;
      tg.attributes.aCol2.setXYZ(i, c2.r, c2.g, c2.b); tg.attributes.aCol2.needsUpdate = true;
      tg.attributes.aPat.array[i] = meta.pattern || 0; tg.attributes.aPat.needsUpdate = true;
    }
    if (this.bodies) {
      const u = this.bodies[i].mat.userData.u;
      u.uShirt.value.set(meta.shirt); u.uShirt2.value.copy(c2); u.uShorts.value.set(meta.shorts); u.uSocks.value.set(meta.socks);
      u.uSkin.value.copy(skin); u.uPat.value = meta.pattern || 0;
      u.uFlags.value.set(meta.gloves || meta.longSleeves ? 1 : 0, meta.trousers ? 1 : 0, meta.tank ? 1 : 0, 0);
      const b = this.bodies[i];
      b.style = meta.hairStyle ?? 4; b.hasBeard = !!meta.beard;
      b.hairMat.color.set(meta.hair || '#222');
      this.applyLod(b, b.far, true);
    }
  }

  // Pose et matrices de tous les joueurs à partir de deux instantanés interpolés
  update(sA, sB, alpha, dt, opts = {}) {
    const lerpAng = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
    for (let i = 0; i < N; i++) {
      const o = i * ENT;
      const rig = this.rigs[i];
      const meta = this.meta[i];
      const hidden = !meta || sB[o] > 9000 || sA[o] > 9000;
      this.hidden[i] = hidden;
      if (hidden) { this.writeHidden(i); continue; }
      const x = sA[o] + (sB[o] - sA[o]) * alpha;
      const y = sA[o + 1] + (sB[o + 1] - sA[o + 1]) * alpha;
      const ang = lerpAng(sA[o + 2], sB[o + 2], alpha);
      const sp = sA[o + 3] + (sB[o + 3] - sA[o + 3]) * alpha;
      const act = sB[o + 4], actT = sB[o + 5];
      this.pose(rig, meta, x, y, ang, sp, act, actT, dt, i >= 22 ? i - 21 : 0);
      rig.root.updateMatrixWorld(true);
      this.write(i, rig);
      if (this.bodies) this.syncBody(i, rig);
    }
    for (const k in this.meshes) this.meshes[k].instanceMatrix.needsUpdate = true;
    // drapeaux des assistants
    for (let j = 0; j < 2; j++) {
      const r = this.rigs[23 + j];
      r.faR.getWorldPosition(this.flags[j].position);
      this.flags[j].position.y -= 0.25;
      this.flags[j].visible = !this.hidden[23 + j];
    }
    // ballon
    const bo = 25 * ENT;
    const bx = sA[bo] + (sB[bo] - sA[bo]) * alpha, by = sA[bo + 1] + (sB[bo + 1] - sA[bo + 1]) * alpha, bh = sA[bo + 2] + (sB[bo + 2] - sA[bo + 2]) * alpha;
    const pos = new THREE.Vector3(bx, Math.max(0.16, bh + 0.05), by);
    const mv = pos.clone().sub(this.lastBall); mv.y = 0;
    const dist = mv.length();
    if (dist > 0.0001 && dist < 5) {
      const axis = new THREE.Vector3(mv.z, 0, -mv.x).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(axis, dist / 0.16);
      this.ballQuat.premultiply(q);
    }
    this.lastBall.copy(pos);
    this.ball.position.copy(pos);
    this.ball.quaternion.copy(this.ballQuat);
    this.ball.visible = !opts.hideBall;
  }

  applyLod(b, far, force) {
    if (b.far === far && !force) return;
    b.far = far;
    const H = far ? this.geo.hairFar : this.geo.hairNear;
    b.mesh.geometry = far ? this.geo.far : this.geo.near;
    b.hair.geometry = H['hair' + b.style] || H.hair1;
    b.beard.geometry = H.beard; b.beard.visible = b.hasBeard;
  }

  syncBody(i, rig) {
    const b = this.bodies[i];
    b.mesh.visible = true;
    if (this.camPos) {
      const r = rig.root.position, c = this.camPos;
      const d = Math.hypot(r.x - c.x, r.z - c.z, c.y);
      // distance « vue » corrigée du zoom de la caméra
      this.applyLod(b, d * (this.lodZoom || 1) > LOD_FAR);
    }
    for (const n of BONES) { const bone = b.bones[n], src = rig[n]; bone.position.copy(src.position); bone.quaternion.copy(src.quaternion); bone.scale.copy(src.scale); }
  }

  writeHidden(i) {
    if (this.bodies) this.bodies[i].mesh.visible = false;
    const z = this._m.makeScale(0, 0, 0);
    for (const [k, nodes] of this.parts) for (let j = 0; j < nodes.length; j++) this.meshes[k].setMatrixAt(i * nodes.length + j, z);
  }

  write(i, r) {
    const meta = this.meta[i];
    const z = this._m.makeScale(0, 0, 0);
    for (const [k, nodes, , cond] of this.parts) {
      const m = this.meshes[k];
      const show = !cond || cond(meta);
      for (let j = 0; j < nodes.length; j++) m.setMatrixAt(i * nodes.length + j, show ? r[nodes[j]].matrixWorld : z);
    }
  }

  pose(r, meta, x, y, ang, sp, act, actT, dt, official) {
    const root = r.root;
    const s = meta.height / 1.92;
    root.scale.setScalar(s);
    root.position.set(x, 0, y);
    root.rotation.set(0, 0, 0);
    // lissage du cap pour éviter les à-coups
    const target = Math.PI / 2 - ang;
    let d = target - r.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    r.yaw += d * Math.min(1, dt * 10);
    root.rotation.y = r.yaw;
    const amp = Math.min(1, sp / 7.5);
    if (sp > 0.25) r.phase += dt * (3.6 + sp * 0.95);
    else r.phase += dt * 0.6;
    const ph = r.phase;
    const sw = Math.sin(ph);
    const moving = sp > 0.25 ? 1 : 0;
    // valeurs par défaut : course
    const legA = (0.12 + 0.75 * amp) * moving;
    r.thL.rotation.set(-sw * legA, 0, 0.03);
    r.thR.rotation.set(sw * legA, 0, -0.03);
    r.shL.rotation.set(Math.max(0, Math.sin(ph - 1.2)) * (0.25 + 1.35 * amp) * moving + 0.05, 0, 0);
    r.shR.rotation.set(Math.max(0, Math.sin(ph + Math.PI - 1.2)) * (0.25 + 1.35 * amp) * moving + 0.05, 0, 0);
    r.ftL.rotation.set(-0.1 * amp, 0, 0); r.ftR.rotation.set(-0.1 * amp, 0, 0);
    const armA = (0.1 + 0.65 * amp) * moving;
    r.uaL.rotation.set(sw * armA, 0, -0.12 - amp * 0.05);
    r.uaR.rotation.set(-sw * armA, 0, 0.12 + amp * 0.05);
    r.faL.rotation.set(-(0.25 + 1.0 * amp), 0, 0);
    r.faR.rotation.set(-(0.25 + 1.0 * amp), 0, 0);
    r.torso.rotation.set(0.04 + amp * 0.2, Math.sin(ph) * 0.08 * amp, 0);
    r.pelvis.position.y = 0.98 + Math.abs(Math.cos(ph)) * 0.05 * amp - amp * 0.03;
    r.pelvis.rotation.set(0, -Math.sin(ph) * 0.1 * amp, 0);
    r.head.rotation.set(-0.05 - amp * 0.12, 0, 0);
    // coiffure
    r.hair.scale.set(1, 1, 1);

    if (official && act === 1) { // coup de sifflet
      r.uaR.rotation.set(-1.9, 0, 0.3); r.faR.rotation.set(-1.6, 0, 0);
    } else if (official && act === 2) { // carton
      r.uaR.rotation.set(-3.05, 0, 0.1); r.faR.rotation.set(0, 0, 0);
    } else if (official === 2 || official === 3) {
      // assistant : drapeau tenu le long du corps
      r.uaR.rotation.x += 0.2;
    }
    if (official) return;

    const kp = (dur) => Math.min(1, Math.max(0, 1 - actT / dur));
    switch (act) {
      case ACT.KICK: {
        const p = kp(0.4);
        const back = p < 0.35 ? p / 0.35 : 1 - (p - 0.35) / 0.25;
        const fwd = p < 0.35 ? 0 : p < 0.7 ? (p - 0.35) / 0.35 : 1 - (p - 0.7) / 0.3;
        const kickR = meta.leftFoot ? r.thL : r.thR, shinK = meta.leftFoot ? r.shL : r.shR;
        kickR.rotation.x = Math.max(0, back) * 0.7 - fwd * 1.25;
        shinK.rotation.x = Math.max(0, back) * 1.4 + 0.05;
        const other = meta.leftFoot ? r.thR : r.thL;
        other.rotation.x = 0.1;
        r.torso.rotation.x = 0.1 - fwd * 0.15;
        r.uaL.rotation.set(-0.3, 0, -0.6); r.uaR.rotation.set(-0.3, 0, 0.6);
        break;
      }
      case ACT.HEAD: {
        const p = kp(0.4);
        r.pelvis.position.y += Math.sin(p * Math.PI) * 0.45;
        r.torso.rotation.x = p < 0.5 ? -0.35 : 0.45;
        r.head.rotation.x = p < 0.5 ? -0.3 : 0.4;
        r.uaL.rotation.set(-1.2, 0, -0.5); r.uaR.rotation.set(-1.2, 0, 0.5);
        r.thL.rotation.x = 0.4; r.thR.rotation.x = -0.2; r.shL.rotation.x = 0.9; r.shR.rotation.x = 0.6;
        break;
      }
      case ACT.DIVE_L: case ACT.DIVE_R: {
        const side = act === ACT.DIVE_L ? 1 : -1;
        const p = kp(1.1);
        const fly = Math.min(1, p * 3.2);
        root.rotateZ(-side * fly * 1.3);
        r.pelvis.position.y = 0.98 * (1 - fly * 0.55) + Math.sin(Math.min(1, p * 2) * Math.PI) * 0.35;
        r.uaL.rotation.set(-2.9, 0, -0.2); r.uaR.rotation.set(-2.9, 0, 0.2);
        r.faL.rotation.set(0, 0, 0); r.faR.rotation.set(0, 0, 0);
        r.thL.rotation.x = -0.2; r.thR.rotation.x = 0.1; r.shL.rotation.x = 0.4; r.shR.rotation.x = 0.4;
        break;
      }
      case ACT.HANDS: {
        r.uaL.rotation.set(-1.35, 0, -0.15); r.uaR.rotation.set(-1.35, 0, 0.15);
        r.faL.rotation.set(-0.3, 0, 0); r.faR.rotation.set(-0.3, 0, 0);
        r.torso.rotation.x = 0.35;
        r.pelvis.position.y -= 0.12; r.thL.rotation.x = -0.5; r.thR.rotation.x = -0.5; r.shL.rotation.x = 0.8; r.shR.rotation.x = 0.8;
        break;
      }
      case ACT.CELEB: {
        const j = Math.abs(Math.sin(performance.now() / 180 + x));
        r.uaL.rotation.set(-2.6 - j * 0.3, 0, -0.5); r.uaR.rotation.set(-2.6 - j * 0.3, 0, 0.5);
        r.faL.rotation.set(-0.4, 0, 0); r.faR.rotation.set(-0.4, 0, 0);
        if (sp < 1.5) { r.pelvis.position.y += j * 0.25; r.head.rotation.x = -0.4; }
        break;
      }
      case ACT.THROW: {
        const p = kp(0.4);
        const a = -3.0 + p * 1.8;
        r.uaL.rotation.set(a, 0, -0.15); r.uaR.rotation.set(a, 0, 0.15);
        r.faL.rotation.set(-0.8 * (1 - p), 0, 0); r.faR.rotation.set(-0.8 * (1 - p), 0, 0);
        r.torso.rotation.x = -0.3 + p * 0.5;
        break;
      }
      case ACT.TACKLE: {
        const p = kp(0.5);
        const k = Math.sin(p * Math.PI);
        r.pelvis.position.y -= 0.45 * k;
        r.torso.rotation.x = -0.5 * k;
        r.thR.rotation.x = -1.4 * k; r.shR.rotation.x = 0.1;
        r.thL.rotation.x = 0.3 * k; r.shL.rotation.x = 1.6 * k;
        r.uaL.rotation.set(-0.4, 0, -0.9 * k); r.uaR.rotation.set(-0.4, 0, 0.9 * k);
        break;
      }
      case ACT.FALL: {
        const p = kp(1.4);
        const down = p < 0.25 ? p / 0.25 : p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25;
        root.rotateX(down * 1.45);
        r.pelvis.position.y = 0.98 - down * 0.78;
        r.uaL.rotation.set(-1.6 * down, 0, -0.4); r.uaR.rotation.set(-1.6 * down, 0, 0.4);
        break;
      }
      case 17: { // service (tennis)
        const p = kp(1.2);
        const toss = Math.min(1, p / 0.6), hit = p > 0.6 ? (p - 0.6) / 0.4 : 0;
        r.uaL.rotation.set(-2.9 * toss * (1 - hit), 0, -0.2); r.faL.rotation.set(0, 0, 0);
        r.uaR.rotation.set(-2.2 - 0.8 * toss + hit * 3.6, 0, 0.5 - hit * 0.6); r.faR.rotation.set(-1.4 * toss * (1 - hit), 0, 0);
        r.torso.rotation.x = -0.25 * toss + hit * 0.45;
        r.pelvis.position.y += hit > 0 && hit < 0.6 ? 0.12 : 0;
        r.thL.rotation.x = -0.25 * toss; r.shL.rotation.x = 0.5 * toss;
        break;
      }
      case 18: case 19: { // coup droit / revers
        const p = kp(0.5);
        const side = act === 18 ? 1 : -1;
        const sw = p < 0.4 ? -p / 0.4 : -1 + (p - 0.4) / 0.6 * 2.2;
        r.torso.rotation.y = side * (-0.9 + (sw + 1) * 0.8);
        r.uaR.rotation.set(-1.0, 0, side * (0.6 + sw * 0.9)); r.faR.rotation.set(-0.5, 0, 0);
        r.uaL.rotation.set(-0.6, 0, -0.3 - (act === 19 ? 0.8 : 0)); r.faL.rotation.set(-1.0, 0, 0);
        r.pelvis.position.y -= 0.1; r.thL.rotation.x = -0.4; r.thR.rotation.x = 0.2; r.shL.rotation.x = 0.7; r.shR.rotation.x = 0.6;
        break;
      }
      case 11: { // tir en suspension (basket)
        const p = kp(0.7);
        const j = Math.sin(Math.min(1, p * 1.3) * Math.PI);
        r.pelvis.position.y += j * 0.45;
        r.uaL.rotation.set(-2.7, 0, -0.15); r.uaR.rotation.set(-2.9 + p * 0.4, 0, 0.1);
        r.faL.rotation.set(-0.9 * (1 - p), 0, 0); r.faR.rotation.set(-1.2 * (1 - p), 0, 0);
        r.thL.rotation.x = -0.15; r.thR.rotation.x = -0.15; r.shL.rotation.x = 0.3; r.shR.rotation.x = 0.3;
        break;
      }
      case 12: { // dunk
        const p = kp(0.9);
        const j = Math.sin(Math.min(1, p * 1.4) * Math.PI);
        r.pelvis.position.y += j * 0.95;
        r.uaL.rotation.set(-3.0, 0, -0.2); r.uaR.rotation.set(-3.0, 0, 0.2);
        r.faL.rotation.set(0, 0, 0); r.faR.rotation.set(0, 0, 0);
        r.thL.rotation.x = -0.8; r.shL.rotation.x = 1.2; r.thR.rotation.x = 0.2; r.shR.rotation.x = 0.5;
        break;
      }
      case 14: { // passe à deux mains
        r.uaL.rotation.set(-1.45, 0, -0.1); r.uaR.rotation.set(-1.45, 0, 0.1);
        r.faL.rotation.set(-0.2, 0, 0); r.faR.rotation.set(-0.2, 0, 0);
        break;
      }
      case 15: { // rebond / saut bras levés
        const p = kp(0.5);
        r.pelvis.position.y += Math.sin(p * Math.PI) * 0.6;
        r.uaL.rotation.set(-3.0, 0, -0.25); r.uaR.rotation.set(-3.0, 0, 0.25);
        r.faL.rotation.set(-0.2, 0, 0); r.faR.rotation.set(-0.2, 0, 0);
        break;
      }
      case 16: { // posture défensive
        r.pelvis.position.y -= 0.18;
        r.thL.rotation.set(-0.5, 0, 0.25); r.thR.rotation.set(-0.5, 0, -0.25); r.shL.rotation.x = 0.8; r.shR.rotation.x = 0.8;
        r.uaL.rotation.set(-0.4, 0, -1.1); r.uaR.rotation.set(-0.4, 0, 1.1);
        r.torso.rotation.x = 0.3;
        break;
      }
      default: break;
    }
  }
}
