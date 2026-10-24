// Non-secret key/value storage. Wraps localStorage defensively (it can be missing or throw).
// NEVER put tokens, passwords, approvals, logs, prompts or artifacts here.
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(prefix: string): string[];
}

export class LocalKV implements KV {
  private mem = new Map<string, string>();
  private ls(): Storage | null {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }
  get(key: string) {
    try {
      return this.ls()?.getItem(key) ?? this.mem.get(key) ?? null;
    } catch {
      return this.mem.get(key) ?? null;
    }
  }
  set(key: string, value: string) {
    try {
      const s = this.ls();
      if (s) return s.setItem(key, value);
    } catch {
      /* fall through to memory */
    }
    this.mem.set(key, value);
  }
  remove(key: string) {
    this.mem.delete(key);
    try {
      this.ls()?.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  keys(prefix: string) {
    const out = new Set([...this.mem.keys()].filter((k) => k.startsWith(prefix)));
    try {
      const s = this.ls();
      for (let i = 0; s && i < s.length; i++) {
        const k = s.key(i);
        if (k?.startsWith(prefix)) out.add(k);
      }
    } catch {
      /* ignore */
    }
    return [...out];
  }
}

export class MemoryKV implements KV {
  m = new Map<string, string>();
  get = (k: string) => this.m.get(k) ?? null;
  set = (k: string, v: string) => void this.m.set(k, v);
  remove = (k: string) => void this.m.delete(k);
  keys = (p: string) => [...this.m.keys()].filter((k) => k.startsWith(p));
}

export function readJson<T>(kv: KV, key: string, fallback: T): T {
  try {
    const v = kv.get(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
export const writeJson = (kv: KV, key: string, v: unknown) => kv.set(key, JSON.stringify(v));
