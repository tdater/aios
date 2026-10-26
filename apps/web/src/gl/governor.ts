// Quality governor: watches frame time and steps quality down when the GPU cannot keep up.
// Order of sacrifices: pixel ratio, then bloom, then background star count. It never steps back up on its own,
// so the picture does not oscillate.
export type Tier = "high" | "medium" | "low";

export interface QualitySettings { level: number; tier: Tier; pixelRatio: number; bloom: boolean; starFraction: number }

export const MAX_LEVEL = 3;

export function settingsFor(level: number, devicePixelRatio: number): QualitySettings {
  const dpr = Math.min(2, Math.max(0.5, devicePixelRatio || 1));
  const l = Math.max(0, Math.min(MAX_LEVEL, level));
  const pixelRatio = l === 0 ? dpr : l === 1 ? Math.min(dpr, dpr > 1 ? 1 : 0.85) : 0.75;
  return { level: l, tier: l === 0 ? "high" : l === 1 ? "medium" : "low", pixelRatio, bloom: l < 2, starFraction: l < 3 ? 1 : 0.35 };
}

export class QualityGovernor {
  level = 0;
  private samples: { at: number; ms: number }[] = [];
  constructor(readonly budgetMs = 24, readonly windowMs = 2000, readonly gapMs = 1000, readonly stallMs = 250) {}

  /** Record one frame. Returns true when the level changed. Gaps (tab switches, debugger) restart the window and
   * one-off stalls (shader compiles, garbage collection) are skipped. */
  sample(frameMs: number, now: number): boolean {
    if (!(frameMs > 0) || frameMs > this.gapMs) { this.samples = []; return false; }
    if (frameMs > this.stallMs) return false;
    this.samples.push({ at: now, ms: frameMs });
    while (this.samples.length && now - this.samples[0].at > this.windowMs) this.samples.shift();
    const span = this.samples.length > 1 ? now - this.samples[0].at : 0;
    if (span < this.windowMs * 0.95 || this.level >= MAX_LEVEL) return false;
    const mean = this.samples.reduce((s, x) => s + x.ms, 0) / this.samples.length;
    if (mean <= this.budgetMs) return false;
    this.level++;
    this.samples = [];
    return true;
  }

  get tier(): Tier { return settingsFor(this.level, 1).tier; }
}
