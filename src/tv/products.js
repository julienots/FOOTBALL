// Studio photo 3D pour les publicités : chaque marque a son produit (canette,
// voiture, smartphone, burger, bouteille...), filmé avec éclairage de studio,
// sol réfléchissant, mouvements de caméra et particules.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function tex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const V = (x, y) => new THREE.Vector2(x, y);
const phys = (o) => new THREE.MeshPhysicalMaterial({ roughness: 0.3, metalness: 0, ...o });

function label(brand, sub, bg, fg, w = 1024, h = 512, deco = 'stripe') {
  return tex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0.0)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(0,0,0,0.15)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    if (deco === 'stripe') { g.globalAlpha = 0.25; g.beginPath(); g.moveTo(0, h * 0.7); g.lineTo(w, h * 0.35); g.lineTo(w, h * 0.5); g.lineTo(0, h * 0.85); g.fill(); g.globalAlpha = 1; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `italic 900 ${Math.round(h * 0.2)}px Arial Black, Arial`;
    for (const cx of [w * 0.25, w * 0.75]) g.fillText(brand, cx, h * 0.45, w * 0.45);
    g.font = `bold ${Math.round(h * 0.07)}px Arial`;
    for (const cx of [w * 0.25, w * 0.75]) g.fillText(sub, cx, h * 0.65, w * 0.45);
  });
}

