import { Store } from "../core/connection";

export interface UpdateState { ready: boolean; apply: () => void }
export const updateStore = new Store<UpdateState>({ ready: false, apply: () => {} });

/** Service worker lifecycle. A new worker WAITS; the user chooses when to apply it (no silent swaps
 *  that could pair new assets with an old API contract). Skipped inside the native shell, whose
 *  assets are bundled in the APK. */
export async function registerServiceWorker(isNative: boolean): Promise<void> {
  if (isNative || !("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const offer = (w: ServiceWorker) =>
      updateStore.set({ ready: true, apply: () => { w.postMessage({ type: "SKIP_WAITING" }); } });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) offer(w);
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
    setInterval(() => void reg.update().catch(() => {}), 30 * 60 * 1000);
  } catch {
    /* no offline shell; the app still works online */
  }
}

/** Used when the server reports an incompatible client: drop every cached shell and reload. */
export async function resetAppCaches(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((regs ?? []).map((r) => r.unregister()));
    const names = await caches?.keys();
    await Promise.all((names ?? []).filter((n) => n.startsWith("aios-shell-")).map((n) => caches.delete(n)));
  } finally {
    location.reload();
  }
}
