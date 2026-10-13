import { SORTS } from './lib/planner.js';
import { geocode, normalize } from './lib/geo.js';
import {
  DEFAULTS, loadHubs, loadSavedRoutes, loadSettings, resetHubs, saveHubs, saveSavedRoutes, saveSettings,
} from './lib/settings.js';

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

// Paradas (cidades de conexão escolhidas na consulta). Começam sempre vazias ao abrir o painel.
let stops = [];

function renderStops() {
  for (const el of searchForm.querySelectorAll('.stop.mid')) el.remove();
  const addRow = $('addStopRow');
  stops.forEach((c, i) => addRow.insertAdjacentHTML('beforebegin', `<li class="stop mid">
    <span class="dot ring" aria-hidden="true"></span><span class="name">${esc(c)}</span>
    <button type="button" data-stop-remove="${i}" title="Remover parada" aria-label="Remover ${esc(c)}">×</button></li>`));
  $('stopsHint').textContent = stops.length
    ? 'A busca passa só pelas paradas que você escolheu, na ordem do caminho.'
    : 'Sem paradas, a extensão escolhe as conexões sozinha.';
  onTripChanged();
}

function addStop() {
  const name = $('stopInput').value.trim();
  if (name && !stops.some((c) => normalize(c) === normalize(name))) stops.push(name);
  $('stopInput').value = '';
  renderStops();
}

function showStopInput(show) {
  $('stopInput').hidden = !show;
  $('addStopBtn').hidden = show;
  if (show) $('stopInput').focus();
}

$('addStopBtn').addEventListener('click', () => showStopInput(true));
$('stopInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addStop(); } // Enter adiciona, não dispara a busca
  if (e.key === 'Escape') { $('stopInput').value = ''; $('stopInput').blur(); }
});
$('stopInput').addEventListener('blur', () => { addStop(); showStopInput(false); });
searchForm.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-stop-remove]');
  if (btn) { stops.splice(+btn.dataset.stopRemove, 1); renderStops(); }
});
$('swap').addEventListener('click', () => {
  [searchForm.from.value, searchForm.to.value] = [searchForm.to.value, searchForm.from.value];
  stops.reverse();
  renderStops();
});
searchForm.from.addEventListener('input', () => onTripChanged());
searchForm.to.addEventListener('input', () => onTripChanged());

chrome.storage.local.get('lastQuery').then(({ lastQuery }) => {
  if (!lastQuery) return;
  searchForm.from.value = lastQuery.from;
  searchForm.to.value = lastQuery.to;
  onTripChanged();
});

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(searchForm);
  if ($('stopInput').value.trim()) addStop(); // parada digitada e ainda não adicionada
  const query = {
    from: f.get('from').trim(), to: f.get('to').trim(), date: f.get('date'), seats: +f.get('seats') || 1,
    hubs: [...stops],
  };
  chrome.storage.local.set({ lastQuery: { from: query.from, to: query.to } });
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
  $('settingsSaved').hidden = true;
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
  $('settingsSaved').hidden = false;
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

// --- rotas salvas (origem, destino e paradas) ---
let savedRoutes = [];
let activeId = null; // rota salva aplicada no formulário
let nameMode = false; // editor de nome aberto

const currentTrip = () => ({ from: searchForm.from.value.trim(), to: searchForm.to.value.trim(), hubs: [...stops] });
const activeRoute = () => savedRoutes.find((r) => r.id === activeId);
const sameTrip = (a, b) => normalize(a.from) === normalize(b.from) && normalize(a.to) === normalize(b.to) &&
  a.hubs.length === b.hubs.length && a.hubs.every((h, i) => normalize(h) === normalize(b.hubs[i]));
const tripText = (r) => [r.from, ...r.hubs, r.to].join(' → ');
const byName = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

function saveMessage(text) {
  $('saveMsg').textContent = text;
  $('saveMsg').hidden = !text;
}

// Atualiza a barra de rotas salvas e o botão de salvar conforme o formulário.
function onTripChanged() {
  $('savedBar').hidden = savedRoutes.length === 0;
  $('savedChips').innerHTML = byName(savedRoutes).map((r) => `<li><button type="button" data-route="${esc(r.id)}"
    aria-pressed="${r.id === activeId}" title="${esc(tripText(r))}">${esc(r.name)}</button></li>`).join('');

  const active = activeRoute();
  const trip = currentTrip();
  const changed = active && !sameTrip(active, trip);
  const btn = $('saveBtn');
  btn.disabled = false;
  if (!active) btn.textContent = '☆ Salvar esta rota';
  else if (changed) btn.textContent = `Salvar alterações em “${active.name}”`;
  else { btn.textContent = `★ Salva como “${active.name}”`; btn.disabled = true; }
  $('saveAsNew').hidden = !changed;
  btn.parentElement.hidden = nameMode || !trip.from || !trip.to;
}

