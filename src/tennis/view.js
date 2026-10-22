// Court central de tennis en 3D : surface dure, filet, chaise d'arbitre,
// tribunes, joueurs avec raquettes, caméra de télévision.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Players } from '../football/players.js';
import { canvasTex } from '../football/stadium.js';
import { ENT, SNAP_LEN } from '../football/engine.js';
import { TL, TW, NET_H, TDT } from './engine.js';
import { RNG, clamp } from '../core/rng.js';

function courtTex(name) {
  return canvasTex(2048, 1024, (g, w, h) => {
    const sx = w / 40, sy = h / 20; // 40 m x 20 m
    const X = (x) => (x + 20) * sx, Y = (y) => (y + 10) * sy;
    g.fillStyle = '#2f6e4f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a5d9a'; g.fillRect(X(-TL - 0.1), Y(-5.6), (2 * TL + 0.2) * sx, 11.2 * sy);
    for (let i = 0; i < 20000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.strokeStyle = '#f5f5f5'; g.lineWidth = 0.05 * sx;
    const L = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(X(x1), Y(y1)); g.lineTo(X(x2), Y(y2)); g.stroke(); };
    L(-TL, -5.485, TL, -5.485); L(-TL, 5.485, TL, 5.485);
    L(-TL, -TW, TL, -TW); L(-TL, TW, TL, TW);
    L(-TL, -5.485, -TL, 5.485); L(TL, -5.485, TL, 5.485);
    L(-6.4, -TW, -6.4, TW); L(6.4, -TW, 6.4, TW); L(-6.4, 0, 6.4, 0);
    L(-TL, 0, -TL + 0.15, 0); L(TL, 0, TL - 0.15, 0);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = `bold ${Math.round(1.3 * sy)}px Arial`; g.textAlign = 'center';
    g.save(); g.translate(X(-TL - 3.2), Y(0)); g.rotate(Math.PI / 2); g.fillText(name.toUpperCase(), 0, 0); g.restore();
    g.save(); g.translate(X(TL + 3.2), Y(0)); g.rotate(-Math.PI / 2); g.fillText(name.toUpperCase(), 0, 0); g.restore();
  }, { aniso: 8 });
}

