/** Small vibrations for touch screens, through the browser's own vibrate call (no plugin, no permission). Silent where there is no vibration
 *  motor, when the person asked for reduced motion, or when `enabled` is false. */
export type Buzz = "tick" | "success" | "warn";
const PATTERNS: Record<Buzz, number | number[]> = { tick: 8, success: [14, 40, 22], warn: [30, 60, 30] };

export function buzz(kind: Buzz, opts: { reducedMotion?: boolean; nav?: Pick<Navigator, "vibrate"> | null } = {}): boolean {
  if (opts.reducedMotion) return false;
  const nav = opts.nav === undefined ? (typeof navigator === "undefined" ? null : navigator) : opts.nav;
  if (!nav || typeof nav.vibrate !== "function") return false;
  try { return nav.vibrate(PATTERNS[kind]); } catch { return false; }
}
