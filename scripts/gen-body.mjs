// Précalcule les maillages des personnages (corps + cheveux) pour chaque niveau de détail.
import { mkdirSync, writeFileSync } from 'node:fs';
import { bodyGeometry, hairGeometries, packGeometries } from '../src/football/body.js';
mkdirSync(new URL('../public/body/', import.meta.url), { recursive: true });
for (const q of ['high', 'medium', 'low', 'far']) {
  const t = Date.now();
  const buf = packGeometries({ body: bodyGeometry(q), ...hairGeometries(q) });
  writeFileSync(new URL(`../public/body/${q}.bin`, import.meta.url), buf);
  console.log(`corps ${q} : ${(buf.length / 1024).toFixed(0)} Ko en ${Date.now() - t} ms`);
}
