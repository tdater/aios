// The trip between destinations: the bridge stays still, only the window changes. Short and skippable.

export const WARP_MS = 1500;
export const WARP_REDUCED_MS = 250;
export type WarpPhase = "idle" | "charge" | "streak" | "arrive";

/** `swapAt` is when the destination changes (hidden by the flash); `total` is when the trip ends. */
export function warpPlan(reduced: boolean): { total: number; swapAt: number } {
  return reduced ? { total: WARP_REDUCED_MS, swapAt: WARP_REDUCED_MS / 2 } : { total: WARP_MS, swapAt: Math.round(WARP_MS * 0.55) };
}

/** What the window should look like `t` ms into a trip. */
export function warpPhase(t: number, reduced: boolean): WarpPhase {
  const { total, swapAt } = warpPlan(reduced);
  if (t < 0 || t >= total) return "idle";
  if (reduced) return t < swapAt ? "charge" : "arrive";
  if (t < swapAt * 0.4) return "charge";
  if (t < swapAt) return "streak";
  return "arrive";
}
