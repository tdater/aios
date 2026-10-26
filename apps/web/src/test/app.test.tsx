import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { createRuntime } from "../core/runtime";
import { MemoryKV } from "../core/storage";
import { webPlatform } from "../platform";
import { Home } from "../screens/Home";
import { Inbox } from "../screens/Inbox";
import { RunDetailView } from "../screens/Runs";
import { Settings } from "../screens/Settings";
import { err, fakeServer, HOME, META } from "./fakeServer";
import { ctxFor, newPlatform, resetRoute, setWidth, Wrap } from "./helpers";

beforeEach(() => { resetRoute(""); setWidth(390, 844); document.documentElement.removeAttribute("data-theme"); });

const boot = (routes: Parameters<typeof fakeServer>[0], opts: { kv?: MemoryKV; platform?: ReturnType<typeof newPlatform> } = {}) => {
  const srv = fakeServer(routes);
  const rt = createRuntime(opts.platform ?? webPlatform, opts.kv ?? new MemoryKV());
  const r = render(<App platform={opts.platform ?? webPlatform} runtime={rt} />);
  return { srv, rt, ...r };
};
const signedIn = { "GET /meta": () => ({ body: META }), "GET /auth/me": () => ({ body: { session_id: "s" } }), "GET /home": () => ({ body: HOME }),
  "GET /auth/sessions": () => ({ body: { items: [] } }) };

describe("boot, auth and honesty", () => {
  it("unauthenticated: shows pairing, never fetches data, then enters the app after pairing", async () => {
    let authed = false;
    const { srv } = boot({ ...signedIn, "GET /auth/me": () => (authed ? { body: { session_id: "s" } } : err(401, "unauthenticated")),
      "POST /auth/pair": () => { authed = true; return { body: { session_id: "s" } }; } });
    await screen.findByText("Sign in to this device");
    expect(srv.count("GET", "/home")).toBe(0);
    fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value: "abcd-efgh" } });
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    await screen.findByText("Current runs");
    const pair = srv.calls.find((c) => c.path === "/auth/pair")!;
    expect(pair.body).toMatchObject({ code: "ABCD-EFGH", kind: "browser" });
    expect(JSON.stringify(localStorage)).not.toMatch(/token/i);                  // browser build stores no credential
  });

  it("wrong pairing code and lockout are shown clearly", async () => {
    boot({ ...signedIn, "GET /auth/me": () => err(401, "unauthenticated"), "POST /auth/pair": () => err(429, "pairing_locked", "locked") });
    await screen.findByText("Sign in to this device");
    fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value: "ABCDEFGH" } });
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    await screen.findByText(/Wait 15 minutes/);
  });

  it("server unavailable: honest screen, no data, no fake status", async () => {
    boot({ "GET /meta": () => Promise.reject(new TypeError("net")) });
    await screen.findByText("Server unreachable");
    expect(screen.queryByText(/Current runs/)).toBeNull();
    expect(screen.getByText(/Nothing is shown as current/)).toBeTruthy();
  });

  it("a different server at the same address must be confirmed and never reuses old cache", async () => {
    const kv = new MemoryKV();
    const rt0 = createRuntime(webPlatform, kv);
    const s = rt0.registry.add("Home PC", "");
    rt0.registry.recordServerId(s.id, "srv_OLD");
    rt0.settings.update({ cacheEnabled: true });
    rt0.cache.put("srv_OLD", "home", { counts: {}, runs: [{ id: "x", title: "OLD SECRET RUN", state: "running" }] });
    boot(signedIn, { kv });
    await screen.findByText("This address is a different server");
    expect(document.body.textContent).not.toMatch(/OLD SECRET RUN/);
    fireEvent.click(screen.getByRole("button", { name: /expected/ }));
    await screen.findByText("Current runs");
    expect(kv.keys("aios.cache").filter((k) => k.includes("srv_OLD"))).toEqual([]);   // old partition wiped
  });

  it("incompatible server version is reported, with a way to refresh", async () => {
    boot({ ...signedIn, "GET /meta": () => ({ body: { ...META, min_client_api: 9 } }) });
    await screen.findByText(/versions don’t match/);
    expect(screen.getByRole("button", { name: /Clear app cache/ })).toBeTruthy();
  });

  it("a 426 from the server mid-session surfaces the same compatibility screen (stale assets)", async () => {
    boot({ ...signedIn, "GET /home": () => err(426, "client_too_old") });
    await screen.findByText(/versions don’t match/);
  });

  it("session expiry mid-use drops back to sign-in", async () => {
    let expired = false;
    boot({ ...signedIn, "GET /home": () => (expired ? err(401, "unauthenticated") : { body: HOME }),
      "GET /projects": () => ({ body: { items: [], next_cursor: null, limit: 20 } }) });
    await screen.findByText("Current runs");
    expired = true;                                           // the server revoked/expired this session
    fireEvent.click(screen.getByRole("button", { name: /Projects/ }));
    await screen.findByText("Register a workspace");
    fireEvent.click(screen.getByRole("button", { name: /Home/ }));
    await screen.findByText("Sign in to this device");
  });
});

