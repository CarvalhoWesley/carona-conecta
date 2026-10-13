import { distKm } from './geo.js';

const MIN = 60e3;

// segments: caronas com fromKey/toKey (de qual busca X→Y vieram).
export function buildRoutes(segments, originKey, destKey, s) {
  const byFrom = new Map();
  for (const seg of segments) {
    if (!byFrom.has(seg.fromKey)) byFrom.set(seg.fromKey, []);
    byFrom.get(seg.fromKey).push(seg);
  }

  const routes = [];
  const extend = (path, visited) => {
    const last = path[path.length - 1];
    if (last.toKey === destKey) { routes.push(toRoute(path)); return; }
    if (path.length >= s.maxLegs) return;
    for (const next of byFrom.get(last.toKey) || []) {
      if (visited.has(next.toKey)) continue;
      const gap = next.dep - last.arr;
      if (gap < s.minLayoverMin * MIN || gap > s.maxWaitMin * MIN) continue;
      if (distKm(last.arrCoord, next.depCoord) > s.maxTransferKm) continue;
      extend([...path, next], new Set(visited).add(next.toKey));
    }
  };
  for (const first of byFrom.get(originKey) || []) extend([first], new Set([originKey, first.toKey]));
  return routes;
}

function toRoute(legs) {
  const prices = legs.map((l) => l.price);
  return {
    id: legs.map((l) => l.id).join('|'),
    legs,
    dep: legs[0].dep,
    arr: legs[legs.length - 1].arr,
    transfers: legs.length - 1,
    price: prices.every((p) => p != null) ? prices.reduce((a, b) => a + b, 0) : null,
    waitMin: legs.slice(1).reduce((acc, l, i) => acc + (l.dep - legs[i].arr) / MIN, 0),
  };
}

export const SORTS = {
  arrival: (a, b) => a.arr - b.arr || a.transfers - b.transfers,
  price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.arr - b.arr,
  transfers: (a, b) => a.transfers - b.transfers || a.arr - b.arr,
};
