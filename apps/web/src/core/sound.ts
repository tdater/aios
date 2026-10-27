// Small synthesised interface sounds (no audio files, no network). Off until the person turns them on; the choice stays on this device.
// Separate from the arrival ping in ping.ts. Never plays while reduced motion is requested or the page is hidden.
const KEY = "aios.sound.ui";

export type SoundName = "chime" | "warp" | "tick";

export function soundEnabled(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function setSoundEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private window: the choice just does not stick */ }
}

type Ctx = Pick<AudioContext, "createOscillator" | "createGain" | "createBiquadFilter" | "currentTime" | "destination" | "resume" | "state">;
let shared: Ctx | null = null;
const make = (): Ctx | null => {
  const C: (new () => AudioContext) | undefined = (globalThis as { AudioContext?: new () => AudioContext }).AudioContext;
  return C ? new C() : null;
};

/** One note: a sine that ramps from `from` to `to` Hz with a soft attack and release. */
function note(ctx: Ctx, at: number, from: number, to: number, dur: number, peak: number, type: OscillatorType = "sine", lowpass?: number) {
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.linearRampToValueAtTime(to, at + dur);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.02, dur / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  if (lowpass) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lowpass; osc.connect(f).connect(gain); } else osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at); osc.stop(at + dur + 0.05);
}

const RECIPES: Record<SoundName, (ctx: Ctx, t: number) => void> = {
  chime: (c, t) => { note(c, t, 523, 523, 0.35, 0.05); note(c, t + 0.1, 659, 659, 0.45, 0.05); },               // a warm rising pair: something finished
  warp: (c, t) => note(c, t, 120, 80, 0.45, 0.06, "sawtooth", 400),                                          // a low sweep: you are travelling
  tick: (c, t) => note(c, t, 1800, 1200, 0.02, 0.03, "square"),                                              // a faint 20 ms click
};

/** Plays one sound if the person turned sounds on, motion is not reduced and the page is visible. Returns whether it played. */
export function playSound(name: SoundName, opts: { enabled?: boolean; reducedMotion?: boolean; make?: () => Ctx | null } = {}): boolean {
  if (!(opts.enabled ?? soundEnabled()) || opts.reducedMotion) return false;
  if (typeof document !== "undefined" && document.hidden) return false;
  try {
    const ctx = opts.make ? opts.make() : (shared ??= make());
    if (!ctx) return false;
    if (ctx.state === "suspended") void ctx.resume();
    RECIPES[name](ctx, ctx.currentTime);
    return true;
  } catch { return false; }
}
