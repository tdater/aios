import { createContext, useContext } from "react";
import { AiosClient } from "../core/client";
import { ConnSnapshot } from "../core/connection";
import { SummaryCache } from "../core/cache";
import { DraftStore } from "../core/drafts";
import { ServerEntry, ServerRegistry } from "../core/servers";
import { Settings } from "../core/settings";

export interface AppCtx {
  client: AiosClient;
  server: ServerEntry;
  registry: ServerRegistry;
  conn: ConnSnapshot;
  /** true only when the server was reached recently: gates approvals, destructive actions, "current status" claims */
  connected: boolean;
  partition: string;          // server identity; cache + drafts are namespaced by it
  cache: SummaryCache;
  drafts: DraftStore;
  settings: Settings;
  updateSettings: (p: Partial<Settings>) => void;
  isNative: boolean;
  signOut: () => Promise<void>;
  /** Switch the active server (or null => back to the server setup screen). Re-initialises the app. */
  switchServer: (id: string | null) => void;
  removeServer: (id: string) => Promise<void>;
  clearLocalData: () => void;
}

export const AppContext = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error("AppContext missing");
  return c;
}
