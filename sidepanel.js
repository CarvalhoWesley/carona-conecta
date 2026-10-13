import { SORTS } from './lib/planner.js';
import { geocode, normalize } from './lib/geo.js';
import { DEFAULTS, loadHubs, loadSettings, resetHubs, saveHubs, saveSettings } from './lib/settings.js';

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

// Modo avançado: cidades de conexão escolhidas na própria consulta.
let advCities = [];

function renderAdv() {
  $('advList').innerHTML = advCities.map((c, i) =>
    `<li>${esc(c)}<button type="button" data-adv-remove="${i}" aria-label="Remover ${esc(c)}">×</button></li>`).join('');
}

function addAdvCity() {
  const name = $('advCity').value.trim();
  if (name && !advCities.some((c) => normalize(c) === normalize(name))) advCities.push(name);
  $('advCity').value = '';
  renderAdv();
}

$('advAdd').addEventListener('click', addAdvCity);
$('advCity').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addAdvCity(); } // Enter adiciona, não dispara a busca
});
$('advList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-adv-remove]');
  if (btn) { advCities.splice(+btn.dataset.advRemove, 1); renderAdv(); }
});

chrome.storage.local.get('lastQuery').then(({ lastQuery }) => {
  if (!lastQuery) return;
  searchForm.from.value = lastQuery.from;
  searchForm.to.value = lastQuery.to;
  advCities = lastQuery.hubs || [];
  $('advanced').open = advCities.length > 0;
  renderAdv();
});

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(searchForm);
  if ($('advCity').value.trim()) addAdvCity(); // cidade digitada sem clicar em Adicionar
  const query = {
    from: f.get('from').trim(), to: f.get('to').trim(), date: f.get('date'), seats: +f.get('seats') || 1,
    hubs: [...advCities],
  };
  chrome.storage.local.set({ lastQuery: query });
  start(query);
});

$('cancel').addEventListener('click', () => {
  port?.postMessage({ type: 'cancel' });
  $('cancel').disabled = true;
  $('statusText').textContent = 'Cancelando…';
});
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
  $('go').hidden = busy;
  $('cancel').hidden = !busy;
  $('cancel').disabled = false;
}

function showAlert(html) {
  $('alert').innerHTML = html;
  $('alert').hidden = false;
}

function onMessage(msg) {
  switch (msg.type) {
    case 'status': $('statusText').textContent = msg.label; break;
    case 'hubs':
      $('hubs').textContent = `Conexões avaliadas${msg.manual ? ' (escolhidas por você)' : ''}: ${msg.hubs.join(', ') || 'nenhuma'}` +
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
const showSettings = (show) => {
  $('viewSearch').hidden = show;
  $('viewSettings').hidden = !show;
  $('saved').hidden = true;
};
$('openSettings').addEventListener('click', async () => {
  fillSettings(await loadSettings());
  renderHubs(await loadHubs());
  showSettings(true);
});
$('closeSettings').addEventListener('click', () => showSettings(false));

const HELP = {
  maxLegs: 'Quantas caronas no máximo uma rota pode ter (1 = só viagens diretas).',
  minLayoverMin: 'Tempo mínimo entre chegar numa cidade de conexão e sair na próxima carona, como folga para atrasos.',
  maxWaitMin: 'Quanto tempo você aceita esperar numa cidade de conexão.',
  maxTransferKm: 'Distância entre onde você desce e onde pega a próxima carona. Em cidades grandes, aumente se aparecerem poucas rotas.',
  maxDetourPct: 'Quanto uma cidade de conexão pode alongar a viagem em relação ao caminho direto.',
  maxHubs: 'Quantas cidades de conexão são avaliadas. Mais cidades encontram mais rotas, mas gastam mais consultas.',
  maxSearches: 'Limite de consultas ao BlaBlaCar por busca. Reduz o tempo total e o risco de CAPTCHA.',
  delaySec: 'Intervalo entre as consultas: maior deixa a busca mais lenta, porém mais discreta para o site.',
};

// Para cada campo: botão de ajuda (i) com explicação e o valor padrão.
for (const input of settingsForm.querySelectorAll('input')) {
  const def = input.name === 'maxDetourPct' ? Math.round(DEFAULTS.maxDetour * 100) : DEFAULTS[input.name];
  input.placeholder = def;
  const label = input.closest('label');
  const text = label.firstChild.textContent.trim();
  label.firstChild.replaceWith(Object.assign(document.createElement('span'), {
    className: 'name',
    innerHTML: `${esc(text)} <button type="button" class="info" aria-label="Sobre ${esc(text)}" aria-expanded="false">i</button>
      <span class="help" role="tooltip" hidden>${esc(HELP[input.name])}</span>`,
  }));
  input.insertAdjacentHTML('afterend', `<span class="default">padrão: ${def}</span>`);
}

const closeHelp = (except) => {
  for (const b of settingsForm.querySelectorAll('.info')) {
    if (b === except) continue;
    b.setAttribute('aria-expanded', 'false');
    b.nextElementSibling.hidden = true;
  }
};

settingsForm.addEventListener('click', (e) => {
  const btn = e.target.closest('.info');
  if (!btn) return;
  e.preventDefault(); // não focar o campo do label
  closeHelp(btn);
  const help = btn.nextElementSibling;
  help.hidden = !help.hidden;
  btn.setAttribute('aria-expanded', String(!help.hidden));
});
document.addEventListener('click', (e) => { if (!e.target.closest('.info, .help')) closeHelp(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHelp(); });

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
  $('saved').hidden = false;
});

$('resetSettings').addEventListener('click', async () => {
  await saveSettings({});
  fillSettings(DEFAULTS);
});

// --- cidades de conexão ---
const hubForm = $('hubForm');
let hubs = [];

function renderHubs(list) {
  hubs = [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  $('hubCount').textContent = `(${hubs.length})`;
  $('hubList').innerHTML = hubs.map((h, i) => `<li>
    <button type="button" class="star${h.major ? ' on' : ''}" data-star="${i}"
      title="${h.major ? 'Polo grande' : 'Marcar como polo grande'}" aria-pressed="${!!h.major}">★</button>
    ${esc(h.name)}
    <button type="button" data-remove="${i}" title="Remover" aria-label="Remover ${esc(h.name)}">×</button>
  </li>`).join('');
}

async function updateHubs(list) {
  await saveHubs(list);
  renderHubs(list);
}

function hubMessage(text) {
  $('hubMsg').textContent = text;
  $('hubMsg').hidden = !text;
}

$('hubList').addEventListener('click', (e) => {
  const star = e.target.closest('[data-star]');
  const remove = e.target.closest('[data-remove]');
  if (star) updateHubs(hubs.map((h, i) => (i === +star.dataset.star ? { ...h, major: !h.major } : h)));
  if (remove) updateHubs(hubs.filter((_, i) => i !== +remove.dataset.remove));
});

hubForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = hubForm.city.value.trim();
  if (hubs.some((h) => normalize(h.name) === normalize(name))) return hubMessage(`${name} já está na lista.`);
  $('addHub').disabled = true;
  hubMessage('Localizando…');
  try {
    const place = await geocode(name);
    await updateHubs([...hubs, { ...place, major: false }]);
    hubForm.city.value = '';
    hubMessage('');
  } catch (err) {
    hubMessage(err.message);
  } finally {
    $('addHub').disabled = false;
  }
});

$('resetHubs').addEventListener('click', async () => {
  await resetHubs();
  renderHubs(await loadHubs());
  hubMessage('Lista padrão restaurada.');
});
