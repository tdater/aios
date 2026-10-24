import { AiosClient } from "./client";
import { Memory } from "./types";

export const DAILY_TAG = "daily";

/** Local calendar date as YYYY-MM-DD (the title of that day's note). */
export function dailyTitle(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let inflight: Promise<string> | null = null;

/** Find today's daily note, or create it. Returns the note id. Concurrent calls share one request, so a double key press never makes two notes. */
export function ensureDailyNote(client: AiosClient, d: Date = new Date()): Promise<string> {
  if (inflight) return inflight;
  const title = dailyTitle(d);
  inflight = (async () => {
    const found = await client.get<{ items: { id: string; title: string }[] }>("/memories", { query: { tag: DAILY_TAG, limit: 200 } });
    const hit = found.items.find((n) => n.title === title);
    if (hit) return hit.id;
    const made = await client.post<Memory>("/memories", { scope: "global", type: "fact", title, body: `# ${title}\n\n`, tags: [DAILY_TAG], status: "approved" });
    return made.data.id;
  })().finally(() => { inflight = null; });
  return inflight;
}