export class TennisView {
  constructor(renderer, info, quality) {
    this.renderer = renderer;
    const scene = (this.scene = new THREE.Scene());
    const night = info.night;
    if (night) scene.background = new THREE.Color(0x070b16);
    else {
      const sky = new Sky(); sky.scale.setScalar(500);
      const u = sky.material.uniforms; u.turbidity.value = 4; u.rayleigh.value = 1.3;
      u.sunPosition.value.setFromSphericalCoords(1, THREE.MathUtils.degToRad(45), THREE.MathUtils.degToRad(150));
      scene.add(sky);
    }
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.3; pm.dispose();
    scene.add(new THREE.HemisphereLight(0xdfefff, 0x3a4a3a, night ? 0.5 : 0.6));
    const key = new THREE.DirectionalLight(0xfff3e0, night ? 2.2 : 2.6);
    key.position.set(-20, 50, 25); key.castShadow = quality !== 'low';
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -25, right: 25, top: 18, bottom: -18, near: 5, far: 120 });
    key.shadow.bias = -0.0005;
    scene.add(key);
    const court = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshStandardMaterial({ map: courtTex(info.tournament), roughness: 0.7 }));
    court.rotation.x = -Math.PI / 2; court.receiveShadow = true; scene.add(court);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x1d2a22 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; scene.add(floor);
    // filet
    const netTex = canvasTex(256, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(20,20,20,0.9)'; g.lineWidth = 2;
      for (let x = 0; x < w; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y < h; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, 8);
    });
    netTex.wrapS = THREE.RepeatWrapping; netTex.repeat.set(12, 1);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(12.8, NET_H), new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
    net.rotation.y = Math.PI / 2; net.position.set(0, NET_H / 2, 0); scene.add(net);
    const postM = new THREE.MeshStandardMaterial({ color: 0x1b5e20, metalness: 0.4, roughness: 0.4 });
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.07, 10), postM); p.position.set(0, 0.535, s * 6.4); p.castShadow = true; scene.add(p); }
    // chaise d'arbitre
    const chair = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ color: 0x1b5e20 });
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.0, 0.8), cm); legs.position.y = 1.0; chair.add(legs);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 1), cm); seat.position.y = 2.1; chair.add(seat);
    chair.position.set(0, 0, -6.9); scene.add(chair);
    // panneaux de fond de court
    const adTex = canvasTex(1024, 128, (g, w, h) => {
      g.fillStyle = '#0d3b66'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'italic 900 76px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(`${info.tournament.toUpperCase()} · TENNIS+`, w / 2, h / 2, w - 30);
    });
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(18, 1.6), new THREE.MeshBasicMaterial({ map: adTex }));
      b.position.set(s * 18.5, 0.8, 0); b.rotation.y = -s * Math.PI / 2; scene.add(b);
    }
    // tribunes + public
    const rng = new RNG('tennis-tribunes');
    const tierM = new THREE.MeshStandardMaterial({ color: 0x23312a, roughness: 0.9 });
    const seats = [];
    const sides = [{ len: 38, off: 11, ax: 'z', s: 1 }, { len: 38, off: 11, ax: 'z', s: -1 }, { len: 18, off: 21, ax: 'x', s: 1 }, { len: 18, off: 21, ax: 'x', s: -1 }];
    for (const sd of sides) for (let r = 0; r < 16; r++) {
      const d = sd.off + r * 0.9, y = 0.5 + r * 0.55, L = sd.len + r * 1.6;
      const box = new THREE.Mesh(new THREE.BoxGeometry(sd.ax === 'z' ? L : 0.9, 0.55, sd.ax === 'z' ? 0.9 : L), tierM);
      if (sd.ax === 'z') box.position.set(0, y, sd.s * d); else box.position.set(sd.s * d, y, 0);
      scene.add(box);
      for (let u = -L / 2 + 0.3; u < L / 2; u += 0.62) {
        if (!rng.chance(0.88)) continue;
        if (sd.ax === 'z') seats.push([u, y + 0.27, sd.s * d, 0, sd.s]); else seats.push([sd.s * d, y + 0.27, u, sd.s, 0]);
      }
    }
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.72, 0.3).translate(0, 0.36, 0), new THREE.MeshStandardMaterial({ roughness: 0.9 }), seats.length);
    const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.7 }), seats.length);
    const o = new THREE.Object3D();
    const cols = ['#ffffff', '#f5f5dc', '#1565c0', '#d32f2f', '#212121', '#ffd600', '#90caf9', '#a5d6a7'].map(c => new THREE.Color(c));
    const skins = ['#f1c9a5', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e'].map(c => new THREE.Color(c));
    seats.forEach(([x, y, z, nx, nz], i) => {
      o.position.set(x, y, z); o.rotation.set(0, Math.atan2(-nx, -nz), 0); o.updateMatrix(); body.setMatrixAt(i, o.matrix); body.setColorAt(i, rng.pick(cols));
      o.position.y += 0.86; o.updateMatrix(); head.setMatrixAt(i, o.matrix); head.setColorAt(i, rng.pick(skins));
    });
    scene.add(body); scene.add(head);
    this.crowd = { body, head, seats };
    // joueurs
    this.players = new Players(scene, quality);
    this.players.ball.visible = false;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd4f53c, roughness: 0.8, emissive: 0x2a3300 }));
    this.ball.castShadow = true; scene.add(this.ball);
    const rack = () => {
      const g = new THREE.Group();
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.25, 8), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      handle.position.y = -0.1; g.add(handle);
      const head = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 6, 24), new THREE.MeshStandardMaterial({ color: info.rackColor || 0xd32f2f, metalness: 0.3, roughness: 0.4 }));
      head.scale.set(0.82, 1.05, 1); head.position.y = -0.36; g.add(head);
      const str = new THREE.Mesh(new THREE.CircleGeometry(0.125, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
      str.scale.set(0.82, 1.05, 1); str.position.y = -0.36; g.add(str);
      scene.add(g); return g;
    };
    this.rackets = [rack(), rack()];
    this.camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.3, 1200);
    this.cam = { pos: new THREE.Vector3(-26, 9.5, 0), look: new THREE.Vector3(2, 0, 0) };
    this.t = 0;
  }

  setRoster(m) {
    m.pl.forEach((p, k) => {
      const d = p.d;
      this.players.setMeta(k * 11, {
        shirt: d.kit[0], shorts: d.kit[1] === '#ffffff' ? '#f5f5f5' : '#1b1b1b', socks: '#ffffff', skin: d.look.skin, hair: d.look.hairColor, hairStyle: d.look.hairStyle,
        beard: d.look.beard, height: d.height, number: 0, numColor: d.kit[0], boot: '#f5f5f5', sponsor: -1, official: true, trim: d.kit[1], pattern: 0,
      });
    });
    this.players.setMeta(22, { shirt: '#1a237e', shorts: '#263238', socks: '#263238', skin: 0.3, hair: '#222', hairStyle: 1, height: 1.8, number: 0, numColor: '#1a237e', official: true, sponsor: -1 });
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  render(dt, m, target, st = {}) {
    this.t += dt;
    const ring = m.ring;
    const i1 = (m.ringPos - 1 + 4) % 4, i0 = (m.ringPos - 2 + 4) % 4;
    const A = ring.subarray(i0 * SNAP_LEN, (i0 + 1) * SNAP_LEN), B = ring.subarray(i1 * SNAP_LEN, (i1 + 1) * SNAP_LEN);
    const alpha = clamp(1 - (m.wall - target) / TDT, 0, 1);
    this.players.update(A, B, alpha, dt, { hideBall: true });
    // raquettes dans la main droite (ou gauche pour les gauchers)
    m.pl.forEach((p, k) => {
      const rig = this.players.rigs[k * 11];
      const hand = p.d.hand === 'gaucher' ? rig.hdL : rig.hdR;
      hand.updateMatrixWorld(true);
      this.rackets[k].matrix.copy(hand.matrixWorld);
      this.rackets[k].matrix.decompose(this.rackets[k].position, this.rackets[k].quaternion, this.rackets[k].scale);
    });
    const bo = 25 * ENT;
    if (B[bo] > 9000) this.ball.visible = false;
    else {
      this.ball.visible = true;
      const ax = A[bo] > 9000 ? B[bo] : A[bo];
      this.ball.position.set(ax + (B[bo] - ax) * alpha, Math.max(0.1, A[bo + 2] + (B[bo + 2] - A[bo + 2]) * alpha), A[bo + 1] + (B[bo + 1] - A[bo + 1]) * alpha);
    }
    // caméra TV derrière le fond de court (plans larges et ralentis de côté)
    let pos, look, fov = 36;
    if (st.camMode === 'aerial') { const a = this.t * 0.06; pos = new THREE.Vector3(Math.cos(a) * 30, 18, Math.sin(a) * 22); look = new THREE.Vector3(0, 0, 0); fov = 45; }
    else if (st.camMode === 'side') { pos = new THREE.Vector3(this.ball.position.x * 0.5, 3, 15); look = new THREE.Vector3(this.ball.position.x * 0.6, 1, 0); fov = 50; }
    else { pos = new THREE.Vector3(-31, 11.5, this.ball.position.z * 0.15); look = new THREE.Vector3(0, 0, this.ball.position.z * 0.2); fov = 34; }
    this.cam.pos.lerp(pos, Math.min(1, dt * 3)); this.cam.look.lerp(look, Math.min(1, dt * 3));
    this.camera.position.copy(this.cam.pos); this.camera.lookAt(this.cam.look);
    if (Math.abs(this.camera.fov - fov) > 0.1) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.scene.environment) this.scene.environment.dispose();
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); });
  }
}
