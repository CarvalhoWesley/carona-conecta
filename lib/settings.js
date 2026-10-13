import { DEFAULT_HUBS } from './hubs.js';

export const DEFAULTS = {
  maxLegs: 3,
  minLayoverMin: 20,
  maxWaitMin: 240,
  maxTransferKm: 3,
  maxDetour: 0.4,
  maxHubs: 8,
  maxSearches: 20,
  delaySec: 4,
};

// Tetos para manter o volume de consultas baixo (uso pessoal; ver Termos do BlaBlaCar, art. 11.1).
export const LIMITS = { maxSearches: 40, minDelaySec: 3 };

export const clampSettings = (s) => ({
  ...s,
  maxSearches: Math.min(s.maxSearches, LIMITS.maxSearches),
  delaySec: Math.max(s.delaySec, LIMITS.minDelaySec),
});

export async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return clampSettings({ ...DEFAULTS, ...settings });
}

export const saveSettings = (settings) => chrome.storage.sync.set({ settings });

// Cidades de conexão do usuário (local: a lista pode passar do limite por item do sync).
export async function loadHubs() {
  const { hubs } = await chrome.storage.local.get('hubs');
  return hubs ?? DEFAULT_HUBS;
}

export const saveHubs = (hubs) => chrome.storage.local.set({ hubs });
export const resetHubs = () => chrome.storage.local.remove('hubs');

// Rotas salvas: { id, name, from, to, hubs[] }.
export async function loadSavedRoutes() {
  const { savedRoutes } = await chrome.storage.local.get('savedRoutes');
  return savedRoutes ?? [];
}

export const saveSavedRoutes = (savedRoutes) => chrome.storage.local.set({ savedRoutes });
