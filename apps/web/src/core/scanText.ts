/** Turns what a computer check returned into readable text. Never lets a nested value show up as "[object Object]". */

export interface SummaryRow { label: string; value: string; tone: "ok" | "warn" }
export interface Idea { id: string; title: string; why: string; ask?: string }

const GB = 1024 ** 3;
const label = (k: string) => k.replace(/_/g, " ");

/** One value as plain text: numbers that look like byte counts become GB, lists are joined, objects become "key value, key value". */
export function plainValue(key: string, v: unknown): string {
  if (v === null || v === undefined) return "not available";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return key.endsWith("bytes") ? `${(v / GB).toFixed(1)} GB` : String(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" && x !== null ? plainValue(key, x) : String(x))).join(", ") || "none";
  return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${label(k.replace(/_bytes$/, ""))} ${plainValue(k, x)}`).join(", ");
}

/** Older results carried only raw facts. This keeps them readable. */
export function factRows(facts: Record<string, unknown>): { label: string; value: string }[] {
  return Object.entries(facts).map(([k, v]) => ({ label: label(k), value: plainValue(k, v) }));
}
