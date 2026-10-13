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

export async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULTS, ...settings };
}

export const saveSettings = (settings) => chrome.storage.sync.set({ settings });
