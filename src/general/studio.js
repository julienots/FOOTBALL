// Plateaux TV en 3D de la chaîne ÉTOILE : studio du journal (et du magazine
// sportif) et grand plateau du jeu télévisé, avec présentateurs et candidats
// animés (mêmes personnages réalistes que les sportifs, en costume).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Players } from '../football/players.js';
import { ENT, SNAP_LEN } from '../football/engine.js';

// Texture dessinée dynamiquement (murs LED, pupitres...)
export class Screen {
  constructor(w, h) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.w = w; this.h = h;
  }
  draw(fn) { fn(this.g, this.w, this.h); this.tex.needsUpdate = true; }
}

export const SUIT = (jacket, look, extra = {}) => ({
  shirt: jacket, shorts: jacket, socks: jacket, trim: '#f2f4f7', boot: '#121212', number: 0, numColor: jacket, official: true, sponsor: -1,
  pattern: 7, shirt2: '#d9dee5', longSleeves: true, trousers: true,
  skin: look.skin, hair: look.hair, hairStyle: look.hairStyle, beard: look.beard, height: look.height, ...extra,
});

// Personnages posés à la main (pas de moteur de match)
class Cast {
  constructor(scene, quality) {
    this.pl = new Players(scene, quality);
    this.pl.ball.visible = false;
    this.pl.flags.forEach(f => (f.visible = false));
    this.A = new Float32Array(SNAP_LEN).fill(9999);
    this.active = [];
    this.t = 0;
  }
  add(i, meta, x, z, yaw) {
    this.pl.setMeta(i, meta);
    const o = i * ENT;
    this.A[o] = x; this.A[o + 1] = z; this.A[o + 2] = Math.PI / 2 - yaw; this.A[o + 3] = 0; this.A[o + 4] = 0; this.A[o + 5] = 0;
    this.active.push(i);
    this.pl.rigs[i].yaw = yaw;
  }
  // pose(i, rig, t) : retouche la pose de chaque personnage après la pose de base
  update(dt, pose) {
    this.t += dt;
    this.pl.update(this.A, this.A, 1, dt, { hideBall: true });
    for (const i of this.active) {
      const r = this.pl.rigs[i];
      pose(i, r, this.t);
      r.root.updateMatrixWorld(true);
      this.pl.write(i, r);
      if (this.pl.bodies) this.pl.syncBody(i, r);
    }
    for (const k in this.pl.meshes) this.pl.meshes[k].instanceMatrix.needsUpdate = true;
  }
}

// Pose assise derrière un bureau, avec gestes quand la personne parle
function seated(r, t, talk, seed) {
  r.pelvis.position.y = 0.52;
  r.thL.rotation.set(-1.45, 0, 0.05); r.thR.rotation.set(-1.45, 0, -0.05);
  r.shL.rotation.set(1.5, 0, 0); r.shR.rotation.set(1.5, 0, 0);
  r.torso.rotation.set(0.1, Math.sin(t * 0.3 + seed) * 0.04, 0);
  const g = talk ? Math.sin(t * 2.3 + seed) : 0, g2 = talk ? Math.sin(t * 1.7 + seed * 2) : 0;
  r.uaL.rotation.set(-0.55 - g * 0.12, 0, -0.22); r.faL.rotation.set(-1.05 - g2 * 0.2, 0.2, 0);
  r.uaR.rotation.set(-0.55 + g2 * 0.1, 0, 0.22); r.faR.rotation.set(-1.0 + g * 0.25, -0.2, 0);
  r.head.rotation.set(-0.06 + (talk ? Math.sin(t * 3.1 + seed) * 0.05 : 0), Math.sin(t * 0.45 + seed) * 0.12, Math.sin(t * 0.7) * 0.03);
}

