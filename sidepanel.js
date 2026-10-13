import { SORTS } from './lib/planner.js';
import { DEFAULTS, loadSettings, saveSettings } from './lib/settings.js';

const $ = (id) => document.getElementById(id);
const searchForm = $('search');
const settingsForm = $('settings');
let routes = [];
let port = null;

const fmtTime = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtMoney = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fmtDur = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// --- busca ---
const tomorrow = new Date(Date.now() + 864e5);
searchForm.date.value = tomorrow.toLocaleDateString('sv-SE');

chrome.storage.local.get('lastQuery').then(({ lastQuery }) => {
  if (lastQuery) { searchForm.from.value = lastQuery.from; searchForm.to.value = lastQuery.to; }
});

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(searchForm);
  const query = { from: f.get('from').trim(), to: f.get('to').trim(), date: f.get('date'), seats: +f.get('seats') || 1 };
  chrome.storage.local.set({ lastQuery: query });
  start(query);
});

$('cancel').addEventListener('click', () => port?.postMessage({ type: 'cancel' }));
$('sort').addEventListener('change', render);

function start(query) {
  port?.disconnect();
  port = chrome.runtime.connect({ name: 'planner' });
  port.onMessage.addListener(onMessage);
  routes = [];
  render();
  $('status').hidden = false;
  $('alert').hidden = true;
  $('hubs').textContent = '';
  $('bar').removeAttribute('value');
  setBusy(true);
  port.postMessage({ type: 'start', query });
}

function setBusy(busy) {
  $('go').disabled = busy;
  $('cancel').hidden = !busy;
}

function showAlert(html) {
  $('alert').innerHTML = html;
  $('alert').hidden = false;
}

function onMessage(msg) {
  switch (msg.type) {
    case 'status': $('statusText').textContent = msg.label; break;
    case 'hubs':
      $('hubs').textContent = `Conexões avaliadas: ${msg.hubs.join(', ') || 'nenhuma'}` +
        (msg.discovered ? ` (descobertas: ${msg.discovered.join(', ')})` : '');
      break;
    case 'progress':
      $('bar').max = msg.total; $('bar').value = msg.done;
      $('statusText').textContent = `Buscando ${msg.label} (${msg.done + 1}/${msg.total})`;
      break;
    case 'routes': routes = msg.routes; render(); break;
    case 'warn': console.warn(msg.message); break;
    case 'captcha':
      showAlert(`${esc(msg.message)} Resolva na aba aberta e clique em <b>Buscar rotas</b> de novo — os trechos já buscados ficam em cache.
        <br><button type="button" id="showTab" class="ghost">Abrir aba</button>`);
      $('showTab').onclick = () => port.postMessage({ type: 'showTab', tabId: msg.tabId });
      break;
    case 'error': showAlert(esc(msg.message)); finish(); break;
    case 'done':
      $('bar').value = $('bar').max;
      $('statusText').textContent = `${msg.cancelled ? 'Interrompido' : 'Concluído'} — ${msg.searches} buscas feitas.`;
      finish();
      break;
  }
}

function finish() { setBusy(false); }

function render() {
  $('results').hidden = routes.length === 0;
  const sorted = [...routes].sort(SORTS[$('sort').value]).slice(0, 50);
  $('count').textContent = `${routes.length} rota${routes.length === 1 ? '' : 's'}`;
  $('routes').innerHTML = sorted.map(routeHtml).join('');
}

function routeHtml(r) {
  const label = r.transfers === 0 ? 'Direto' : `${r.transfers} conex${r.transfers === 1 ? 'ão' : 'ões'}`;
  const legs = r.legs.map((l, i) => {
    const wait = i > 0 ? `<div class="wait">⏱ espera ${fmtDur((l.dep - r.legs[i - 1].arr) / 60e3)} em ${esc(l.depName)}</div>` : '';
    return `${wait}<div class="leg">
      <span class="time">${fmtTime(l.dep)}<br>${fmtTime(l.arr)}</span>
      <span>${esc(l.depName)} → ${esc(l.arrName)}<br>
        <span class="muted">${esc(l.driver)}${l.rating ? ` ★${l.rating}` : ''}${l.autoApprove ? ' · reserva automática' : ''}${l.scarcity ? ` · ${esc(l.scarcity)}` : ''}</span></span>
      <span>${fmtMoney(l.price)}<br><a href="${esc(l.url)}" target="_blank">ver</a></span>
    </div>`;
  }).join('');
  return `<li class="route">
    <div class="route-head"><span>${fmtTime(r.dep)} → ${fmtTime(r.arr)} · ${fmtDur((r.arr - r.dep) / 60e3)}</span><span>${fmtMoney(r.price)}</span></div>
    <div class="muted">${label}</div>${legs}</li>`;
}

// --- configurações ---
$('toggleSettings').addEventListener('click', async () => {
  settingsForm.hidden = !settingsForm.hidden;
  if (!settingsForm.hidden) fillSettings(await loadSettings());
});

// Mostra o valor padrão ao lado de cada campo.
for (const input of settingsForm.querySelectorAll('input')) {
  const def = input.name === 'maxDetourPct' ? Math.round(DEFAULTS.maxDetour * 100) : DEFAULTS[input.name];
  input.placeholder = def;
  input.insertAdjacentHTML('afterend', `<span class="default">padrão: ${def}</span>`);
}

function fillSettings(s) {
  for (const [k, v] of Object.entries(s)) if (settingsForm[k]) settingsForm[k].value = v;
  settingsForm.maxDetourPct.value = Math.round(s.maxDetour * 100);
}

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const s = {};
  for (const k of Object.keys(DEFAULTS)) if (settingsForm[k]) s[k] = +settingsForm[k].value;
  s.maxDetour = +settingsForm.maxDetourPct.value / 100;
  await saveSettings(s);
  settingsForm.hidden = true;
});

$('resetSettings').addEventListener('click', async () => {
  await saveSettings({});
  fillSettings(DEFAULTS);
});
