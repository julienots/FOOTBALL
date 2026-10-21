// Joueurs 3D : squelettes procéduraux animés (course, frappe, tête, plongeon,
// tacle, chute, célébration) rendus avec des InstancedMesh (peu d'appels GPU).
import * as THREE from 'three';
import { ENT, ACT } from './engine.js';
import { canvasTex } from './stadium.js';

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

class Rig {
  constructor() {
    const o = () => new THREE.Object3D();
    this.root = o(); this.pelvis = o(); this.torso = o(); this.head = o(); this.hair = o(); this.num = o();
    this.uaL = o(); this.uaR = o(); this.faL = o(); this.faR = o();
    this.thL = o(); this.thR = o(); this.shL = o(); this.shR = o(); this.ftL = o(); this.ftR = o();
    this.root.add(this.pelvis);
    this.pelvis.position.y = 0.98;
    this.pelvis.add(this.torso); this.torso.position.y = 0.06;
    this.torso.add(this.head); this.head.position.y = 0.62;
    this.head.add(this.hair); this.hair.position.y = 0.02;
    this.torso.add(this.num); this.num.position.set(0, 0.34, -0.155); this.num.rotation.y = Math.PI;
    this.torso.add(this.uaL); this.uaL.position.set(0.215, 0.5, 0);
    this.torso.add(this.uaR); this.uaR.position.set(-0.215, 0.5, 0);
    this.uaL.add(this.faL); this.faL.position.y = -0.3;
    this.uaR.add(this.faR); this.faR.position.y = -0.3;
    this.pelvis.add(this.thL); this.thL.position.set(0.1, -0.02, 0);
    this.pelvis.add(this.thR); this.thR.position.set(-0.1, -0.02, 0);
    this.thL.add(this.shL); this.shL.position.y = -0.46;
    this.thR.add(this.shR); this.shR.position.y = -0.46;
    this.shL.add(this.ftL); this.ftL.position.y = -0.44;
    this.shR.add(this.ftR); this.ftR.position.y = -0.44;
    this.phase = Math.random() * 6;
    this.yaw = 0;
  }
}

