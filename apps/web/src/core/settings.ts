import { KV, readJson, writeJson } from "./storage";
import { Store } from "./connection";

export interface Settings {
  theme: "system" | "dark" | "light";
  cacheEnabled: boolean;                 // opt-in: cache non-secret summaries for offline viewing
  draftPolicy: "manual" | "ask_on_reconnect";   // there is deliberately no "auto upload"
}
const KEY = "aios.settings.v1";
export const DEFAULT_SETTINGS: Settings = { theme: "system", cacheEnabled: false, draftPolicy: "ask_on_reconnect" };

export function createSettingsStore(kv: KV) {
  const store = new Store<Settings>({ ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(kv, KEY, {}) });
  return {
    store,
    update(patch: Partial<Settings>) {
      const next = { ...store.get(), ...patch };
      writeJson(kv, KEY, next);
      store.set(next);
    },
  };
}