// ---------- Produits ----------
const P = {
  can(s) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 1.2, 64, 1, true), phys({ map: label(s.brand, s.sub, s.c1, s.c2), metalness: 0.65, roughness: 0.22, clearcoat: 1 }));
    g.add(body);
    const alu = phys({ color: 0xd0d4d8, metalness: 1, roughness: 0.25 });
    const top = new THREE.Mesh(new THREE.LatheGeometry([V(0, 0.6), V(0.27, 0.6), V(0.3, 0.64), V(0.33, 0.6), V(0.33, 0.58)], 48), alu); g.add(top);
    const bot = new THREE.Mesh(new THREE.LatheGeometry([V(0.33, -0.58), V(0.3, -0.62), V(0.2, -0.6), V(0, -0.58)], 48), alu); g.add(bot);
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.2), alu); tab.position.set(0, 0.63, 0.05); g.add(tab);
    // gouttes de condensation
    const drop = new THREE.InstancedMesh(new THREE.SphereGeometry(0.006, 8, 6), phys({ color: 0xffffff, transparent: true, opacity: 0.45, roughness: 0, clearcoat: 1 }), 160);
    const o = new THREE.Object3D();
    for (let i = 0; i < 160; i++) { const a = Math.random() * 6.28, y = (Math.random() - 0.5) * 1.1; o.position.set(Math.cos(a) * 0.335, y, Math.sin(a) * 0.335); o.scale.set(1, 1 + Math.random(), 1); o.updateMatrix(); drop.setMatrixAt(i, o.matrix); }
    g.add(drop);
    return g;
  },
  bottle(s) {
    const g = new THREE.Group();
    const prof = [V(0, -0.8), V(0.3, -0.8), V(0.32, -0.75), V(0.32, 0.2), V(0.25, 0.45), V(0.12, 0.62), V(0.11, 0.8)];
    g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 64), phys({ color: 0xcfe6ff, transparent: true, opacity: 0.35, roughness: 0.04, clearcoat: 1, depthWrite: false })));
    const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.325, 0.325, 0.5, 64, 1, true), phys({ map: label(s.brand, s.sub, s.c1, s.c2), roughness: 0.4 }));
    lab.position.y = -0.25; g.add(lab);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 32), phys({ color: s.c2, roughness: 0.3 })); cap.position.y = 0.86; g.add(cap);
    return g;
  },
  phone(s) {
    const g = new THREE.Group();
    const shape = new THREE.Shape(); const w = 0.42, h = 0.88, r = 0.08;
    shape.moveTo(-w + r, -h); shape.lineTo(w - r, -h); shape.quadraticCurveTo(w, -h, w, -h + r); shape.lineTo(w, h - r); shape.quadraticCurveTo(w, h, w - r, h); shape.lineTo(-w + r, h); shape.quadraticCurveTo(-w, h, -w, h - r); shape.lineTo(-w, -h + r); shape.quadraticCurveTo(-w, -h, -w + r, -h);
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 6 }), phys({ color: s.c1, metalness: 0.8, roughness: 0.2, clearcoat: 1 }));
    body.position.z = -0.03; g.add(body);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 1.66), new THREE.MeshBasicMaterial({ map: tex(512, 1024, (c, W, H) => {
      const grd = c.createLinearGradient(0, 0, W, H); grd.addColorStop(0, '#00c853'); grd.addColorStop(1, '#2962ff'); c.fillStyle = grd; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(255,255,255,0.9)'; c.font = 'bold 150px Arial'; c.textAlign = 'center'; c.fillText('5G', W / 2, H * 0.45);
      c.font = 'bold 60px Arial'; c.fillText('⚽ 4K LIVE', W / 2, H * 0.6);
      for (let i = 0; i < 12; i++) { c.fillStyle = 'rgba(255,255,255,0.25)'; c.beginPath(); c.roundRect(40 + (i % 4) * 115, H * 0.68 + Math.floor(i / 4) * 110, 85, 85, 20); c.fill(); }
    }), toneMapped: false }));
    screen.position.z = 0.055; g.add(screen);
    const cam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 32).rotateX(Math.PI / 2), phys({ color: 0x111111, metalness: 0.5, roughness: 0.1 }));
    cam.position.set(-0.25, 0.68, -0.07); g.add(cam);
    return g;
  },
  car(s) {
    const g = new THREE.Group();
    const paint = phys({ color: s.c1, metalness: 0.7, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
    const glass = phys({ color: 0x0a0f18, metalness: 0.2, roughness: 0.05, clearcoat: 1 });
    const shape = new THREE.Shape();
    shape.moveTo(-2.2, 0.25); shape.lineTo(2.25, 0.25); shape.quadraticCurveTo(2.35, 0.7, 2.0, 0.78); shape.lineTo(0.9, 0.85); shape.quadraticCurveTo(0.3, 1.35, -0.6, 1.35); shape.quadraticCurveTo(-1.6, 1.3, -2.1, 0.95); shape.lineTo(-2.25, 0.6); shape.lineTo(-2.2, 0.25);
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.7, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 8 }), paint);
    body.position.z = -0.85; g.add(body);
    const win = new THREE.Shape(); win.moveTo(0.75, 0.88); win.quadraticCurveTo(0.25, 1.28, -0.6, 1.28); win.quadraticCurveTo(-1.45, 1.24, -1.85, 0.95); win.lineTo(0.75, 0.88);
    const wg = new THREE.ExtrudeGeometry(win, { depth: 1.86, bevelEnabled: false }); wg.translate(0, 0.02, -0.93);
    g.add(new THREE.Mesh(wg, glass));
    const tyre = phys({ color: 0x111111, roughness: 0.8 }), rim = phys({ color: 0xcfd8dc, metalness: 1, roughness: 0.15 });
    for (const [x, z] of [[1.35, 0.95], [1.35, -0.95], [-1.35, 0.95], [-1.35, -0.95]]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.13, 16, 32), tyre); w.position.set(x, 0.42, z); g.add(w);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 24).rotateX(Math.PI / 2), rim); r.position.set(x, 0.42, z * 1.03); g.add(r);
    }
    for (const z of [-0.6, 0.6]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.45), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })); hl.position.set(2.32, 0.62, z); g.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.5), new THREE.MeshBasicMaterial({ color: 0xff1744, toneMapped: false })); tl.position.set(-2.3, 0.8, z); g.add(tl);
    }
    g.scale.setScalar(0.42); g.position.y = -0.35;
    return g;
  },
  bag(s) {
    const geo = new THREE.BoxGeometry(1, 1.4, 0.32, 20, 20, 6);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const pinch = Math.pow(Math.abs(y) / 0.7, 6); pos.setZ(i, z * (1 - pinch * 0.9) * (1 - x * x * 0.4)); pos.setX(i, x * (1 + 0.04 * Math.sin(y * 9))); }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, phys({ map: label(s.brand, s.sub, s.c1, s.c2, 512, 512, 'none'), metalness: 0.5, roughness: 0.3, clearcoat: 1 }));
    m.material.map.repeat.set(1, 1);
    const g = new THREE.Group(); g.add(m);
    return g;
  },
  card(s) {
    const shape = new THREE.Shape(); const w = 0.85, h = 0.54, r = 0.06;
    shape.moveTo(-w + r, -h); shape.lineTo(w - r, -h); shape.quadraticCurveTo(w, -h, w, -h + r); shape.lineTo(w, h - r); shape.quadraticCurveTo(w, h, w - r, h); shape.lineTo(-w + r, h); shape.quadraticCurveTo(-w, h, -w, h - r); shape.lineTo(-w, -h + r); shape.quadraticCurveTo(-w, -h, -w + r, -h);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + w) / (2 * w), (uv.getY(i) + h) / (2 * h));
    const face = tex(1024, 640, (g, W, H) => {
      const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, s.c1); grd.addColorStop(1, '#000'); g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = '#d4af37'; g.beginPath(); g.roundRect(90, 230, 150, 115, 18); g.fill();
      g.fillStyle = '#fff'; g.font = 'italic 900 80px Arial'; g.fillText(s.brand, 90, 140);
      g.font = '58px monospace'; g.fillText('4970  1234  5678  9010', 90, 470); g.font = '34px Arial'; g.fillText('M. CLIENT HEUREUX      12/30', 90, 560);
    });
    return new THREE.Group().add(new THREE.Mesh(geo, phys({ map: face, metalness: 0.4, roughness: 0.25, clearcoat: 1 })));
  },
  burger(s) {
    const g = new THREE.Group();
    const layer = (r, h, y, color, rough = 0.6, bulge = 0.2) => {
      const pts = []; for (let i = 0; i <= 12; i++) { const a = i / 12; pts.push(V(r * Math.sin(Math.PI * a * 0.5 + 0.0001) * (1 + bulge * Math.sin(Math.PI * a)), y + h * a)); }
      const m = new THREE.Mesh(new THREE.LatheGeometry([V(0.0001, y), ...pts.slice(1), V(0.0001, y + h)], 48), phys({ color, roughness: rough })); g.add(m); return m;
    };
    layer(0.72, 0.18, -0.45, '#c8823a', 0.5, 0.05);
    layer(0.78, 0.16, -0.27, '#4e2a14', 0.85);
    const cheese = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.03, 1.45), phys({ color: '#ffc107', roughness: 0.4 })); cheese.position.y = -0.1; cheese.rotation.y = 0.4; g.add(cheese);
    layer(0.78, 0.16, -0.08, '#4e2a14', 0.85);
    const lettuce = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.8, 0.05, 32, 1), phys({ color: '#7cb342', roughness: 0.6 })); lettuce.position.y = 0.11; g.add(lettuce);
    const tomato = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 32), phys({ color: '#e53935', roughness: 0.3, clearcoat: 0.6 })); tomato.position.y = 0.16; g.add(tomato);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.78, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), phys({ color: '#d68b3a', roughness: 0.45, clearcoat: 0.4 })); top.scale.y = 0.55; top.position.y = 0.19; g.add(top);
    const seeds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.025, 6, 4).scale(1, 0.5, 1.6), phys({ color: '#fff3e0' }), 70);
    const o = new THREE.Object3D();
    for (let i = 0; i < 70; i++) { const a = Math.random() * 6.28, e = Math.random() * 1.2; o.position.set(Math.cos(a) * Math.sin(e) * 0.78, 0.19 + Math.cos(e) * 0.43, Math.sin(a) * Math.sin(e) * 0.78); o.rotation.set(0, a, 0); o.updateMatrix(); seeds.setMatrixAt(i, o.matrix); }
    g.add(seeds);
    return g;
  },
  pizza(s) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1.02, 0.08, 64), phys({ color: '#e0a35a', roughness: 0.7 })));
    const crust = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.07, 12, 64), phys({ color: '#c47d35', roughness: 0.7 })); crust.rotation.x = Math.PI / 2; crust.position.y = 0.05; g.add(crust);
    const sauce = new THREE.Mesh(new THREE.CylinderGeometry(0.93, 0.93, 0.02, 64), phys({ color: '#d84315', roughness: 0.4 })); sauce.position.y = 0.05; g.add(sauce);
    const cheese = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.02, 64), phys({ color: '#ffe082', roughness: 0.35, transparent: true, opacity: 0.9 })); cheese.position.y = 0.065; g.add(cheese);
    const pep = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.11, 0.025, 20), phys({ color: '#b71c1c', roughness: 0.35, clearcoat: 0.5 }), 18);
    const o = new THREE.Object3D();
    for (let i = 0; i < 18; i++) { const a = i * 2.4, r = 0.2 + (i / 18) * 0.62; o.position.set(Math.cos(a) * r, 0.085, Math.sin(a) * r); o.updateMatrix(); pep.setMatrixAt(i, o.matrix); }
    g.add(pep);
    const basil = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 4).scale(1, 0.15, 0.6), phys({ color: '#2e7d32' }), 10);
    for (let i = 0; i < 10; i++) { const a = i * 1.7 + 0.5, r = 0.3 + (i % 3) * 0.2; o.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r); o.rotation.y = a; o.updateMatrix(); basil.setMatrixAt(i, o.matrix); }
    g.add(basil);
    g.rotation.x = 0.5;
    return g;
  },
  icecream(s) {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.1, 32, 8, true), phys({ map: tex(256, 256, (c, w, h) => { c.fillStyle = '#d7a058'; c.fillRect(0, 0, w, h); c.strokeStyle = '#a86d2a'; c.lineWidth = 6; for (let i = -w; i < w * 2; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.stroke(); c.beginPath(); c.moveTo(i, h); c.lineTo(i + h, 0); c.stroke(); } }), roughness: 0.8 }));
    cone.rotation.x = Math.PI; cone.position.y = -0.45; g.add(cone);
    const cols = [s.c1, '#fff8e1', '#ffb74d'];
    cols.forEach((c, i) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.38 - i * 0.04, 32, 20), phys({ color: c, roughness: 0.55, clearcoat: 0.3 })); b.position.set(Math.sin(i * 2) * 0.08, 0.18 + i * 0.3, 0); b.scale.y = 0.85; g.add(b); });
    return g;
  },
  plane(s) {
    const g = new THREE.Group();
    const white = phys({ color: 0xf5f5f5, metalness: 0.3, roughness: 0.3, clearcoat: 0.6 });
    const fus = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 2.6, 12, 24).rotateZ(Math.PI / 2), white); g.add(fus);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 3.4), white); wing.position.set(0.1, -0.05, 0); g.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.04), phys({ color: s.c1, roughness: 0.3 })); tail.position.set(-1.4, 0.4, 0); g.add(tail);
    const ht = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.03, 1.1), white); ht.position.set(-1.4, 0.05, 0); g.add(ht);
    for (const z of [-0.8, 0.8]) { const e = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.45, 16).rotateZ(Math.PI / 2), phys({ color: 0xb0bec5, metalness: 0.8, roughness: 0.3 })); e.position.set(0.3, -0.18, z); g.add(e); }
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.253, 0.253, 2.0, 32, 1, true).rotateZ(Math.PI / 2), phys({ color: s.c1, roughness: 0.3 })); stripe.scale.set(1, 1, 1); stripe.position.y = -0.05; stripe.scale.y = 1; g.add(stripe);
    g.rotation.z = 0.08;
    return g;
  },
  controller(s) {
    const g = new THREE.Group();
    const mat = phys({ color: 0x1b1b1f, roughness: 0.35, clearcoat: 0.6 });
    const body = new THREE.Mesh(mergeGeometries([new THREE.CapsuleGeometry(0.32, 0.9, 12, 24).rotateZ(Math.PI / 2).scale(1, 0.75, 0.5), new THREE.SphereGeometry(0.36, 24, 16).scale(1, 1.2, 0.55).translate(-0.55, -0.25, 0), new THREE.SphereGeometry(0.36, 24, 16).scale(1, 1.2, 0.55).translate(0.55, -0.25, 0)]), mat);
    g.add(body);
    const btn = (x, y, c) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6 })); b.position.set(x, y, 0.17); g.add(b); };
    btn(0.55, 0.12, '#00e676'); btn(0.67, 0, '#ff1744'); btn(0.43, 0, '#2979ff'); btn(0.55, -0.12, '#ffea00');
    for (const x of [-0.2, 0.2]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 20).rotateX(Math.PI / 2), phys({ color: 0x333333 })); st.position.set(x, -0.15, 0.18); g.add(st); }
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.02), new THREE.MeshBasicMaterial({ color: s.c1, toneMapped: false })); led.position.set(0, 0.2, 0.18); g.add(led);
    g.scale.setScalar(1.3);
    return g;
  },
  shield(s) {
    const shape = new THREE.Shape(); shape.moveTo(0, 0.9); shape.quadraticCurveTo(0.5, 0.8, 0.75, 0.7); shape.quadraticCurveTo(0.75, -0.3, 0, -0.95); shape.quadraticCurveTo(-0.75, -0.3, -0.75, 0.7); shape.quadraticCurveTo(-0.5, 0.8, 0, 0.9);
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 8 }), phys({ color: s.c1, metalness: 0.9, roughness: 0.2, clearcoat: 1 }));
    m.position.z = -0.07;
    return new THREE.Group().add(m);
  },
  coins(s) {
    const g = new THREE.Group();
    const gold = phys({ color: 0xffc107, metalness: 1, roughness: 0.2 });
    for (let i = 0; i < 9; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 48), gold); c.position.set(Math.sin(i) * 0.03, -0.6 + i * 0.09, Math.cos(i) * 0.03); g.add(c); }
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 48).rotateX(Math.PI / 2), gold); f.position.set(0.6, 0, 0.2); f.rotation.y = -0.4; g.add(f);
    return g;
  },
  ball(s) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 32), phys({ map: tex(512, 256, (c, w, h) => { c.fillStyle = '#d4f53c'; c.fillRect(0, 0, w, h); for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.25})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); } c.strokeStyle = '#fff'; c.lineWidth = 10; c.beginPath(); for (let x = 0; x <= w; x += 4) c.lineTo(x, h / 2 + Math.sin(x / w * Math.PI * 4) * h * 0.22); c.stroke(); }), roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0xffffff) }));
    g.add(b);
    return g;
  },
  trophy(s) {
    const g = new THREE.Group();
    const gold = phys({ color: 0xffca28, metalness: 1, roughness: 0.12, clearcoat: 1 });
    g.add(new THREE.Mesh(new THREE.LatheGeometry([V(0, -0.9), V(0.35, -0.9), V(0.35, -0.75), V(0.15, -0.65), V(0.08, -0.3), V(0.1, -0.2), V(0.42, 0.1), V(0.5, 0.55), V(0.47, 0.6), V(0.0, 0.25)], 64), gold));
    for (const sx of [-1, 1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 12, 32, Math.PI * 1.3), gold); h.position.set(sx * 0.5, 0.3, 0); h.rotation.z = sx > 0 ? -1.2 : Math.PI + 1.2; g.add(h); }
    return g;
  },
  panel(s) {
    const g = new THREE.Group();
    const cells = tex(512, 512, (c, w, h) => { c.fillStyle = '#0d1b4a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#90a4ae'; c.lineWidth = 3; for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(i * w / 8, 0); c.lineTo(i * w / 8, h); c.stroke(); c.beginPath(); c.moveTo(0, i * h / 6); c.lineTo(w, i * h / 6); c.stroke(); } });
    const p = new THREE.Mesh(new THREE.BoxGeometry(2, 0.04, 1.3), [phys({ color: 0xb0bec5, metalness: 1 }), phys({ color: 0xb0bec5, metalness: 1 }), phys({ map: cells, metalness: 0.4, roughness: 0.08, clearcoat: 1 }), phys({ color: 0x333333 }), phys({ color: 0xb0bec5 }), phys({ color: 0xb0bec5 })]);
    p.rotation.x = 0.55; g.add(p);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffe082, toneMapped: false })); sun.position.set(1.1, 1.0, -1.2); g.add(sun);
    return g;
  },
  shoe(s) {
    const g = new THREE.Group();
    const upper = new THREE.Mesh(mergeGeometries([new THREE.SphereGeometry(0.5, 32, 20).scale(1.6, 0.55, 0.62).translate(0, 0.15, 0), new THREE.SphereGeometry(0.4, 24, 16).scale(0.9, 0.9, 0.6).translate(-0.45, 0.4, 0)]), phys({ color: s.c1, roughness: 0.5, sheen: 0.6 }));
    g.add(upper);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.1, 0.62), phys({ color: 0xffffff, roughness: 0.5 })); sole.position.y = -0.12; g.add(sole);
    const swoosh = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 8, 32, 2.2), phys({ color: s.c2, roughness: 0.3 })); swoosh.position.set(0.05, 0.15, 0.32); swoosh.rotation.z = 3.6; g.add(swoosh);
    const studs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.04, 0.08, 12), phys({ color: 0xffc107, metalness: 1 }), 10);
    const o = new THREE.Object3D(); for (let i = 0; i < 10; i++) { o.position.set(-0.65 + (i % 5) * 0.32, -0.2, i < 5 ? -0.18 : 0.18); o.updateMatrix(); studs.setMatrixAt(i, o.matrix); }
    g.add(studs);
    return g;
  },
  racecar(s) { const g = P.car({ ...s }); g.scale.set(0.42, 0.3, 0.38); return g; },
  pan(s) {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.LatheGeometry([V(0.0001, -0.12), V(0.8, -0.12), V(0.95, 0.1), V(0.97, 0.12)], 64), phys({ color: s.c1, metalness: 0.6, roughness: 0.3, clearcoat: 1 }));
    g.add(outer);
    const inner = new THREE.Mesh(new THREE.LatheGeometry([V(0.94, 0.11), V(0.79, -0.1), V(0.0001, -0.1)], 64), phys({ color: 0x222226, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 }));
    g.add(inner);
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 1.1, 8, 16).rotateZ(Math.PI / 2), phys({ color: 0x151515, roughness: 0.6 }));
    handle.position.set(1.55, 0.08, 0); handle.rotation.z = 0.12; g.add(handle);
    const egg = new THREE.Mesh(new THREE.CircleGeometry(0.35, 32), phys({ color: 0xfafafa, roughness: 0.3 })); egg.rotation.x = -Math.PI / 2; egg.position.set(-0.2, -0.09, 0.1); g.add(egg);
    const yolk = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 12).scale(1, 0.5, 1), phys({ color: 0xffa000, roughness: 0.2, clearcoat: 1 })); yolk.position.set(-0.2, -0.07, 0.1); g.add(yolk);
    g.rotation.x = 0.35; g.scale.setScalar(0.85);
    return g;
  },
  blender(s) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.55, 48), phys({ color: s.c1, metalness: 0.7, roughness: 0.25, clearcoat: 1 })); base.position.y = -0.6; g.add(base);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 24).rotateX(Math.PI / 2), phys({ color: 0x222222 })); knob.position.set(0, -0.6, 0.48); g.add(knob);
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.33, 1.1, 48, 1, true), phys({ color: 0xffffff, transparent: true, opacity: 0.25, roughness: 0.05, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false })); jar.position.y = 0.23; g.add(jar);
    const juice = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.32, 0.65, 48), phys({ color: s.c2 === '#ffffff' ? '#e91e63' : s.c2, roughness: 0.3, clearcoat: 0.6 })); juice.position.y = 0.0; g.add(juice);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.08, 48), phys({ color: 0x222222, roughness: 0.4 })); lid.position.y = 0.8; g.add(lid);
    return g;
  },
  watch(s) {
    const g = new THREE.Group();
    const steel = phys({ color: 0xd0d4d8, metalness: 1, roughness: 0.15, clearcoat: 1 });
    const kase = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.16, 64).rotateX(Math.PI / 2), steel); g.add(kase);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 16, 64), steel); bezel.position.z = 0.07; g.add(bezel);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.45, 64), new THREE.MeshPhysicalMaterial({ map: tex(512, 512, (c, w, h) => {
      const grd = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2); grd.addColorStop(0, '#1c2a48'); grd.addColorStop(1, '#070b16'); c.fillStyle = grd; c.fillRect(0, 0, w, h);
      c.fillStyle = '#e0e0e0'; for (let i = 0; i < 12; i++) { c.save(); c.translate(w / 2, h / 2); c.rotate(i * Math.PI / 6); c.fillRect(-6, -230, 12, i % 3 ? 30 : 50); c.restore(); }
      c.font = 'bold 34px Arial'; c.textAlign = 'center'; c.fillText(s.brand, w / 2, h * 0.36); c.font = '20px Arial'; c.fillText('AUTOMATIC · 100 M', w / 2, h * 0.68);
    }), roughness: 0.2, clearcoat: 1 }));
    face.position.z = 0.081; g.add(face);
    const hand = (len, wdt, rot) => { const m = new THREE.Mesh(new THREE.BoxGeometry(wdt, len, 0.01), steel); m.geometry.translate(0, len / 2, 0); m.position.z = 0.09; m.rotation.z = rot; g.add(m); };
    hand(0.28, 0.035, -1.0); hand(0.38, 0.025, 2.1);
    for (const sy of [-1, 1]) { const strap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.7, 0.06), phys({ color: 0x3e2723, roughness: 0.7 })); strap.position.set(0, sy * 0.78, -0.03); strap.rotation.x = sy * 0.25; g.add(strap); }
    return g;
  },
  robot(s) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.22, 64), phys({ color: 0x1a1a1e, metalness: 0.4, roughness: 0.2, clearcoat: 1 })); g.add(body);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 32), phys({ color: 0xe0e0e0, metalness: 0.8, roughness: 0.2 })); top.position.set(0, 0.14, -0.3); g.add(top);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.012, 8, 64), new THREE.MeshBasicMaterial({ color: s.c1, toneMapped: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.115; g.add(ring);
    const bump = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 0.12, 64, 1, true, -1.2, 2.4), phys({ color: 0x555555, roughness: 0.4 })); bump.position.y = -0.02; g.add(bump);
    g.rotation.x = 0.25;
    return g;
  },
};

