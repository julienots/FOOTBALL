// Construction procédurale du stade : pelouse tondue, lignes, buts et filets,
// panneaux LED, tribunes en cuvette, toit, projecteurs et écran géant.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HL, HW, GOAL_HW, GOAL_H } from './engine.js';
import { RNG } from '../core/rng.js';

export function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso || 4;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
  t.canvas = c; t.ctx = g;
  return t;
}

function grassNormal(rng) {
  const S = 256;
  const hgt = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) hgt[i] = rng.next();
  // brins d'herbe : bruit étiré
  for (let k = 0; k < 2; k++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hgt[y * S + x] = (hgt[y * S + x] + hgt[((y + 1) % S) * S + x]) * 0.5;
  return canvasTex(S, S, (g) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x + S - 1) % S)];
      const dy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x];
      const i = (y * S + x) * 4;
      img.data[i] = 128 - dx * 200; img.data[i + 1] = 128 - dy * 200; img.data[i + 2] = 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { linear: true, repeat: [70, 45], aniso: 8 });
}

function grassTexture(rng) {
  return canvasTex(2048, 1024, (g, w, h) => {
    // bandes de tonte
    const stripes = 18;
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? '#2b5b22' : '#36682b';
      g.fillRect((i * w) / stripes, 0, w / stripes + 1, h);
    }
    // bandes transversales légères (damier)
    g.globalAlpha = 0.035;
    for (let j = 0; j < 10; j++) { g.fillStyle = j % 2 ? '#000' : '#fff'; g.fillRect(0, (j * h) / 10, w, h / 10); }
    g.globalAlpha = 1;
    // grain de l'herbe
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rng.next() - 0.5) * 22;
      d[i] += n * 0.6; d[i + 1] += n; d[i + 2] += n * 0.4;
    }
    g.putImageData(img, 0, 0);
    // usure devant les buts et au centre
    for (const [cx, cy, r] of [[w * 0.06, h / 2, 90], [w * 0.94, h / 2, 90], [w / 2, h / 2, 70]]) {
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, 'rgba(110,95,50,0.28)'); grd.addColorStop(1, 'rgba(110,95,50,0)');
      g.fillStyle = grd; g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }
  }, { aniso: 8 });
}

function lineGeometry() {
  const W = 0.14;
  const parts = [];
  const rect = (x0, z0, x1, z1) => {
    const g = new THREE.PlaneGeometry(Math.abs(x1 - x0) || W, Math.abs(z1 - z0) || W);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0.012, (z0 + z1) / 2);
    parts.push(g);
  };
  const ln = (x0, z0, x1, z1) => {
    if (x0 === x1) rect(x0 - W / 2, z0, x0 + W / 2, z1); else rect(x0, z0 - W / 2, x1, z0 + W / 2);
  };
  // contour
  ln(-HL, -HW, HL, -HW); ln(-HL, HW, HL, HW);
  ln(-HL, -HW - W / 2, -HL, HW + W / 2); ln(HL, -HW - W / 2, HL, HW + W / 2);
  ln(0, -HW, 0, HW);
  for (const s of [-1, 1]) {
    const gx = s * HL;
    // surface de réparation
    ln(gx, -20.16, gx - s * 16.5, -20.16); ln(gx, 20.16, gx - s * 16.5, 20.16);
    ln(gx - s * 16.5, -20.16, gx - s * 16.5, 20.16);
    // surface de but
    ln(gx, -9.16, gx - s * 5.5, -9.16); ln(gx, 9.16, gx - s * 5.5, 9.16);
    ln(gx - s * 5.5, -9.16, gx - s * 5.5, 9.16);
    // point de penalty
    const spot = new THREE.CircleGeometry(0.15, 16); spot.rotateX(-Math.PI / 2); spot.translate(gx - s * 11, 0.013, 0); parts.push(spot);
    // arc de la surface
    const ang = Math.acos(5.5 / 9.15);
    const arc = new THREE.RingGeometry(9.15 - W / 2, 9.15 + W / 2, 48, 1, s > 0 ? Math.PI - ang : -ang, 2 * ang);
    arc.rotateX(-Math.PI / 2);
    arc.translate(gx - s * 11, 0.012, 0);
    parts.push(arc);
    // arcs de corner
    for (const t of [-1, 1]) {
      const st = s > 0 ? (t > 0 ? Math.PI / 2 : Math.PI) : (t > 0 ? 0 : -Math.PI / 2);
      const c = new THREE.RingGeometry(1 - W / 2, 1 + W / 2, 12, 1, st, Math.PI / 2);
      c.rotateX(-Math.PI / 2);
      c.translate(gx, 0.012, t * HW);
      parts.push(c);
    }
  }
  const circ = new THREE.RingGeometry(9.15 - W / 2, 9.15 + W / 2, 96); circ.rotateX(-Math.PI / 2); circ.translate(0, 0.012, 0); parts.push(circ);
  const cs = new THREE.CircleGeometry(0.15, 16); cs.rotateX(-Math.PI / 2); cs.translate(0, 0.013, 0); parts.push(cs);
  return mergeGeometries(parts.map(p => p.toNonIndexed()));
}

function netTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 3;
    const n = 16;
    for (let i = 0; i <= n; i++) {
      g.beginPath(); g.moveTo(0, (i * h) / n); g.lineTo(w, (i * h) / n); g.stroke();
      g.beginPath(); g.moveTo((i * w) / n, 0); g.lineTo((i * w) / n, h); g.stroke();
    }
  }, { repeat: [1, 1] });
}

function buildGoal(side, netTex) {
  const grp = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1 });
  const r = 0.06;
  const postG = new THREE.CylinderGeometry(r, r, GOAL_H, 12);
  for (const z of [-GOAL_HW - r, GOAL_HW + r]) {
    const p = new THREE.Mesh(postG, white); p.position.set(0, GOAL_H / 2, z); p.castShadow = true; grp.add(p);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, GOAL_HW * 2 + 4 * r, 12), white);
  bar.rotation.x = Math.PI / 2; bar.position.set(0, GOAL_H, 0); bar.castShadow = true; grp.add(bar);
  // structure arrière
  const depth = 2.0;
  const thin = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 });
  const sg = new THREE.CylinderGeometry(0.025, 0.025, 1, 6);
  const seg = (a, b) => {
    const m = new THREE.Mesh(sg, thin);
    const dir = new THREE.Vector3().subVectors(b, a);
    m.scale.y = dir.length();
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    grp.add(m);
  };
  for (const z of [-GOAL_HW, GOAL_HW]) {
    seg(new THREE.Vector3(0, GOAL_H, z), new THREE.Vector3(depth * 0.5, GOAL_H * 0.85, z));
    seg(new THREE.Vector3(depth * 0.5, GOAL_H * 0.85, z), new THREE.Vector3(depth, 0, z));
    seg(new THREE.Vector3(0, 0.02, z), new THREE.Vector3(depth, 0.02, z));
  }
  seg(new THREE.Vector3(depth, 0.02, -GOAL_HW), new THREE.Vector3(depth, 0.02, GOAL_HW));
  // filet
  const netMat = new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 1, depthWrite: false });
  const mk = (w, h, repx, repy) => {
    const t = netTex.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repx, repy);
    const m = netMat.clone(); m.map = t;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  };
  const back = mk(GOAL_HW * 2, Math.hypot(depth * 0.5, GOAL_H * 0.85), 6, 2);
  back.position.set(depth * 0.75, GOAL_H * 0.42, 0);
  back.rotation.y = Math.PI / 2;
  back.rotation.x = 0;
  back.rotateX(-Math.atan2(depth * 0.5, GOAL_H * 0.85));
  grp.add(back);
  const top = mk(GOAL_HW * 2, depth * 0.52, 6, 1);
  top.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  top.rotateX(-0.29);
  top.position.set(depth * 0.25, GOAL_H * 0.93, 0);
  grp.add(top);
  for (const z of [-GOAL_HW, GOAL_HW]) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(depth, 0); shape.lineTo(depth * 0.5, GOAL_H * 0.85); shape.lineTo(0, GOAL_H); shape.lineTo(0, 0);
    const g = new THREE.ShapeGeometry(shape);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.6, uv.getY(i) * 0.6);
    const m = netMat.clone(); const t = netTex.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; m.map = t;
    const s = new THREE.Mesh(g, m); s.position.z = z; grp.add(s);
  }
  grp.position.set(side * HL, 0, 0);
  if (side < 0) grp.rotation.y = Math.PI;
  return grp;
}

