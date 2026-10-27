import { AiosClient } from "./client";

/** Daily widgets: types, API calls and the small pure helpers the "My Day" dock and the gallery share.
 *  A widget is data (a kind plus plain settings). Nothing here renders HTML or runs anything the owner typed. */

export type WidgetKind = "counter" | "checklist" | "note" | "habit" | "timer" | "routine" | "facts" | "mission";
export type RoutineWhen = "manual" | "daily" | "weekdays" | "weekly";

export interface ChecklistItem { text: string; done: boolean }
export interface MissionStep { text: string; done: boolean }
export interface MissionConfig { target: string; steps: MissionStep[]; note: string }
export interface Fact { label: string; value: string }
export interface RoutineConfig { prompt: string; when: RoutineWhen; at: string; day: number; last_run: string; last_task: string }
export interface ConfigByKind {
  counter: { value: number; step: number };
  checklist: { items: ChecklistItem[] };
  note: { text: string };
  habit: { days: string[]; per_week: number };
  timer: { focus: number; rest: number; sessions: number };
  routine: RoutineConfig;
  facts: { items: Fact[] };
  mission: MissionConfig;
}
export type Widget = { [K in WidgetKind]: { id: string; kind: K; title: string; config: ConfigByKind[K]; created_at?: string } }[WidgetKind];

export interface CatalogItem {
  id: string; group: string; kind: WidgetKind; title: string; name: string; blurb: string; space: string;
  you_can_change: string; who: "Everyone" | "Technical"; needs_claude: boolean; config: Record<string, unknown>;
}
export interface Catalog { groups: string[]; items: CatalogItem[] }
export interface AbilityRow { name: string; title: string; enabled: boolean; can_see?: string[]; can_do?: string[]; cannot?: string[] }
export interface AbilityStatus { paused: boolean; abilities: AbilityRow[] }

export const MAX_ITEMS = 20;
export const MAX_FACTS = 60;
export const MAX_STEPS = 30;
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// ---- API ----
export const listWidgets = (c: AiosClient) => c.get<{ items: Widget[] }>("/widgets").then((r) => r.items);
export const getCatalog = (c: AiosClient) => c.get<Catalog>("/widgets/catalog");
export const getAbilities = (c: AiosClient) => c.get<AbilityStatus>("/abilities");
export const setAbility = (c: AiosClient, name: string, enabled: boolean) => c.put<AbilityStatus>(`/abilities/${name}`, { enabled, confirm: true }).then((r) => r.data);
export const addFromCatalog = (c: AiosClient, template: string) => c.post<Widget>("/widgets/from-catalog", { template }).then((r) => r.data);
export const saveWidget = (c: AiosClient, id: string, config: unknown, title?: string) =>
  c.put<Widget>(`/widgets/${id}`, title === undefined ? { config } : { config, title }).then((r) => r.data);
export const removeWidget = (c: AiosClient, id: string) => c.delete<unknown>(`/widgets/${id}`).then(() => undefined);
export const runRoutine = (c: AiosClient, id: string) => c.post<{ id: string }>(`/widgets/${id}/run`).then((r) => r.data);
export const isAbilityOn = (s: AbilityStatus | null | undefined, name: string) => !!s?.abilities.find((a) => a.name === name)?.enabled;

// ---- dates (local days, matching the server's date.today()) ----
const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Date = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Consecutive days checked, counted back from today (or from yesterday if today is not checked yet). Mirrors widgets.streak(). */
export function streak(days: string[], today: Date = new Date()): number {
  const have = new Set(days);
  let d = today;
  if (!have.has(dayKey(d))) d = addDays(d, -1);
  let n = 0;
  while (have.has(dayKey(d))) { n++; d = addDays(d, -1); }
  return n;
}
export const doneToday = (days: string[], today: Date = new Date()) => days.includes(dayKey(today));

/** Checks made this week (Monday to today). */
export function weekCount(days: string[], today: Date = new Date()): number {
  const back = (today.getDay() + 6) % 7;
  const start = dayKey(addDays(today, -back));
  const end = dayKey(today);
  return [...new Set(days)].filter((d) => d >= start && d <= end).length;
}
/** Toggle today's check, keeping the list sorted and unique. */
export function toggleToday(days: string[], today: Date = new Date()): string[] {
  const k = dayKey(today);
  return days.includes(k) ? days.filter((d) => d !== k) : [...days, k].sort();
}

