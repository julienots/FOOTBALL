// Circuit automobile en 3D : piste, vibreurs, barrières, tribunes, arbres,
// portique de départ, monoplaces aux couleurs des écuries, caméras TV.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTex } from '../football/stadium.js';
import { getTrack, RDT } from './engine.js';
import { RNG } from '../core/rng.js';

const W = 7; // demi-largeur de piste

function ribbon(S, off0, off1, y, uvScale, closed = true) {
  const pos = [], uv = [], idx = [];
  const N = S.length;
  let acc = 0;
  for (let i = 0; i <= N; i++) {
    const p = S[i % N];
    pos.push(p.x + p.nx * off0, y, p.z + p.nz * off0, p.x + p.nx * off1, y, p.z + p.nz * off1);
    uv.push(0, acc / uvScale, 1, acc / uvScale);
    acc += 2;
    if (i < N) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function wallGeo(S, off, h) {
  const pos = [], idx = [], N = S.length;
  for (let i = 0; i <= N; i++) { const p = S[i % N]; pos.push(p.x + p.nx * off, 0, p.z + p.nz * off, p.x + p.nx * off, h, p.z + p.nz * off); if (i < N) idx.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function carMesh(d) {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: d.colors[0], metalness: 0.5, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
  const trim = new THREE.MeshStandardMaterial({ color: d.colors[1], metalness: 0.3, roughness: 0.4 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5, metalness: 0.3 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.85 });
  const body = new THREE.Mesh(mergeGeometries([
    new THREE.BoxGeometry(0.9, 0.45, 2.6).translate(0, 0.45, -0.2),
    new THREE.CylinderGeometry(0.12, 0.42, 1.9, 10).rotateX(Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.38, 1.9),
    new THREE.BoxGeometry(1.5, 0.35, 1.5).translate(0, 0.4, -0.4),
    new THREE.BoxGeometry(0.5, 0.55, 1.2).translate(0, 0.75, -0.9),
  ].map(x => x.toNonIndexed())), paint);
  g.add(body);
  const fw = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.45), trim); fw.position.set(0, 0.15, 2.75); g.add(fw);
  const rw = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.4), trim); rw.position.set(0, 0.95, -2.1); g.add(rw);
  for (const sx of [-0.48, 0.48]) { const ep = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.5), carbon); ep.position.set(sx, 0.75, -2.1); g.add(ep); }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 3.6), carbon); floor.position.set(0, 0.12, -0.1); g.add(floor);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 6, 16, Math.PI), carbon); halo.rotation.set(-Math.PI / 2 + 0.25, 0, 0); halo.position.set(0, 0.8, 0.35); g.add(halo);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), new THREE.MeshStandardMaterial({ color: d.colors[1], roughness: 0.2, metalness: 0.2 })); helmet.position.set(0, 0.82, 0.2); g.add(helmet);
  const wheels = [];
  for (const [x, z, r] of [[-0.8, 1.55, 0.33], [0.8, 1.55, 0.33], [-0.82, -1.35, 0.36], [0.82, -1.35, 0.36]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.38, 16).rotateZ(Math.PI / 2), tyre);
    w.position.set(x, r, z); g.add(w); wheels.push(w);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData.wheels = wheels;
  return g;
}

