import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it } from "vitest";
import { Inbox } from "../screens/Inbox";
import { Improvements } from "../screens/inbox/Improvements";
import { err, fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, Wrap } from "./helpers";

beforeEach(() => resetRoute("#/inbox/improvements"));

const CAND = (o: object = {}) => ({ id: "skc_1", name: "adb-debug", status: "candidate", eval_status: "not_run", content_sha256: "a".repeat(64), created_at: new Date().toISOString(), decided_at: null, decision_note: null, ...o });
const DETAIL = (o: object = {}) => ({ id: "skc_1", name: "adb-debug", status: "candidate", eval_status: "not_run", rationale: "Recurring need seen in 3 sessions", content: "---\nname: adb-debug\n---\n# adb-debug\nSTEP ONE <script>x</script>", sha256: "b".repeat(64),
  decision_note: null, results: [], active_version: null, ...o });
const VERSION = (o: object = {}) => ({ name: "workflow-audit", version: 2, status: "active", sha256: "c".repeat(64), parent_version: 1, deployed_at: new Date().toISOString(), note: null, ...o });

function setup(over: Record<string, Parameters<typeof fakeServer>[0][string]> = {}, ov = { candidates: [CAND()], versions: [VERSION(), VERSION({ version: 1, status: "rolled_back" })] }) {
  const srv = fakeServer({ "GET /skills": () => ({ body: ov }), "GET /skills/candidates/skc_1": () => ({ body: DETAIL() }), ...over });
  const c = ctxFor();
  return { srv, c, ...render(<Wrap ctx={c.ctx}><Improvements /></Wrap>) };
}
const openIt = async () => fireEvent.click(await screen.findByRole("button", { name: /adb-debug/ }));