// Chemin d'un rectangle arrondi décalé de D mètres autour du terrain
function bowlPath(D, n, ax = HL + 2, bz = HW + 2) {
  const pts = [];
  const L1 = 2 * ax, L2 = 2 * bz, arc = (Math.PI / 2) * D;
  const per = 2 * L1 + 2 * L2 + 4 * arc;
  for (let i = 0; i < n; i++) {
    let s = (i / n) * per;
    let x, z, nx, nz;
    const segs = [
      [L1, (t) => [-ax + t, bz + D, 0, 1]],
      [arc, (t) => { const a = Math.PI / 2 - t / D; return [ax + Math.cos(a) * D, bz + Math.sin(a) * D, Math.cos(a), Math.sin(a)]; }],
      [L2, (t) => [ax + D, bz - t, 1, 0]],
      [arc, (t) => { const a = -t / D; return [ax + Math.cos(a) * D, -bz + Math.sin(a) * D, Math.cos(a), Math.sin(a)]; }],
      [L1, (t) => [ax - t, -bz - D, 0, -1]],
      [arc, (t) => { const a = -Math.PI / 2 - t / D; return [-ax + Math.cos(a) * D, -bz + Math.sin(a) * D, Math.cos(a), Math.sin(a)]; }],
      [L2, (t) => [-ax - D, -bz + t, -1, 0]],
      [arc, (t) => { const a = Math.PI - t / D; return [-ax + Math.cos(a) * D, bz + Math.sin(a) * D, Math.cos(a), Math.sin(a)]; }],
    ];
    for (const [len, f] of segs) {
      if (s <= len) { [x, z, nx, nz] = f(s); break; }
      s -= len;
    }
    if (x === undefined) [x, z, nx, nz] = segs[0][1](0);
    pts.push({ x, z, nx, nz });
  }
  return { pts, per };
}

// Escaliers d'accès entre les blocs de sièges
export function isAisle(p) {
  const m = (v, step, w) => { const a = ((Math.abs(v) % step) + step) % step; return a < w || a > step - w; };
  if (Math.abs(p.nz) > 0.97) return m(p.x, 13, 0.55);
  if (Math.abs(p.nx) > 0.97) return m(p.z, 11, 0.55);
  const ang = Math.atan2(p.nz, p.nx) * 180 / Math.PI;
  return m(ang, 18, 1.4);
}

