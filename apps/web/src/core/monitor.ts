import { AiosClient, ApiError, NetworkError } from "./client";
import { RunDetail, RunEvents } from "./types";

export type LinkState = "live" | "reconnecting" | "ended" | "unauthenticated" | "error";
export interface MonitorHandlers {
  onSnapshot(d: RunDetail): void;
  onEvents(items: RunEvents["items"]): void;
  onLink(s: LinkState, info?: string): void;
}
export interface MonitorOpts {
  intervalMs?: number;
  maxBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/** Reconnectable run monitor: snapshot, then events?after=<cursor>. Network loss => backoff and retry;
 *  resync_required (or version change) => reload the full snapshot. Returns a stop function. */
export function monitorRun(client: AiosClient, runId: string, h: MonitorHandlers, o: MonitorOpts = {}): () => void {
  const interval = o.intervalMs ?? 1500;
  const maxBackoff = o.maxBackoffMs ?? 15000;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let stopped = false;

  (async () => {
    let last = 0;
    let version = -1;
    let failures = 0;
    let needSnapshot = true;
    while (!stopped) {
      try {
        if (needSnapshot) {
          const snap = await client.get<RunDetail>(`/runs/${runId}`);
          if (stopped) return;
          last = snap.last_event_id;
          version = snap.run.version;
          needSnapshot = false;
          h.onSnapshot(snap);
          if (TERMINAL.has(snap.run.state)) return void h.onLink("ended");
        } else {
          const ev = await client.get<RunEvents>(`/runs/${runId}/events`, { query: { after: last } });
          if (stopped) return;
          if (ev.items.length) h.onEvents(ev.items);
          last = ev.last_event_id;
          if (ev.run_version !== version) {
            needSnapshot = true;          // state/cancellation changed: refresh steps/artifacts/evidence
            version = ev.run_version;
            continue;
          }
          if (ev.terminal) return void h.onLink("ended");
        }
        h.onLink("live");
        failures = 0;
        await sleep(interval);
      } catch (e) {
        if (stopped) return;
        if (e instanceof ApiError && e.code === "resync_required") {
          needSnapshot = true;
          continue;
        }
        if (e instanceof ApiError && e.status === 401) return void h.onLink("unauthenticated");
        if (e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) {
          failures++;
          h.onLink("reconnecting", e.message);
          needSnapshot = true;            // after any gap, resynchronise from a fresh snapshot
          await sleep(Math.min(maxBackoff, 1000 * 2 ** Math.min(failures, 5)) + Math.random() * 250);
          continue;
        }
        return void h.onLink("error", e instanceof Error ? e.message : String(e));
      }
    }
  })();
  return () => {
    stopped = true;
  };
}