$('savedChips').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-route]');
  if (!btn) return;
  saveMessage('');
  if (btn.dataset.route === activeId) { activeId = null; onTripChanged(); return; } // segundo toque desmarca
  const r = savedRoutes.find((x) => x.id === btn.dataset.route);
  activeId = r.id;
  searchForm.from.value = r.from;
  searchForm.to.value = r.to;
  stops = [...r.hubs];
  renderStops();
});

const defaultName = () => `${searchForm.from.value.trim()} → ${searchForm.to.value.trim()}`;

function openNameEditor() {
  nameMode = true;
  $('routeName').value = defaultName();
  $('nameEditor').hidden = false;
  onTripChanged();
  $('routeName').select();
}

function closeNameEditor() {
  nameMode = false;
  $('nameEditor').hidden = true;
  onTripChanged();
}

$('saveBtn').addEventListener('click', async () => {
  const active = activeRoute();
  if (!active) return openNameEditor();
  savedRoutes = savedRoutes.map((x) => (x.id === active.id ? { ...x, ...currentTrip() } : x));
  await saveSavedRoutes(savedRoutes);
  saveMessage(`Alterações salvas em “${active.name}”.`);
  onTripChanged();
});
$('saveAsNew').addEventListener('click', openNameEditor);

$('nameOk').addEventListener('click', async () => {
  const name = $('routeName').value.trim();
  if (!name) return saveMessage('Dê um nome à rota.');
  if (savedRoutes.some((x) => x.name.toLowerCase() === name.toLowerCase())) return saveMessage(`Já existe uma rota chamada “${name}”.`);
  activeId = crypto.randomUUID();
  savedRoutes = [...savedRoutes, { id: activeId, name, ...currentTrip() }];
  await saveSavedRoutes(savedRoutes);
  saveMessage(`Rota “${name}” salva.`);
  closeNameEditor();
});
$('nameCancel').addEventListener('click', () => { saveMessage(''); closeNameEditor(); });
$('routeName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('nameOk').click(); }
  if (e.key === 'Escape') $('nameCancel').click();
});

// --- tela de gerenciar rotas salvas ---
let renamingId = null;

function showManage(show) {
  $('viewSearch').hidden = show;
  $('viewManage').hidden = !show;
  renamingId = null;
  if (show) renderManage(); else onTripChanged();
}

function renderManage() {
  const list = byName(savedRoutes);
  $('manageList').innerHTML = list.length ? list.map((r) => `<li data-id="${esc(r.id)}">
    <div class="title">${r.id === renamingId
      ? `<input class="rename" value="${esc(r.name)}" maxlength="40" aria-label="Novo nome">
         <button type="button" class="small" data-act="renameOk">Salvar</button>`
      : `<span>${esc(r.name)}</span>`}</div>
    <span class="muted">${esc(tripText(r))}</span>
    <div class="actions">
      <button type="button" class="link" data-act="rename">Renomear</button>
      <button type="button" class="link danger-text" data-act="delete">Excluir</button>
    </div></li>`).join('') : '<li class="muted">Nenhuma rota salva.</li>';
  $('manageList').querySelector('.rename')?.select();
}

$('openManage').addEventListener('click', () => showManage(true));
$('closeManage').addEventListener('click', () => showManage(false));

$('manageList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('li').dataset.id;
  if (btn.dataset.act === 'rename') { renamingId = id; renderManage(); return; }
  if (btn.dataset.act === 'renameOk') {
    const name = btn.closest('li').querySelector('.rename').value.trim();
    if (!name || savedRoutes.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return;
    savedRoutes = savedRoutes.map((x) => (x.id === id ? { ...x, name } : x));
  } else if (btn.dataset.act === 'delete') {
    if (!btn.dataset.confirm) { // segundo clique confirma
      btn.dataset.confirm = '1';
      btn.textContent = 'Confirmar exclusão';
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.confirm; btn.textContent = 'Excluir'; } }, 3000);
      return;
    }
    savedRoutes = savedRoutes.filter((x) => x.id !== id);
    if (activeId === id) activeId = null;
  }
  renamingId = null;
  await saveSavedRoutes(savedRoutes);
  renderManage();
});
$('manageList').addEventListener('keydown', (e) => {
  if (!e.target.matches('.rename')) return;
  if (e.key === 'Enter') e.target.closest('li').querySelector('[data-act="renameOk"]').click();
  if (e.key === 'Escape') { renamingId = null; renderManage(); }
});

loadSavedRoutes().then((list) => { savedRoutes = list; renderStops(); });