// Pose debout (présentateur, candidat derrière un pupitre)
function standing(r, t, o) {
  const talk = o.talk ? 1 : 0;
  r.torso.rotation.set(0.02, Math.sin(t * 0.4 + o.seed) * 0.05, 0);
  r.head.rotation.set(-0.03 + talk * Math.sin(t * 3.3 + o.seed) * 0.05, (o.look || 0) + Math.sin(t * 0.5 + o.seed) * 0.1, 0);
  if (o.mode === 'podium') {
    r.uaL.rotation.set(-0.6, 0, -0.15); r.faL.rotation.set(-0.75, 0, 0);
    r.uaR.rotation.set(-0.6, 0, 0.15); r.faR.rotation.set(-0.75, 0, 0);
  } else if (o.mode === 'buzz') {
    r.uaR.rotation.set(-0.9, 0, 0.1); r.faR.rotation.set(-0.4, 0, 0);
    r.uaL.rotation.set(-0.6, 0, -0.15); r.faL.rotation.set(-0.75, 0, 0);
    r.torso.rotation.x = 0.12;
  } else if (o.mode === 'joy') {
    const j = Math.abs(Math.sin(t * 6));
    r.uaL.rotation.set(-2.7 - j * 0.2, 0, -0.4); r.uaR.rotation.set(-2.7 - j * 0.2, 0, 0.4);
    r.faL.rotation.set(-0.3, 0, 0); r.faR.rotation.set(-0.3, 0, 0);
  } else if (o.mode === 'sad') {
    r.head.rotation.x = 0.3; r.uaL.rotation.set(-0.1, 0, -0.08); r.uaR.rotation.set(-0.1, 0, 0.08);
  } else if (o.mode === 'host') {
    // fiches dans la main gauche, gestes de la main droite
    r.uaL.rotation.set(-0.5, 0, -0.15); r.faL.rotation.set(-1.25, 0.3, 0);
    const g = talk ? Math.sin(t * 2.1 + o.seed) : 0;
    r.uaR.rotation.set(-0.35 - talk * (0.35 + g * 0.2), 0, 0.2 + talk * 0.15); r.faR.rotation.set(-0.6 - talk * (0.5 + Math.sin(t * 2.7) * 0.2), 0, 0);
  } else if (o.mode === 'clap') {
    const c = Math.sin(t * 18) * 0.12;
    r.uaL.rotation.set(-0.9, 0, -0.1 + c); r.faL.rotation.set(-1.0, 0.6, 0);
    r.uaR.rotation.set(-0.9, 0, 0.1 - c); r.faR.rotation.set(-1.0, -0.6, 0);
  } else {
    r.uaL.rotation.set(0.05, 0, -0.1); r.uaR.rotation.set(0.05, 0, 0.1);
  }
}

const mat = (o) => new THREE.MeshPhysicalMaterial({ roughness: 0.35, metalness: 0, ...o });
const emis = (color, k = 1) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(color), emissiveIntensity: k });

