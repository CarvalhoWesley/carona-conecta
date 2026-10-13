import { distKm, geocode, reverseCity } from './lib/geo.js';
import { corridorHubs, hubKey } from './lib/hubs.js';
import { buildRoutes } from './lib/planner.js';
import { loadSettings } from './lib/settings.js';
import { CaptchaError, fetchSearch } from './lib/source-blablacar.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let current = null; // { cancelled }
// Cache de buscas (10 min): permite retomar após um CAPTCHA sem repetir trechos.
const searchCache = new Map();
const CACHE_MS = 10 * 60e3;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'planner') return;
  port.onMessage.addListener((msg) => {
    if (msg.type === 'start') {
      if (current) current.cancelled = true;
      current = { cancelled: false };
      plan(msg.query, port, current).catch((e) => safePost(port, { type: 'error', message: e.message }));
    } else if (msg.type === 'cancel' && current) {
      current.cancelled = true;
    } else if (msg.type === 'showTab') {
      chrome.tabs.update(msg.tabId, { active: true });
    }
  });
  port.onDisconnect.addListener(() => { if (current) current.cancelled = true; });
});

function safePost(port, msg) {
  try { port.postMessage(msg); } catch { /* painel fechado */ }
}

async function plan({ from, to, date, seats }, port, job) {
  const s = await loadSettings();
  const post = (m) => safePost(port, m);

  post({ type: 'status', label: 'Localizando cidades…' });
  const origin = await geocode(from);
  const dest = await geocode(to);
  const oKey = hubKey(origin);
  const dKey = hubKey(dest);

  const hubs = corridorHubs(origin, dest, s);
  post({ type: 'hubs', hubs: hubs.map((h) => h.name) });

  const segments = [];
  const results = new Map(); // "a>b" -> número de caronas
  let used = 0;

  const addTrips = (a, b, k, trips) => {
    results.set(k, trips.length);
    for (const t of trips) segments.push({ ...t, fromKey: hubKey(a), toKey: hubKey(b), fromName: a.name, toName: b.name });
    post({ type: 'routes', routes: buildRoutes(segments, oKey, dKey, s), searches: used });
    return trips.length;
  };

  const search = async (a, b) => {
    const k = `${hubKey(a)}>${hubKey(b)}`;
    if (results.has(k) || job.cancelled) return results.get(k) || 0;
    const cacheKey = `${k}@${date}#${seats}`;
    const hit = searchCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) return addTrips(a, b, k, hit.trips);
    if (used >= s.maxSearches) return 0;
    if (used > 0) await sleep(s.delaySec * 1000);
    if (job.cancelled) return 0;
    used++;
    post({ type: 'progress', done: used - 1, total: s.maxSearches, label: `${a.name} → ${b.name}` });
    try {
      const trips = await fetchSearch(a.name, b.name, date, seats);
      searchCache.set(cacheKey, { at: Date.now(), trips });
      return addTrips(a, b, k, trips);
    } catch (e) {
      if (e instanceof CaptchaError) {
        job.cancelled = true;
        post({ type: 'captcha', tabId: e.tabId, message: e.message });
        return 0;
      }
      results.set(k, 0);
      post({ type: 'warn', message: `${a.name} → ${b.name}: ${e.message}` });
      return 0;
    }
  };

  // a. direto
  await search(origin, dest);
  // b. origem → hubs
  const reachable = [];
  for (const h of hubs) if (await search(origin, h)) reachable.push(h);

  // descoberta: pontos de chegada de caronas saindo da origem, no corredor e longe de hubs conhecidos
  const known = [origin, dest, ...hubs];
  const discovered = [];
  for (const seg of segments.filter((x) => x.fromKey === oKey && x.toKey !== dKey)) {
    if (discovered.length >= 2 || job.cancelled) break;
    if (known.some((k) => distKm(k, seg.arrCoord) < 15)) continue;
    const city = await reverseCity(seg.arrCoord).catch(() => null);
    if (!city || known.some((k) => hubKey(k) === hubKey(city))) continue;
    known.push(city);
    discovered.push(city);
  }
  if (discovered.length) post({ type: 'hubs', hubs: [...hubs, ...discovered].map((h) => h.name), discovered: discovered.map((h) => h.name) });
  for (const h of discovered) if (await search(origin, h)) reachable.push(h);

  // c. hubs alcançáveis → destino
  for (const h of reachable) await search(h, dest);
  // d. demais hubs → destino (para rotas de 3 trechos)
  const others = hubs.filter((h) => !reachable.includes(h));
  if (s.maxLegs >= 3) {
    const intoDest = [];
    for (const h of others) if (await search(h, dest)) intoDest.push(h);
    // e. alcançável → intermediário, respeitando o sentido da viagem
    const pairs = reachable.flatMap((a) => intoDest.filter((b) => (b.progress ?? 1) > (a.progress ?? 0)).map((b) => [a, b]))
      .sort((x, y) => distKm(x[0], x[1]) - distKm(y[0], y[1]));
    for (const [a, b] of pairs) await search(a, b);
  }

  post({ type: 'done', searches: used, cancelled: job.cancelled });
}