export class Players {
  constructor(scene, quality) {
    this.scene = scene;
    const std = (opts = {}) => new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, ...opts });
    const parts = {
      shorts: [new THREE.CylinderGeometry(0.155, 0.17, 0.27, 12).scale(1, 1, 0.8).translate(0, -0.09, 0), 1],
      torso: [capsule(0.16, 0.36, 10).translate(0, 0.62, 0).scale(1.18, 1, 0.78), 1],
      head: [new THREE.SphereGeometry(0.115, 14, 12).scale(0.92, 1.08, 1).translate(0, 0.1, 0), 1],
      hair: [new THREE.SphereGeometry(0.122, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0.11, -0.008), 1],
      sleeve: [capsule(0.058, 0.2, 8), 2],
      forearm: [capsule(0.045, 0.22, 8), 2],
      thigh: [capsule(0.075, 0.33, 8), 2],
      shin: [capsule(0.058, 0.33, 8), 2],
      boot: [new THREE.BoxGeometry(0.1, 0.07, 0.26).translate(0, -0.035, 0.06), 2],
      num: [new THREE.PlaneGeometry(0.24, 0.24), 1],
    };
    this.meshes = {};
    const numTex = numberAtlas();
    for (const [k, [geo, mult]] of Object.entries(parts)) {
      let mat;
      if (k === 'num') {
        mat = new THREE.MeshStandardMaterial({ map: numTex, transparent: true, alphaTest: 0.4, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
        mat.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aNum;')
            .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = (vMapUv + vec2(mod(aNum, 10.0), 9.0 - floor(aNum / 10.0))) / 10.0;\n#endif');
        };
        geo.setAttribute('aNum', new THREE.InstancedBufferAttribute(new Float32Array(N), 1));
      } else mat = std(k === 'boot' ? { roughness: 0.4 } : k === 'hair' ? { roughness: 0.9 } : {});
      const m = new THREE.InstancedMesh(geo, mat, N * mult);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = k !== 'num' && k !== 'hair' && quality !== 'low';
      m.frustumCulled = false;
      for (let i = 0; i < N * mult; i++) m.setColorAt(i, new THREE.Color(1, 1, 1));
      this.meshes[k] = m;
      scene.add(m);
    }
    this.rigs = Array.from({ length: N }, () => new Rig());
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

  // meta : { shirt, shorts, socks, skin, hair, hairStyle, height, number, boot }
  setMeta(i, meta) {
    this.meta[i] = meta;
    const set = (k, idx, col) => { this.meshes[k].setColorAt(idx, new THREE.Color(col)); this.meshes[k].instanceColor.needsUpdate = true; };
    set('torso', i, meta.shirt); set('sleeve', i * 2, meta.shirt); set('sleeve', i * 2 + 1, meta.shirt);
    set('shorts', i, meta.shorts);
    const skin = skinColor(meta.skin);
    set('head', i, skin); set('thigh', i * 2, skin); set('thigh', i * 2 + 1, skin);
    set('forearm', i * 2, meta.gloves || skin); set('forearm', i * 2 + 1, meta.gloves || skin);
    set('shin', i * 2, meta.socks); set('shin', i * 2 + 1, meta.socks);
    set('boot', i * 2, meta.boot || '#111111'); set('boot', i * 2 + 1, meta.boot || '#111111');
    set('hair', i, meta.hair);
    set('num', i, meta.numColor || '#ffffff');
    const a = this.meshes.num.geometry.attributes.aNum;
    a.array[i] = meta.number ?? 0; a.needsUpdate = true;
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

  writeHidden(i) {
    const z = this._m.makeScale(0, 0, 0);
    for (const k of ['shorts', 'torso', 'head', 'hair', 'num']) this.meshes[k].setMatrixAt(i, z);
    for (const k of ['sleeve', 'forearm', 'thigh', 'shin', 'boot']) { this.meshes[k].setMatrixAt(i * 2, z); this.meshes[k].setMatrixAt(i * 2 + 1, z); }
  }

  write(i, r) {
    const M = this.meshes;
    M.shorts.setMatrixAt(i, r.pelvis.matrixWorld);
    M.torso.setMatrixAt(i, r.torso.matrixWorld);
    M.head.setMatrixAt(i, r.head.matrixWorld);
    M.hair.setMatrixAt(i, r.hair.matrixWorld);
    M.num.setMatrixAt(i, r.num.matrixWorld);
    M.sleeve.setMatrixAt(i * 2, r.uaL.matrixWorld); M.sleeve.setMatrixAt(i * 2 + 1, r.uaR.matrixWorld);
    M.forearm.setMatrixAt(i * 2, r.faL.matrixWorld); M.forearm.setMatrixAt(i * 2 + 1, r.faR.matrixWorld);
    M.thigh.setMatrixAt(i * 2, r.thL.matrixWorld); M.thigh.setMatrixAt(i * 2 + 1, r.thR.matrixWorld);
    M.shin.setMatrixAt(i * 2, r.shL.matrixWorld); M.shin.setMatrixAt(i * 2 + 1, r.shR.matrixWorld);
    M.boot.setMatrixAt(i * 2, r.ftL.matrixWorld); M.boot.setMatrixAt(i * 2 + 1, r.ftR.matrixWorld);
  }

  pose(r, meta, x, y, ang, sp, act, actT, dt, official) {
    const root = r.root;
    const s = meta.height / 1.88;
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
    const hs = meta.hairStyle;
    r.hair.scale.set(hs === 3 ? 1.28 : hs === 0 ? 0.97 : 1.03, hs === 3 ? 1.25 : hs === 2 ? 1.12 : hs === 0 ? 0.9 : 1.0, hs === 2 ? 1.12 : hs === 3 ? 1.25 : 1.04);

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
