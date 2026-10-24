// Secrets (bearer tokens) live ONLY here. On Android this is backed by the Keystore (see platform/native.ts).
// The browser/PWA build uses an HttpOnly cookie instead, so it stores no token at all.
export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Process-memory only: used by tests and as a safe fallback (token vanishes on restart => re-pair). */
export class MemorySecureStore implements SecureStore {
  private m = new Map<string, string>();
  async get(k: string) {
    return this.m.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.m.set(k, v);
  }
  async remove(k: string) {
    this.m.delete(k);
  }
}

export const tokenKey = (serverLocalId: string) => `aios.token.${serverLocalId}`;
