import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationView } from "../core/types";
import { Workflow } from "../screens/work/Workflow";
import { fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

beforeEach(() => { resetRoute(""); setWidth(1200, 900); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

const PROFILES = {
  build_and_check: { label: "Build, check and review", summary: "Claude makes the change, AIOS runs your check, a separate Claude reviews it, and Claude fixes real problems.", steps: ["implement", "review", "correct"], max_rounds: 2, permissions: ["Claude edits only in an isolated copy of your project, never your project folder.", "Merging the change into your project is never part of a workflow. Applying it stays a separate approval."] },
  build_and_test: { label: "Build and check only", summary: "No independent review.", steps: ["implement", "correct"], max_rounds: 1, permissions: ["Claude edits only in an isolated copy of your project, never your project folder."] },
};
const step = (seq: number, kind: string, o: object = {}) => ({ id: `s${seq}`, seq, kind, round: 0, run_id: `run_${seq}`, status: "done", summary: null, ...o });
const wf = (o: object = {}) => ({ id: "wf_1", request: "fix add so it adds", profile: "build_and_check", label: "Build, check and review", max_rounds: 2, round: 0, state: "working", outcome: null, outcome_reason: null,
  steps: [step(1, "implement", { status: "running" })], needs_you: null, pending_approvals: [], current_run: { id: "run_1", state: "running" }, max_rounds_allowed: 3, ...o });
const V = (o: object = {}) => ({ conversation: { id: "cnv_1" }, verify_command: ["python", "-m", "unittest"], status: { run: null }, ...o }) as unknown as ConversationView;
const show = (routes: object, v = V(), open = vi.fn(), reload = vi.fn().mockResolvedValue(undefined)) => {
  const srv = fakeServer(routes as never);
  const r = render(<Wrap ctx={ctxFor().ctx}><Workflow v={v} reload={reload} open={open} /></Wrap>);
  return { srv, open, reload, ...r };
};

describe("Start to finish", () => {
  it("starts a run with the chosen profile and corrections, and says plainly what it may and may not do", async () => {
    const { srv } = show({ "GET /conversations/cnv_1/workflow": () => ({ body: { workflow: null, profiles: PROFILES } }), "POST /conversations/cnv_1/workflow": () => ({ status: 201, body: wf() }) });
    expect(await screen.findByText("Start a new run")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);        // needs a request
    fireEvent.change(screen.getByLabelText("What should be built or fixed?"), { target: { value: "  fix add so it adds " } });
    fireEvent.click(screen.getByText("What this run may and may not do"));
    expect(screen.getByText(/never part of a workflow/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("How careful?"), { target: { value: "build_and_test" } });
    expect(screen.getByText("No independent review.")).toBeTruthy();
    expect((screen.getByLabelText("Most corrections allowed") as HTMLSelectElement).value).toBe("1");        // follows the profile
    fireEvent.change(screen.getByLabelText("Most corrections allowed"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(srv.count("POST", "/conversations/cnv_1/workflow")).toBe(1));
    expect(srv.calls.find((c) => c.method === "POST")!.body).toEqual({ request: "fix add so it adds", profile: "build_and_test", max_rounds: 3 });
  });

  it("will not start without a check command, and points to where to set one", async () => {
    const { open } = show({ "GET /conversations/cnv_1/workflow": () => ({ body: { workflow: null, profiles: PROFILES } }) }, V({ verify_command: null }));
    expect(await screen.findByText(/no check command yet/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What should be built or fixed?"), { target: { value: "x" } });
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Open Tests" }));
    expect(open).toHaveBeenCalledWith("tests");
  });

  it("shows each step as it happens, asks for your yes when the check needs it, and can be cancelled", async () => {
    const waiting = wf({ state: "waiting_you", steps: [step(1, "implement", { status: "running" })], needs_you: "Approve or decline the check to continue.", pending_approvals: [{ id: "apr_1", summary: "run it" }], current_run: { id: "run_1", state: "awaiting_approval" } });
    const { srv, open } = show({ "GET /conversations/cnv_1/workflow": () => ({ body: { workflow: waiting, profiles: PROFILES } }), "POST /workflows/wf_1/cancel": () => ({ body: wf({ state: "cancelled", outcome: "cancelled", outcome_reason: "You cancelled it." }) }) });
    expect(await screen.findByText("waiting for you")).toBeTruthy();
    expect(screen.getByText("Approve or decline the check to continue.")).toBeTruthy();
    expect(screen.queryByText("Start a new run")).toBeNull();                          // one run at a time
    fireEvent.click(screen.getByRole("button", { name: "Review and decide" }));
    expect(open).toHaveBeenCalledWith("tests");
    fireEvent.click(screen.getByRole("button", { name: "Cancel this run" }));
    await waitFor(() => expect(srv.count("POST", "/workflows/wf_1/cancel")).toBe(1));
  });

  it("reports the finished run in plain words: the steps, the corrections used, and that nothing was merged", async () => {
    const done = wf({ state: "finished", outcome: "ready", outcome_reason: "The check passed and the independent review found no high-severity problems.", round: 1,
      steps: [step(1, "implement", { summary: "check passed" }), step(2, "review", { summary: "high=1" }), step(3, "correct", { round: 1, summary: "check passed" }), step(4, "review", { round: 1, summary: "high=0" }), step(5, "capture", { summary: "knowledge candidates proposed" })] });
    const { open, container } = show({ "GET /conversations/cnv_1/workflow": () => ({ body: { workflow: done, profiles: PROFILES } }) });
    expect(await screen.findByText("Correction 1")).toBeTruthy();
    expect(screen.getByText("1 high-severity problem")).toBeTruthy();
    expect(screen.getByText("no high-severity problems")).toBeTruthy();
    expect(screen.getByText("Corrections used: 1 of 2")).toBeTruthy();
    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "See the result" }));
    expect(open).toHaveBeenCalledWith("outcome");
    expect(screen.getByText("Start a new run")).toBeTruthy();                          // a finished run frees the form
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
  });

  it("hands the decision back when it could not finish", async () => {
    const stuck = wf({ state: "finished", outcome: "needs_you", outcome_reason: "An independent review of your last change found 1 high-severity problem, and the 2 correction rounds allowed are used up. Over to you.", round: 2 });
    show({ "GET /conversations/cnv_1/workflow": () => ({ body: { workflow: stuck, profiles: PROFILES } }) });
    expect(await screen.findByText(/Over to you/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "See the result" })).toBeNull();
  });

  it("keeps refreshing while a run is live, and stops once it has ended", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let state = wf();
    const { srv } = show({ "GET /conversations/cnv_1/workflow": () => ({ body: { workflow: state, profiles: PROFILES } }) });
    await vi.waitFor(() => expect(screen.getByText("working")).toBeTruthy());
    const before = srv.count("GET", "/conversations/cnv_1/workflow");
    await vi.advanceTimersByTimeAsync(4100);
    expect(srv.count("GET", "/conversations/cnv_1/workflow")).toBeGreaterThan(before);
    state = wf({ state: "finished", outcome: "no_change", outcome_reason: "Claude made no file changes." });
    await vi.advanceTimersByTimeAsync(2100);
    await vi.waitFor(() => expect(screen.getByText("No change was made")).toBeTruthy());
    const after = srv.count("GET", "/conversations/cnv_1/workflow");
    await vi.advanceTimersByTimeAsync(6000);
    expect(srv.count("GET", "/conversations/cnv_1/workflow")).toBe(after);
  });
});
