const R = 6371;
const rad = (d) => (d * Math.PI) / 180;

export function distKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Razão entre ir por H e ir direto (1 = exatamente no caminho).
export const detour = (o, h, d) => (distKm(o, h) + distKm(h, d)) / distKm(o, d);

// 0 = na origem, 1 = no destino.
export const progress = (o, h, d) => distKm(o, h) / (distKm(o, h) + distKm(h, d));

export const normalize = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const NOMINATIM = 'https://nominatim.openstreetmap.org';

export async function geocode(city) {
  const key = 'geo:' + normalize(city);
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached) return cached;
  const url = `${NOMINATIM}/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(city)}`;
  const [hit] = await (await fetch(url)).json();
  if (!hit) throw new Error(`Cidade não encontrada: ${city}`);
  const place = { name: city, lat: +hit.lat, lng: +hit.lon };
  await chrome.storage.local.set({ [key]: place });
  return place;
}

export async function reverseCity({ lat, lng }) {
  const url = `${NOMINATIM}/reverse?format=json&zoom=10&lat=${lat}&lon=${lng}`;
  const res = await (await fetch(url)).json();
  const a = res.address || {};
  const name = a.city || a.town || a.municipality || a.village;
  return name ? { name, lat: +res.lat, lng: +res.lon } : null;
}
