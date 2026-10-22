// Salle de basket 3D : parquet, paniers, tribunes, écran géant suspendu.
import * as THREE from 'three';
import { Players } from '../football/players.js';
import { canvasTex } from '../football/stadium.js';
import { ENT, SNAP_LEN } from '../football/engine.js';
import { CL, CW, HOOP_X, RIM_H, BDT } from './engine.js';
import { RNG, clamp } from '../core/rng.js';

function courtTexture(home) {
  return canvasTex(2048, 1100, (g, w, h) => {
    const sx = w / 32, sy = h / 17; // marges de 2 m autour (28 x 15)
    const X = (x) => (x + 16) * sx, Y = (y) => (y + 8.5) * sy;
    // parquet
    for (let i = 0; i < 90; i++) {
      const y0 = (i * h) / 90;
      const tone = 180 + ((i * 37) % 23);
      g.fillStyle = `rgb(${tone + 30},${tone - 20},${tone - 90})`;
      g.fillRect(0, y0, w, h / 90 + 1);
      g.fillStyle = 'rgba(0,0,0,0.08)';
      for (let k = 0; k < 6; k++) g.fillRect(((i * 131 + k * 397) % w), y0, 2, h / 90);
    }
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, 0, w, h);
    // hors-terrain couleur club
    g.fillStyle = home.colors[0];
    g.fillRect(0, 0, w, Y(-7.5)); g.fillRect(0, Y(7.5), w, h - Y(7.5)); g.fillRect(0, 0, X(-14), h); g.fillRect(X(14), 0, w - X(14), h);
    // raquettes
    g.fillStyle = home.colors[0];
    g.globalAlpha = 0.85;
    g.fillRect(X(-14), Y(-2.45), 5.8 * sx, 4.9 * sy); g.fillRect(X(14 - 5.8), Y(-2.45), 5.8 * sx, 4.9 * sy);
    g.globalAlpha = 1;
    g.strokeStyle = '#fff'; g.lineWidth = 6;
    g.strokeRect(X(-14), Y(-7.5), 28 * sx, 15 * sy);
    g.beginPath(); g.moveTo(X(0), Y(-7.5)); g.lineTo(X(0), Y(7.5)); g.stroke();
    g.beginPath(); g.ellipse(X(0), Y(0), 1.8 * sx, 1.8 * sy, 0, 0, Math.PI * 2); g.stroke();
    for (const s of [-1, 1]) {
      const hx = s * HOOP_X;
      g.strokeRect(s < 0 ? X(-14) : X(14 - 5.8), Y(-2.45), 5.8 * sx, 4.9 * sy);
      g.beginPath(); g.ellipse(X(s * (14 - 5.8)), Y(0), 1.8 * sx, 1.8 * sy, 0, 0, Math.PI * 2); g.stroke();
      // ligne à 3 points
      g.beginPath();
      const a = Math.acos(6.6 / 6.75);
      g.moveTo(X(s * 14), Y(-6.6)); g.lineTo(X(s * (14 - 2.99)), Y(-6.6));
      for (let t = -Math.PI / 2 + a; t <= Math.PI / 2 - a; t += 0.02) g.lineTo(X(hx - s * Math.cos(t) * 6.75), Y(Math.sin(t) * 6.75));
      g.lineTo(X(s * 14), Y(6.6));
      g.stroke();
    }
    // logo central
    g.fillStyle = home.colors[1]; g.globalAlpha = 0.85;
    g.font = `bold ${Math.round(1.1 * sy)}px Arial Black, Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(home.short, X(0), Y(0));
    g.globalAlpha = 1;
    g.fillStyle = '#fff'; g.font = `bold ${Math.round(0.7 * sy)}px Arial`;
    g.fillText('BASKET+ LIGUE PRO', X(0), Y(8.05));
    g.fillText(home.name.toUpperCase(), X(0), Y(-8.05));
  }, { aniso: 8 });
}

function hoop(scene, side) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
  post.position.set(side * (CL + 1.4), 1.7, 0); g.add(post);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 0.25), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
  arm.position.set(side * (CL + 0.7), 3.35, 0); g.add(arm);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0x1565c0 }));
  pad.position.set(side * (CL + 1.5), 0.6, 0); g.add(pad);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 1.8), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0 }));
  board.position.set(side * (CL - 1.2), RIM_H + 0.45, 0); g.add(board);
  const sq = new THREE.Mesh(new THREE.PlaneGeometry(0.59, 0.45), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }));
  sq.position.set(side * (CL - 1.225), RIM_H + 0.3, 0); sq.rotation.y = -side * Math.PI / 2; g.add(sq);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.012, 8, 32), new THREE.MeshStandardMaterial({ color: 0xff5722, metalness: 0.5, roughness: 0.4 }));
  rim.rotation.x = Math.PI / 2; rim.position.set(side * HOOP_X, RIM_H, 0); g.add(rim);
  const net = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.15, 0.42, 16, 3, true), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.8 }));
  net.position.set(side * HOOP_X, RIM_H - 0.21, 0); g.add(net);
  scene.add(g);
  return { rim, net };
}

export class BasketView {
  constructor(renderer, info, quality) {
    this.renderer = renderer;
    this.info = info;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x07080c);
    scene.fog = new THREE.Fog(0x07080c, 60, 140);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x332211, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 30, 10); key.castShadow = quality !== 'low';
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -20, right: 20, top: 14, bottom: -14, near: 5, far: 60 });
    scene.add(key);
    const spot = new THREE.SpotLight(0xffffff, 400, 60, 0.9, 0.5);
    spot.position.set(0, 25, 0); scene.add(spot); scene.add(spot.target);
    // parquet
    const court = new THREE.Mesh(new THREE.PlaneGeometry(32, 17), new THREE.MeshStandardMaterial({ map: courtTexture(info.home), roughness: 0.35, metalness: 0.05 }));
    court.rotation.x = -Math.PI / 2; court.receiveShadow = true; scene.add(court);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 90), new THREE.MeshStandardMaterial({ color: 0x15171c }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; scene.add(floor);
    this.hoops = [hoop(scene, 1), hoop(scene, -1)];
    // tribunes (rectangulaires, 4 côtés)
    const rng = new RNG('salle');
    const seats = [];
    const tierMat = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.9 });
    const sides = [
      { len: 36, off: CW + 4, axis: 'z', sign: 1 }, { len: 36, off: CW + 4, axis: 'z', sign: -1 },
      { len: 22, off: CL + 5, axis: 'x', sign: 1 }, { len: 22, off: CL + 5, axis: 'x', sign: -1 },
    ];
    for (const sd of sides) {
      for (let r = 0; r < 22; r++) {
        const d = sd.off + r * 0.9, y = 0.4 + r * 0.55;
        const box = new THREE.Mesh(new THREE.BoxGeometry(sd.axis === 'z' ? sd.len + r * 1.8 : 0.9, 0.55, sd.axis === 'z' ? 0.9 : sd.len + r * 1.8), tierMat);
        if (sd.axis === 'z') box.position.set(0, y, sd.sign * d); else box.position.set(sd.sign * d, y, 0);
        scene.add(box);
        const n = Math.floor((sd.len + r * 1.8) / 0.62);
        for (let i = 0; i < n; i++) {
          if (!rng.chance(0.9)) continue;
          const u = -((sd.len + r * 1.8) / 2) + (i + 0.5) * 0.62;
          if (sd.axis === 'z') seats.push({ x: u, y: y + 0.27, z: sd.sign * d, nx: 0, nz: sd.sign });
          else seats.push({ x: sd.sign * d, y: y + 0.27, z: u, nx: sd.sign, nz: 0 });
        }
      }
    }
    this.crowd = this.makeCrowd(scene, seats, info);
    // écran géant suspendu
    this.screenTex = canvasTex(512, 256, () => {});
    const cube = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.6), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
      sc.position.set(Math.sin(i * Math.PI / 2) * 2.5, 0, Math.cos(i * Math.PI / 2) * 2.5); sc.rotation.y = i * Math.PI / 2;
      cube.add(sc);
    }
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.9, 2.9, 4.9), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    cube.add(body);
    cube.position.set(0, 13, 0); scene.add(cube);
    // rampes lumineuses
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(40, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      strip.position.set(0, 20, s * 12); scene.add(strip);
    }
    this.players = new Players(scene, quality);
    this.players.ball.visible = false;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), new THREE.MeshStandardMaterial({ color: 0xd9601a, roughness: 0.7 }));
    const seams = new THREE.Mesh(new THREE.SphereGeometry(0.152, 12, 8), new THREE.MeshBasicMaterial({ color: 0x111111, wireframe: true }));
    this.ball.add(seams);
    this.ball.castShadow = true;
    scene.add(this.ball);
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.3, 300);
    this.cam = { pos: new THREE.Vector3(0, 8, 17), look: new THREE.Vector3() };
    this.t = 0;
  }

  makeCrowd(scene, seats, info) {
    const g = new THREE.BoxGeometry(0.42, 0.75, 0.3);
    g.translate(0, 0.37, 0);
    const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.9 }), seats.length);
    const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }), seats.length);
    const rng = new RNG('salle-foule');
    const cols = [info.home.colors[0], info.home.colors[1], '#ffffff', '#222222', info.away.colors[0]].map(c => new THREE.Color(c));
    const skins = ['#f1c9a5', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e'].map(c => new THREE.Color(c));
    const o = new THREE.Object3D();
    this.seatData = seats;
    seats.forEach((s, i) => {
      o.position.set(s.x, s.y, s.z); o.rotation.set(0, Math.atan2(-s.nx, -s.nz), 0); o.scale.setScalar(1); o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, rng.chance(0.55) ? cols[0] : rng.pick(cols));
      o.position.y += 0.88; o.updateMatrix(); head.setMatrixAt(i, o.matrix); head.setColorAt(i, rng.pick(skins));
      s.phase = rng.next() * 6.28;
    });
    scene.add(m); scene.add(head);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); head.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return { m, head, o };
  }

  setRoster(engine, kits) {
    for (let t = 0; t < 2; t++) {
      const kit = kits[t];
      for (let i = 0; i < 11; i++) {
        const idx = t * 11 + i;
        const p = engine.teams[t].players[i];
        if (!p) { this.players.meta[idx] = null; continue; }
        const d = p.d;
        this.players.setMeta(idx, {
          shirt: kit.shirt, shorts: kit.shirt, socks: '#ffffff', skin: d.look.skin, hair: d.look.hairColor, hairStyle: d.look.hairStyle,
          height: d.height, number: d.number, numColor: kit.num, gloves: null, boot: '#f5f5f5', tank: true,
        });
        // débardeur : bras nus
        const skin = this.players.meshes.forearm.getColorAt(idx * 2, new THREE.Color());
        this.players.meshes.sleeve.setColorAt(idx * 2, skin); this.players.meshes.sleeve.setColorAt(idx * 2 + 1, skin);
        this.players.meshes.sleeve.instanceColor.needsUpdate = true;
      }
    }
    const ref = { shirt: '#9e9e9e', shorts: '#111111', socks: '#111111', skin: 0.4, hair: '#222', hairStyle: 0, height: 1.82, number: 0, numColor: '#9e9e9e', official: true, sponsor: -1 };
    for (let i = 0; i < 3; i++) this.players.setMeta(22 + i, { ...ref, skin: [0.2, 0.6, 0.9][i] });
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  render(dt, engine, target, st = {}) {
    this.t += dt;
    const ring = engine.ring;
    const i1 = (engine.ringPos - 1 + 4) % 4, i0 = (engine.ringPos - 2 + 4) % 4;
    const A = ring.subarray(i0 * SNAP_LEN, (i0 + 1) * SNAP_LEN), B = ring.subarray(i1 * SNAP_LEN, (i1 + 1) * SNAP_LEN);
    const alpha = clamp(1 - (engine.wall - target) / BDT, 0, 1);
    this.players.camPos = this.camera.position; this.players.lodZoom = this.camera.fov / 40;
    this.players.update(A, B, alpha, dt, { hideBall: true });
    const bo = 25 * ENT;
    const bx = A[bo] + (B[bo] - A[bo]) * alpha, bz = A[bo + 1] + (B[bo + 1] - A[bo + 1]) * alpha, bh = A[bo + 2] + (B[bo + 2] - A[bo + 2]) * alpha;
    this.ball.position.set(bx, Math.max(0.15, bh), bz);
    this.ball.rotation.x += dt * 4; this.ball.rotation.z += dt * 2;
    // filets qui bougent sur un panier
    this.hoops.forEach(h => { h.net.scale.y += (1 - h.net.scale.y) * dt * 5; });
    if (st.swish != null) { this.hoops[st.swish].net.scale.y = 1.35; }
    // foule
    const exc = engine.excitement;
    if (Math.floor(this.t * 20) % 2 === 0) {
      const { m, head, o } = this.crowd;
      const jump = exc > 0.8 ? 0.18 : 0.02;
      this.seatData.forEach((s, i) => {
        const y = s.y + Math.max(0, Math.sin(this.t * 7 + s.phase)) * jump;
        o.position.set(s.x, y, s.z); o.rotation.set(0, Math.atan2(-s.nx, -s.nz), 0); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
        o.position.y += 0.88; o.updateMatrix(); head.setMatrixAt(i, o.matrix);
      });
      m.instanceMatrix.needsUpdate = true; head.instanceMatrix.needsUpdate = true;
    }
    // caméra
    const cam = this.cam;
    let pos, look, fov = 40;
    if (st.camMode === 'aerial') { const a = this.t * 0.08; pos = new THREE.Vector3(Math.cos(a) * 12, 8, Math.sin(a) * 8.5); look = new THREE.Vector3(0, 0.5, 0); fov = 55; }
    else { pos = new THREE.Vector3(clamp(bx * 0.55, -9, 9), 7.5, 17.5); look = new THREE.Vector3(clamp(bx, -12, 12) * 0.9, 1.2, clamp(bz * 0.4, -3, 3)); fov = 42; }
    cam.pos.lerp(pos, Math.min(1, dt * 2.5)); cam.look.lerp(look, Math.min(1, dt * 3.5));
    this.camera.position.copy(cam.pos); this.camera.lookAt(cam.look);
    if (Math.abs(this.camera.fov - fov) > 0.1) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 2); this.camera.updateProjectionMatrix(); }
    this.renderer.render(this.scene, this.camera);
  }

  drawScreen(engine, home, away) {
    const g = this.screenTex.ctx;
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#fff'; g.font = 'bold 44px Arial'; g.textAlign = 'center';
    g.fillText(home.short, 110, 70); g.fillText(away.short, 400, 70);
    g.fillStyle = '#ffeb3b'; g.font = 'bold 90px Arial';
    g.fillText(`${engine.score[0]}`, 110, 170); g.fillText(`${engine.score[1]}`, 400, 170);
    g.fillStyle = '#ff5252'; g.font = 'bold 46px Arial';
    g.fillText(engine.clockLabel(), 256, 130);
    g.fillStyle = '#fff'; g.font = '30px Arial'; g.fillText(`QT ${engine.quarter}`, 256, 200);
    this.screenTex.needsUpdate = true;
  }

  dispose() {
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); });
  }
}
