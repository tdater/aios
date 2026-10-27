import { ChecklistItem, Widget, dayKey, doneToday } from "./widgets";

/** The daily bookends: what to look at in the morning, what to wrap up in the evening. Everything is read from this person's own
 *  panels and notes on this device. Pure functions, so the screen only has to show them. */

type Checklist = Extract<Widget, { kind: "checklist" }>;
type Habit = Extract<Widget, { kind: "habit" }>;

export const isEvening = (now: Date = new Date()) => now.getHours() >= 17;

const looksLikeTopThree = (w: Widget): w is Checklist => w.kind === "checklist" && /top\s*3|top three|priorit/i.test(w.title);

/** The checklist that holds today's priorities: the one named like "Today's top 3", else the first checklist. */
export function topChecklist(widgets: Widget[]): Checklist | null {
  return widgets.find(looksLikeTopThree) ?? (widgets.find((w): w is Checklist => w.kind === "checklist") ?? null);
}

export function topThree(widgets: Widget[]): ChecklistItem[] {
  return (topChecklist(widgets)?.config.items ?? []).filter((i) => !i.done).slice(0, 3);
}

export function habitsDue(widgets: Widget[], today: Date = new Date()): Habit[] {
  return widgets.filter((w): w is Habit => w.kind === "habit" && !doneToday(w.config.days, today));
}

export function habitsDone(widgets: Widget[], today: Date = new Date()): Habit[] {
  return widgets.filter((w): w is Habit => w.kind === "habit" && doneToday(w.config.days, today));
}

/** Notes made on this calendar date in an earlier year ("a year ago today"). Oldest first. */
export function flashbacks<T extends { title: string; created_at?: string }>(notes: T[], today: Date = new Date()): { note: T; yearsAgo: number }[] {
  const md = dayKey(today).slice(5);
  return notes.flatMap((note) => {
    const c = note.created_at?.slice(0, 10);
    if (!c || c.slice(5) !== md) return [];
    const yearsAgo = today.getFullYear() - Number(c.slice(0, 4));
    return yearsAgo >= 1 ? [{ note, yearsAgo }] : [];
  }).sort((a, b) => b.yearsAgo - a.yearsAgo);
}

/** Tomorrow's list: what is done is cleared, what is not stays, in the same order. */
export function carryOver(items: ChecklistItem[]): { next: ChecklistItem[]; cleared: number } {
  const next = items.filter((i) => !i.done);
  return { next, cleared: items.length - next.length };
}

/** The morning dispatch as one spoken-friendly paragraph. */
export function morningText(widgets: Widget[], flashback: { note: { title: string }; yearsAgo: number } | null, now: Date = new Date()): string {
  const parts: string[] = [`${now.getHours() < 12 ? "Good morning" : "Hello"}.`];
  const top = topThree(widgets);
  parts.push(top.length ? `Your top ${top.length === 1 ? "priority" : `${top.length} priorities`}: ${top.map((i) => i.text).join(", ")}.` : "You have no priorities listed yet.");
  const due = habitsDue(widgets, now);
  if (due.length) parts.push(`Habits still to do today: ${due.map((h) => h.title).join(", ")}.`);
  if (flashback) parts.push(`${flashback.yearsAgo === 1 ? "A year" : `${flashback.yearsAgo} years`} ago today you wrote: ${flashback.note.title}.`);
  return parts.join(" ");
}