// ---- plain-words text ----
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export function progressText(w: Widget, today: Date = new Date()): string {
  switch (w.kind) {
    case "checklist": {
      const n = w.config.items.length, d = w.config.items.filter((i) => i.done).length;
      return n === 0 ? "Nothing on the list yet" : d === n ? `All ${n} done` : `${d} of ${n} done`;
    }
    case "counter": return `Now at ${w.config.value}`;
    case "habit": {
      const s = streak(w.config.days, today);
      return `${weekCount(w.config.days, today)} of ${w.config.per_week} this week${s > 0 ? `, ${plural(s, "day", "days")} in a row` : ""}`;
    }
    case "timer": return `${plural(w.config.sessions, "session", "sessions")} finished`;
    case "note": return w.config.text ? `${w.config.text.length} of 500 characters` : "Empty";
    case "mission": {
      const n = w.config.steps.length, d = w.config.steps.filter((x) => x.done).length;
      return n === 0 ? "No steps yet" : d === n ? `All ${n} steps done` : `${d} of ${n} steps done`;
    }
    case "facts": return plural(w.config.items.length, "fact kept", "facts kept");
    case "routine": return w.config.last_run ? `Last run ${fmtWhen(w.config.last_run)}` : "Not run yet";
  }
}
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

/** When a routine will start by itself. `scheduling` is whether the 'routines' ability is on; without it a schedule does nothing. */
export function nextRunText(c: RoutineConfig, now: Date = new Date(), scheduling = true): string {
  if (c.when === "manual") return "Runs only when you press Run now";
  const label = c.when === "daily" ? "every day" : c.when === "weekdays" ? "on weekdays" : `every ${WEEKDAYS[c.day] ?? "Sunday"}`;
  const base = `Runs ${label} at ${clock(c.at)}`;
  if (!scheduling) return `${base}, but only once you turn on scheduled routines`;
  const [h, m] = c.at.split(":").map(Number);
  const ranToday = !!c.last_run && dayKey(new Date(c.last_run)) === dayKey(now);
  for (let i = 0; i < 8; i++) {
    const d = addDays(now, i);
    const wd = (d.getDay() + 6) % 7;
    if (c.when === "weekdays" && wd >= 5) continue;
    if (c.when === "weekly" && wd !== c.day) continue;
    if (i === 0 && ranToday) continue;
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
    if (i === 0 && at.getTime() < now.getTime()) return `${base}. It starts soon`;   // overdue today: the server starts it on its next check
    return `${base}. Next: ${i === 0 ? "today" : i === 1 ? "tomorrow" : WEEKDAYS[wd]}`;
  }
  return base;
}

export const mmss = (s: number) => `${pad(Math.floor(Math.max(0, s) / 60))}:${pad(Math.max(0, s) % 60)}`;

/** What the focus timer does when the clock reaches zero. Pure so the UI stays thin. */
export function timerNext(phase: "focus" | "rest", cfg: { focus: number; rest: number; sessions: number }) {
  if (phase === "focus") {
    return cfg.rest > 0 ? { phase: "rest" as const, remaining: cfg.rest * 60, sessions: cfg.sessions + 1 } : { phase: "focus" as const, remaining: cfg.focus * 60, sessions: cfg.sessions + 1 };
  }
  return { phase: "focus" as const, remaining: cfg.focus * 60, sessions: cfg.sessions };
}

/** Filter the catalog by audience and search text (name, space, blurb). */
export function filterCatalog(items: CatalogItem[], who: "All" | "Everyone" | "Technical", q: string): CatalogItem[] {
  const needle = q.trim().toLowerCase();
  return items.filter((i) => (who === "All" || i.who === who) && (!needle || `${i.name} ${i.space} ${i.blurb} ${i.group}`.toLowerCase().includes(needle)));
}

/** Facts whose label or value contains every word typed (any case). An empty search shows them all, in the order kept. */
export function findFacts(items: Fact[], query: string): Fact[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length === 0 ? items : items.filter((f) => words.every((w) => `${f.label} ${f.value}`.toLowerCase().includes(w)));
}

/** How far along a mission is, as a whole percent (0 for no steps), and the next thing to do. */
export function missionProgress(c: MissionConfig): { percent: number; next: string | null; done: number; total: number } {
  const total = c.steps.length, done = c.steps.filter((x) => x.done).length;
  return { percent: total === 0 ? 0 : Math.round((done / total) * 100), next: c.steps.find((x) => !x.done)?.text ?? null, done, total };
}

/** Days from `today` to the target date: negative once it has passed, null when there is no date. */
export function daysToTarget(target: string, today: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(target);
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((t - t0) / 86_400_000);
}

export function targetText(target: string, today: Date = new Date()): string {
  const d = daysToTarget(target, today);
  if (d === null) return "No target date";
  return d === 0 ? "Due today" : d === 1 ? "Due tomorrow" : d > 1 ? `Due in ${d} days (${target})` : `${-d} day${d === -1 ? "" : "s"} past ${target}`;
}
