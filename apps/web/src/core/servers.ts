import { KV, readJson, writeJson } from "./storage";
import { newKey } from "./client";

export interface ServerEntry {
  id: string;            // local id
  label: string;
  url: string;           // "" = same origin as the page (browser/PWA deployment)
  serverId?: string;     // identity reported by the server's /meta; detects "different server at same URL"
  addedAt: string;
}

const KEY = "aios.servers.v1";
const ACTIVE = "aios.server.active";
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/;

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/** HTTPS only. Cleartext is refused outright, except explicit dev loopback when the build allows it. */
export function checkServerUrl(raw: string, allowDevLoopback = false): UrlCheck {
  const s = raw.trim().replace(/\/+$/, "");
  if (s === "") return { ok: true, url: "" };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  if (u.username || u.password) return { ok: false, reason: "Do not put credentials in the URL." };
  if (u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return { ok: false, reason: "Use only the server address, without a path." };
  if (u.protocol === "https:") return { ok: true, url: u.origin };
  if (allowDevLoopback && LOOPBACK.test(u.origin)) return { ok: true, url: u.origin };
  return { ok: false, reason: "HTTPS is required. Plain HTTP is not allowed." };
}

export class ServerRegistry {
  constructor(private kv: KV, private onRemove: (s: ServerEntry) => Promise<void> | void = () => {}) {}

  list(): ServerEntry[] {
    return readJson<ServerEntry[]>(this.kv, KEY, []);
  }
  private save(l: ServerEntry[]) {
    writeJson(this.kv, KEY, l);
  }
  add(label: string, url: string): ServerEntry {
    const e: ServerEntry = { id: newKey(), label: label.trim() || url || "This server", url, addedAt: new Date().toISOString() };
    this.save([...this.list(), e]);
    if (!this.activeId()) this.setActive(e.id);
    return e;
  }
  activeId(): string | null {
    return this.kv.get(ACTIVE);
  }
  active(): ServerEntry | null {
    const id = this.activeId();
    return this.list().find((s) => s.id === id) ?? null;
  }
  setActive(id: string) {
    this.kv.set(ACTIVE, id);
  }
  clearActive() {
    this.kv.remove(ACTIVE);
  }
  /** Compare the identity the server reports with what we stored. */
  recordServerId(id: string, serverId: string): "first" | "same" | "changed" {
    const l = this.list();
    const e = l.find((s) => s.id === id);
    if (!e) return "first";
    if (!e.serverId) {
      e.serverId = serverId;
      this.save(l);
      return "first";
    }
    return e.serverId === serverId ? "same" : "changed";
  }
  /** User confirmed the address now legitimately points at a new server: adopt identity, caller wipes caches. */
  adoptServerId(id: string, serverId: string) {
    const l = this.list();
    const e = l.find((s) => s.id === id);
    if (e) {
      e.serverId = serverId;
      this.save(l);
    }
  }
  async remove(id: string) {
    const l = this.list();
    const e = l.find((s) => s.id === id);
    this.save(l.filter((s) => s.id !== id));
    if (this.activeId() === id) this.kv.remove(ACTIVE);
    if (e) await this.onRemove(e);
  }
}
