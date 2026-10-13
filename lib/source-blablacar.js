// Único módulo acoplado ao blablacar.com.br.
// Abre a busca numa aba real em segundo plano e lê o JSON que o servidor embute na página.

const BASE = 'https://www.blablacar.com.br';

export class CaptchaError extends Error {
  constructor(tabId) {
    super('O BlaBlaCar pediu verificação (CAPTCHA).');
    this.tabId = tabId;
  }
}

export const searchUrl = (from, to, date, seats = 1) =>
  `${BASE}/search?fn=${encodeURIComponent(from)}&tn=${encodeURIComponent(to)}&db=${date}&seats=${seats}`;

export const rideUrl = (id) => `${BASE}/trip?source=CARPOOLING&id=${encodeURIComponent(id)}`;

// Executado dentro da página (world MAIN): precisa ser autocontido.
function readSearchCache() {
  const cache = window.__INFRASTRUCTURE__cache;
  if (!cache) {
    const captcha = document.querySelector('iframe[src*="captcha-delivery"]') || /captcha/i.test(document.title);
    return { status: captcha ? 'captcha' : 'pending' };
  }
  const key = Object.keys(cache).find((k) => k.includes('/trip/search/'));
  const value = key && cache[key]?.value;
  if (!value) return { status: 'pending' };
  return { status: 'ok', value };
}

function waitTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { done(); reject(new Error('Tempo esgotado carregando a busca.')); }, timeoutMs);
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') { done(); resolve(); } };
    const removed = (id) => { if (id === tabId) { done(); reject(new Error('Aba fechada.')); } };
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(removed);
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removed);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// onTab(tabId): permite ao chamador fechar a aba para cancelar a busca.
export async function fetchSearch(from, to, date, seats = 1, onTab = () => {}) {
  const tab = await chrome.tabs.create({ url: searchUrl(from, to, date, seats), active: false });
  onTab(tab.id);
  let keepTab = false;
  try {
    await waitTabComplete(tab.id, 30000);
    for (let i = 0; i < 20; i++) {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN', func: readSearchCache,
      });
      if (result.status === 'ok') return parseTrips(result.value, date);
      if (result.status === 'captcha') { keepTab = true; throw new CaptchaError(tab.id); }
      await sleep(500);
    }
    // Página carregou sem cache nem CAPTCHA visível: provavelmente bloqueio. Deixa a aba para o usuário ver.
    keepTab = true;
    throw new CaptchaError(tab.id);
  } finally {
    if (!keepTab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

const parsePrice = (trip) => {
  const gtm = trip.action?.tracking?.gtm?.price;
  const raw = gtm ?? (trip.price?.tokenizedPrice || []).filter((t) => t.type !== 'CURRENCY').map((t) => t.value).join('');
  const n = parseFloat(String(raw).replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const toMs = (date, hhmm) => new Date(`${date}T${hhmm}:00`).getTime();

export function parseTrips(value, date) {
  const items = value.resultsContent?.searchItems || [];
  return items.filter((i) => i.type === 'TRIP' && i.multimodalId?.source === 'CARPOOLING').map((t) => {
    const it = t.travelDetails.itinerary;
    const driver = t.travelDetails.provider?.profiles?.[0] || {};
    const dep = toMs(date, it.departure.time);
    let arr = toMs(date, it.arrival.time);
    if (arr <= dep || it.isOvernight) arr += 24 * 3600e3;
    return {
      id: t.multimodalId.id,
      dep,
      arr,
      depName: it.departure.primaryLocation,
      arrName: it.arrival.primaryLocation,
      depCoord: { lat: it.departure.coordinates.latitude, lng: it.departure.coordinates.longitude },
      arrCoord: { lat: it.arrival.coordinates.latitude, lng: it.arrival.coordinates.longitude },
      price: parsePrice(t),
      driver: driver.name,
      rating: driver.rating ? +driver.rating : null,
      autoApprove: (t.travelDetails.amenities || []).some((a) => a.id === 'AUTOMATIC_APPROVAL'),
      scarcity: t.scarcity || null,
      url: rideUrl(t.multimodalId.id),
    };
  });
}
