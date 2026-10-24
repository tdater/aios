import { KV, readJson, writeJson } from "./storage";

// Only NON-SECRET SUMMARIES, only if the user opted in, always partitioned by server identity.
// Never cached: approvals, artifacts, logs, run events, memory bodies, tokens, API responses in bulk.
export type CacheKey = "home" | "projects";
const PREFIX = "aios.cache.v1.";

export interface CachedValue<T> { value: T; at: string }

export class SummaryCache {
  constructor(private kv: KV, private enabled: () => boolean) {}
  private k(partition: string, key: CacheKey) {
    return `${PREFIX}${partition}.${key}`;
  }
  put<T>(partition: string, key: CacheKey, value: T): void {
    if (!this.enabled() || !partition) return;
    writeJson(this.kv, this.k(partition, key), { value, at: new Date().toISOString() } satisfies CachedValue<T>);
  }
  get<T>(partition: string, key: CacheKey): CachedValue<T> | null {
    if (!this.enabled() || !partition) return null;
    return readJson<CachedValue<T> | null>(this.kv, this.k(partition, key), null);
  }
  clearPartition(partition: string): void {
    for (const k of this.kv.keys(`${PREFIX}${partition}.`)) this.kv.remove(k);
  }
  clearAll(): void {
    for (const k of this.kv.keys(PREFIX)) this.kv.remove(k);
  }
}
