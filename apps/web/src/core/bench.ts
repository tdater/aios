import { ConversationView, Finding } from "./types";
import { sortFindings } from "./work";

// The Bench: a picture of who did what to this change. Everything here is derived from facts AIOS already holds;
// it decides nothing. "Stage" says where the change physically is in the writer -> reviewer hand-off.
export type SeatState = "empty" | "idle" | "working" | "done";
export interface Seat { role: "writer" | "reviewer"; model: string | null; state: SeatState }
export type Stage = "none" | "writer" | "travelling" | "reviewer";
export type Verdict = "none" | "unreviewed" | "stale" | "ready" | "not_ready";
export interface Bench {
  seats: [Seat, Seat]; stage: Stage; verdict: Verdict; pinned: Finding[]; hidden: number; sameModel: boolean;
}
const MAX_PINNED = 5;
const ACTIVE = new Set(["queued", "running", "awaiting_approval"]);

type ReviewMeta = { findings?: Finding[]; model?: string; reviewed_revision?: string } | undefined;

export function benchModel(v: ConversationView): Bench {
  const r = v.changes.readiness, run = v.status.run;
  const review = (v.changes.review?.meta as { review?: ReviewMeta } | null)?.review;
  const hasChange = !!r.head_revision;
  const active = !!run && ACTIVE.has(run.state);
  const reviewing = active && run!.task_kind.includes("review");
  const writing = active && !reviewing;
  const current = !!review && review.reviewed_revision === r.head_revision;
  const writerModel = v.status.last_turn?.model ?? v.conversation.model ?? null;
  const reviewerModel = review?.model ?? v.status.last_review_turn?.model ?? null;
  const writer: Seat = { role: "writer", model: writerModel, state: writing ? "working" : hasChange ? "done" : "idle" };
  const reviewer: Seat = { role: "reviewer", model: reviewerModel, state: reviewing ? "working" : current ? "done" : review ? "idle" : "empty" };
  const stage: Stage = !hasChange ? "none" : reviewing ? "travelling" : current ? "reviewer" : "writer";
  const verdict: Verdict = !hasChange ? "none" : r.ready ? "ready" : !current ? (review ? "stale" : "unreviewed") : "not_ready";
  const all = current ? sortFindings(review?.findings ?? []) : [];
  const sameModel = !!writerModel && !!reviewerModel && writerModel === reviewerModel;
  return { seats: [writer, reviewer], stage, verdict, pinned: all.slice(0, MAX_PINNED), hidden: Math.max(0, all.length - MAX_PINNED), sameModel };
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  none: "Nothing on the bench yet", unreviewed: "Not reviewed", stale: "Review is out of date", ready: "Ready", not_ready: "Not ready",
};
