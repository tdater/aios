import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationScreen } from "../screens/work/Conversation";
import { HOLD_MS } from "../ui/VaultDoor";
import { WorkPicker } from "../screens/work/Picker";
import { err, fakeServer, Handler } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

afterEach(cleanup);
beforeEach(() => { resetRoute("#/work/cnv_1"); setWidth(1200); });

const T0 = "2026-10-25T10:00:00+00:00";
const RUN = (o: object = {}) => ({ id: "run_1", task_id: "t1", task_title: "Fix the add bug", task_kind: "claude.turn", state: "succeeded", display_state: "completed",
  state_reason: null, block_code: null, attempt: 1, max_attempts: 1, iteration: 0, max_iterations: 1000, version: 3, created_at: T0, finished_at: T0, ...o });
const msg = (seq: number, o: object = {}) => ({ id: `m${seq}`, conversation_id: "cnv_1", seq, role: "user", author_kind: "user", author: "you", kind: "message",
  content: "hello", run_id: "run_1", meta: null, created_at: T0, ...o });
const PATCH_META = { changed: true, artifact_id: "art_patch", sha256: "a".repeat(64), base_revision: "b".repeat(40), head_revision: "c".repeat(40),
  files: [{ status: "M", path: "calc.py" }], added: 1, removed: 1, sensitive_paths: [], possible_secret_kinds: [], truncated: false };
const VER_META = { passed: true, exit_code: 0, duration_s: 0.2, argv: ["python", "-m", "unittest"], head_revision: "c".repeat(40), artifact_id: "art_ver", timed_out: false };
const TURN = { model: "claude-sonnet-5-5", client_version: "2.1.310", permission_mode: "dontAsk", tools: ["Glob", "Grep", "Read"], unexpected_tools: [], api_key_source: "none",
  builtin_plugins: ["cc-plugin-telemetry"], external_plugins: [], mcp_servers: [], permission_denials: [], num_turns: 1, cost_estimate_usd: 0.04 };
const DIFF = "diff --git a/calc.py b/calc.py\nindex 1..2 100644\n--- a/calc.py\n+++ b/calc.py\n@@ -1,3 +1,3 @@\n def add(a, b):\n-    return a - b\n+    return a + b\n \n";

function view(o: Record<string, unknown> = {}, changes: Record<string, unknown> = {}, status: Record<string, unknown> = {}) {
  const patch = msg(4, { author_kind: "aios", author: "aios", kind: "patch", role: "system", content: "Proposed change: 1 file(s), +1 -1\n  M calc.py", meta: PATCH_META });
  const ver = msg(5, { author_kind: "aios", author: "aios", kind: "verification", role: "system", content: "Verification PASSED: `python -m unittest` exited 0 in 0.2s.\n\n..\nOK", meta: VER_META });
  return {
    conversation: { id: "cnv_1", project_id: "prj_1", workspace_id: "wsp_1", title: "Fix the add bug", provider: "claude", model: "sonnet", status: "open", session_id: "sess-1234abcd",
      worktree_path: "C:\\aios-state\\worktrees\\cnv_1", branch: "aios/cnv_1", base_revision: "b".repeat(40), head_revision: "c".repeat(40), created_at: T0, updated_at: T0, version: 2 },
    project: { id: "prj_1", name: "Calc" }, verify_command: ["python", "-m", "unittest"],
    messages: [
      msg(1, { content: "Fix the add bug please" }),
      msg(2, { role: "assistant", author_kind: "provider", author: "claude-code 2.1.310 (claude-sonnet-5-5)", content: "I changed add to use +.", meta: { turn: TURN } }),
      patch, ver],
    status: { provider: { name: "claude", mode: "interactive", billing: "subscription", client_version: "2.1.310 (Claude Code)", plan: "pro", auth_method: "claude.ai", logged_in: true },
      session: { id: "sess-1234abcd", resumable: true, model: "sonnet" },
      permissions: { tools_read_mode: ["Read", "Glob", "Grep"], shell: "denied", network: "denied", verification: "runs only after you approve the exact command and revision" },
      workspace: { worktree: "C:\\aios-state\\worktrees\\cnv_1", branch: "aios/cnv_1", base_revision: "b".repeat(40), head_revision: "c".repeat(40) },
      last_turn: { at: T0, run_id: "run_1", role: "writer", ...TURN, rate_limit: null }, last_review_turn: null,
      quota: { status: "allowed", overage: "rejected", five_hour: { utilization: 0.39, resets_at: 1792975200, status: "allowed" }, seven_day: { utilization: 0.07, resets_at: 1793484000, status: "allowed" } },
      quota_note: "From the last turn's rate-limit report; shows 5-hour and 7-day usage of your subscription. Not live.",
      run: RUN(), pending_approvals: [], ...status },
    changes: { patch, verification: ver, review: null, readiness: { ready: true, verified: true, reviewed: false, high_findings: 0, reasons: ["no independent review of this revision (optional)"], head_revision: "c".repeat(40) }, ...changes },
    context: { run_1: [{ kind: "memory", ref: "mem_1", version: "1", sha256: "x" }] },
    ...o,
  };
}