// Tribune en gradins (géométrie unique)
function tierGeometry(D0, rows, depth, rise, h0, segs, colorFn) {
  const pos = [], col = [], idx = [];
  const c = new THREE.Color();
  let vi = 0;
  for (let r = 0; r < rows; r++) {
    const Da = D0 + r * depth, Db = Da + depth;
    const y = h0 + r * rise;
    const A = bowlPath(Da, segs).pts, B = bowlPath(Db, segs).pts;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      colorFn(c, r, i / segs, A[i]);
      // contremarche
      const quad = (p0, p1, p2, p3, shade) => {
        pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
        for (let k = 0; k < 4; k++) col.push(c.r * shade, c.g * shade, c.b * shade);
        idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        vi += 4;
      };
      quad([A[i].x, y, A[i].z], [A[j].x, y, A[j].z], [A[j].x, y + rise, A[j].z], [A[i].x, y + rise, A[i].z], 0.55);
      quad([A[i].x, y + rise, A[i].z], [A[j].x, y + rise, A[j].z], [B[j].x, y + rise, B[j].z], [B[i].x, y + rise, B[i].z], 1.0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export const AD_BRANDS = [
  { name: 'VOLTA', sub: 'ENERGY DRINK', bg: '#0a0a0a', fg: '#c6ff00' },
  { name: 'AUTO LUMINA', sub: 'Électrique. Évidemment.', bg: '#0d47a1', fg: '#ffffff' },
  { name: 'CRISPYMAX', sub: 'Le croustillant des champions', bg: '#ffca28', fg: '#b71c1c' },
  { name: 'BANQUE HORIZON', sub: 'Votre avenir, notre métier', bg: '#004d40', fg: '#ffffff' },
  { name: 'NEO MOBILE 5G', sub: 'Le réseau qui va plus vite', bg: '#6a1b9a', fg: '#ffffff' },
  { name: 'SPORT TV+', sub: 'Tout le sport en direct', bg: '#d50000', fg: '#ffffff' },
  { name: 'AQUAPURA', sub: 'Eau minérale naturelle', bg: '#e1f5fe', fg: '#0277bd' },
  { name: 'KAPPA FIT', sub: 'Équipementier officiel', bg: '#212121', fg: '#ff6d00' },
];

function adBoardTexture(offsetIdx) {
  const t = canvasTex(4096, 128, (g, w, h) => {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const b = AD_BRANDS[(i + offsetIdx) % AD_BRANDS.length];
      const x0 = (i * w) / n;
      g.fillStyle = b.bg; g.fillRect(x0, 0, w / n, h);
      g.fillStyle = b.fg;
      g.font = 'bold 64px Arial Black, Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(b.name, x0 + w / n / 2, h * 0.42, w / n - 20);
      g.font = '24px Arial, sans-serif';
      g.fillText(b.sub, x0 + w / n / 2, h * 0.8, w / n - 20);
    }
  }, { repeat: [1, 1] });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export class Stadium {
  constructor(scene, opts) {
    this.scene = scene;
    this.opts = opts;
    this.group = new THREE.Group();
    scene.add(this.group);
    const rng = new RNG('stade-' + (opts.seed || 'x'));
    this.rng = rng;
    this.build();
  }

  build() {
    const { night, homeColor, awayColor, quality } = this.opts;
    const G = this.group;
    // sol extérieur
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x2a2f2a, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true;
    G.add(ground);
    // pelouse
    const grass = grassTexture(this.rng);
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(HL * 2 + 14, HW * 2 + 14), new THREE.MeshStandardMaterial({ map: grass, roughness: 0.88, metalness: 0, normalMap: quality === 'low' ? null : grassNormal(this.rng), normalScale: new THREE.Vector2(0.55, 0.55) }));
    pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true;
    G.add(pitch);
    // piste autour (zone technique)
    const apron = new THREE.Mesh(new THREE.RingGeometry(1, 2, 4), new THREE.MeshStandardMaterial({ color: 0x3d7a2c }));
    apron.visible = false;
    const lines = new THREE.Mesh(lineGeometry(), new THREE.MeshStandardMaterial({ color: 0xe9ece6, roughness: 0.85 }));
    lines.receiveShadow = true;
    G.add(lines);
    // buts
    const netTex = netTexture();
    this.goals = [buildGoal(1, netTex), buildGoal(-1, netTex)];
    this.goals.forEach(g => G.add(g));
    // drapeaux de corner
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xffeb3b, side: THREE.DoubleSide });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), poleMat);
      pole.position.set(sx * HL, 0.75, sz * HW); pole.castShadow = true; G.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.32), flagMat);
      flag.position.set(sx * HL + 0.22, 1.33, sz * HW); G.add(flag);
    }
    // panneaux publicitaires LED
    this.adTex = [adBoardTexture(0), adBoardTexture(3), adBoardTexture(5)];
    const adMat = this.adTex.map(t => new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
    const boardH = 0.95;
    const mkBoard = (len, x, z, ry, mi) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, boardH, 0.25), [
        new THREE.MeshStandardMaterial({ color: 0x111111 }), new THREE.MeshStandardMaterial({ color: 0x111111 }),
        new THREE.MeshStandardMaterial({ color: 0x111111 }), new THREE.MeshStandardMaterial({ color: 0x111111 }),
        adMat[mi], new THREE.MeshStandardMaterial({ color: 0x222222 }),
      ]);
      m.position.set(x, boardH / 2, z); m.rotation.y = ry; m.castShadow = true;
      G.add(m);
    };
    mkBoard(110, 0, -HW - 4.5, 0, 0);
    mkBoard(110, 0, HW + 4.5, Math.PI, 1);
    mkBoard(70, HL + 5.5, 0, -Math.PI / 2, 2);
    mkBoard(70, -HL - 5.5, 0, Math.PI / 2, 2);
    // bancs de touche
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, transparent: true, opacity: 0.45, roughness: 0.1 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x263238 });
    for (const sx of [-1, 1]) {
      const b = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.BoxGeometry(9, 2.2, 2.2), benchMat);
      shell.position.y = 1.1; b.add(shell);
      const seats = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.5, 0.8), seatMat);
      seats.position.set(0, 0.4, -0.4); b.add(seats);
      b.position.set(sx * 12, 0, -HW - 7.5);
      G.add(b);
    }
    // tribunes en cuvette
    const segs = quality === 'low' ? 140 : 220;
    const hc = new THREE.Color(homeColor), ac = new THREE.Color(awayColor), grey = new THREE.Color(0x5a5f66);
    const seatColor = (c, r, u, p) => {
      if (isAisle(p)) { c.setRGB(0.62, 0.63, 0.65); return; }
      // sièges aux couleurs du club, secteur visiteur dans un virage
      const away = p.x < -HL - 4 && p.z < -10;
      const stripe = Math.floor(u * 64) % 6 === 0;
      c.copy(away ? ac : hc).lerp(grey, stripe ? 0.1 : 0.35);
      if (r % 9 === 0) c.lerp(new THREE.Color(0xeeeeee), 0.25);
    };
    const tierMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.lower = { D0: 8, rows: 24, depth: 0.85, rise: 0.42, h0: 0.9 };
    this.upper = { D0: 31, rows: 22, depth: 0.85, rise: 0.6, h0: 14 };
    for (const T of [this.lower, this.upper]) {
      const m = new THREE.Mesh(tierGeometry(T.D0, T.rows, T.depth, T.rise, T.h0, segs, seatColor), tierMat);
      m.receiveShadow = true;
      G.add(m);
    }
    // mur d'enceinte bas + bande VIP vitrée
    const bandPts = bowlPath(29, segs).pts;
    const band = this.wallStrip(bandPts, 12.2, 14.0, new THREE.MeshStandardMaterial({ color: 0x0b1a2a, emissive: night ? 0x1d3a5a : 0x0a1520, roughness: 0.08, metalness: 0.8 }));
    // ruban LED entre les deux anneaux de tribunes
    this.ribbonTex = adBoardTexture(2);
    this.ribbonTex.repeat.set(9, 1);
    const ribbon = this.wallStrip(bowlPath(28.6, segs).pts, 11.0, 12.2, new THREE.MeshBasicMaterial({ map: this.ribbonTex, toneMapped: false }), true);
    G.add(ribbon);
    this.adTex.push(this.ribbonTex);
    G.add(band);
    const fascia = this.wallStrip(bowlPath(8, segs).pts, 0, 0.9, new THREE.MeshStandardMaterial({ color: 0x222831 }));
    G.add(fascia);
    const backWall = this.wallStrip(bowlPath(31 + 22 * 0.85, segs).pts, 14, 34.5, new THREE.MeshStandardMaterial({ color: 0x30353d, side: THREE.DoubleSide }));
    G.add(backWall);
    // toit
    const roofPtsIn = bowlPath(24, segs).pts, roofPtsOut = bowlPath(52, segs).pts;
    const rp = [], ri = [];
    const roofY0 = 31, roofY1 = 33;
    for (let i = 0; i < segs; i++) {
      rp.push(roofPtsIn[i].x, roofY0, roofPtsIn[i].z, roofPtsOut[i].x, roofY1, roofPtsOut[i].z);
      const j = (i + 1) % segs;
      ri.push(2 * i, 2 * j, 2 * i + 1, 2 * j, 2 * j + 1, 2 * i + 1);
    }
    const roofG = new THREE.BufferGeometry();
    roofG.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); roofG.setIndex(ri); roofG.computeVertexNormals();
    const roof = new THREE.Mesh(roofG, new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }));
    G.add(roof);
    // rampe de projecteurs sous le toit
    const lightStrip = this.wallStrip(bowlPath(25, segs).pts, roofY0 - 1.2, roofY0 - 0.2, new THREE.MeshBasicMaterial({ color: night ? 0xffffff : 0xdedede, toneMapped: false }));
    G.add(lightStrip);
    if (night) {
      const glowTex = canvasTex(64, 64, (g, w, h) => {
        const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,250,230,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
      });
      const sm = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 });
      const lp = bowlPath(25, 60).pts;
      for (const p of lp) { const s = new THREE.Sprite(sm); s.position.set(p.x, roofY0 - 0.7, p.z); s.scale.set(6, 6, 1); G.add(s); }
    }
    // charpente métallique sous le toit
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.45 });
    const beam = (a, b, r = 0.18) => {
      const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length();
      const m = new THREE.Matrix4().compose(a.clone().addScaledVector(dir, 0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()), new THREE.Vector3(r, len, r));
      return m;
    };
    const trussM = [];
    const tin = bowlPath(24.5, 48).pts, tout = bowlPath(51, 48).pts;
    for (let i = 0; i < 48; i++) {
      const a = new THREE.Vector3(tin[i].x, roofY0 - 0.3, tin[i].z), b = new THREE.Vector3(tout[i].x, roofY1 - 0.3, tout[i].z);
      const a2 = a.clone(); a2.y -= 2.4; const b2 = b.clone(); b2.y -= 4;
      trussM.push(beam(a, b), beam(a2, b2, 0.14), beam(a, a2, 0.1), beam(b, b2, 0.1));
      const mid = a.clone().lerp(b, 0.5), mid2 = a2.clone().lerp(b2, 0.5);
      trussM.push(beam(a, mid2, 0.08), beam(mid2, b, 0.08), beam(mid, mid2, 0.08));
    }
    for (const D of [27, 38, 49]) {
      const ring = bowlPath(D, 96).pts;
      const y = roofY0 + (D - 24) / 28 * (roofY1 - roofY0) - 2.6;
      for (let i = 0; i < 96; i++) { const j = (i + 1) % 96; trussM.push(beam(new THREE.Vector3(ring[i].x, y, ring[i].z), new THREE.Vector3(ring[j].x, y, ring[j].z), 0.1)); }
    }
    const truss = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), trussMat, trussM.length);
    trussM.forEach((m, i) => truss.setMatrixAt(i, m));
    G.add(truss);
    if (night) {
      // faisceaux des projecteurs dans l'air (légère brume)
      const fade = canvasTex(4, 128, (g, w, h) => { const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#fff'); grd.addColorStop(0.6, '#333'); grd.addColorStop(1, '#000'); g.fillStyle = grd; g.fillRect(0, 0, w, h); }, { linear: true });
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0, transparent: true, opacity: 0.05, alphaMap: fade, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const cone = new THREE.ConeGeometry(6, 34, 24, 1, true); cone.translate(0, -17, 0);
      for (const p of bowlPath(25, 20).pts) {
        const m = new THREE.Mesh(cone, beamMat);
        m.position.set(p.x, roofY0 - 0.7, p.z);
        m.lookAt(p.x * 0.35, 0, p.z * 0.35); m.rotateX(-Math.PI / 2);
        G.add(m);
      }
    }
    // piliers du toit
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xbfc5cc, metalness: 0.4, roughness: 0.5 });
    for (const p of bowlPath(50, 24).pts) {
      const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 33, 8), pillarMat);
      pl.position.set(p.x, 16.5, p.z); G.add(pl);
    }
    // écran géant
    this.screenTex = canvasTex(1024, 512, () => {});
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
    scr.position.set(-HL - 2 - 20, 24, 0); scr.rotation.y = Math.PI / 2;
    G.add(scr);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(23, 12, 0.5), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    frame.position.set(-HL - 2 - 20.3, 24, 0); frame.rotation.y = Math.PI / 2; G.add(frame);
    this.screen = scr;
    this.bowlPath = bowlPath;
  }

  wallStrip(pts, y0, y1, mat, withUv = false) {
    const p = [], idx = [], uv = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) { p.push(pts[i].x, y0, pts[i].z, pts[i].x, y1, pts[i].z); uv.push(i / n, 0, i / n, 1); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(2 * i, 2 * j, 2 * i + 1, 2 * j, 2 * j + 1, 2 * i + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(idx); g.computeVertexNormals();
    if (withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, mat);
    if (!mat.side || mat.side === THREE.FrontSide) mat.side = THREE.DoubleSide;
    return m;
  }

  // Positions des sièges (pour la foule)
  seats(spacing) {
    const out = [];
    for (const T of [this.lower, this.upper]) {
      for (let r = 0; r < T.rows; r++) {
        const D = T.D0 + r * T.depth + T.depth * 0.45;
        const { per } = bowlPath(D, 8);
        const n = Math.floor(per / spacing);
        const { pts } = bowlPath(D, n);
        const y = T.h0 + (r + 1) * T.rise;
        for (const p of pts) {
          if (isAisle(p)) continue;
          out.push({ x: p.x, y, z: p.z, nx: p.nx, nz: p.nz, row: r, upper: T === this.upper });
        }
      }
    }
    return out;
  }

  update(dt, t) {
    // défilement des panneaux LED
    for (let i = 0; i < this.adTex.length; i++) {
      const tex = this.adTex[i];
      const phase = Math.floor(t / 12) % 2;
      tex.offset.x = phase ? (t * 0.01 * (i % 2 ? 1 : -1)) % 1 : Math.floor((t / 6) % 16) / 16;
    }
  }

  drawScreen(home, away, score, clock, msg) {
    const g = this.screenTex.ctx;
    const w = 1024, h = 512;
    g.fillStyle = '#05070b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0d1b2a'; g.fillRect(16, 16, w - 32, h - 32);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.font = 'bold 72px Arial';
    g.fillText(home.short, w * 0.22, 150); g.fillText(away.short, w * 0.78, 150);
    g.fillStyle = home.colors[0]; g.fillRect(w * 0.12, 210, w * 0.2, 14);
    g.fillStyle = away.colors[0]; g.fillRect(w * 0.68, 210, w * 0.2, 14);
    g.fillStyle = '#ffeb3b'; g.font = 'bold 170px Arial';
    g.fillText(`${score[0]} - ${score[1]}`, w / 2, 170);
    g.fillStyle = '#fff'; g.font = 'bold 80px Arial';
    g.fillText(msg || clock, w / 2, 380);
    this.screenTex.needsUpdate = true;
  }
}
