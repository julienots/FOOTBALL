// Ressources graphiques partagées entre les chaînes (évite de les recalculer à chaque zapping).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const envs = new WeakMap();
// Éclairage d'ambiance par image : calculé une seule fois par moteur de rendu.
// Ne jamais le libérer dans dispose() : il est partagé.
export function roomEnv(renderer) {
  let t = envs.get(renderer);
  if (!t) {
    const pm = new THREE.PMREMGenerator(renderer);
    t = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    envs.set(renderer, t);
  }
  return t;
}

// Libère la mémoire graphique d'une scène (géométries, textures, ombres, squelettes)
// SANS libérer les matériaux : leurs shaders compilés restent en cache dans le moteur
// de rendu et sont réutilisés au prochain passage sur la chaîne (zapping sans gel).
export function disposeScene(scene) {
  const shared = new Set([scene.environment]);
  const texs = new Set();
  const addTex = (v) => { if (v && v.isTexture && !shared.has(v)) texs.add(v); };
  scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.isInstancedMesh) o.dispose();
    if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
    if (o.isLight && o.dispose) o.dispose();
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const k in m) addTex(m[k]);
      if (m.uniforms) for (const k in m.uniforms) addTex(m.uniforms[k]?.value);
    }
  });
  addTex(scene.background);
  texs.forEach(t => t.dispose());
}