const RUN_DETAIL = { run: RUN(), last_event_id: 2, steps: [], artifacts: [], evidence: [], approvals: [],
  events: [{ id: 1, ts: T0, kind: "claude", message: "reading calc.py" }, { id: 2, ts: T0, kind: "claude", message: "editing calc.py" }] };
const base = (v: object, extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  "GET /conversations/cnv_1": () => ({ body: v }),
  "GET /runs/run_1": () => ({ body: RUN_DETAIL }),
  "GET /runs/run_1/events": () => ({ body: { items: [], last_event_id: 2, run_state: "succeeded", run_version: 3, terminal: true } }),
  "GET /artifacts/art_patch": () => ({ body: { id: "art_patch", kind: "patch", sha256: "a", provenance: "x", content: DIFF } }),
  ...extra,
});
const open = async (v: object, extra: Record<string, Handler> = {}, over: { connected?: boolean } = {}) => {
  const srv = fakeServer(base(v, extra));
  const c = ctxFor(over);
  const r = render(<Wrap ctx={c.ctx}><ConversationScreen id="cnv_1" /></Wrap>);
  await screen.findByRole("heading", { name: "Fix the add bug" });
  return { srv, ...r };
};
const tab = (name: RegExp) => fireEvent.click(screen.getByRole("tab", { name }));