export class RacingView {
  constructor(renderer, info, quality) {
    this.renderer = renderer;
    const T = (this.T = getTrack());
    const S = T.S;
    const scene = (this.scene = new THREE.Scene());
    const sky = new Sky(); sky.scale.setScalar(4000);
    const u = sky.material.uniforms; u.turbidity.value = 5; u.rayleigh.value = 1.5;
    u.sunPosition.value.setFromSphericalCoords(1, THREE.MathUtils.degToRad(55), THREE.MathUtils.degToRad(120));
    scene.add(sky);
    scene.fog = new THREE.Fog(0xb8cfe0, 400, 1600);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.5; pm.dispose();
    scene.add(new THREE.HemisphereLight(0xdfefff, 0x445533, 0.7));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.position.set(120, 200, 80); sun.castShadow = quality !== 'low';
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 600 });
    scene.add(sun); scene.add(sun.target);
    this.sun = sun;
    // herbe
    const grassTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#3f7a2c'; g.fillRect(0, 0, w, h); for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(${20 + Math.random() * 60},${80 + Math.random() * 60},20,0.25)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, { repeat: [200, 200] });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; scene.add(ground);
    // asphalte
    const asphalt = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#3a3c40'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) { const c = 40 + Math.random() * 40; g.fillStyle = `rgb(${c},${c},${c + 3})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
      g.fillStyle = 'rgba(20,20,20,0.35)'; g.fillRect(w * 0.3, 0, w * 0.4, h); // trajectoire gommée
      g.fillStyle = '#f5f5f5'; g.fillRect(2, 0, 5, h); g.fillRect(w - 7, 0, 5, h);
    }, { aniso: 8 });
    asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
    const road = new THREE.Mesh(ribbon(S, -W, W, 0.02, 14), new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.85 }));
    road.receiveShadow = true; scene.add(road);
    // vibreurs rouge/blanc dans les virages
    const kerbTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#d50000'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h / 2); });
    kerbTex.wrapS = kerbTex.wrapT = THREE.RepeatWrapping;
    const kS = S.map(p => p);
    const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.6 });
    for (let i = 0; i < S.length; i++) {
      if (Math.abs(S[i].k) < 0.008) continue;
      let j = i; while (j < S.length && Math.abs(S[j].k) >= 0.008) j++;
      const part = kS.slice(Math.max(0, i - 4), Math.min(S.length, j + 4));
      if (part.length > 3) {
        const side = S[Math.floor((i + j) / 2)].k > 0 ? 1 : -1;
        for (const sd of [side, -side]) {
          const geo = ribbon(part, sd > 0 ? W : -W - 1.2, sd > 0 ? W + 1.2 : -W, 0.03, 6, false);
          geo.index.array = geo.index.array.slice(0, (part.length - 1) * 6);
          const m = new THREE.Mesh(geo, kerbMat); m.receiveShadow = true; scene.add(m);
        }
      }
      i = j;
    }
    // bas-côtés en gravier et barrières
    const gravel = new THREE.MeshStandardMaterial({ color: 0xbfa77a, roughness: 1 });
    scene.add(new THREE.Mesh(ribbon(S, W + 1.2, W + 9, 0.01, 20), gravel));
    scene.add(new THREE.Mesh(ribbon(S, -W - 9, -W - 1.2, 0.01, 20), gravel));
    const barrierTex = canvasTex(256, 32, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#d50000' : '#f5f5f5'; g.fillRect(i * 32, 0, 32, h); } g.fillStyle = '#0d47a1'; g.font = 'bold 18px Arial'; g.fillText('MOTEUR+', 90, 22); });
    const bMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, side: THREE.DoubleSide });
    scene.add(new THREE.Mesh(wallGeo(S, W + 9.5, 1.1), bMat));
    scene.add(new THREE.Mesh(wallGeo(S, -W - 9.5, 1.1), bMat));
    // tribunes le long de la ligne droite des stands
    const rng = new RNG('circuit');
    const standM = new THREE.MeshStandardMaterial({ color: 0x8a939c, roughness: 0.8 });
    const seats = [];
    const addStand = (si, side, len) => {
      const p = S[si];
      const grp = new THREE.Group();
      for (let r = 0; r < 12; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.9), standM);
        step.position.set(0, 0.25 + r * 0.5, r * 0.9);
        grp.add(step);
        for (let x = -len / 2 + 0.4; x < len / 2; x += 0.6) if (rng.chance(0.85)) seats.push({ grp, x, y: 0.5 + r * 0.5, z: r * 0.9 });
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.2, 13), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.4 }));
      roof.position.set(0, 8.5, 5); grp.add(roof);
      grp.position.set(p.x + p.nx * side * (W + 11), 0, p.z + p.nz * side * (W + 11));
      grp.rotation.y = Math.atan2(p.nx * side, p.nz * side);
      scene.add(grp);
      return grp;
    };
    const stands = [addStand(60, 1, 120), addStand(60, -1, 60), addStand(Math.floor(S.length * 0.45), 1, 60), addStand(Math.floor(S.length * 0.7), -1, 50)];
    const pg = new THREE.BoxGeometry(0.42, 0.7, 0.3).translate(0, 0.35, 0);
    const crowd = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ roughness: 0.9 }), seats.length);
    const o = new THREE.Object3D();
    const cols = ['#d50000', '#0d47a1', '#ff6d00', '#ffffff', '#212121', '#ffd600', '#00bfa5'].map(c => new THREE.Color(c));
    seats.forEach((s, i) => {
      o.position.set(s.x, s.y, s.z); o.rotation.set(0, Math.PI, 0); o.updateMatrix();
      s.grp.updateMatrixWorld(); o.matrix.premultiply(s.grp.matrixWorld);
      crowd.setMatrixAt(i, o.matrix); crowd.setColorAt(i, rng.pick(cols));
    });
    scene.add(crowd);
    // portique de départ
    const g0 = S[0];
    const gantry = new THREE.Group();
    const gm = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5 });
    for (const sd of [-1, 1]) { const pole = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), gm); pole.position.set(sd * (W + 1.5), 4, 0); gantry.add(pole); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * W + 3.6, 1.6, 0.8), gm); beam.position.y = 8; gantry.add(beam);
    this.lights = [];
    for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), new THREE.MeshBasicMaterial({ color: 0x330000 })); l.position.set(-2.4 + i * 1.2, 8, 0.42); gantry.add(l); this.lights.push(l); }
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, 1.2), new THREE.MeshBasicMaterial({ map: canvasTex(512, 48, (g, w, h) => { g.fillStyle = '#0d47a1'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'italic 900 34px Arial'; g.textAlign = 'center'; g.fillText(info.circuit.toUpperCase(), w / 2, 36, w - 20); }) }));
    banner.position.set(0, 6.8, 0.42); gantry.add(banner);
    gantry.position.set(g0.x, 0, g0.z); gantry.rotation.y = Math.atan2(-g0.nz, g0.nx);
    scene.add(gantry);
    // ligne de départ en damier
    const chk = canvasTex(128, 16, (g, w, h) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#fff' : '#111'; g.fillRect(x * 8, y * 8, 8, 8); } });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, 1), new THREE.MeshStandardMaterial({ map: chk }));
    line.rotation.order = 'YXZ'; line.rotation.set(-Math.PI / 2, Math.atan2(-g0.nz, g0.nx), 0); line.position.set(g0.x, 0.035, g0.z);
    scene.add(line);
    // arbres
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 6).translate(0, 1.5, 0), new THREE.MeshStandardMaterial({ color: 0x5d4037 }), 260);
    const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 7, 8).translate(0, 6, 0), new THREE.MeshStandardMaterial({ color: 0x2e5e2a, roughness: 0.9 }), 260);
    let ti = 0;
    for (let k = 0; k < 600 && ti < 260; k++) {
      const p = S[rng.int(0, S.length - 1)];
      const off = (rng.chance(0.5) ? 1 : -1) * rng.range(28, 90);
      const x = p.x + p.nx * off, z = p.z + p.nz * off;
      if (S.some((q, i) => i % 10 === 0 && Math.hypot(q.x - x, q.z - z) < 22)) continue;
      o.position.set(x, 0, z); o.rotation.set(0, rng.range(0, 6), 0); o.scale.setScalar(rng.range(0.8, 1.5)); o.updateMatrix();
      trunk.setMatrixAt(ti, o.matrix); leaves.setMatrixAt(ti, o.matrix); ti++;
    }
    trunk.count = leaves.count = ti; leaves.castShadow = true;
    scene.add(trunk); scene.add(leaves);
    // voitures
    this.cars = new Map();
    for (const d of info.drivers) { const m = carMesh(d); scene.add(m); this.cars.set(d.id, m); }
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 5000);
    // caméras TV le long du circuit
    this.tvCams = [];
    for (let i = 0; i < S.length; i += Math.floor(S.length / 14)) {
      const p = S[i]; const sd = i % 2 ? 1 : -1;
      this.tvCams.push(new THREE.Vector3(p.x + p.nx * sd * 26, 7 + (i % 3) * 3, p.z + p.nz * sd * 26));
    }
    this.cam = { pos: new THREE.Vector3(0, 50, 50), look: new THREE.Vector3(), fov: 30, idx: -1, mode: 'tv', modeT: 0 };
    this.prev = new Map();
    this.t = 0;
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  carPose(c, sim) {
    const s = ((c.s % this.T.len) + this.T.len) % this.T.len;
    const i = Math.floor(s / this.T.step) % this.T.S.length;
    const p = this.T.S[i], q = this.T.S[(i + 1) % this.T.S.length];
    const f = (s - i * this.T.step) / this.T.step;
    const x = p.x + (q.x - p.x) * f + p.nx * c.lane, z = p.z + (q.z - p.z) * f + p.nz * c.lane;
    return { x, z, yaw: Math.atan2(p.tx, p.tz), p };
  }

  render(dt, sim, focus, st = {}) {
    this.t += dt;
    // positions (le moteur avance par pas de 50 ms ; on extrapole avec la vitesse)
    const extra = Math.max(0, Math.min(RDT, (st.target ?? sim.wall) - sim.wall + RDT));
    for (const c of sim.cars) {
      const m = this.cars.get(c.d.id);
      if (c.out) { m.visible = st.showOut !== false && false; continue; }
      m.visible = true;
      const pose = this.carPose({ s: c.s + c.v * extra, lane: c.lane }, sim);
      m.position.set(pose.x, 0, pose.z);
      m.rotation.y = pose.yaw;
      for (const w of m.userData.wheels) w.rotation.x += c.v * dt / 0.34;
    }
    // feux de départ
    const lit = sim.started ? 0 : Math.min(5, Math.floor((6 - sim.lightsT) / 0.9) + 1);
    this.lights.forEach((l, i) => l.material.color.setHex(i < lit ? 0xff1a1a : 0x330000));
    // réalisation
    const fm = focus && this.cars.get(focus.d.id);
    const cam = this.cam;
    cam.modeT -= dt;
    if (cam.modeT <= 0 && !st.camMode) {
      const r = Math.random();
      cam.mode = r < 0.55 ? 'tv' : r < 0.75 ? 'chase' : r < 0.88 ? 'onboard' : 'heli';
      cam.modeT = cam.mode === 'tv' ? 14 : 7;
      cam.idx = -1;
    }
    const mode = st.camMode || cam.mode;
    let pos, look, fov = 30;
    if (!fm || mode === 'aerial') {
      const a = this.t * 0.04; pos = new THREE.Vector3(Math.cos(a) * 520 + 80, 260, Math.sin(a) * 520 + 300); look = new THREE.Vector3(80, 0, 300); fov = 45;
    } else if (mode === 'chase') {
      const fwd = new THREE.Vector3(Math.sin(fm.rotation.y), 0, Math.cos(fm.rotation.y));
      pos = fm.position.clone().addScaledVector(fwd, -9).add(new THREE.Vector3(0, 3.2, 0)); look = fm.position.clone().addScaledVector(fwd, 8).add(new THREE.Vector3(0, 1, 0)); fov = 55;
    } else if (mode === 'onboard') {
      const fwd = new THREE.Vector3(Math.sin(fm.rotation.y), 0, Math.cos(fm.rotation.y));
      pos = fm.position.clone().addScaledVector(fwd, -0.4).add(new THREE.Vector3(0, 1.25, 0)); look = fm.position.clone().addScaledVector(fwd, 20).add(new THREE.Vector3(0, 0.6, 0)); fov = 70;
    } else if (mode === 'heli') {
      pos = fm.position.clone().add(new THREE.Vector3(40, 60, 40)); look = fm.position.clone(); fov = 32;
    } else {
      // caméra fixe la plus proche de la voiture suivie
      let best = 0, bd = 1e9;
      this.tvCams.forEach((c, i) => { const d = c.distanceTo(fm.position); if (d < bd) { bd = d; best = i; } });
      if (cam.idx !== best) { cam.idx = best; cam.pos.copy(this.tvCams[best]); cam.look.copy(fm.position); }
      pos = this.tvCams[best]; look = fm.position.clone().add(new THREE.Vector3(0, 0.5, 0));
      fov = Math.max(6, Math.min(40, 900 / Math.max(10, bd)));
    }
    const snap = mode !== 'tv' && mode !== 'aerial';
    if (snap) { cam.pos.copy(pos); cam.look.copy(look); }
    else { cam.pos.lerp(pos, Math.min(1, dt * 4)); cam.look.lerp(look, Math.min(1, dt * 6)); }
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
    this.camera.position.copy(cam.pos); this.camera.lookAt(cam.look);
    if (Math.abs(this.camera.fov - cam.fov) > 0.05) { this.camera.fov = cam.fov; this.camera.updateProjectionMatrix(); }
    if (fm) { this.sun.position.copy(fm.position).add(new THREE.Vector3(120, 200, 80)); this.sun.target.position.copy(fm.position); }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.scene.environment) this.scene.environment.dispose();
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); });
  }
}
