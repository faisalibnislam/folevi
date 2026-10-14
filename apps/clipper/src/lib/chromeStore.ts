// chrome.storage areas as the Store the session needs: local for what survives a restart, session for
// what lives in memory only (the access token).
import type { Store } from "./session";

export function chromeStore(area: chrome.storage.StorageArea): Store {
  return {
    get: async (key) => (await area.get(key))[key],
    set: async (key, value) => {
      await area.set({ [key]: value });
    },
    remove: async (key) => {
      await area.remove(key);
    },
  };
}