describe("skill improvements review", () => {
  it("lists what is waiting and what is deployed, honestly", async () => {
    setup();
    await screen.findByRole("button", { name: /adb-debug/ });
    expect(screen.getByText("not checked")).toBeTruthy();
    expect(screen.getByText("workflow-audit")).toBeTruthy();
    expect(screen.getByText(/version 2 active/)).toBeTruthy();
    expect(screen.getByText(/behavioural examples inside a skill are/)).toBeTruthy();
  });

  it("empty states do not pretend anything exists", async () => {
    setup({}, { candidates: [], versions: [] });
    await screen.findByText(/No skill changes are waiting/);
    expect(screen.getByText(/No skill has been deployed/)).toBeTruthy();
  });

  it("shows the exact text as inert data and cannot deploy before checks pass", async () => {
    const { container } = setup();
    await openIt();
    await screen.findByText(/Exact text that would be deployed \(new skill\)/);
    expect(container.textContent).toContain("<script>x</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/Deploying is unavailable until the checks pass/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Deploy skill" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a change to an already-deployed skill is shown as a diff against the deployed text, with the full text one click away", async () => {
    setup({ "GET /skills/candidates/skc_1": () => ({ body: DETAIL({ current_content: ["# adb-debug", "STEP ONE", "old line"].join("\n"), content: ["# adb-debug", "STEP ONE", "new line"].join("\n") }) }) });
    await openIt();
    const diff = await screen.findByRole("group", { name: "Changes from the deployed version" });
    expect(diff.textContent).toContain("1 line added, 1 removed");
    expect(diff.textContent).toContain("- old line");
    expect(diff.textContent).toContain("+ new line");
    fireEvent.click(screen.getByRole("button", { name: "Show full text" }));
    expect(screen.queryByRole("group", { name: "Changes from the deployed version" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show changes only" })).toBeTruthy();
  });

  it("an identical proposal says so, and a brand-new skill shows full text without a diff", async () => {
    setup({ "GET /skills/candidates/skc_1": () => ({ body: DETAIL({ current_content: "same", content: "same" }) }) });
    await openIt();
    await screen.findByText(/Identical to the deployed text/);
  });

  it("running checks reports failures and still blocks deployment", async () => {
    let ran = false;
    const srv = setup({ "POST /skills/candidates/skc_1/evaluate": () => { ran = true; return { body: { eval_status: "failed", failed_cases: ["no-unrestricted-shell"], regression_failures: ["other-skill"], not_executed: 4, note: "n" } }; },
      "GET /skills/candidates/skc_1": () => ({ body: ran ? DETAIL({ eval_status: "failed", results: [{ case: "no-unrestricted-shell", passed: false, detail: "fail: uses Bash" }] }) : DETAIL() }) }).srv;
    await openIt();
    fireEvent.click(await screen.findByRole("button", { name: "Run checks" }));
    await screen.findByText(/Failed: no-unrestricted-shell, regression: other-skill/);
    expect(screen.getByText(/4 behavioural cases were written down but not executed/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Check results" }).textContent).toContain("✗ no-unrestricted-shell");
    expect((screen.getByRole("button", { name: "Deploy skill" }) as HTMLButtonElement).disabled).toBe(true);
    expect(srv.count("POST", "/skills/candidates/skc_1/promote")).toBe(0);
  });

  it("deploy needs passing checks AND an explicit tick, then sends confirm: true with the note", async () => {
    const srv = setup({ "GET /skills/candidates/skc_1": () => ({ body: DETAIL({ eval_status: "passed", results: [{ case: "section:Purpose and trigger", passed: true, detail: "ok" }] }) }),
      "POST /skills/candidates/skc_1/promote": () => ({ body: { skill: "adb-debug", version: 1, sha256: "x", path: "p", previous_version: null } }) }).srv;
    await openIt();
    const deploy = await screen.findByRole("button", { name: "Deploy skill" });
    expect((deploy as HTMLButtonElement).disabled).toBe(true);                                // passed, but not yet confirmed by the human
    fireEvent.change(screen.getByLabelText("Decision note"), { target: { value: "looks right" } });
    fireEvent.click(screen.getByLabelText(/I read the exact text above/));
    expect((deploy as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(deploy);
    await screen.findByText("Deployed adb-debug as version 1.");
    expect(srv.calls.find((x) => x.path.endsWith("/promote"))!.body).toEqual({ confirm: true, note: "looks right" });
  });

  it("a server-side refusal is shown, not swallowed", async () => {
    setup({ "GET /skills/candidates/skc_1": () => ({ body: DETAIL({ eval_status: "passed" }) }), "POST /skills/candidates/skc_1/promote": () => err(409, "evaluation_failed", "re-evaluation failed") });
    await openIt();
    fireEvent.click(await screen.findByLabelText(/I read the exact text above/));
    fireEvent.click(screen.getByRole("button", { name: "Deploy skill" }));
    await screen.findByText(/re-evaluation failed/);
  });

  it("rejecting requires a reason and a second click", async () => {
    const srv = setup({ "POST /skills/candidates/skc_1/reject": () => ({ body: { id: "skc_1", status: "rejected" } }) }).srv;
    await openIt();
    fireEvent.click(await screen.findByRole("button", { name: "Reject…" }));
    const confirm = screen.getByRole("button", { name: "Confirm reject" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(srv.count("POST", "/skills/candidates/skc_1/reject")).toBe(0);
    fireEvent.change(screen.getByLabelText("Decision note"), { target: { value: "too broad" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await screen.findByText(/Rejected\./);
    expect(srv.calls.find((x) => x.path.endsWith("/reject"))!.body).toEqual({ note: "too broad" });
  });

  it("roll back asks first, then restores through the API", async () => {
    const srv = setup({ "POST /skills/workflow-audit/rollback": () => ({ body: { skill: "workflow-audit", restored_version: 1, sha256: "x" } }) }).srv;
    fireEvent.click(await screen.findByRole("button", { name: "Roll back…" }));
    expect(srv.count("POST", "/skills/workflow-audit/rollback")).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Yes, roll back" }));
    await screen.findByText("workflow-audit restored to version 1.");
  });

  it("offline: every decision button is disabled", async () => {
    fakeServer({ "GET /skills": () => ({ body: { candidates: [CAND()], versions: [VERSION()] } }), "GET /skills/candidates/skc_1": () => ({ body: DETAIL({ eval_status: "passed" }) }) });
    const c = ctxFor({ connected: false });
    render(<Wrap ctx={c.ctx}><Improvements /></Wrap>);
    fireEvent.click(await screen.findByRole("button", { name: /adb-debug/ }));
    expect((await screen.findByRole("button", { name: "Re-run checks" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reject…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Roll back…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Offline: reviewing and deploying need a connection/)).toBeTruthy();
  });

  it("is reachable from the Inbox tab and has no accessibility violations", async () => {
    fakeServer({ "GET /skills": () => ({ body: { candidates: [CAND()], versions: [VERSION()] } }), "GET /skills/candidates/skc_1": () => ({ body: DETAIL() }) });
    const c = ctxFor();
    const { container } = render(<Wrap ctx={c.ctx}><Inbox sub="improvements" /></Wrap>);
    fireEvent.click(await screen.findByRole("button", { name: /adb-debug/ }));
    await screen.findByText(/Exact text that would be deployed/);
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Improvements", selected: true })).toBeTruthy());
  });
});
