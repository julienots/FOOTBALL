// Réalisation TV d'un match : scène 3D, caméras (plan large, gros plans,
// ralentis sous plusieurs angles), éclairage jour/nuit.
import * as THREE from 'three';
import { Stadium } from './stadium.js';
import { Crowd } from './crowd.js';
import { Players } from './players.js';
import { HL, HW, SNAP_LEN, ENT, DT } from './engine.js';
import { clamp } from '../core/rng.js';

const tmpA = new Float32Array(SNAP_LEN), tmpB = new Float32Array(SNAP_LEN), tmpC = new Float32Array(SNAP_LEN);

export class FootballView {
  constructor(renderer, info, quality = 'high') {
    this.renderer = renderer;
    this.info = info; // { home, away, kits, night, sunset, seed }
    this.quality = quality;
    const scene = (this.scene = new THREE.Scene());
    const night = info.night, sunset = info.sunset;
    const skyTop = night ? 0x050a18 : sunset ? 0x30406e : 0x3d7fd1;
    const skyBot = night ? 0x111a33 : sunset ? 0xf0915a : 0xbcd9f2;
    scene.background = new THREE.Color(skyBot);
    scene.fog = new THREE.Fog(skyBot, 250, 700);
    // ciel dégradé
    const skyGeo = new THREE.SphereGeometry(900, 24, 12);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(skyTop) }, bot: { value: new THREE.Color(skyBot) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(bot, top, h), 1.0);\n#include <colorspace_fragment>\n}',
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));
    // lumières
    const hemi = new THREE.HemisphereLight(night ? 0x8899cc : 0xcfe6ff, 0x34502a, night ? 0.55 : 0.75);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(night ? 0xfff6e8 : sunset ? 0xffc28a : 0xfff4e0, night ? 2.3 : sunset ? 2.0 : 2.6);
    key.position.set(night ? 20 : -60, night ? 120 : 90, night ? 40 : 50);
    key.castShadow = quality !== 'low';
    key.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    const sc = key.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 50; sc.bottom = -50; sc.near = 10; sc.far = 300;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    scene.add(key); scene.add(key.target);
    if (night) {
      // projecteurs secondaires (ombres multiples façon stade)
      const fill = new THREE.DirectionalLight(0xffffff, 0.9);
      fill.position.set(-30, 100, -60); scene.add(fill);
    }
    this.stadium = new Stadium(scene, { night, homeColor: info.home.colors[0], awayColor: info.away.colors[0], quality, seed: info.seed });
    this.crowd = new Crowd(scene, this.stadium, { homeColors: info.home.colors, awayColors: info.away.colors, quality, attendance: info.attendance ?? 0.93 });
    if (night) this.crowd.uniforms.uLight.value.setRGB(0.75, 0.78, 0.85);
    this.players = new Players(scene, quality);
    this.camera = new THREE.PerspectiveCamera(26, 16 / 9, 0.5, 2000);
    this.cam = { pos: new THREE.Vector3(0, 20, 63), look: new THREE.Vector3(0, 0, 0), fov: 26 };
    this.mode = 'wide';
    this.replay = null;
    this.t = 0;
    this.joy = [0, 0];
    this.chant = 0;
  }

  setRoster(engine) {
    const { kits } = this.info;
    for (let t = 0; t < 2; t++) {
      const kit = t === 0 ? kits.home : kits.away;
      const tm = engine.teams[t];
      for (let s = 0; s < 11; s++) {
        const p = tm.players[s];
        const d = p.data;
        const gk = p.isGK;
        const shirt = gk ? kit.gk : kit.shirt;
        this.players.setMeta(t * 11 + s, {
          shirt, shorts: gk ? '#1a1a1a' : kit.shorts, socks: gk ? '#1a1a1a' : kit.shirt, skin: d.look.skin, hair: d.look.hairColor,
          hairStyle: d.look.hairStyle, height: d.look.height, number: d.number, numColor: lum(shirt) > 0.6 ? '#111111' : '#ffffff',
          gloves: gk ? '#f5f5f5' : null, boot: ['#111111', '#f5f5f5', '#ff6d00', '#00e5ff'][d.id % 4], leftFoot: d.foot === 'gauche', id: d.id,
        });
      }
    }
    const refKit = { shirt: '#101010', shorts: '#101010', socks: '#101010', skin: 0.3, hair: '#222', hairStyle: 0, height: 1.8, number: 0, numColor: '#101010' };
    this.players.setMeta(22, refKit);
    this.players.setMeta(23, { ...refKit, shirt: '#e6d200', skin: 0.15 });
    this.players.setMeta(24, { ...refKit, shirt: '#e6d200', skin: 0.6 });
    this.rosterKey = engine.teams.map(t => t.players.map(p => p.data.id).join(',')).join('|');
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Lance un ralenti à partir d'un clip enregistré par le moteur
  startReplay(clip, opts = {}) {
    if (!clip || !clip.frames.length) return;
    const n = clip.frames.length;
    const end = n - 1;
    const angles = opts.short ? [{ from: Math.max(0, end - 150), to: end, speed: 0.75, cam: 'goal' }]
      : [{ from: Math.max(0, end - 170), to: end, speed: 0.6, cam: 'goal' }, { from: Math.max(0, end - 85), to: end - 10, speed: 0.38, cam: 'low' }];
    this.replay = { clip, angles, ai: 0, f: angles[0].from, done: false, onEnd: opts.onEnd };
    this.mode = 'replay';
  }

  stopReplay() { this.replay = null; this.mode = 'wide'; }

  frameAt(clip, f) {
    const i = Math.floor(f), a = f - i;
    const fr = clip.frames;
    return { A: fr[Math.min(i, fr.length - 1)], B: fr[Math.min(i + 1, fr.length - 1)], alpha: a };
  }

  // engineView : { engine, target } — target = secondes depuis le coup d'envoi
  render(dt, engine, target, overlayState = {}) {
    this.t += dt;
    const R = this.renderer;
    let A, B, alpha;
    let replaying = false;
    if (this.replay) {
      const rp = this.replay;
      const ang = rp.angles[rp.ai];
      rp.f += dt * 20 * ang.speed;
      if (rp.f >= ang.to) {
        rp.ai++;
        if (rp.ai >= rp.angles.length) { const cb = rp.onEnd; this.stopReplay(); if (cb) cb(); }
        else rp.f = rp.angles[rp.ai].from;
      }
      if (this.replay) {
        const fr = this.frameAt(rp.clip, rp.f);
        A = fr.A; B = fr.B; alpha = fr.alpha; replaying = true;
      }
    }
    if (!replaying) {
      if (engine.ring && engine.ringCount >= 2) {
        const i1 = (engine.ringPos - 1 + 260) % 260, i0 = (engine.ringPos - 2 + 260) % 260;
        A = engine.ring.subarray(i0 * SNAP_LEN, (i0 + 1) * SNAP_LEN);
        B = engine.ring.subarray(i1 * SNAP_LEN, (i1 + 1) * SNAP_LEN);
        alpha = clamp(1 - (engine.wall - target) / DT, 0, 1);
        if (engine.period === 'ht' || engine.period === 'end' || engine.period === 'ft') alpha = 1;
      } else {
        engine.writeSnap(tmpC, 0); A = B = tmpC; alpha = 1;
      }
      // avant-match : alignement des équipes sur la ligne médiane
      if (overlayState.preMatch != null) { this.lineup(A, B, overlayState.preMatch); A = tmpA; B = tmpA; alpha = 1; }
      // après un coup de sifflet final de période : les joueurs quittent la pelouse / fêtent
      if ((engine.period === 'ht' || engine.period === 'ft' || engine.period === 'end') && A !== tmpA && engine.stopWall != null) {
        this.walkOff(B, target - engine.stopWall, engine);
        A = B = tmpA; alpha = 1;
      }
    }
    const key = engine.teams.map(t => t.players.map(p => p.data.id).join(',')).join('|');
    if (key !== this.rosterKey && !replaying) this.setRoster(engine);
    this.players.update(A, B, alpha, dt, {});
    // ambiance tribunes
    const exc = engine.excitement ?? 0.3;
    this.crowd.update(dt, this.t, exc, this.joy[0], this.joy[1], this.chant);
    this.joy[0] *= Math.pow(0.5, dt / 6); this.joy[1] *= Math.pow(0.5, dt / 6);
    this.stadium.update(dt, this.t);
    this.direct(dt, engine, A, B, alpha, replaying, overlayState);
    R.render(this.scene, this.camera);
  }

  lineup(A, B, p) {
    // p : 0 = joueurs alignés, 1 = en place pour le coup d'envoi (transition)
    tmpA.set(B);
    for (let i = 0; i < 22; i++) {
      const o = i * ENT;
      const t = i < 11 ? 0 : 1, s = i % 11;
      const lx = (t === 0 ? -1 : 1) * (1.2 + s * 1.05), ly = HW - 6;
      const kx = B[o], ky = B[o + 1];
      if (p <= 0) { tmpA[o] = lx; tmpA[o + 1] = ly; tmpA[o + 2] = Math.PI / 2; tmpA[o + 3] = 0; }
      else { tmpA[o] = lx + (kx - lx) * p; tmpA[o + 1] = ly + (ky - ly) * p; tmpA[o + 2] = Math.atan2(ky - ly, kx - lx); tmpA[o + 3] = p < 1 ? 1.6 : 0; }
      tmpA[o + 4] = 0;
    }
    // arbitres au centre
    const r = 22 * ENT;
    if (p <= 0) { tmpA[r] = 0; tmpA[r + 1] = HW - 6; tmpA[r + 2] = Math.PI / 2; tmpA[r + 3] = 0; tmpA[r + ENT] = -1.1; tmpA[r + ENT + 1] = HW - 6; tmpA[r + 2 * ENT] = 1.1; tmpA[r + 2 * ENT + 1] = HW - 6; }
    const b = 25 * ENT; tmpA[b] = 0; tmpA[b + 1] = 0; tmpA[b + 2] = 0.11;
  }

  // animation des joueurs après le coup de sifflet (le moteur est à l'arrêt)
  walkOff(B, t, engine) {
    tmpA.set(B);
    const final = engine.period !== 'ht';
    const s0 = engine.score;
    const winner = final ? (engine.pens ? engine.pens.winner : s0[0] > s0[1] ? 0 : s0[1] > s0[0] ? 1 : -1) : -1;
    for (let i = 0; i < 25; i++) {
      const o = i * ENT;
      const x0 = B[o], y0 = B[o + 1];
      if (x0 > 9000) continue;
      const team = i < 11 ? 0 : i < 22 ? 1 : 2;
      // destination : tunnel (mi-temps) ou rond central / tribune (fin de match)
      let tx = 0, ty = -HW - 6;
      if (final) {
        if (team === winner) { tx = (i % 11 - 5) * 3; ty = HW - 4; }
        else { tx = x0 * 0.5; ty = y0 * 0.5; }
      }
      const delay = final ? 1.5 : 3 + (i % 7) * 0.6;
      const sp = final ? (team === winner ? 2.2 : 0.8) : 1.7;
      const dx = tx - x0, dy = ty - y0, d = Math.hypot(dx, dy) || 1;
      const walked = Math.max(0, t - delay) * sp;
      const f = Math.min(1, walked / d);
      tmpA[o] = x0 + dx * f; tmpA[o + 1] = y0 + dy * f;
      const moving = f < 1 && t > delay;
      tmpA[o + 2] = moving ? Math.atan2(dy, dx) : (final ? Math.PI / 2 : B[o + 2]);
      tmpA[o + 3] = moving ? sp : 0;
      tmpA[o + 4] = final && team === winner && t > delay && (t % 6) < 3 ? 5 : 0; tmpA[o + 5] = 0.3;
      if (!final && f >= 1) tmpA[o] = 9999;
    }
  }

  hideTunnel(B, A) {
    for (let i = 0; i < 25; i++) {
      const o = i * ENT;
      if (B[o + 1] < -HW - 3.5) { B[o] = 9999; A[o] = 9999; }
    }
  }

  direct(dt, engine, A, B, alpha, replaying, st) {
    const cam = this.cam;
    const bo = 25 * ENT;
    const bx = B[bo], bz = B[bo + 1], bh = B[bo + 2];
    let pos = new THREE.Vector3(), look = new THREE.Vector3(), fov = 26;
    let k = 2.2; // vitesse de lissage
    const mode = replaying ? 'replay' : (st.camMode || this.mode);
    if (mode === 'replay') {
      const ang = this.replay.angles[this.replay.ai];
      const side = Math.sign(bx || 1);
      if (ang.cam === 'goal') { pos.set(side * (HL + 17), 7.5, bz * 0.35 + 6); look.set(bx * 0.7 + side * HL * 0.3, 0.8, bz * 0.8); fov = 34; }
      else { pos.set(bx - side * 12, 1.7, bz + (bz > 0 ? 10 : -10)); look.set(bx, 1.0, bz); fov = 30; }
      k = 6;
      if (this.replay.f === ang.from) k = 1000;
    } else if (mode === 'aerial') {
      const a = this.t * 0.05;
      pos.set(Math.cos(a) * 105, 55, Math.sin(a) * 85); look.set(0, 0, 0); fov = 38; k = 50;
    } else if (mode === 'celebrate' && st.focus != null) {
      const o = st.focus * ENT;
      const px = B[o], pz = B[o + 1];
      if (px < 9000) {
        const dir = new THREE.Vector3(-px, 0, -pz).normalize();
        pos.set(px + dir.x * 7, 1.9, pz + dir.z * 7); look.set(px, 1.3, pz); fov = 30; k = 3;
      } else { pos.copy(cam.pos); look.copy(cam.look); }
    } else if (mode === 'closeup' && st.focus != null) {
      const o = st.focus * ENT;
      const px = B[o], pz = B[o + 1];
      pos.set(px + 4, 2.2, pz + 9); look.set(px, 1.1, pz); fov = 28; k = 3;
    } else if (mode === 'pens') {
      pos.set(HL - 25, 3.2, 1.5); look.set(HL, 1.2, 0); fov = 24; k = 3;
    } else {
      // plan large de la tribune principale
      const tx = clamp(bx * 0.8, -40, 40);
      pos.set(tx, 19.5, 63);
      look.set(clamp(bx, -HL + 4, HL - 4) * 0.97, 0, clamp(bz * 0.6, -18, 22));
      const dz = 63 - bz;
      fov = clamp(12 + dz * 0.12, 17, 27);
      if (Math.abs(bx) > HL - 18) fov -= 1.5;
      if (bh > 4) fov += 2;
    }
    const f = Math.min(1, dt * k);
    if (cam.lastMode !== mode && mode !== 'wide') { cam.pos.copy(pos); cam.look.copy(look); cam.fov = fov; }
    cam.pos.lerp(pos, f);
    cam.look.lerp(look, Math.min(1, dt * (mode === 'wide' ? 3.2 : k)));
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 1.2);
    cam.lastMode = mode;
    this.camera.position.copy(cam.pos);
    // légère respiration de la caméra (opérateur humain)
    this.camera.position.y += Math.sin(this.t * 0.7) * 0.05;
    this.camera.lookAt(cam.look);
    if (Math.abs(this.camera.fov - cam.fov) > 0.01) { this.camera.fov = cam.fov; this.camera.updateProjectionMatrix(); }
  }

  dispose() {
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    });
  }
}

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
