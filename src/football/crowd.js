// Foule : des dizaines de milliers de supporters en "imposteurs" instanciés
// (une silhouette par siège), animés par un shader selon l'ambiance du match.
import * as THREE from 'three';
import { canvasTex } from './stadium.js';
import { RNG } from '../core/rng.js';
import { HL, HW } from './engine.js';

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
    // photographes derrière les buts et stadiers face au public
    const extras = [];
    for (const sx of [-1, 1]) for (let i = 0; i < 9; i++) {
      const z = -15 + i * 3.75 + rng.range(-0.6, 0.6);
      if (Math.abs(z) < 5) continue;
      extras.push({ x: sx * (HL + 3.2), y: 0, z, nx: sx, nz: 0, kind: 'photo' });
    }
    for (const sz of [-1, 1]) for (let i = -3; i <= 3; i++) extras.push({ x: i * 15 + 4, y: 0, z: sz * (HW + 6.6), nx: 0, nz: -sz, kind: 'steward' });
    filled.push(...extras);
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
      const awaySector = s.x < -56 && s.z < -10 && !s.kind;
      const r = rng.next();
      if (s.kind === 'photo') c.set(rng.pick(['#222222', '#2b2b33', '#3a3a3a']));
      else if (s.kind === 'steward') c.set('#ffd600');
      else if (awaySector) c.copy(r < 0.75 ? ac[0] : r < 0.9 ? ac[1] : rng.pick(neutral));
      else c.copy(r < 0.55 ? hc[0] : r < 0.72 ? hc[1] : rng.pick(neutral));
      c.offsetHSL(0, 0, (rng.next() - 0.5) * 0.12);
      shirt.set([c.r, c.g, c.b], i * 3);
      c.copy(rng.pick(skins)); skin.set([c.r, c.g, c.b], i * 3);
      // phase, tempérament, secteur (1 = ultras derrière un but), visiteur
      const ultras = !s.kind && ((s.x > 58 && Math.abs(s.z) < 30 && !s.upper) || awaySector);
      misc.set([rng.next() * 6.283, s.kind ? 0.0 : 0.5 + rng.next() * 0.8, ultras ? 1 : 0, awaySector ? 1 : 0], i * 4);
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
        varying vec2 vUv; varying vec3 vShirt; varying vec3 vSkin; varying float vShade; varying float vY;
        void main(){ vY = uv.y;
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
        varying vec2 vUv; varying vec3 vShirt; varying vec3 vSkin; varying float vShade; varying float vY;
        void main(){
          vec4 t = texture2D(uTex, vUv);
          if (t.a < 0.5) discard;
          vec3 col = vShirt * t.r + vSkin * t.g + vec3(0.08, 0.08, 0.1) * t.b;
          col *= 0.62 + 0.5 * vY; // éclairage du haut vers le bas
          gl_FragColor = vec4(col * vShade * uLight, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(ig, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.buildFlags(scene, homeColors, awayColors, opts);
  }

  // Drapeaux qui flottent dans les virages + banderole des ultras
  buildFlags(scene, hc, ac, opts) {
    const flagTex = (c1, c2, kind) => canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = c1; g.fillRect(0, 0, w, h);
      g.fillStyle = c2;
      if (kind === 0) for (let i = 0; i < 4; i++) g.fillRect(i * 32 + 16, 0, 16, h);
      else if (kind === 1) { g.fillRect(0, h / 3, w, h / 3); }
      else { g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.lineTo(w, h * 0.6); g.lineTo(w * 0.4, 0); g.fill(); }
    });
    this.flagUniforms = { uTime: { value: 0 } };
    const geo = new THREE.PlaneGeometry(3.2, 2.1, 12, 4); geo.translate(1.6, 0, 0);
    const mkMat = (tex, seed) => {
      const m = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.flagUniforms.uTime;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n float k = position.x / 3.2; transformed.z += sin(uTime * 5.0 + position.x * 2.2 + modelMatrix[3][2]) * 0.35 * k; transformed.y += sin(uTime * 3.0 + position.x) * 0.1 * k;');
      };
      m.customProgramCacheKey = () => 'flag';
      return m;
    };
    const rng = new RNG('drapeaux');
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x777777 });
    const spots = [];
    for (let i = 0; i < 9; i++) spots.push({ x: 64 + rng.range(0, 14), z: -24 + i * 6 + rng.range(-1, 1), c: hc });
    for (let i = 0; i < 5; i++) spots.push({ x: -64 - rng.range(0, 10), z: -14 - i * 4.5, c: ac });
    spots.forEach((p, i) => {
      const D = Math.abs(p.x) - (HL + 2);
      const y = 0.9 + Math.max(0, (D - 8) / 0.85) * 0.42 + 2.2;
      const flag = new THREE.Mesh(geo, mkMat(flagTex(p.c[0], p.c[1], i % 3)));
      flag.position.set(p.x, y + 1.6, p.z);
      flag.rotation.y = Math.sign(p.x) > 0 ? Math.PI / 2 + 0.6 : -Math.PI / 2 + 0.6;
      scene.add(flag);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.6, 5), poleMat);
      pole.position.set(p.x, y + 0.9, p.z); scene.add(pole);
    });
    // banderole au premier rang derrière le but
    const city = (opts.homeName || '').split(' ').pop().toUpperCase();
    const banTex = canvasTex(1024, 96, (g, w, h) => {
      g.fillStyle = hc[0]; g.fillRect(0, 0, w, h);
      g.fillStyle = hc[1]; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10);
      g.font = 'italic 900 64px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = hc[1]; g.fillText(`ALLEZ ${city} ! ON EST CHEZ NOUS`, w / 2, h / 2 + 2, w - 40);
    });
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(34, 3.2), new THREE.MeshStandardMaterial({ map: banTex, roughness: 0.9, side: THREE.DoubleSide }));
    ban.position.set(HL + 2 + 8.3, 2.0, 0); ban.rotation.y = -Math.PI / 2; ban.rotation.x = 0.25;
    scene.add(ban);
  }

  update(dt, t, exc, homeJoy, awayJoy, chant) {
    const u = this.uniforms;
    if (this.flagUniforms) this.flagUniforms.uTime.value = t;
    u.uTime.value = t;
    u.uExc.value += (exc - u.uExc.value) * Math.min(1, dt * 2);
    u.uHomeJoy.value += (homeJoy - u.uHomeJoy.value) * Math.min(1, dt * 4);
    u.uAwayJoy.value += (awayJoy - u.uAwayJoy.value) * Math.min(1, dt * 4);
    u.uChant.value = chant;
  }
}
