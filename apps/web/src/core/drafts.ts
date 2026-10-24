import { AiosClient, ApiError, NetworkError, newKey } from "./client";
import { KV, readJson, writeJson } from "./storage";

/** A draft is LOCAL ONLY. It is not a task until the user explicitly sends it. */
export interface Draft {
  id: string;
  idempotencyKey: string;     // fixed at creation and preserved across retries/reconnects
  text: string;
  projectId: string | null;
  createdAt: string;
  attempted: boolean;         // a send was started; its outcome may be unknown
  status: "draft" | "sending" | "unknown_outcome" | "conflict" | "failed" | "sent";
  error?: string;
  taskId?: string;
}

const PREFIX = "aios.drafts.v1.";

export function draftPayload(d: Draft) {
  const first = d.text.trim().split("\n")[0].slice(0, 80) || "Captured idea";
  return { title: first, kind: "capture.note", spec: { text: d.text.trim() }, project_id: d.projectId };
}

export class DraftStore {
  constructor(private kv: KV) {}
  private key(partition: string) {
    return `${PREFIX}${partition}`;
  }
  list(partition: string): Draft[] {
    return readJson<Draft[]>(this.kv, this.key(partition), []);
  }
  private save(partition: string, l: Draft[]) {
    writeJson(this.kv, this.key(partition), l);
  }
  add(partition: string, text: string, projectId: string | null = null): Draft {
    const d: Draft = { id: newKey(), idempotencyKey: `draft-${newKey()}`, text, projectId, createdAt: new Date().toISOString(),
      attempted: false, status: "draft" };
    this.save(partition, [d, ...this.list(partition)]);
    return d;
  }
  update(partition: string, id: string, patch: Partial<Draft>): Draft | null {
    const l = this.list(partition);
    const d = l.find((x) => x.id === id);
    if (!d) return null;
    // Editing after an attempt would change the payload under the same key; refuse (conflict surfaced instead).
    if (patch.text !== undefined && d.attempted) throw new Error("This draft was already sent once; its outcome may be unknown. Duplicate it instead of editing.");
    Object.assign(d, patch);
    this.save(partition, l);
    return d;
  }
  remove(partition: string, id: string) {
    this.save(partition, this.list(partition).filter((d) => d.id !== id));
  }
  clear(partition: string) {
    this.kv.remove(this.key(partition));
  }
  clearAll() {
    for (const k of this.kv.keys(PREFIX)) this.kv.remove(k);
  }
  pendingCount(partition: string) {
    return this.list(partition).filter((d) => d.status !== "sent").length;
  }

  /** Explicit, user-triggered upload of one draft. Never called automatically. */
  async send(partition: string, client: AiosClient, id: string): Promise<Draft> {
    const d = this.list(partition).find((x) => x.id === id);
    if (!d) throw new Error("draft not found");
    this.update(partition, id, { attempted: true, status: "sending", error: undefined });
    try {
      const r = await client.post<{ task: { id: string } }>("/tasks", { ...draftPayload(d), start_run: false }, { idempotencyKey: d.idempotencyKey });
      return this.update(partition, id, { status: "sent", taskId: r.data.task.id })!;
    } catch (e) {
      if (e instanceof NetworkError) {
        // The server may have received it. Same key on retry is safe; say so honestly.
        return this.update(partition, id, { status: "unknown_outcome", error: "No answer from the server. It may or may not have been received; retrying is safe." })!;
      }
      if (e instanceof ApiError && e.code === "idempotency_key_reuse") {
        return this.update(partition, id, { status: "conflict", error: "The server already has a different request with this key." })!;
      }
      if (e instanceof ApiError && e.code === "idempotency_in_progress") {
        return this.update(partition, id, { status: "unknown_outcome", error: "The server is still processing the first attempt." })!;
      }
      return this.update(partition, id, { status: "failed", error: e instanceof Error ? e.message : String(e) })!;
    }
  }

  /** Policy-gated bulk upload: caller passes the ids the user selected (or all, if they chose "send all"). */
  async sendMany(partition: string, client: AiosClient, ids: string[]): Promise<Draft[]> {
    const out: Draft[] = [];
    for (const id of ids) out.push(await this.send(partition, client, id));
    return out;
  }
}