export class StudioView {
  constructor(renderer, mode, quality, opts = {}) {
    this.renderer = renderer;
    this.mode = mode;
    this.quality = quality;
    this.opts = opts;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x02030a);
    const pm = new THREE.PMREMGenerator(renderer);
    this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    scene.environment = this.env;
    scene.environmentIntensity = 0.35;
    this.camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 200);
    this.cam = { pos: new THREE.Vector3(0, 2, 8), look: new THREE.Vector3(0, 1.3, 0), fov: 36 };
    this.cast = new Cast(scene, quality);
    this.t = 0;
    this.shotT = 0;
    if (mode === 'quiz') this.buildQuiz(); else this.buildNews(mode === 'mag');
    if (quality !== 'low') {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : 2 });
      this.composer = new EffectComposer(renderer, rt);
      this.composer.addPass(new RenderPass(scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), mode === 'quiz' ? 0.42 : 0.18, 0.5, 0.93));
      this.composer.addPass(new OutputPass());
    }
  }

  // ---------------- Studio du journal / magazine ----------------
  buildNews(mag) {
    const S = this.scene;
    const c1 = mag ? '#00c853' : '#1e88e5', c2 = mag ? '#ff9100' : '#e53935';
    this.palette = [c1, c2];
    // sol brillant + anneaux lumineux
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), mat({ color: 0x080b14, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, metalness: 0.3 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
    for (const [r, c] of [[2.6, c1], [3.4, c2], [5.5, c1]]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.04, 96), emis(c, 1.4));
      ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.005, -0.5); S.add(ring);
    }
    // mur LED
    this.wall = new Screen(2048, 768);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), new THREE.MeshBasicMaterial({ map: this.wall.tex, color: 0x9a9a9a }));
    wall.position.set(0, 3.1, -4.6); S.add(wall);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(16.4, 0.12, 0.2), emis(c1, 2)); frame.position.set(0, 0.06, -4.55); S.add(frame);
    const frameT = frame.clone(); frameT.position.y = 6.15; S.add(frameT);
    // colonnes lumineuses et écrans latéraux
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.12, 5.5, 0.12), emis(k % 2 ? c2 : c1, 1.6));
        col.position.set(sx * (5.2 + k * 0.9), 2.75, -2.8 + k * 1.3); S.add(col);
      }
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.4, 3.8), mat({ color: 0x10131c, roughness: 0.4 }));
      side.position.set(sx * 7.6, 2.2, -1.5); side.rotation.y = sx * 0.35; S.add(side);
    }
    this.side = new Screen(512, 288);
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.9), new THREE.MeshBasicMaterial({ map: this.side.tex, toneMapped: false }));
      m.position.set(sx * 7.5, 2.2, -1.5); m.rotation.y = -sx * (Math.PI / 2 - 0.35); S.add(m);
    }
    // bureau : plateau blanc laqué, façade sombre avec bandeau lumineux et logo
    const desk = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(mag ? 4.4 : 3.2, 0.06, 1.1), mat({ color: 0xb8bcc4, roughness: 0.3, clearcoat: 0.6 }));
    top.position.y = 0.78; top.castShadow = true; top.receiveShadow = true; desk.add(top);
    this.deskLogo = new Screen(1024, 256);
    const front = new THREE.Mesh(new THREE.BoxGeometry(mag ? 4.2 : 3.0, 0.74, 0.06), [mat({ color: 0x0d1220 }), mat({ color: 0x0d1220 }), mat({ color: 0x0d1220 }), mat({ color: 0x0d1220 }), new THREE.MeshStandardMaterial({ map: this.deskLogo.tex, emissive: 0xffffff, emissiveMap: this.deskLogo.tex, emissiveIntensity: 0.6, roughness: 0.3 }), mat({ color: 0x0d1220 })]);
    front.position.set(0, 0.39, 0.5); desk.add(front);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(mag ? 4.3 : 3.1, 0.03, 0.03), emis(c1, 3)); glow.position.set(0, 0.03, 0.54); desk.add(glow);
    const base = new THREE.Mesh(new THREE.BoxGeometry(mag ? 4.0 : 2.8, 0.74, 0.9), mat({ color: 0x0b0f1a })); base.position.y = 0.39; desk.add(base);
    S.add(desk);
    // écran de bureau (portable) et feuilles
    const lap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.01), mat({ color: 0x222222, metalness: 0.6, roughness: 0.3 }));
    lap.position.set(mag ? 1.6 : 0.95, 0.95, -0.15); lap.rotation.set(-0.25, -0.5, 0); S.add(lap);
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.004, 0.3), mat({ color: 0xbdbdbd, roughness: 0.95 }));
    paper.position.set(-0.3, 0.815, 0.0); paper.rotation.y = 0.1; S.add(paper);
    // plafond technique (projecteurs)
    for (let k = 0; k < 8; k++) {
      const spot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.35, 12), mat({ color: 0x1a1a1a, metalness: 0.7 }));
      spot.position.set(-5.25 + k * 1.5, 7.2, 1.5); spot.rotation.x = 0.6; S.add(spot);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), emis('#fff6e0', 2)); lens.position.set(-5.25 + k * 1.5, 7.08, 1.62); lens.rotation.x = Math.PI / 2 + 0.6; S.add(lens);
    }
    // lumières
    S.add(new THREE.HemisphereLight(0x8fa8ff, 0x101018, 0.45));
    const key = new THREE.SpotLight(0xfff3e6, 45, 30, 0.45, 0.6, 1.6); key.position.set(1.5, 6.5, 6); key.target.position.set(0, 1.2, -0.8);
    key.castShadow = this.quality !== 'low'; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0005; S.add(key); S.add(key.target);
    const fill = new THREE.SpotLight(0xe6efff, 18, 30, 0.6, 0.8, 1.6); fill.position.set(-4, 4, 5); fill.target.position.set(0, 1.2, -0.8); S.add(fill); S.add(fill.target);
    const rim = new THREE.SpotLight(new THREE.Color(c1), 30, 20, 0.6, 0.6, 1.6); rim.position.set(0, 5, -3.5); rim.target.position.set(0, 1.4, -0.8); S.add(rim); S.add(rim.target);
    // présentateur(s)
    if (mag) {
      this.cast.add(0, SUIT('#1e2a24', { skin: 0.18, hair: '#2a2018', hairStyle: 0, beard: 0, height: 1.82 }, { shirt2: '#dcdcdc' }), -0.9, -0.95, 0.12);
      this.cast.add(1, SUIT('#2b2b33', { skin: 0.55, hair: '#151515', hairStyle: 2, beard: 1, height: 1.86 }, { shirt2: '#c9d6e6' }), 0.9, -0.95, -0.12);
    } else this.cast.add(0, SUIT('#18202e', { skin: 0.22, hair: '#3a2c22', hairStyle: 1, beard: 0, height: 1.83 }), 0, -0.95, 0);
    this.drawDeskLogo(this.opts.title || 'LE 20H');
  }

  drawDeskLogo(title) {
    const [c1, c2] = this.palette;
    this.deskLogo.draw((g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, '#05070d'); grd.addColorStop(0.5, '#10182a'); grd.addColorStop(1, '#05070d');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.fillStyle = c1; g.fillRect(0, h - 10, w, 10);
      g.font = 'italic 900 92px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#ffffff'; g.fillText('★ ÉTOILE', w * 0.5, h * 0.4);
      g.font = 'bold 44px Arial'; g.fillStyle = c2; g.fillText(title.toUpperCase(), w * 0.5, h * 0.78);
    });
  }

  // ---------------- Plateau du jeu ----------------
  buildQuiz() {
    const S = this.scene;
    S.background = new THREE.Color(0x020108);
    S.fog = new THREE.Fog(0x020108, 18, 40);
    // scène circulaire noire laquée et anneaux LED
    const floor = new THREE.Mesh(new THREE.CircleGeometry(10, 96), mat({ color: 0x050308, roughness: 0.18, clearcoat: 1, metalness: 0.4 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
    const outer = new THREE.Mesh(new THREE.CircleGeometry(30, 32), mat({ color: 0x07060c, roughness: 0.6 })); outer.rotation.x = -Math.PI / 2; outer.position.y = -0.01; S.add(outer);
    this.rings = [];
    for (let k = 0; k < 6; k++) {
      const m = emis('#5e35b1', 1.5);
      const ring = new THREE.Mesh(new THREE.RingGeometry(2 + k * 1.4, 2.06 + k * 1.4, 128), m);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004; S.add(ring); this.rings.push(ring);
    }
    // marches lumineuses vers le fond
    for (let k = 0; k < 3; k++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(12 - k * 2, 0.25, 1), mat({ color: 0x0a0812, roughness: 0.3, clearcoat: 1 }));
      step.position.set(0, 0.125 + k * 0.25, -4.5 - k * 0.9); S.add(step);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(12 - k * 2, 0.03, 0.03), emis('#00e5ff', 2)); edge.position.set(0, 0.26 + k * 0.25, -4.0 - k * 0.9); S.add(edge);
      this.rings.push(edge);
    }
    // grand mur LED incurvé
    this.wall = new Screen(2048, 640);
    this.wall.tex.wrapS = THREE.RepeatWrapping; this.wall.tex.repeat.x = -1;
    const wg = new THREE.CylinderGeometry(13, 13, 7, 64, 1, true, Math.PI - 0.62, 1.24);
    const wall = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ map: this.wall.tex, side: THREE.BackSide, color: 0xb0b0b0 }));
    wall.position.set(0, 4.2, 6.5); S.add(wall);
    // pupitres des candidats (en arc), écran nominatif + couronne lumineuse
    this.pods = [];
    const xs = [-3.4, 0, 3.4];
    xs.forEach((x, i) => {
      const z = -1.6 + Math.abs(x) * 0.18;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.5, 1.05, 6), mat({ color: 0x15121f, roughness: 0.25, clearcoat: 1, metalness: 0.3 }));
      body.position.y = 0.525; body.rotation.y = Math.PI / 6; body.castShadow = true; g.add(body);
      const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.03, 8, 6), emis('#ffffff', 2.5));
      topRing.rotation.x = Math.PI / 2; topRing.rotation.z = Math.PI / 6; topRing.position.y = 1.06; g.add(topRing);
      const scr = new Screen(512, 256);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshBasicMaterial({ map: scr.tex, toneMapped: false }));
      panel.position.set(0, 0.6, 0.55); panel.rotation.x = -0.05; g.add(panel);
      const baseRing = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.8, 6), emis('#ffffff', 1.5)); baseRing.rotation.x = -Math.PI / 2; baseRing.rotation.z = Math.PI / 6; baseRing.position.y = 0.01; g.add(baseRing);
      g.position.set(x, 0, z); g.rotation.y = -x * 0.08;
      S.add(g);
      this.pods.push({ g, topRing, baseRing, scr, x, z, key: '' });
    });
    // pupitre de l'animateur
    const hp = new THREE.Group();
    const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.3, 1.1, 24, 1, false, 0, Math.PI * 1.5), mat({ color: 0x8a86a0, roughness: 0.3, clearcoat: 1, metalness: 0.3 }));
    hb.position.y = 0.55; hb.rotation.y = Math.PI * 0.75; hp.add(hb);
    const hl = new THREE.Mesh(new THREE.TorusGeometry(0.39, 0.02, 6, 32), emis('#ffd54f', 2.5)); hl.rotation.x = Math.PI / 2; hl.position.y = 1.1; hp.add(hl);
    hp.position.set(4.25, 0, 2.35); S.add(hp);
    // gradins du public (de part et d'autre, face au plateau)
    const seats = [];
    for (const sx of [-1, 1]) for (let row = 0; row < 6; row++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.5, 13), mat({ color: 0x0c0a14, roughness: 0.7 }));
      tier.position.set(sx * (10 + row * 0.95), row * 0.5 + 0.25, 2.5); tier.rotation.y = sx * 0.12; S.add(tier);
      for (let k = 0; k < 16; k++) {
        const zz = -3.2 + k * 0.78;
        seats.push([sx * (10 + row * 0.95) - sx * Math.sin(0.12) * (zz - 2.5) * 0, row * 0.5 + 0.5, zz, sx > 0 ? -Math.PI / 2 - 0.12 : Math.PI / 2 + 0.12]);
      }
    }
    const body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.22, 0.4, 4, 8), new THREE.MeshStandardMaterial({ roughness: 0.8 }), seats.length);
    const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.6 }), seats.length);
    const cols = ['#9e9e9e', '#263238', '#1e4f8f', '#8e1b1b', '#212121', '#5d4037', '#5f7f99', '#8f6b78', '#2e5d31'].map(c => new THREE.Color(c));
    const skins = ['#c9a080', '#b48a5c', '#a06c3a', '#704521', '#4a2f19'].map(c => new THREE.Color(c));
    const o = new THREE.Object3D();
    seats.forEach(([x, y, z, a], i) => {
      o.position.set(x, y + 0.42, z); o.rotation.set(0, a, 0); o.updateMatrix(); body.setMatrixAt(i, o.matrix); body.setColorAt(i, cols[(i * 7) % cols.length]);
      o.position.y += 0.47; o.updateMatrix(); head.setMatrixAt(i, o.matrix); head.setColorAt(i, skins[(i * 3) % skins.length]);
    });
    S.add(body); S.add(head);
    this.crowd = { body, head, seats, o };
    // structure (truss) et projecteurs motorisés avec faisceaux
    const trussM = mat({ color: 0x9e9e9e, metalness: 0.9, roughness: 0.35 });
    for (const z of [-3, 3]) { const t = new THREE.Mesh(new THREE.BoxGeometry(18, 0.3, 0.3), trussM); t.position.set(0, 8.5, z); S.add(t); }
    this.beams = [];
    const beamGeo = new THREE.ConeGeometry(0.75, 8.5, 20, 1, true); beamGeo.translate(0, -4.5, 0);
    for (let k = 0; k < 8; k++) {
      const x = -7 + k * 2, z = k % 2 ? -3 : 3;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.45, 12), mat({ color: 0x111111, metalness: 0.6 })); head.position.set(x, 8.2, z); S.add(head);
      const m = new THREE.MeshBasicMaterial({ color: 0x7c4dff, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(beamGeo, m); beam.position.set(x, 8.1, z); S.add(beam);
      this.beams.push({ beam, m, k });
    }
    // éclairage
    S.add(new THREE.HemisphereLight(0x9a8cff, 0x0a0614, 0.4));
    const key = new THREE.SpotLight(0xfff0e0, 160, 40, 0.5, 0.5, 1.5); key.position.set(0, 9, 9); key.target.position.set(0, 1, -0.5);
    key.castShadow = this.quality !== 'low'; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0005; S.add(key); S.add(key.target);
    const hostKey = new THREE.SpotLight(0xffffff, 70, 25, 0.35, 0.5, 1.5); hostKey.position.set(7, 7, 7); hostKey.target.position.set(4.6, 1.2, 2.6); S.add(hostKey); S.add(hostKey.target);
    this.mood = new THREE.PointLight(0x7c4dff, 14, 25, 1.5); this.mood.position.set(0, 5.5, -6); S.add(this.mood);
    // animateur et candidats
    const hlook = this.opts.host?.look || { skin: 0.25, hair: '#4a3b30', hairStyle: 1, beard: 0, height: 1.84 };
    this.cast.add(0, SUIT('#20123a', hlook, { shirt2: '#d6d6d6' }), 4.65, 2.05, -0.95);
    (this.opts.cands || []).forEach((c, i) => {
      const p = this.pods[i];
      this.cast.add(1 + i, {
        shirt: c.shirt, shorts: '#22252b', socks: '#22252b', skin: c.look.skin, hair: c.look.hair, hairStyle: c.look.hairStyle, beard: c.look.beard, height: c.look.height,
        number: 0, numColor: c.shirt, official: true, sponsor: -1, trim: c.shirt, boot: '#3a2a1a', trousers: true, longSleeves: i !== 1, pattern: 0,
      }, p.x, p.z - 0.62, -p.x * 0.08);
    });
    this.quizState = { lights: 'idle', active: -1, flash: 0 };
  }

  // texte du pupitre d'un candidat
  setPodium(i, name, score, state) {
    const p = this.pods?.[i];
    if (!p) return;
    const key = `${name}|${score}|${state}`;
    if (p.key === key) return;
    p.key = key;
    const col = state === 'buzz' ? '#ffd600' : state === 'ok' ? '#00e676' : state === 'ko' ? '#ff1744' : state === 'out' ? '#424242' : '#7c4dff';
    p.scr.draw((g, w, h) => {
      g.fillStyle = '#05030a'; g.fillRect(0, 0, w, h);
      const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, col); grd.addColorStop(1, '#05030a');
      g.globalAlpha = state === 'out' ? 0.3 : 0.55; g.fillStyle = grd; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 54px Arial'; g.fillStyle = state === 'out' ? '#777' : '#fff'; g.fillText(name.toUpperCase(), w / 2, h * 0.3, w * 0.9);
      g.font = '900 96px Arial Black, Arial'; g.fillStyle = state === 'out' ? '#555' : col === '#7c4dff' ? '#ffffff' : col; g.fillText(String(score), w / 2, h * 0.7);
    });
    const c = new THREE.Color(col);
    p.topRing.material.emissive.copy(c); p.baseRing.material.emissive.copy(c);
    p.topRing.material.emissiveIntensity = state === 'out' ? 0.2 : 2.5;
  }

  resize(w, h) {
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.portrait = w < h;
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
  }

  shotFor(shot) {
    const t = this.shotT;
    const P = (x, y, z) => new THREE.Vector3(x, y, z);
    if (this.mode === 'quiz') {
      const pods = this.pods;
      if (shot === 'host') return [P(2.2 - t * 0.02, 1.7, 5.6), P(4.65, 1.5, 2.05), 24];
      if (shot === 'cands') return [P(0, 2.2, 6.5 - t * 0.03), P(0, 1.2, -1.4), 38];
      if (shot && shot.startsWith('cand')) { const p = pods[+shot.slice(4)]; return [P(p.x * 0.75 - 0.4, 1.72, p.z + 3.2 - t * 0.02), P(p.x, 1.5, p.z - 0.6), 24]; }
      if (shot === 'cands') return [P(0, 2.2, 6.5 - t * 0.03), P(0, 1.2, -1.4), 38];
      if (shot === 'top') { const a = t * 0.05; return [P(Math.sin(a) * 9, 9.5, Math.cos(a) * 9), P(0, 0, 0), 46]; }
      const a = Math.sin(t * 0.08) * 0.45;
      return [P(Math.sin(a) * 11, 3.6 + Math.sin(t * 0.11) * 0.6, 3 + Math.cos(a) * 9), P(0.6, 1.3, -0.6), 42];
    }
    const mag = this.mode === 'mag';
    if (shot === 'p0' && mag) return [P(-0.5, 1.35, 2.3), P(-0.9, 1.25, -0.95), 30];
    if (shot === 'p1' && mag) return [P(0.5, 1.35, 2.3), P(0.9, 1.25, -0.95), 30];
    if (shot === 'anchor') return [P(0.15 * Math.sin(t * 0.1), 1.35, 2.6 - t * 0.01), P(0, 1.28, -0.95), 30];
    if (shot === 'close') return [P(0.25, 1.35, 1.9), P(0, 1.36, -0.95), 22];
    if (shot === 'side') return [P(3.8, 1.7, 3.0), P(-0.6, 1.4, -1.6), 36];
    return [P(Math.sin(t * 0.06) * 1.5, 2.1, 7.6 - Math.min(1.5, t * 0.04)), P(0, 1.6, -1.2), 38];
  }

  // st : { shot, talk: index qui parle, poses: {i: mode}, lights, flash }
  render(dt, st = {}) {
    this.t += dt;
    if (st.shot !== this.lastShot) { this.lastShot = st.shot; this.shotT = 0; this.cut = true; }
    this.shotT += dt;
    const [pos, look, fov] = this.shotFor(st.shot);
    const f = this.portrait ? fov * 1.35 : fov;
    if (this.cut) { this.cam.pos.copy(pos); this.cam.look.copy(look); this.cut = false; }
    else { this.cam.pos.lerp(pos, Math.min(1, dt * 2)); this.cam.look.lerp(look, Math.min(1, dt * 2)); }
    this.camera.position.copy(this.cam.pos); this.camera.lookAt(this.cam.look);
    if (Math.abs(this.camera.fov - f) > 0.05) { this.camera.fov = f; this.camera.updateProjectionMatrix(); }
    const poses = st.poses || {};
    if (this.mode === 'quiz') {
      this.cast.update(dt, (i, r, t) => {
        if (i === 0) standing(r, t, { mode: 'host', talk: st.talk === 0, seed: 1, look: st.hostLook ?? 0 });
        else standing(r, t, { mode: poses[i] || 'podium', talk: st.talk === i, seed: i * 2.3 });
      });
      this.animateQuiz(dt, st);
    } else {
      this.cast.update(dt, (i, r, t) => seated(r, t, st.talk === i, i * 1.7 + 0.4));
    }
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }

  animateQuiz(dt, st) {
    const t = this.t;
    const L = st.lights || 'idle';
    const col = L === 'ok' ? 0x00e676 : L === 'ko' ? 0xff1744 : L === 'tension' ? 0xff6d00 : L === 'gold' ? 0xffd600 : L === 'buzz' ? 0xffea00 : 0x7c4dff;
    const c = new THREE.Color(col);
    this.rings.forEach((r, k) => {
      r.material.emissive.lerp(c, Math.min(1, dt * 4));
      r.material.emissiveIntensity = 1.1 + 0.9 * Math.max(0, Math.sin(t * (L === 'tension' ? 9 : 2.2) - k * 0.7));
    });
    this.mood.color.lerp(c, Math.min(1, dt * 3));
    for (const b of this.beams) {
      const sp = L === 'tension' ? 1.6 : L === 'gold' || L === 'ok' ? 2.2 : 0.5;
      b.beam.rotation.set(Math.sin(t * sp * 0.7 + b.k) * 0.5, 0, Math.cos(t * sp * 0.5 + b.k * 1.3) * 0.55);
      b.m.color.lerp(b.k % 3 === 0 ? new THREE.Color(0xffffff) : c, Math.min(1, dt * 3));
      b.m.opacity = L === 'ok' || L === 'gold' ? 0.07 + 0.04 * Math.max(0, Math.sin(t * 12 + b.k)) : 0.045;
    }
    // public : applaudissements (petits sauts)
    const cr = this.crowd;
    if (st.applause || cr.was) {
      cr.was = !!st.applause;
      cr.seats.forEach(([x, y, z, a], i) => {
        const j = st.applause ? Math.max(0, Math.sin(t * 14 + i * 1.7)) * 0.05 : 0;
        cr.o.position.set(x, y + 0.42 + j, z); cr.o.rotation.set(0, a, 0); cr.o.updateMatrix(); cr.body.setMatrixAt(i, cr.o.matrix);
        cr.o.position.y += 0.47; cr.o.updateMatrix(); cr.head.setMatrixAt(i, cr.o.matrix);
      });
      cr.body.instanceMatrix.needsUpdate = true; cr.head.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.env.dispose();
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); });
  }
}