describe("responsive layout", () => {
  it.each([[390, "phone"], [700, "tablet"], [1280, "desktop"]])("width %i => %s layout with all six sections reachable", async (w, mode) => {
    setWidth(w, 900);
    boot(signedIn);
    await screen.findByText("Current runs");
    expect(document.querySelector(`[data-layout="${mode}"]`)).toBeTruthy();
    const nav = within(screen.getByRole("navigation", { name: "Main" }));
    for (const t of ["Home", "Projects", "Runs", "Inbox", "Knowledge", "Settings"]) expect(nav.getByRole("button", { name: new RegExp(t) })).toBeTruthy();
  });

  it("landscape phones are detected and wide screens get two panes for list/detail", async () => {
    setWidth(850, 400);
    boot({ ...signedIn, "GET /runs": () => ({ body: { items: [], next_cursor: null, limit: 20 } }) });
    await screen.findByText("Current runs");
    expect(document.querySelector(".shell.landscape")).toBeTruthy();
    resetRoute("#/runs");
    await screen.findByText("Select a run to see its timeline.");
    expect(document.querySelector(".panes")).toBeTruthy();
  });

  it("Android back: closes a detail, then goes Home, then lets the platform exit", async () => {
    let handler: (() => boolean) | null = null;
    const platform = newPlatform({ onBack: (h) => { handler = h; return () => { handler = null; }; } });
    const back = vi.spyOn(history, "back").mockImplementation(() => {});
    resetRoute("#/runs/run_1");
    boot({ ...signedIn, "GET /runs/run_1": () => err(404, "not_found") }, { platform });
    await waitFor(() => expect(handler).not.toBeNull());
    await waitFor(() => expect(handler!()).toBe(true));          // a detail is open: back closes it
    expect(back).toHaveBeenCalled();
    act(() => resetRoute("#/settings"));
    await waitFor(() => expect(handler!()).toBe(true));          // not at Home: back goes Home
    await waitFor(() => expect(location.hash).toBe("#/home"));
    act(() => resetRoute("#/home"));
    await waitFor(() => expect(handler!()).toBe(false));         // at Home: platform decides (exit)
    back.mockRestore();
  });

  it("theme preference applies", async () => {
    const { rt } = boot(signedIn);
    await screen.findByText("Current runs");
    act(() => rt.settings.update({ theme: "light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => rt.settings.update({ theme: "system" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe("Home with real (faked-backend) data", () => {
  it("shows counts, current and blocked runs, provider availability", async () => {
    fakeServer({ "GET /home": () => ({ body: HOME }) });
    const { ctx } = ctxFor();
    render(<Wrap ctx={ctx}><Home /></Wrap>);
    await screen.findByText("Audit sample");
    expect(screen.getByRole("button", { name: "Approvals: 2" })).toBeTruthy();
    expect(screen.getByText("provider 'gemini' unavailable")).toBeTruthy();
    expect(screen.getByText(/gemini:/)).toBeTruthy();
  });

  it("when the backend fails: error shown, nothing invented; cached summary only if opted in and clearly stale", async () => {
    fakeServer({ "GET /home": () => Promise.reject(new TypeError("net")) });
    const off = ctxFor();
    render(<Wrap ctx={off.ctx}><Home /></Wrap>);
    await screen.findByText(/Could not reach the server/);
    expect(screen.queryByText(/as of last sync/)).toBeNull();
    document.body.innerHTML = "";
    const on = ctxFor({ cacheEnabled: true });
    on.rt.cache.put("srv_test1", "home", { counts: {}, runs: [{ id: "r", title: "Cached run", state: "running" }] });
    render(<Wrap ctx={on.ctx}><Home /></Wrap>);
    await screen.findByText(/NOT current status/);
    expect(screen.getByText(/Cached run/).textContent).toMatch(/as of last sync/);
  });

  it("offline capture saves a local draft only; sending later reuses the draft's idempotency key", async () => {
    const srv = fakeServer({ "GET /home": () => ({ body: HOME }), "POST /tasks": () => ({ status: 201, body: { task: { id: "tsk_9" } } }) });
    const off = ctxFor({ connected: false });
    const { unmount } = render(<Wrap ctx={off.ctx}><Home /></Wrap>);
    fireEvent.change(screen.getByLabelText("Idea or task"), { target: { value: "call the dentist" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText(/Saved as a local draft \(not sent\)/);
    expect(srv.count("POST", "/tasks")).toBe(0);                                  // a draft is not a server task
    const [draft] = off.rt.drafts.list("srv_test1");
    expect(draft.status).toBe("draft");
    expect(screen.getByText("1 pending sync")).toBeTruthy();
    unmount();
    const on = { ...off.ctx, connected: true };
    render(<Wrap ctx={on}><Home /></Wrap>);
    await screen.findByText(/Local drafts/);
    expect(srv.count("POST", "/tasks")).toBe(0);                                  // reconnecting does NOT auto-upload
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(srv.count("POST", "/tasks")).toBe(1));
    expect(srv.calls.find((c) => c.method === "POST")!.headers["idempotency-key"]).toBe(draft.idempotencyKey);
  });
});

const APPROVAL = (over: object = {}) => ({
  id: "apr_1", run_id: "run_1", summary: "Write 20 chars to C:\\x\\a.txt", status: "pending", action_hash: "h".repeat(64), version: 4, destructive: false,
  action: { type: "write_file" }, requested_at: new Date(Date.now() - 120000).toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString(), age_s: 120, expires_in_s: 3600,
  review: { type: "write_file", target: "C:\\x\\a.txt", side_effects: ["Creates the file at C:\\x\\a.txt"], content_preview: "hello", destructive: false },
  context: { run: { id: "run_1", state: "awaiting_approval", task_title: "Guarded write", task_kind: "demo.guarded_write" }, evidence: [{ kind: "scan", summary: "scanned 3 files", created_at: "t" }] }, ...over });

describe("approvals on the phone", () => {
  it("shows the exact action: target, content, side effects, age, expiry, version, evidence", async () => {
    fakeServer({ "GET /approvals/apr_1": () => ({ body: APPROVAL() }) });
    const { ctx } = ctxFor();
    render(<Wrap ctx={ctx}><Inbox sub="approval" id="apr_1" /></Wrap>);
    await screen.findByText("Exact target");
    expect(screen.getByText("C:\\x\\a.txt", { selector: "code" })).toBeTruthy();
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText(/Creates the file/)).toBeTruthy();
    expect(screen.getByText(/v4 · hash/)).toBeTruthy();
    expect(screen.getByText(/in 60 min/)).toBeTruthy();
    expect(screen.getByText(/scanned 3 files/)).toBeTruthy();
  });

  it("offline: approvals are impossible and nothing is queued", async () => {
    const srv = fakeServer({ "GET /approvals/apr_1": () => ({ body: APPROVAL() }) });
    const { ctx } = ctxFor({ connected: false });
    render(<Wrap ctx={ctx}><Inbox sub="approval" id="apr_1" /></Wrap>);
    await screen.findByText(/never queued/);
    expect((screen.getByRole("button", { name: /Approve this exact action/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(true);
    expect(srv.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("binds the decision to the reviewed hash+version and ignores a double-tap", async () => {
    let n = 0;
    const srv = fakeServer({ "GET /approvals/apr_1": () => ({ body: APPROVAL({ status: n ? "approved" : "pending" }) }),
      "POST /approvals/apr_1/decide": async () => { n++; await new Promise((r) => setTimeout(r, 30)); return { body: APPROVAL({ status: "approved" }) }; } });
    const { ctx } = ctxFor();
    render(<Wrap ctx={ctx}><Inbox sub="approval" id="apr_1" /></Wrap>);
    const btn = await screen.findByRole("button", { name: /Approve this exact action/ });
    fireEvent.click(btn); fireEvent.click(btn); fireEvent.click(btn);
    await waitFor(() => expect(srv.count("POST", "/approvals/apr_1/decide")).toBe(1));
    expect(srv.calls.find((c) => c.method === "POST")!.body).toMatchObject({ approve: true, expected_version: 4, action_hash: "h".repeat(64), confirm_destructive: false });
  });

  it("destructive actions require a deliberate acknowledgement before approving", async () => {
    const srv = fakeServer({ "GET /approvals/apr_1": () => ({ body: APPROVAL({ destructive: true, review: { ...APPROVAL().review, destructive: true, side_effects: ["Overwrites the file at C:\\x\\a.txt"] } }) }),
      "POST /approvals/apr_1/decide": () => ({ body: APPROVAL({ status: "approved" }) }) });
    const { ctx } = ctxFor();
    render(<Wrap ctx={ctx}><Inbox sub="approval" id="apr_1" /></Wrap>);
    const btn = await screen.findByRole("button", { name: /Approve this exact action/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/Destructive or unrecognised action/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/I understand this may overwrite/));
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(srv.calls.find((c) => c.method === "POST")!.body).toMatchObject({ confirm_destructive: true }));
  });

  it.each([["approval_expired", "expired"], ["approval_resolved", "resolved"], ["approval_superseded", "superseded"], ["action_changed", "action changed"], ["version_conflict", "version conflict"]])(
    "server refusal %s is shown, not hidden", async (code) => {
      fakeServer({ "GET /approvals/apr_1": () => ({ body: APPROVAL() }), "POST /approvals/apr_1/decide": () => err(409, code, `refused: ${code}`) });
      const { ctx } = ctxFor();
      render(<Wrap ctx={ctx}><Inbox sub="approval" id="apr_1" /></Wrap>);
      fireEvent.click(await screen.findByRole("button", { name: /Approve this exact action/ }));
      await screen.findByText(`refused: ${code}`);
    });

  it("hostile content is rendered as inert text (no HTML injection)", async () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    fakeServer({ "GET /approvals/apr_1": () => ({ body: APPROVAL({ summary: evil, review: { ...APPROVAL().review, target: evil, content_preview: evil, side_effects: [evil] } }) }) });
    const { ctx } = ctxFor();
    const { container } = render(<Wrap ctx={ctx}><Inbox sub="approval" id="apr_1" /></Wrap>);
    await screen.findByText("Exact target");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=");
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

const RUN = (over: object = {}) => ({ id: "run_1", task_id: "t", task_title: "Slow job", task_kind: "demo.slow_steps", state: "running", display_state: "running", state_reason: null, block_code: null,
  attempt: 1, max_attempts: 3, iteration: 0, max_iterations: 1000, version: 5, created_at: "2026-01-01T00:00:00+00:00", finished_at: null, cancellation: { status: "none", requested_at: null, confirmed_at: null, in_flight_step: null, may_still_finish_step: false, note: "Cancelling stops further steps. It does not reverse side effects that already completed." }, ...over });
const SNAP = (run: object, extra: object = {}) => ({ run, last_event_id: 3, steps: [], events: [{ id: 1, ts: "2026-01-01T00:00:00+00:00", kind: "state", message: "queued -> running" }], artifacts: [], evidence: [], approvals: [], ...extra });

describe("run monitoring and honest execution state", () => {
  it("cancellation REQUESTED is not shown as cancelled, and says the in-flight step may finish", async () => {
    fakeServer({ "GET /runs/run_1": () => ({ body: SNAP(RUN({ cancellation: { status: "requested", requested_at: "t", confirmed_at: null, in_flight_step: { step: "s3", side_effect: true }, may_still_finish_step: true, note: "Cancelling stops further steps. It does not reverse side effects that already completed." } })) }),
      "GET /runs/run_1/events": () => ({ body: { items: [], last_event_id: 3, run_state: "running", run_version: 5, terminal: false } }) });
    const { ctx } = ctxFor();
    render(<Wrap ctx={ctx}><RunDetailView id="run_1" /></Wrap>);
    await screen.findByText(/Cancellation requested — not yet complete/);
    expect(screen.getByText(/may still finish/)).toBeTruthy();
    expect(screen.getByText(/external side effects/)).toBeTruthy();
    expect(screen.getByText(/does not reverse side effects/)).toBeTruthy();
    expect(screen.queryByText("Cancellation confirmed")).toBeNull();
    expect(screen.queryByRole("button", { name: /Request cancellation/ })).toBeNull();     // can't double-request
  });

  it("requesting cancellation needs a deliberate confirm and sends the reviewed version", async () => {
    const srv = fakeServer({ "GET /runs/run_1": () => ({ body: SNAP(RUN()) }), "POST /runs/run_1/cancel": () => ({ body: { result: "requested" } }),
      "GET /runs/run_1/events": () => ({ body: { items: [], last_event_id: 3, run_state: "running", run_version: 5, terminal: false } }) });
    const { ctx } = ctxFor();
    render(<Wrap ctx={ctx}><RunDetailView id="run_1" /></Wrap>);
    fireEvent.click(await screen.findByRole("button", { name: /Request cancellation…/ }));
    expect(srv.count("POST", "/runs/run_1/cancel")).toBe(0);
    const yes = screen.getByRole("button", { name: /Yes, request cancellation/ });
    fireEvent.click(yes); fireEvent.click(yes);
    await waitFor(() => expect(srv.count("POST", "/runs/run_1/cancel")).toBe(1));
    expect(srv.calls.find((c) => c.method === "POST")!.body).toEqual({ expected_version: 5 });
  });

  it.each([
    ["quota_exhausted", "blocked_quota", "blocked: quota"],
    ["awaiting_provider_session", "awaiting_provider_session", "awaiting your provider session"],
  ])("%s is labelled precisely and never offers Resume for a quota/provider stop", async (code, display, label) => {
    fakeServer({ "GET /runs/run_1": () => ({ body: SNAP(RUN({ state: "blocked", display_state: display, block_code: code, state_reason: "stopped" }), { artifacts: [{ id: "a1", kind: "task_packet", sha256: "x".repeat(64), bytes: 10, provenance: "generated" }] }) }) });
    const { ctx } = ctxFor();
    render(<Wrap ctx={ctx}><RunDetailView id="run_1" /></Wrap>);
    await screen.findByText(label);
    if (code === "quota_exhausted") expect(screen.queryByRole("button", { name: "Resume run" })).toBeNull();
    else expect(screen.getByText("Waiting for your provider session")).toBeTruthy();
  });

  it("network loss shows a reconnecting banner with the age of the data, then recovers via snapshot", async () => {
    let down = false, evs = 0;
    fakeServer({ "GET /runs/run_1": () => (down ? Promise.reject(new TypeError("net")) : { body: SNAP(RUN()) }),
      "GET /runs/run_1/events": () => { evs++; if (evs === 2) down = true; if (down) return Promise.reject(new TypeError("net")); return { body: { items: [], last_event_id: 3, run_state: "running", run_version: 5, terminal: false } }; } });
    const { ctx } = ctxFor();
    render(<Wrap ctx={ctx}><RunDetailView id="run_1" /></Wrap>);
    await screen.findByText("Slow job");
    await screen.findByText(/Connection lost/, undefined, { timeout: 6000 });
    expect(screen.getByText("Slow job")).toBeTruthy();                           // last data stays visible, labelled as old
    down = false;
    await waitFor(() => expect(screen.queryByText(/Connection lost/)).toBeNull(), { timeout: 12000 });
  }, 20000);

  it("untrusted artifact and event text cannot inject markup", async () => {
    const evil = "<b onmouseover=alert(1)>x</b><iframe src=//evil></iframe>";
    fakeServer({ "GET /runs/run_1": () => ({ body: SNAP(RUN({ state: "succeeded", display_state: "completed" }), { events: [{ id: 1, ts: "2026-01-01T00:00:00+00:00", kind: "state", message: evil }], evidence: [{ id: "e", kind: "scan", summary: evil, created_at: "t" }], artifacts: [{ id: "a1", kind: "audit_report", sha256: "x".repeat(64), bytes: 5, provenance: "generated" }] }) }),
      "GET /artifacts/a1": () => ({ body: { id: "a1", kind: "audit_report", sha256: "x", provenance: "g", content: evil } }) });
    const { ctx } = ctxFor();
    const { container } = render(<Wrap ctx={ctx}><RunDetailView id="run_1" /></Wrap>);
    await screen.findByText("Slow job");
    fireEvent.click(screen.getByRole("button", { name: /Artifacts/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Show content" }));
    await waitFor(() => expect(container.querySelector("pre")).toBeTruthy());
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });
});

describe("settings: privacy and logout", () => {
  it("turning the cache off wipes it; wipe-all clears local data", async () => {
    fakeServer({ ...signedIn, "GET /health": () => ({ body: { version: "x", db: "ok", schema: ["0003"], run_counts: {}, disk_free_gb: 1, backup_status: "never run", billable_env: {} } }), "GET /providers": () => ({ body: { items: [] } }) });
    const { ctx, rt } = ctxFor({ cacheEnabled: true });
    rt.cache.put("srv_test1", "projects", [{ id: "p", name: "Secret project" }]);
    const wipe = vi.fn();
    render(<Wrap ctx={{ ...ctx, clearLocalData: wipe }}><Settings /></Wrap>);
    fireEvent.click(await screen.findByLabelText(/Keep non-secret summaries/));
    expect(rt.cache.get("srv_test1", "projects")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Wipe all local data/ }));
    expect(wipe).toHaveBeenCalled();
    expect(screen.getByText(/Push notifications are/)).toBeTruthy();             // honest notification status
  });
});

describe("modes change what the menu lists, and nothing else", () => {
  it("Simple hides Projects and Runs; Settings switches the mode and brings them back", async () => {
    setWidth(1280, 900);
    const kv = new MemoryKV();
    const rt0 = createRuntime(webPlatform, kv);
    rt0.settings.update({ mode: "simple" });
    boot(signedIn, { kv });
    await screen.findByText("Current runs");
    const nav = () => within(screen.getByRole("navigation", { name: "Main" }));
    expect(nav().queryByRole("button", { name: /Projects/ })).toBeNull();
    expect(nav().queryByRole("button", { name: /Runs/ })).toBeNull();
    expect(nav().getByRole("button", { name: /Insights/ })).toBeTruthy();
    fireEvent.click(nav().getByRole("button", { name: /Settings/ }));
    fireEvent.click(await screen.findByLabelText(/Standard/));
    await waitFor(() => expect(nav().getByRole("button", { name: /Projects/ })).toBeTruthy());
    expect(nav().getByRole("button", { name: /Runs/ })).toBeTruthy();
    expect(nav().queryByRole("button", { name: /Graph/ })).toBeNull();
  });
});

describe("Today cards on Home", () => {
  const skyline = { "GET /skyline": () => ({ body: { projects: [{ id: "p", name: "Calc", floors: 2, working: 0, waiting: 0, conversations: 1 }], totals: { projects: 1, floors: 2, waiting: 0 } } }) };
  it("shows what needs you, what AIOS saw pass, and one next step with its reason", async () => {
    fakeServer({ ...signedIn, ...skyline });
    render(<Wrap ctx={ctxFor().ctx}><Home /></Wrap>);
    const today = await screen.findByRole("region", { name: "Today" });
    await waitFor(() => expect(today.textContent).toContain("2 changes passed tests that AIOS ran itself."));
    expect(today.textContent).toContain("2 approvals and 1 blocked run.");
    expect(today.textContent).toContain("Review what is waiting for your approval. 2 actions cannot go ahead until you decide.");
  });
  it("a card the person switched off is not shown", async () => {
    fakeServer({ ...signedIn, ...skyline });
    const c = ctxFor();
    render(<Wrap ctx={{ ...c.ctx, settings: { ...c.ctx.settings, hiddenCards: ["ask", "done"] } }}><Home /></Wrap>);
    const today = await screen.findByRole("region", { name: "Today" });
    expect(within(today).queryByText("Ask anything")).toBeNull();
    expect(within(today).getByText("Needs you")).toBeTruthy();
  });
});