describe("conversation thread", () => {
  it("shows who said what: you, Claude with its model, and AIOS for facts it computed", async () => {
    await open(view());
    const thread = screen.getByRole("list", { name: "Conversation" });
    expect(within(thread).getByText("Fix the add bug please")).toBeTruthy();
    expect(within(thread).getByText("You")).toBeTruthy();
    expect(within(thread).getByText("Claude")).toBeTruthy();
    expect(within(thread).getByText(/claude-sonnet-5-5 · Claude Code 2.1.310/)).toBeTruthy();
    expect(within(thread).getAllByText("AIOS").length).toBe(2);
    expect(within(thread).getAllByText(/computed by AIOS, not by the model/).length).toBe(2);
    expect(within(thread).getByText("tests passed")).toBeTruthy();
  });

  it("renders hostile reply text as inert text", async () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script> [click](javascript:alert(1))';
    const v = view();
    (v.messages[1] as { content: string }).content = evil;
    const { container } = await open(v);
    expect(screen.getByText(evil)).toBeTruthy();
    expect(container.querySelector("img, script, a[href^='javascript']")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("labels an independent reviewer distinctly", async () => {
    const v = view();
    v.messages.push(msg(6, { role: "assistant", author_kind: "provider", kind: "review", author: "claude-code 2.1.310 (claude-opus-5-5), independent reviewer", content: "Fine.\n0 finding(s).", meta: {} }) as never);
    await open(v);
    expect(screen.getByText("Claude (independent reviewer)")).toBeTruthy();
  });
});

describe("composer", () => {
  it("sends once with an idempotency key and the chosen mode, then clears", async () => {
    const { srv } = await open(view(), { "POST /conversations/cnv_1/messages": () => ({ status: 201, body: {} }) });
    const box = screen.getByLabelText("Your message") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Please also add a multiply test" } });
    fireEvent.click(screen.getByLabelText(/Make changes/));
    const send = screen.getByRole("button", { name: "Send and make changes" });
    fireEvent.click(send);
    fireEvent.click(send);                                                                       // double tap must not double-post
    await waitFor(() => expect(srv.count("POST", "/conversations/cnv_1/messages")).toBe(1));
    const call = srv.calls.find((c) => c.method === "POST")!;
    expect(call.body).toEqual({ content: "Please also add a multiply test", mode: "edit" });
    expect(call.headers["idempotency-key"]).toMatch(/^msg-/);
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("explains a turn already in progress and keeps the text", async () => {
    await open(view(), { "POST /conversations/cnv_1/messages": () => err(409, "turn_in_progress", "x") });
    const box = screen.getByLabelText("Your message") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/Claude is still working on the previous message/);
    expect(box.value).toBe("again");
  });

  it("says it is waiting for YOU, not that Claude is busy, when an approval is pending", async () => {
    const waiting = view({}, {}, { run: RUN({ state: "awaiting_approval", display_state: "awaiting_approval" }), pending_approvals: [{ id: "apr_1", summary: "x", requested_at: T0, expires_at: T0 }] });
    await open(waiting);
    expect(screen.getByText(/waiting for your approval to run the tests/)).toBeTruthy();
    expect(screen.queryByText(/Claude is working/)).toBeNull();
    expect((screen.getByLabelText("Your message") as HTMLTextAreaElement).disabled).toBe(true);
    cleanup();
    await open(view({}, {}, { run: RUN({ state: "blocked", display_state: "blocked", block_code: "provider_unavailable", state_reason: "not signed in" }) }));
    expect(screen.getByText(/stopped before it finished/)).toBeTruthy();
  });

  it("is disabled while Claude is working and while offline", async () => {
    const working = view({}, {}, { run: RUN({ state: "running", display_state: "running" }) });
    await open(working);
    expect(screen.getByText(/Claude is working\. You can send the next message/)).toBeTruthy();
    expect((screen.getByLabelText("Your message") as HTMLTextAreaElement).disabled).toBe(true);
    cleanup();
    await open(view(), {}, { connected: false });
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "hi" } });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/You are offline, so messages cannot be sent/)).toBeTruthy();
  });
});

describe("activity", () => {
  it("shows what Claude did, in order, and what AIOS told it", async () => {
    await open(view());
    await screen.findByText("reading calc.py");
    expect(screen.getByText("editing calc.py")).toBeTruthy();
    fireEvent.click(screen.getByText(/What AIOS told Claude/));
    expect(screen.getByText(/mem_1/)).toBeTruthy();
  });
});

describe("changes", () => {
  it("shows a readable diff, says the project folder is untouched, and flags risky files", async () => {
    const v = view({}, { patch: msg(4, { author_kind: "aios", author: "aios", kind: "patch", role: "system", content: "x", meta: { ...PATCH_META, sensitive_paths: [".github/workflows/ci.yml"], possible_secret_kinds: ["assigned-secret"] } }) });
    await open(v);
    tab(/^Changes/);
    await screen.findByText(/calc\.py — changed, \+1 −1/);
    expect(screen.getByText(/Your project folder has not been changed/)).toBeTruthy();
    expect(screen.getByText(/AIOS does not yet apply/)).toBeTruthy();
    expect(screen.getByText(/Look closely at these files/).parentElement?.textContent).toMatch(/\.github\/workflows\/ci\.yml/);
    expect(screen.getByText(/secret-like values \(assigned-secret\)/)).toBeTruthy();
    expect(screen.getByText(/return a \+ b/)).toBeTruthy();
    expect(screen.getByText(/return a - b/)).toBeTruthy();
    expect(screen.getByLabelText("added")).toBeTruthy();
    expect(screen.getByLabelText("removed")).toBeTruthy();
  });

  it("says plainly when there is nothing yet", async () => {
    const v = view({}, { patch: null, verification: null, readiness: { ready: false, verified: null, reviewed: false, high_findings: 0, reasons: ["there is no proposed change yet"], head_revision: null } });
    await open(v);
    tab(/^Changes/);
    expect(screen.getByText(/No changes yet/)).toBeTruthy();
  });
});

