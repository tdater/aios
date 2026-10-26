// The Proof Seal: a small emblem that is a pure function of recorded facts.
//   * its SHAPE comes from the patch hash, so the same change always has the same seal and no two look alike;
//   * its RINGS are real, independent checks that passed (a person approved the run, the tests passed on this exact
//     revision, an independent review of this exact revision found no high-severity problem);
//   * its STATE says how far to trust it: solid (ready), cracked (a check failed), hollow (nothing verified yet).
// A seal never says more than the facts do. It teaches the difference between "verified" and "trust me".
import type { ConversationView, Readiness } from "./types";

export interface SealChecks { approved: boolean | null; tests: boolean | null; review: boolean | null }   // null = not done
export type SealState = "ready" | "cracked" | "hollow";
export interface SealGeometry { edge: string; crack: string; dots: { x: number; y: number }[]; lobes: number }

export const RING_RADII = { approved: 31, tests: 25, review: 19 } as const;

/** Up to `n` bytes from a hex hash. Anything that is not hex, or a missing hash, falls back to fixed filler. */
export function hashBytes(hash: string | null | undefined, n = 16): number[] {
  const clean = (hash ?? "").toLowerCase().replace(/[^0-9a-f]/g, "");
  return Array.from({ length: n }, (_, i) => {
    const pair = clean.slice(i * 2, i * 2 + 2);
    return pair.length === 2 ? parseInt(pair, 16) : (i * 37 + 11) % 256;
  });
}

const f = (x: number) => (Math.round(x * 100) / 100).toString();

export function sealGeometry(hash: string | null | undefined): SealGeometry {
  const b = hashBytes(hash, 16);
  const lobes = 6 + (b[0] % 7);                                   // 6..12 points
  const outer = 46, innerBase = 34 + (b[1] % 7);
  const phase = (b[2] / 256) * ((2 * Math.PI) / lobes);
  const pts: [number, number][] = [];
  for (let i = 0; i < lobes * 2; i++) {
    const a = phase + (i * Math.PI) / lobes - Math.PI / 2;
    const r = i % 2 === 0 ? outer - (b[3 + (i % 12)] % 3) : innerBase + (b[3 + ((i + 5) % 12)] % 3);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  // closed path of quadratic curves through the midpoints, so the edge looks like a stamped wax seal
  const mid = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const start = mid(pts[pts.length - 1], pts[0]);
  let edge = `M${f(start[0])} ${f(start[1])}`;
  pts.forEach((p, i) => { const m = mid(p, pts[(i + 1) % pts.length]); edge += ` Q${f(p[0])} ${f(p[1])} ${f(m[0])} ${f(m[1])}`; });
  edge += "Z";

  const dotCount = 3 + (b[10] % 4), dotPhase = (b[11] / 256) * 2 * Math.PI;
  const dots = Array.from({ length: dotCount }, (_, i) => {
    const a = dotPhase + (i * 2 * Math.PI) / dotCount;
    return { x: Math.round(Math.cos(a) * 8 * 100) / 100, y: Math.round(Math.sin(a) * 8 * 100) / 100 };
  });

  const ca = (b[12] / 256) * 2 * Math.PI;                          // a jagged crack from the rim toward the centre
  let crack = `M${f(Math.cos(ca) * 46)} ${f(Math.sin(ca) * 46)}`;
  for (let k = 1; k <= 5; k++) {
    const r = 46 - k * 8.5, wob = ((b[(12 + k) % 16] % 9) - 4) * 0.9;
    crack += ` L${f(Math.cos(ca) * r - Math.sin(ca) * wob)} ${f(Math.sin(ca) * r + Math.cos(ca) * wob)}`;
  }
  return { edge, crack, dots, lobes };
}

export const sealStrength = (c: SealChecks) => [c.approved, c.tests, c.review].filter((x) => x === true).length;

/** hollow: nothing verified. cracked: something that was checked failed, or the AIOS verdict is not ready. ready: AIOS says ready. */
export function sealState(ready: boolean | null, c: SealChecks): SealState {
  if (c.tests === null && c.review === null) return "hollow";
  if (c.tests === false || c.review === false || ready === false) return "cracked";
  return ready ? "ready" : "hollow";
}

export interface SealView { state: SealState; checks: SealChecks; strength: number; label: string }

/** The seal for a conversation's current change: hash from the recorded patch, rings from the AIOS verdict. A review
 *  only counts when it was of exactly this revision (`readiness.reviewed`). */
export function sealOfChanges(c: ConversationView["changes"]): { hash: string | null; view: SealView; show: boolean } {
  const r = c.readiness;
  const rev = (c.review?.meta as { review?: { counts?: { high?: number } } } | null)?.review;
  const high = r.reviewed ? Number(rev?.counts?.high ?? 0) : null;
  const hash = ((c.patch?.meta as { sha256?: string } | null)?.sha256) ?? null;
  return { hash, view: sealFor(r, high, r.head_revision), show: !!r.head_revision };
}

/** Everything the emblem shows, derived from the AIOS verdict and the review of the same revision. */
export function sealFor(r: Readiness, reviewHigh: number | null, revision: string | null): SealView {
  const checks: SealChecks = {
    approved: r.verified === null ? null : true,                   // a verification result exists only after a person approved that exact run
    tests: r.verified,
    review: r.reviewed ? reviewHigh === 0 : null,
  };
  const state = sealState(r.head_revision ? r.ready : null, checks);
  const strength = sealStrength(checks);
  const said = (v: boolean | null, yes: string, no: string, none: string) => (v === true ? yes : v === false ? no : none);
  const label = `Proof seal for revision ${revision ? revision.slice(0, 8) : "none"}: ${state === "ready" ? "ready" : state === "cracked" ? "a check failed" : "not verified"}. `
    + [said(checks.approved, "you approved the test run", "", "no approved test run"),
       said(checks.tests, "tests passed on this revision", "tests failed on this revision", "tests not run"),
       said(checks.review, "independent review found no high-severity problem", "independent review found a high-severity problem", "no independent review")].filter(Boolean).join(", ")
    + `. ${strength} of 3 checks.`;
  return { state, checks, strength, label };
}
