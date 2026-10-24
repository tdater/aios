import { SummaryCache } from "./cache";
import { DraftStore } from "./drafts";
import { ServerEntry, ServerRegistry } from "./servers";
import { createSettingsStore } from "./settings";
import { tokenKey } from "./secure";
import { KV, LocalKV } from "./storage";
import { Platform } from "../platform";

/** Wires the local, non-secret state together. Partition key = server identity (never a URL). */
export function createRuntime(platform: Platform, kv: KV = new LocalKV()) {
  const settings = createSettingsStore(kv);
  const cache = new SummaryCache(kv, () => settings.store.get().cacheEnabled);
  const drafts = new DraftStore(kv);
  const partitionOf = (s: ServerEntry) => s.serverId ?? s.id;
  const registry = new ServerRegistry(kv, async (s) => {
    await platform.secure.remove(tokenKey(s.id));   // token gone with the server entry
    cache.clearPartition(partitionOf(s));
    drafts.clear(partitionOf(s));
  });
  return { kv, settings, cache, drafts, registry, partitionOf };
}
export type Runtime = ReturnType<typeof createRuntime>;
