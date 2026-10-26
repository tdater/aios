import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { benchModel } from "../core/bench";
import { ConversationView } from "../core/types";
import { Bench } from "../ui/Bench";

afterEach(cleanup);
const F = (id: string, severity: "high" | "medium" | "low") => ({ id, severity, title: `T-${id}`, detail: "", file: "a.py", line: 3, suggestion: null, grounded: true });
function view(o: { head?: string | null; review?: { rev: string; model: string; findings: ReturnType<typeof F>[] } | null; ready?: boolean; run?: string | null; writer?: string }): ConversationView {
  const head = o.head === undefined ? "abc123def456" : o.head;
  return {
    conversation: { model: null }, project: { id: "p", name: "p" }, verify_command: null, messages: [], context: {},
    status: { last_turn: { model: o.writer ?? "claude-sonnet-5-5" }, last_review_turn: null, run: o.run ? { state: "running", task_kind: o.run } : null },
    changes: { patch: null, verification: null, review: o.review ? { meta: { review: { findings: o.review.findings, model: o.review.model, reviewed_revision: o.review.rev } } } : null,
      readiness: { ready: !!o.ready, verified: null, reviewed: !!o.review, high_findings: 0, reasons: [], head_revision: head } },
  } as unknown as ConversationView;
}

describe("benchModel", () => {
  it("nothing yet, then a change with the writer", () => {
    expect(benchModel(view({ head: null })).verdict).toBe("none");
    const b = benchModel(view({}));
    expect([b.stage, b.verdict, b.seats[0].state, b.seats[1].state]).toEqual(["writer", "unreviewed", "done", "empty"]);
  });
  it("travels to the reviewer while a review runs, and shows the writer working during a turn", () => {
    expect(benchModel(view({ run: "claude.review" })).stage).toBe("travelling");
    const w = benchModel(view({ run: "claude.turn" }));
    expect([w.seats[0].state, w.stage]).toEqual(["working", "writer"]);
  });
  it("a current review pins the worst findings first, capped, and AIOS readiness decides the verdict", () => {
    const fs = [F("1", "low"), F("2", "high"), F("3", "medium"), F("4", "low"), F("5", "low"), F("6", "low"), F("7", "low")];
    const b = benchModel(view({ review: { rev: "abc123def456", model: "claude-opus-5-5", findings: fs } }));
    expect(b.pinned.map((f) => f.id).slice(0, 2)).toEqual(["2", "3"]);
    expect([b.pinned.length, b.hidden, b.stage, b.verdict, b.sameModel]).toEqual([5, 2, "reviewer", "not_ready", false]);
    expect(benchModel(view({ ready: true, review: { rev: "abc123def456", model: "x", findings: [] } })).verdict).toBe("ready");
  });
  it("a review of an older revision is stale: no pinned findings, no reviewer credit", () => {
    const b = benchModel(view({ review: { rev: "OLD", model: "x", findings: [F("1", "high")] } }));
    expect([b.verdict, b.pinned.length, b.stage, b.seats[1].state]).toEqual(["stale", 0, "writer", "idle"]);
  });
  it("a run without a task kind (older server) does not crash the bench", () => {
    const v = view({});
    (v.status as unknown as { run: object }).run = { state: "running" };
    expect(benchModel(v).seats[0].state).toBe("working");
  });
  it("flags a reviewer on the same model as the writer", () => {
    expect(benchModel(view({ writer: "m", review: { rev: "abc123def456", model: "m", findings: [] } })).sameModel).toBe(true);
  });
});

describe("Bench", () => {
  it("renders seats, pinned findings and the verdict, with no a11y violations", async () => {
    const { container } = render(<Bench v={view({ review: { rev: "abc123def456", model: "claude-opus-5-5", findings: [F("2", "high")] } })} />);
    expect(screen.getByText("Writer")).toBeTruthy();
    expect(screen.getByText("claude-opus-5-5")).toBeTruthy();
    expect(screen.getByText("T-2")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Not ready");
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});
