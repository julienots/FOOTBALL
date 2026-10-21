// Foule : des dizaines de milliers de supporters en "imposteurs" instanciés
// (une silhouette par siège), animés par un shader selon l'ambiance du match.
import * as THREE from 'three';
import { canvasTex } from './stadium.js';
import { RNG } from '../core/rng.js';

// Atlas : 4 poses (assis/debout, bras levés, applaudit, écharpe tendue).
// Canaux : R = maillot, G = peau, B = pantalon/cheveux, A = opacité
function atlas() {
  return canvasTex(512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const fw = w / 4;
    for (let f = 0; f < 4; f++) {
      const ox = f * fw, cx = ox + fw / 2;
      const body = (col, fn) => { g.fillStyle = col; g.beginPath(); fn(); g.fill(); };
      // jambes / bas
      body('rgb(0,0,255)', () => g.rect(cx - 26, 170, 52, 86));
      // torse
      body('rgb(255,0,0)', () => { g.moveTo(cx - 34, 175); g.quadraticCurveTo(cx - 36, 100, cx - 20, 92); g.lineTo(cx + 20, 92); g.quadraticCurveTo(cx + 36, 100, cx + 34, 175); g.closePath(); });
      // cou + tête
      body('rgb(0,255,0)', () => { g.rect(cx - 7, 78, 14, 18); });
      body('rgb(0,255,0)', () => { g.ellipse(cx, 62, 17, 21, 0, 0, Math.PI * 2); });
      // cheveux
      body('rgb(0,0,255)', () => { g.ellipse(cx, 50, 17, 12, 0, Math.PI, Math.PI * 2); });
      // bras selon la pose
      g.lineCap = 'round';
      const arm = (x0, y0, x1, y1, x2, y2) => {
        g.strokeStyle = 'rgb(255,0,0)'; g.lineWidth = 15;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        g.strokeStyle = 'rgb(0,255,0)'; g.lineWidth = 12;
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      };
      if (f === 0) { arm(cx - 30, 102, cx - 38, 140, cx - 30, 172); arm(cx + 30, 102, cx + 38, 140, cx + 30, 172); }
      if (f === 1) { arm(cx - 28, 100, cx - 44, 62, cx - 50, 20); arm(cx + 28, 100, cx + 44, 62, cx + 50, 20); }
      if (f === 2) { arm(cx - 28, 102, cx - 30, 130, cx - 4, 118); arm(cx + 28, 102, cx + 30, 130, cx + 4, 116); }
      if (f === 3) {
        arm(cx - 28, 100, cx - 40, 64, cx - 34, 30); arm(cx + 28, 100, cx + 40, 64, cx + 34, 30);
        g.strokeStyle = 'rgb(255,0,0)'; g.lineWidth = 10; g.beginPath(); g.moveTo(cx - 34, 32); g.lineTo(cx + 34, 32); g.stroke();
      }
    }
  }, { linear: true, aniso: 2 });
}

