import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function loadSw(shell = ["/", "/index.html", "/assets/app.js"]) {
  const src = readFileSync(resolve(__dirname, "../pwa/sw.template.js"), "utf8")
    .replace("__BUILD_ID__", "b2").replace("__SHELL_ASSETS__", JSON.stringify(shell));
  const handlers: Record<string, (e: any) => void> = {};
  const stores = new Map<string, Set<string>>([["aios-shell-b1", new Set(["/old"])], ["other-app-cache", new Set(["/keep"])]]);
  const self: any = { addEventListener: (t: string, f: any) => (handlers[t] = f), location: { origin: "https://aios.example" }, clients: { claim: vi.fn(async () => {}) }, skipWaiting: vi.fn() };
  const caches: any = {
    open: async (n: string) => { if (!stores.has(n)) stores.set(n, new Set()); return { addAll: async (urls: string[]) => urls.forEach((u) => stores.get(n)!.add(u)) }; },
    keys: async () => [...stores.keys()], delete: async (n: string) => stores.delete(n),
    match: vi.fn(async (r: any) => (typeof r === "string" ? { cached: r } : undefined)),
  };
  const fetch = vi.fn(async (r: any) => ({ network: r.url }));
  // The worker is our own repo file; run it in an isolated vm context with stubbed globals.
  runInNewContext(src, { self, caches, fetch, URL });
  return { handlers, self, stores, caches, fetch };
}
const ev = (url: string, method = "GET", mode = "cors") => { const e: any = { request: { url, method, mode }, respondWith: vi.fn() }; return e; };

describe("service worker", () => {
  it("installs the app shell under a versioned cache and does NOT skip waiting by itself", async () => {
    const sw = loadSw();
    let p: Promise<unknown> | undefined;
    sw.handlers.install({ waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
    expect([...sw.stores.get("aios-shell-b2")!]).toEqual(["/", "/index.html", "/assets/app.js"]);
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();                            // updates wait for the user
  });

  it("applies an update only when asked, and cleans only its own old caches", async () => {
    const sw = loadSw();
    sw.handlers.message({ data: { type: "SKIP_WAITING" } });
    expect(sw.self.skipWaiting).toHaveBeenCalledOnce();
    let p: Promise<unknown> | undefined;
    sw.handlers.activate({ waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
    expect(sw.stores.has("aios-shell-b1")).toBe(false);
    expect(sw.stores.has("other-app-cache")).toBe(true);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });

  it("never intercepts or caches API traffic, writes, or cross-origin requests", () => {
    const sw = loadSw();
    for (const e of [ev("https://aios.example/api/v1/home"), ev("https://aios.example/api/v1/approvals/x/decide", "POST"),
      ev("https://aios.example/assets/app.js", "POST"), ev("https://evil.example/assets/app.js")]) {
      sw.handlers.fetch(e);
      expect(e.respondWith).not.toHaveBeenCalled();
    }
  });

  it("serves hashed assets cache-first and navigations network-first with an offline shell fallback", async () => {
    const sw = loadSw();
    const asset = ev("https://aios.example/assets/app.js");
    sw.handlers.fetch(asset);
    expect(asset.respondWith).toHaveBeenCalledOnce();
    const nav = ev("https://aios.example/", "GET", "navigate");
    sw.handlers.fetch(nav);
    const res = await nav.respondWith.mock.calls[0][0];
    expect(res).toEqual({ network: "https://aios.example/" });                     // fresh HTML when online
    sw.fetch.mockRejectedValueOnce(new Error("offline"));
    const nav2 = ev("https://aios.example/", "GET", "navigate");
    sw.handlers.fetch(nav2);
    expect(await nav2.respondWith.mock.calls[0][0]).toEqual({ cached: "/index.html" });
  });
});
