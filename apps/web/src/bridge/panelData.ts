import { UObject, Tone } from "../core/scene";
import { tiles, systems } from "../core/hud";

// What the bridge panels say. Everything comes from objects the server already reports; nothing is invented.

export interface AlertItem { id: string; name: string; text: string; tone: Tone; count: number }
export interface OpsItem { id: string; name: string; text: string; tone: Tone; kind: "job" | "system" }

const RANK: Record<Tone, number> = { bad: 0, warn: 1, info: 2, ok: 3, muted: 4 };
const countOf = (o: UObject) => (typeof o.meta?.count === "number" ? (o.meta.count as number) : 1);

/** Things that need the person: comets with something in them, and anything in a warning or bad state. Worst first. */
export function alertItems(objects: readonly UObject[]): AlertItem[] {
  return objects
    .filter((o) => (o.type === "comet" && countOf(o) > 0 && o.state.tone !== "ok" && o.state.tone !== "muted") || ((o.state.tone === "warn" || o.state.tone === "bad") && o.type !== "comet"))
    .map((o) => ({ id: o.id, name: o.name, text: o.state.text, tone: o.state.tone, count: o.type === "comet" ? countOf(o) : 1 }))
    .sort((a, b) => RANK[a.tone] - RANK[b.tone] || a.name.localeCompare(b.name));
}

/** Jobs in flight, then how each system is. */
export function opsItems(objects: readonly UObject[]): OpsItem[] {
  const jobs: OpsItem[] = objects.filter((o) => o.type === "shuttle").map((o) => ({ id: o.id, name: o.name, text: o.state.text, tone: o.state.tone, kind: "job" as const }));
  const sys: OpsItem[] = systems(objects).map((s) => ({ ...s, kind: "system" as const }));
  return [...jobs.sort((a, b) => RANK[a.tone] - RANK[b.tone]), ...sys];
}

/** One line for the status strip. */
export function summary(objects: readonly UObject[]): string {
  const t = tiles(objects, null);
  const running = t.find((x) => x.id === "jobs")?.value ?? 0;
  const waiting = t.find((x) => x.id === "waiting")?.value ?? 0;
  return `${running} job${running === 1 ? "" : "s"} running · ${waiting ? `${waiting} waiting for you` : "nothing waiting for you"}`;
}
