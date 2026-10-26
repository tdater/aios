import { Tone, UObject } from "./scene";

// The glass panels over the universe: a few real numbers, the state of each system, and the latest log lines.
// Everything here is computed from what the server already says; nothing is invented and nothing is a trend we do not have.

export interface Tile { id: string; label: string; value: number; tone: Tone; hint: string; to?: { tab: string; id?: string } }
export interface SystemRow { id: string; name: string; text: string; tone: Tone }

const countOf = (o: UObject) => (typeof o.meta?.count === "number" ? (o.meta.count as number) : 1);

export function tiles(objects: readonly UObject[], approvedMemories: number | null): Tile[] {
  const running = objects.filter((o) => o.type === "shuttle" && o.state.tone === "info").length;
  const waiting = objects.filter((o) => o.type === "comet" && o.id === "comet:approvals").reduce((n, o) => n + countOf(o), 0);
  const stuck = objects.filter((o) => o.type === "comet" && o.id === "comet:blocked").reduce((n, o) => n + countOf(o), 0);
  const probes = objects.filter((o) => o.type === "probe").length;
  const out: Tile[] = [
    { id: "jobs", label: "Jobs running", value: running, tone: running ? "info" : "muted", hint: "Work in flight between your projects and your AIs", to: { tab: "runs" } },
    { id: "waiting", label: "Waiting for you", value: waiting + stuck, tone: stuck ? "bad" : waiting ? "warn" : "ok", hint: "Approvals and stuck jobs", to: { tab: "inbox" } },
    { id: "probes", label: "Daily widgets", value: probes, tone: "muted", hint: "Probes in My Day" },
  ];
  if (approvedMemories !== null) out.splice(2, 0, { id: "memories", label: "Memories", value: approvedMemories, tone: "ok", hint: "Things AIOS remembers for you", to: { tab: "ais", id: "knows" } });
  return out;
}

export function systems(objects: readonly UObject[]): SystemRow[] {
  return objects.filter((o) => o.type === "module" || o.type === "allstop").map((o) => ({ id: o.id, name: o.name, text: o.state.text, tone: o.state.tone }));
}

export const TONE_DOT: Record<Tone, string> = { ok: "#3ee0a0", info: "#5ab4ff", warn: "#ffc857", bad: "#ff5d6c", muted: "#7a869c" };

/** Things that need you glow and pulse so you can find them in the dark. */
export const needsYou = (o: UObject) => o.state.tone === "warn" || o.state.tone === "bad";
