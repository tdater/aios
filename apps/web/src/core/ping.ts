// An optional soft sound when something new arrives. Off unless the person turns it on; the choice stays on this device.
const KEY = "aios.arrival.ping";

export function pingEnabled(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function setPingEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private window: the choice just does not stick */ }
}

/** Two short, quiet notes. Does nothing when the browser has no audio or is not allowed to start it. */
export function playPing(enabled = pingEnabled()): boolean {
  if (!enabled) return false;
  try {
    const Ctx: typeof AudioContext | undefined = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx(), now = ctx.currentTime;
    [660, 880].forEach((hz, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.06, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.12); osc.stop(now + i * 0.12 + 0.4);
    });
    setTimeout(() => void ctx.close().catch(() => undefined), 1200);
    return true;
  } catch { return false; }
}
