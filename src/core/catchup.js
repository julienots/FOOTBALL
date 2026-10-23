// Rattrapage du direct par tranches : on avance la simulation au plus `budgetMs`
// millisecondes à la fois pour ne jamais figer l'image (ni la chaîne regardée).
export function catchUp(engine, target, budgetMs, chunk = 200) {
  const t0 = performance.now();
  do {
    const before = engine.wall;
    if (engine.syncTo(target, chunk) || engine.wall >= target || engine.wall === before) return true;
  } while (performance.now() - t0 < budgetMs);
  return false;
}

// budget : grand quand la chaîne affiche son écran de chargement, petit en arrière-plan
export const budget = (visible) => (visible ? 24 : 3);
