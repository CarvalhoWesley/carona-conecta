import { distKm, geocode, progress, reverseCity } from './lib/geo.js';
import { corridorHubs, hubKey } from './lib/hubs.js';
import { buildRoutes } from './lib/planner.js';
import { loadHubs, loadSettings } from './lib/settings.js';
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
      if (current) cancel(current);
      current = { cancelled: false, tabId: null };
      plan(msg.query, port, current).catch((e) => safePost(port, { type: 'error', message: e.message }));
    } else if (msg.type === 'cancel' && current) {
      cancel(current);
    } else if (msg.type === 'showTab') {
      chrome.tabs.update(msg.tabId, { active: true });
    }
  });
  port.onDisconnect.addListener(() => { if (current) cancel(current); });
});

function cancel(job) {
  job.cancelled = true;
  if (job.tabId) chrome.tabs.remove(job.tabId).catch(() => {});
}

function safePost(port, msg) {
  try { port.postMessage(msg); } catch { /* painel fechado */ }
}

async function plan({ from, to, date, seats, hubs: manualHubs = [] }, port, job) {
  let s = await loadSettings();
  const post = (m) => safePost(port, m);

  post({ type: 'status', label: 'Localizando cidades…' });
  const origin = await geocode(from);
  const dest = await geocode(to);
  const oKey = hubKey(origin);
  const dKey = hubKey(dest);

  // Modo avançado: usa só as cidades informadas, sem filtro de desvio nem limite de hubs.
  const manual = manualHubs.length > 0;
  const hubs = manual
    ? await manualCorridor(manualHubs, origin, dest)
    : corridorHubs(origin, dest, s, await loadHubs());
  post({ type: 'hubs', hubs: hubs.map((h) => h.name), manual });

  // Modo avançado: as cidades escolhidas formam a sequência da viagem (ordenadas pelo caminho).
  // Permite trechos suficientes para passar por todas e busca todos os pares no sentido da viagem.
  const manualPairs = () => {
    const nodes = [origin, ...hubs, dest];
    const pairs = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) pairs.push([nodes[i], nodes[j]]);
    // Primeiro os pares consecutivos (a sequência informada), depois os atalhos.
    return pairs.sort((x, y) => (nodes.indexOf(x[1]) - nodes.indexOf(x[0])) - (nodes.indexOf(y[1]) - nodes.indexOf(y[0])));
  };
  if (manual) {
    const total = manualPairs().length;
    s = { ...s, maxLegs: Math.max(s.maxLegs, hubs.length + 1), maxSearches: Math.max(s.maxSearches, total) };
  }
  const planManual = async () => {
    for (const [a, b] of manualPairs()) await search(a, b);
  };

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
      const trips = await fetchSearch(a.name, b.name, date, seats, (id) => { job.tabId = id; });
      searchCache.set(cacheKey, { at: Date.now(), trips });
      return addTrips(a, b, k, trips);
    } catch (e) {
      if (job.cancelled) return 0;
      if (e instanceof CaptchaError) {
        job.tabId = null; // a aba do CAPTCHA fica aberta para o usuário
        job.cancelled = true;
        post({ type: 'captcha', tabId: e.tabId, message: e.message });
        return 0;
      }
      results.set(k, 0);
      post({ type: 'warn', message: `${a.name} → ${b.name}: ${e.message}` });
      return 0;
    }
  };

  if (manual) {
    await planManual();
    post({ type: 'done', searches: used, cancelled: job.cancelled });
    return;
  }

  // a. direto
  await search(origin, dest);
  // b. origem → hubs
  const reachable = [];
  for (const h of hubs) if (await search(origin, h)) reachable.push(h);

  // descoberta: pontos de chegada de caronas saindo da origem, no corredor e longe de hubs conhecidos
  const known = [origin, dest, ...hubs];
  const discovered = [];
  for (const seg of manual ? [] : segments.filter((x) => x.fromKey === oKey && x.toKey !== dKey)) {
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

async function manualCorridor(names, origin, dest) {
  const keys = new Set([hubKey(origin), hubKey(dest)]);
  const hubs = [];
  for (const name of names) {
    const place = await geocode(name); // erro "Cidade não encontrada" vai para o painel
    if (keys.has(hubKey(place))) continue;
    keys.add(hubKey(place));
    hubs.push({ ...place, progress: progress(origin, place, dest) });
  }
  return hubs.sort((a, b) => a.progress - b.progress);
}