describe("tests and approval", () => {
  it("shows the AIOS-run result and warns when it is for an older revision", async () => {
    await open(view());
    tab(/^Tests/);
    const panel = () => within(screen.getByRole("region", { name: "Tests" }));
    expect(panel().getByText("tests passed")).toBeTruthy();
    expect(panel().getByText(/run by AIOS, not by Claude/)).toBeTruthy();
    cleanup();
    const stale = view({}, { verification: msg(5, { author_kind: "aios", kind: "verification", role: "system", content: "Verification FAILED.\n\nboom", meta: { ...VER_META, passed: false, exit_code: 1, head_revision: "d".repeat(40) } }) });
    await open(stale);
    tab(/^Tests/);
    expect(panel().getByText("tests failed")).toBeTruthy();
    expect(screen.getByText(/result is for an older revision/)).toBeTruthy();
  });

  const APPROVAL = { id: "apr_1", run_id: "run_1", summary: "Run `python -m unittest` against revision cccccccccccc", status: "pending", action_hash: "h".repeat(64), version: 4,
    action: {}, destructive: true, requested_at: T0, expires_at: T0, age_s: 5, expires_in_s: 3000,
    review: { type: "run_verification", target: "C:\\w", side_effects: ["Runs this command on your computer: python -m unittest", "This is not a sandbox"], content_preview: '{"argv":["python"]}', destructive: true } };

  it("makes you acknowledge the risk, then approves exactly what you reviewed", async () => {
    const waiting = view({}, { verification: null }, { run: RUN({ state: "awaiting_approval", display_state: "awaiting_approval" }), pending_approvals: [{ id: "apr_1", summary: "x", requested_at: T0, expires_at: T0 }] });
    const { srv } = await open(waiting, { "GET /approvals/apr_1": () => ({ body: APPROVAL }), "POST /approvals/apr_1/decide": () => ({ body: { status: "approved" } }) });
    expect(screen.getByText(/Your approval is needed before AIOS runs the tests/)).toBeTruthy();
    tab(/^Tests/);
    await screen.findByText("Your approval is needed");
    expect(screen.getByText("This is not a sandbox")).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve and run the tests" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);                                                         // not until acknowledged
    fireEvent.click(screen.getByLabelText(/I understand this runs code that Claude just wrote/));
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);                                                                    // one press only arms the heavy door
    expect(approve.textContent).toContain("Press again to open");
    expect(srv.count("POST", "/approvals/apr_1/decide")).toBe(0);
    fireEvent.pointerDown(approve);                                                              // holding it is what opens it
    await act(async () => { await new Promise((r) => setTimeout(r, HOLD_MS + 250)); });
    fireEvent.pointerUp(approve);
    await waitFor(() => expect(srv.count("POST", "/approvals/apr_1/decide")).toBe(1));
    expect(srv.calls.find((c) => c.path === "/approvals/apr_1/decide")!.body).toEqual(
      { approve: true, expected_version: 4, action_hash: "h".repeat(64), confirm_destructive: true });
  });

  it("rejecting needs no acknowledgement", async () => {
    const waiting = view({}, { verification: null }, { run: RUN({ state: "awaiting_approval", display_state: "awaiting_approval" }), pending_approvals: [{ id: "apr_1", summary: "x", requested_at: T0, expires_at: T0 }] });
    const { srv } = await open(waiting, { "GET /approvals/apr_1": () => ({ body: APPROVAL }), "POST /approvals/apr_1/decide": () => ({ body: {} }) });
    tab(/^Tests/);
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    await waitFor(() => expect(srv.calls.find((c) => c.path === "/approvals/apr_1/decide")!.body).toMatchObject({ approve: false, confirm_destructive: false }));
  });

  it("never lets you approve while offline", async () => {
    const waiting = view({}, { verification: null }, { run: RUN({ state: "awaiting_approval", display_state: "awaiting_approval" }), pending_approvals: [{ id: "apr_1", summary: "x", requested_at: T0, expires_at: T0 }] });
    await open(waiting, { "GET /approvals/apr_1": () => ({ body: APPROVAL }) }, { connected: false });
    tab(/^Tests/);
    await screen.findByText(/Approvals are never queued/);
    expect((screen.getByRole("button", { name: "Approve and run the tests" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets the owner set the test command, one part per line, with no shell", async () => {
    const v = view({ verify_command: null }, { verification: null });
    const { srv } = await open(v, { "PUT /projects/prj_1/verify-command": () => ({ body: { argv: ["npm", "test"] } }) });
    tab(/^Tests/);
    fireEvent.click(screen.getByRole("button", { name: "Node (npm test)" }));
    expect((screen.getByLabelText(/Command \(one part per line\)/) as HTMLTextAreaElement).value).toBe("npm\ntest");
    expect(screen.getByText(/AIOS will run:/).textContent).toContain("npm test");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(srv.count("PUT", "/projects/prj_1/verify-command")).toBe(1));
    expect(srv.calls.find((c) => c.method === "PUT")!.body).toEqual({ argv: ["npm", "test"] });
  });
});

describe("outcome and review", () => {
  const FINDINGS = [
    { id: "f1", severity: "low", title: "Naming nit", detail: "meh", file: null, line: null, suggestion: null, grounded: null },
    { id: "f2", severity: "high", title: "Wrong result for negatives", detail: "add() is wrong", file: "calc.py", line: 2, suggestion: "Use a + b", grounded: true },
    { id: "f3", severity: "medium", title: "Ghost file", detail: "d", file: "nope.py", line: 9, suggestion: null, grounded: false },
  ];
  const reviewed = (high: number) => view({}, {
    review: msg(6, { author_kind: "provider", kind: "review", role: "assistant", author: "claude-code 2.1.310 (claude-opus-5-5), independent reviewer", created_at: T0, content: "x",
      meta: { review: { reviewed_revision: "c".repeat(40), findings: FINDINGS, counts: { high, medium: 1, low: 1 }, summary: "Two problems.", model: "claude-opus-5-5", separate_session: true } } }),
    readiness: { ready: high === 0, verified: true, reviewed: true, high_findings: high, reasons: high ? [`${high} high-severity finding(s) in the review of this revision`] : [], head_revision: "c".repeat(40) },
  });

  it("states the verdict, who decided it, and why", async () => {
    await open(reviewed(1));
    tab(/^Outcome/);
    expect(screen.getByRole("status", { name: "" , hidden: false })).toBeTruthy();
    expect(screen.getByText("NOT READY")).toBeTruthy();
    expect(screen.getByText(/decided by AIOS from the facts below, not by Claude/)).toBeTruthy();
    expect(screen.getByText(/1 high-severity finding\(s\) in the review of this revision/)).toBeTruthy();
    expect(screen.getByText("passed on this revision")).toBeTruthy();
    expect(screen.getByText("1 high · 1 medium · 1 low")).toBeTruthy();
  });

  it("lists findings by severity with honest locations", async () => {
    await open(reviewed(1));
    tab(/^Outcome/);
    const items = screen.getAllByRole("listitem").filter((li) => li.className.includes("finding"));
    expect(items.map((li) => within(li).getByText(/Naming nit|Wrong result|Ghost file/).textContent)).toEqual(["Wrong result for negatives", "Ghost file", "Naming nit"]);
    expect(screen.getByText("calc.py:2 (location confirmed)")).toBeTruthy();
    expect(screen.getByText("nope.py:9 (AIOS could not find this location)")).toBeTruthy();
    expect(screen.getByText("no location given")).toBeTruthy();
    expect(screen.getByText(/cannot check that the finding is right/)).toBeTruthy();
  });

  it("requests a review, with an optional model", async () => {
    const { srv } = await open(view(), { "POST /conversations/cnv_1/review": () => ({ status: 201, body: {} }) });
    tab(/^Outcome/);
    fireEvent.change(screen.getByLabelText("Reviewer model"), { target: { value: "opus" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask for an independent review" }));
    await waitFor(() => expect(srv.count("POST", "/conversations/cnv_1/review")).toBe(1));
    expect(srv.calls.find((c) => c.path.endsWith("/review"))!.body).toEqual({ model: "opus" });
  });

  it("drafts a fix request from the selected findings and does not send it", async () => {
    const { srv } = await open(reviewed(1));
    tab(/^Outcome/);
    fireEvent.click(screen.getByRole("button", { name: "Select high and medium" }));
    fireEvent.click(screen.getByRole("button", { name: "Draft a fix request (2 selected)" }));
    const box = (await screen.findByLabelText("Your message")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toContain("Wrong result for negatives"));
    expect(box.value).toContain("Ghost file");
    expect(box.value).not.toContain("Naming nit");
    expect((screen.getByLabelText(/Make changes/) as HTMLInputElement).checked).toBe(true);
    expect(srv.count("POST", "/conversations/cnv_1/messages")).toBe(0);                          // a person reads it and presses Send
  });
});

describe("proof seal", () => {
  it("shows an honest seal in the header and the outcome: rings are checks that passed", async () => {
    await open(view());
    const header = screen.getAllByRole("img", { name: /Proof seal/ });
    expect(header.length).toBe(1);
    expect(header[0].getAttribute("class")).toContain("ready");
    expect(header[0].getAttribute("aria-label")).toContain("revision cccccccc");
    expect(header[0].getAttribute("aria-label")).toContain("2 of 3 checks");                    // approved + tests; no review yet
    tab(/^Outcome/);
    const seals = screen.getAllByRole("img", { name: /Proof seal/ });
    expect(seals.length).toBe(2);
    expect(seals[1].querySelectorAll("circle.ring").length).toBe(2);
    expect(screen.getByText(/each ring is a check that really passed \(2 of 3\)/)).toBeTruthy();
  });

  it("cracks when AIOS says NOT READY, even though the tests passed", async () => {
    const lazy = view({}, {
      review: msg(6, { author_kind: "provider", kind: "review", role: "assistant", author: "claude-code 2.1.310 (claude-opus-5-5), independent reviewer", content: "x",
        meta: { review: { reviewed_revision: "c".repeat(40), findings: [], counts: { high: 1, medium: 0, low: 0 }, summary: "s", model: "m", separate_session: true } } }),
      readiness: { ready: false, verified: true, reviewed: true, high_findings: 1, reasons: ["1 high-severity finding(s) in the review of this revision"], head_revision: "c".repeat(40) },
    });
    await open(lazy);
    const seal = screen.getByRole("img", { name: /Proof seal/ });
    expect(seal.getAttribute("class")).toContain("cracked");
    expect(seal.querySelector("path.crack")).toBeTruthy();
    expect(seal.getAttribute("aria-label")).toContain("independent review found a high-severity problem");
  });

  it("is hollow when nothing has been verified, and absent when there is no change", async () => {
    await open(view({}, { verification: null, readiness: { ready: false, verified: null, reviewed: false, high_findings: 0, reasons: ["not verified: no verification has run"], head_revision: "c".repeat(40) } }));
    expect(screen.getByRole("img", { name: /Proof seal/ }).getAttribute("class")).toContain("hollow");
    cleanup();
    await open(view({}, { patch: null, verification: null, readiness: { ready: false, verified: null, reviewed: false, high_findings: 0, reasons: [], head_revision: null } }));
    expect(screen.queryByRole("img", { name: /Proof seal/ })).toBeNull();
  });
});

describe("status", () => {
  it("shows provider, real quota, permissions and what Claude Code reported about itself", async () => {
    await open(view());
    tab(/^Status/);
    expect(screen.getByText(/2.1.310 \(Claude Code\) · interactive/)).toBeTruthy();
    expect(screen.getByText(/claude.ai \(pro plan\)/)).toBeTruthy();
    expect(screen.getByText("your subscription (no API charges)")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "5-hour window usage" }).getAttribute("aria-valuenow")).toBe("39");
    expect(screen.getByRole("progressbar", { name: "7-day window usage" }).getAttribute("aria-valuenow")).toBe("7");
    expect(screen.getByText(/Extra paid usage is off for this account/)).toBeTruthy();
    expect(screen.getByText(/Running commands:/).parentElement?.textContent).toContain("denied");
    expect(screen.getByText("Glob, Grep, Read")).toBeTruthy();
    expect(screen.getByText("no (subscription login)")).toBeTruthy();
    expect(screen.getByText(/built into Claude Code: cc-plugin-telemetry/)).toBeTruthy();
  });

  it("is loud when Claude Code reports something it should not have", async () => {
    const v = view();
    Object.assign(v.status.last_turn as object, { unexpected_tools: ["Bash"], api_key_source: "ANTHROPIC_API_KEY", external_plugins: ["mine"] });
    await open(v);
    tab(/^Status/);
    expect(screen.getByText("Bash").className).toContain("bad-text");
    expect(screen.getByText("ANTHROPIC_API_KEY").className).toContain("bad-text");
    expect(screen.getByText("mine").className).toContain("bad-text");
  });

  it("does not invent a quota before the first turn", async () => {
    const v = view({}, {}, { quota: null, last_turn: null, quota_note: "No quota report yet: it appears after the first turn." });
    await open(v);
    tab(/^Status/);
    expect(screen.getByText("No quota report yet: it appears after the first turn.")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("No turn has run yet.")).toBeTruthy();
  });
});

describe("narrow screens and accessibility", () => {
  it("on a phone the chat is a tab and the other panels replace it", async () => {
    setWidth(400);
    await open(view());
    expect(screen.getByRole("tab", { name: "Chat" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Your message")).toBeTruthy();
    tab(/^Status/);
    expect(screen.queryByLabelText("Your message")).toBeNull();
    expect(screen.getByText("Provider")).toBeTruthy();
  });

  it("has no axe violations on the conversation and its panels", async () => {
    const { container } = await open(view());
    for (const t of [null, /^Changes/, /^Tests/, /^Outcome/, /^Status/]) {
      if (t) tab(t);
      await waitFor(() => expect(container.querySelector(".work-right")).toBeTruthy());
      const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
      expect(r.violations.map((x) => `${x.id}: ${x.nodes[0]?.html.slice(0, 80)}`)).toEqual([]);
    }
  });
});

describe("picker", () => {
  const routes = (claude: object = { provider: "claude", mode: "interactive", billing: "subscription", detail: {} }) => ({
    "GET /providers": () => ({ body: { items: [claude] } }),
    "GET /conversations": () => ({ body: { items: [{ id: "cnv_1", project_id: "prj_1", project_name: "Calc", title: "Fix the add bug", model: "sonnet", branch: "aios/cnv_1", updated_at: T0, created_at: T0 }], next_cursor: null, limit: 50 } }),
    "GET /projects": () => ({ body: { items: [{ id: "prj_1", slug: "calc", name: "Calc", path: "C:\\calc", created_at: T0, version: 1 }], next_cursor: null, limit: 200 } }),
  });

  it("lists conversations and starts a new one on the chosen project and model", async () => {
    const srv = fakeServer({ ...routes(), "POST /conversations": () => ({ status: 201, body: { id: "cnv_9" } }) });
    render(<Wrap ctx={ctxFor().ctx}><WorkPicker /></Wrap>);
    await screen.findByText("Fix the add bug");
    expect(screen.getByText("has changes")).toBeTruthy();
    fireEvent.change(await screen.findByLabelText("Which Claude model"), { target: { value: "sonnet" } });
    fireEvent.change(screen.getByLabelText(/What is it about/), { target: { value: "Refactor" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(srv.count("POST", "/conversations")).toBe(1));
    expect(srv.calls.find((c) => c.method === "POST")!.body).toEqual({ project_id: "prj_1", title: "Refactor", model: "sonnet" });
    await waitFor(() => expect(location.hash).toBe("#/work/cnv_9"));
  });

  it("warns plainly when Claude Code is unusable and blocks starting", async () => {
    fakeServer(routes({ provider: "claude", mode: "unavailable", billing: "n/a", detail: { reason: "not logged in to the official client" } }));
    render(<Wrap ctx={ctxFor().ctx}><WorkPicker /></Wrap>);
    await screen.findByText(/Claude Code is not usable on this computer right now/);
    expect(screen.getByText(/not logged in to the official client/)).toBeTruthy();
    expect((await screen.findByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("warns when an API key could bill instead of the subscription", async () => {
    fakeServer(routes({ provider: "claude", mode: "interactive", billing: "metered_api_possible", detail: {} }));
    render(<Wrap ctx={ctxFor().ctx}><WorkPicker /></Wrap>);
    await screen.findByText(/might bill it instead of your subscription/);
  });

  it("sends you to register a project when there are none", async () => {
    fakeServer({ ...routes(), "GET /projects": () => ({ body: { items: [], next_cursor: null, limit: 200 } }), "GET /conversations": () => ({ body: { items: [], next_cursor: null, limit: 50 } }) });
    render(<Wrap ctx={ctxFor().ctx}><WorkPicker /></Wrap>);
    await screen.findByText(/You need a project first/);
    fireEvent.click(screen.getByRole("button", { name: "Register a project" }));
    expect(location.hash).toBe("#/projects");
  });
});

describe("other AIs by copy and paste", () => {
  it("writes a prompt, then files the pasted answer, and never claims AIOS ran the other AI", async () => {
    const { srv } = await open(view(), {
      "POST /conversations/cnv_1/handoff": () => ({ status: 201, body: { prompt: "PROMPT TEXT", message_id: "m1", briefing_items: 0, briefing_sha256: null } }),
      "POST /conversations/cnv_1/handoff/reply": () => ({ status: 201, body: { message_id: "m2" } }),
    });
    tab(/^Status/);
    fireEvent.click(await screen.findByRole("button", { name: /Ask another AI/ }));
    expect(screen.getByText(/AIOS does not connect to Gemini/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "How should I name tests?" } });
    fireEvent.click(screen.getByRole("button", { name: "Write the prompt" }));
    expect(await screen.findByDisplayValue("PROMPT TEXT")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Paste Gemini's answer here/), { target: { value: "Use descriptive names." } });
    fireEvent.click(screen.getByRole("button", { name: "Save the answer" }));
    expect(await screen.findByText(/Gemini's answer was added to this conversation/)).toBeTruthy();
    const sent = srv.calls.filter((c: { path: string }) => c.path.endsWith("/handoff") || c.path.endsWith("/handoff/reply")).map((c: { body: unknown }) => c.body);
    expect(sent).toEqual([{ provider: "gemini", question: "How should I name tests?" }, { provider: "gemini", reply: "Use descriptive names." }]);
  });
});
