// A few pixels of depth between the bridge frame and the panels. Small on purpose: comfort over spectacle.

export const MAX_PARALLAX_PX = 14;

/** `nx`, `ny` are the pointer position from -1 to 1 across the stage. `depth` is 0 (still) to 1 (moves most). */
export function parallaxOffset(nx: number, ny: number, depth: number, enabled: boolean, max = MAX_PARALLAX_PX): { x: number; y: number } {
  if (!enabled || !Number.isFinite(nx) || !Number.isFinite(ny)) return { x: 0, y: 0 };
  const c = (n: number) => Math.max(-1, Math.min(1, n));
  const d = Math.max(0, Math.min(1, depth));
  const r = (n: number) => (Math.round(n * 10) / 10) + 0;
  return { x: r(-c(nx) * d * max), y: r(-c(ny) * d * max * 0.6) };
}
