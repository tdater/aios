/** The Runs list as an activity timeline: grouped by day, with what happened said in plain words instead of an internal task kind. */

export type Bucket = "Today" | "Yesterday" | "This week" | "Earlier";
export const BUCKETS: Bucket[] = ["Today", "Yesterday", "This week", "Earlier"];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function dayBucket(iso: string, now: Date = new Date()): Bucket {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "Earlier";
  const days = Math.floor((startOfDay(now) - startOfDay(new Date(t))) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "This week" : "Earlier";
}

const PLAIN: Record<string, { icon: string; text: string }> = {
  "claude.turn": { icon: "💬", text: "Talked with Claude" },
  "claude.review": { icon: "🔍", text: "Reviewed a change" },
  "claude.apply": { icon: "🔀", text: "Merged a change into a project" },
  "audit.workspace": { icon: "🧾", text: "Checked a project's files" },
  "capture.note": { icon: "📝", text: "Saved a note" },
  "provider.task": { icon: "📨", text: "Prepared a task for another AI" },
  "demo.guarded_write": { icon: "📄", text: "Wrote a file after approval" },
};

/** What a run was, in everyday words. Unknown kinds fall back to a neutral line rather than an internal name. */
export function plainKind(kind: string): { icon: string; text: string } {
  return PLAIN[kind] ?? { icon: "⚙️", text: kind.startsWith("demo.") ? "Ran a test task" : "Did some work" };
}

export function groupByDay<T extends { created_at: string }>(items: T[], now: Date = new Date()): { bucket: Bucket; items: T[] }[] {
  return BUCKETS.map((bucket) => ({ bucket, items: items.filter((i) => dayBucket(i.created_at, now) === bucket) })).filter((g) => g.items.length > 0);
}