export class Crowd {
  constructor(scene, stadium, opts) {
    const { homeColors, awayColors, quality, attendance = 0.92 } = opts;
    const spacing = quality === 'low' ? 1.25 : quality === 'medium' ? 0.95 : 0.72;
    const seats = stadium.seats(spacing);
    const rng = new RNG('foule');
    const filled = seats.filter(() => rng.chance(attendance));
    const n = filled.length;
    this.count = n;
    const geo = new THREE.PlaneGeometry(0.62, 1.25);
    geo.translate(0, 0.62, 0);
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = geo.index;
    ig.attributes.position = geo.attributes.position;
    ig.attributes.uv = geo.attributes.uv;
    const offs = new Float32Array(n * 3), rot = new Float32Array(n), shirt = new Float32Array(n * 3), skin = new Float32Array(n * 3), misc = new Float32Array(n * 4);
    const hc = homeColors.map(c => new THREE.Color(c)), ac = awayColors.map(c => new THREE.Color(c));
    const neutral = ['#f5f5f5', '#1a1a1a', '#455a64', '#c62828', '#1565c0', '#2e7d32', '#ffb300', '#6d4c41'].map(c => new THREE.Color(c));
    const skins = ['#f1c9a5', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e', '#ffdbac'].map(c => new THREE.Color(c));
    const c = new THREE.Color();
    filled.forEach((s, i) => {
      offs[i * 3] = s.x + (rng.next() - 0.5) * 0.15; offs[i * 3 + 1] = s.y; offs[i * 3 + 2] = s.z + (rng.next() - 0.5) * 0.15;
      rot[i] = Math.atan2(-s.nx, -s.nz);
      const awaySector = s.x < -56 && s.z < -10;
      const r = rng.next();
      if (awaySector) c.copy(r < 0.75 ? ac[0] : r < 0.9 ? ac[1] : rng.pick(neutral));
      else c.copy(r < 0.55 ? hc[0] : r < 0.72 ? hc[1] : rng.pick(neutral));
      c.offsetHSL(0, 0, (rng.next() - 0.5) * 0.12);
      shirt.set([c.r, c.g, c.b], i * 3);
      c.copy(rng.pick(skins)); skin.set([c.r, c.g, c.b], i * 3);
      // phase, tempérament, secteur (1 = ultras derrière un but), visiteur
      const ultras = (s.x > 58 && Math.abs(s.z) < 30 && !s.upper) || awaySector;
      misc.set([rng.next() * 6.283, 0.5 + rng.next() * 0.8, ultras ? 1 : 0, awaySector ? 1 : 0], i * 4);
    });
    ig.setAttribute('iOff', new THREE.InstancedBufferAttribute(offs, 3));
    ig.setAttribute('iRot', new THREE.InstancedBufferAttribute(rot, 1));
    ig.setAttribute('iShirt', new THREE.InstancedBufferAttribute(shirt, 3));
    ig.setAttribute('iSkin', new THREE.InstancedBufferAttribute(skin, 3));
    ig.setAttribute('iMisc', new THREE.InstancedBufferAttribute(misc, 4));
    ig.instanceCount = n;
    this.uniforms = {
      uTex: { value: atlas() }, uTime: { value: 0 }, uExc: { value: 0.3 }, uHomeJoy: { value: 0 }, uAwayJoy: { value: 0 },
      uLight: { value: new THREE.Color(1, 1, 1) }, uChant: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        attribute vec3 iOff; attribute float iRot; attribute vec3 iShirt; attribute vec3 iSkin; attribute vec4 iMisc;
        uniform float uTime; uniform float uExc; uniform float uHomeJoy; uniform float uAwayJoy; uniform float uChant;
        varying vec2 vUv; varying vec3 vShirt; varying vec3 vSkin; varying float vShade;
        void main(){
          float ph = iMisc.x; float temp = iMisc.y; float ultras = iMisc.z; float away = iMisc.w;
          float joy = mix(uHomeJoy, uAwayJoy, away);
          float exc = clamp(uExc * temp + ultras * 0.35 + joy, 0.0, 1.5);
          // choix de la pose
          float beat = sin(uTime * (3.0 + temp) + ph);
          float frame = 0.0;
          if (joy > 0.2) frame = (fract(ph * 7.31) > 0.4) ? 1.0 : 3.0;
          else if (ultras > 0.5 && uChant > 0.3) frame = (beat > 0.2) ? 1.0 : 2.0;
          else if (exc > 0.75) frame = (beat > 0.0) ? 2.0 : 1.0;
          else if (exc > 0.55 && fract(ph * 3.17) > 0.6) frame = 2.0;
          vUv = vec2((uv.x + frame) * 0.25, uv.y);
          // sautillement
          float jump = max(0.0, sin(uTime * (7.0 + temp * 2.0) + ph)) * 0.22 * smoothstep(0.6, 1.2, exc + joy);
          float sitting = (exc < 0.45 && ultras < 0.5) ? 0.28 : 0.0;
          vec3 p = position;
          p.y = p.y * (1.0 - sitting) + jump;
          float c = cos(iRot), s = sin(iRot);
          vec3 w = vec3(p.x * c, p.y, -p.x * s) + iOff;
          vShirt = iShirt; vSkin = iSkin; vShade = 0.75 + 0.25 * fract(ph * 13.7);
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uTex; uniform vec3 uLight;
        varying vec2 vUv; varying vec3 vShirt; varying vec3 vSkin; varying float vShade;
        void main(){
          vec4 t = texture2D(uTex, vUv);
          if (t.a < 0.5) discard;
          vec3 col = vShirt * t.r + vSkin * t.g + vec3(0.08, 0.08, 0.1) * t.b;
          gl_FragColor = vec4(col * vShade * uLight, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(ig, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(dt, t, exc, homeJoy, awayJoy, chant) {
    const u = this.uniforms;
    u.uTime.value = t;
    u.uExc.value += (exc - u.uExc.value) * Math.min(1, dt * 2);
    u.uHomeJoy.value += (homeJoy - u.uHomeJoy.value) * Math.min(1, dt * 4);
    u.uAwayJoy.value += (awayJoy - u.uAwayJoy.value) * Math.min(1, dt * 4);
    u.uChant.value = chant;
  }
}