// produit associé à chaque marque
export const PRODUCT_OF = {
  VOLTA: 'can', 'AUTO LUMINA': 'car', CRISPYMAX: 'bag', 'BANQUE HORIZON': 'card', 'NEO MOBILE 5G': 'phone', AQUAPURA: 'bottle', 'KAPPA FIT': 'shoe',
  'PIZZA ROMA EXPRESS': 'pizza', 'GLACE POLAR': 'icecream', 'STARLINE AIR': 'plane', 'MÉGABOX GAMES': 'controller', 'BURGER KAISER': 'burger',
  'ASSURANCE ÉGIDE': 'shield', 'PARIS+': 'coins', 'TENNIS+': 'ball', 'MOTEUR+': 'racecar', 'FOOT+ 2': 'trophy', SOLARIX: 'panel',
};

const FLAT = new Set(['pizza', 'card', 'panel', 'coins']);
const firstColor = (bg) => (bg.match(/#[0-9a-fA-F]{6}/g) || ['#1565c0'])[0];
const lastColor = (bg) => { const m = bg.match(/#[0-9a-fA-F]{6}/g) || ['#0d47a1']; return m[m.length - 1]; };

class ProductStage {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ad-3d';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.03).texture;
    this.scene.environmentIntensity = 0.55;
    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.05, 100);
    // studio : fond courbe, sol miroir
    this.backMat = new THREE.ShaderMaterial({
      uniforms: { c1: { value: new THREE.Color() }, c2: { value: new THREE.Color() }, t: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 c1; uniform vec3 c2; uniform float t; varying vec3 vP; void main(){ vec3 d = normalize(vP); float g = smoothstep(-0.3, 0.8, d.y); float r = 0.5 + 0.5 * sin(atan(d.z, d.x) * 6.0 + t); vec3 c = mix(c2 * 0.35, c1, g * 0.8 + r * 0.08); gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}',
      side: THREE.BackSide, depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(30, 48, 24), this.backMat));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshPhysicalMaterial({ color: 0x050505, metalness: 0.5, roughness: 0.3, clearcoat: 0.6, envMapIntensity: 0.12 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1.05; floor.receiveShadow = true; this.floor = floor;
    this.scene.add(floor);
    const key = new THREE.SpotLight(0xffffff, 26, 20, 0.5, 0.6); key.position.set(3, 5, 4); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); this.scene.add(key);
    const rim = new THREE.SpotLight(0xffffff, 34, 20, 0.6, 0.8); rim.position.set(-4, 3, -4); this.scene.add(rim);
    this.rim = rim;
    this.fill = new THREE.PointLight(0xffffff, 6, 10); this.fill.position.set(-3, 0, 3); this.scene.add(this.fill);
    // particules (bulles, étincelles, poussière lumineuse)
    const n = 220; const pg = new THREE.BufferGeometry(); const pp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pp[i * 3] = (Math.random() - 0.5) * 8; pp[i * 3 + 1] = (Math.random() - 0.5) * 5; pp[i * 3 + 2] = (Math.random() - 0.5) * 6; }
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.04, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.particles);
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.cache = new Map();
  }

  setSpot(spot) {
    const kind = spot.product || PRODUCT_OF[spot.brand] || 'can';
    const c1 = firstColor(spot.bg), c2 = lastColor(spot.bg);
    this.backMat.uniforms.c1.value.set(c1); this.backMat.uniforms.c2.value.set(c2);
    this.rim.color.set(c1);
    this.floor.material.color.set(c2).multiplyScalar(0.12);
    this.holder.clear();
    const key = spot.brand;
    let obj = this.cache.get(key);
    if (!obj) {
      obj = P[kind]({ brand: spot.brand.split(' ')[0], sub: (spot.scenes[spot.scenes.length - 1] || '').split('·').pop().trim(), c1: spot.fg === '#fff' || spot.fg === '#ffffff' ? c1 : spot.fg, c2: spot.fg === '#fff' || spot.fg === '#ffffff' ? '#ffffff' : c1 });
      obj.traverse(o => { if (o.isMesh) o.castShadow = true; });
      this.cache.set(key, obj);
    }
    this.holder.add(obj);
    this.kind = kind;
    if (obj.userData.r === undefined) { const bb = new THREE.Box3().setFromObject(obj); obj.userData.r = bb.getBoundingSphere(new THREE.Sphere()).radius; obj.userData.y0 = bb.min.y; }
    this.radius = Math.max(0.5, obj.userData.r);
    this.floor.position.y = obj.userData.y0 - 0.12 * this.radius;
    this.floor.scale.setScalar(Math.max(1, this.radius));
  }

  resize(w, h) {
    if (this.w === w && this.h === h) return;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // t : secondes depuis le début du spot ; plan : index de la scène
  render(t, plan) {
    const R = this.radius || 0.8;
    // plans (en unités du rayon du produit) : orbite, gros plan, travelling, plan final
    const shots = [
      () => { const a = t * 0.35; return [Math.sin(a) * 3.5, 0.35 + Math.sin(t * 0.4) * 0.2, Math.cos(a) * 3.5, 0, 0, 0, 32]; },
      () => [1.3 - t * 0.05, 0.25, 2.5, 0, 0.15, 0, 26],
      () => [-2.4 + t * 0.12, 1.1, 2.4, 0, 0, 0, 34],
      () => [0, 0.3, 4.3, 0, -0.5, 0, 30],
    ];
    const sh = shots[plan % shots.length]();
    this.camera.position.set(sh[0] * R, sh[1] * R, sh[2] * R);
    this.camera.lookAt(sh[3] * R, sh[4] * R, sh[5] * R);
    this.camera.fov = sh[6]; this.camera.updateProjectionMatrix();
    this.holder.rotation.y = this.kind === 'plane' ? Math.sin(t * 0.5) * 0.4 + 0.6 : t * 0.5;
    this.holder.position.y = Math.sin(t * 1.4) * 0.04;
    if (this.kind === 'plane') this.holder.rotation.z = Math.sin(t) * 0.1;
    this.holder.rotation.x = FLAT.has(this.kind) ? 0.55 : 0;
    this.backMat.uniforms.t.value = t * 0.3;
    this.particles.rotation.y = t * 0.05;
    this.particles.position.y = (t * 0.15) % 1;
    this.renderer.render(this.scene, this.camera);
  }
}

let STAGE = null;
export function getStage() {
  if (!STAGE) { try { STAGE = new ProductStage(); } catch (e) { console.warn('studio pub', e); STAGE = false; } }
  return STAGE || null;
}
