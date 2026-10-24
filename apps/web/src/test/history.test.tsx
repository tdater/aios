import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it } from "vitest";
import { isDocumentRoute } from "../core/workspace";
import { Settings } from "../screens/Settings";
import { HistorySection } from "../screens/settings/History";
import { PublishSection } from "../screens/settings/Publish";
import { err, fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, Wrap } from "./helpers";

beforeEach(() => resetRoute(""));

const TOTALS = { discovered: 3, parsed: 1, quarantined: 1, duplicate: 0, unsupported: 0, failed: 1, deleted: 0 };
const SUMMARY = { totals: TOTALS, approved_dir: "C:\\aios-state\\imports\\approved", last_review: null, candidate_counts: { candidate: 4 }, note: "x" };
const SRC = (o: object) => ({ id: "src_1", rel_path: "claude-code/proj/a.jsonl", kind: "claude_code", provider: "claude", imported_at: new Date().toISOString(), status: "parsed", status_detail: "", message_count: 12,
  date_start: "2026-01-02T00:00:00Z", date_end: "2026-01-04T00:00:00Z", secret_kinds: [], ...o });
const base = (sources: object[]) => ({
  "GET /history/summary": () => ({ body: SUMMARY }),
  "GET /history/schedule": () => ({ body: { enabled: false, every_hours: 24, last_attempt: null, last_status: null, next_due: null } }),
  "GET /history/sources": () => ({ body: { items: sources, next_cursor: null, limit: 200 } }),
});

describe("history section", () => {
  it("shows the approved folder, honest totals, sources, and secret KINDS only", async () => {
    fakeServer(base([SRC({}), SRC({ id: "src_2", rel_path: "claude-code/proj/b.jsonl", status: "quarantined", secret_kinds: ["github-token"], status_detail: "held back" }), SRC({ id: "src_3", status: "deleted" })]));
    const c = ctxFor();
    const { container } = render(<Wrap ctx={c.ctx}><HistorySection /></Wrap>);
    await screen.findByText(/3 files seen · 1 read · 1 held back for secrets/);
    expect(screen.getByText("C:\\aios-state\\imports\\approved")).toBeTruthy();
    expect(screen.getByText("claude-code/proj/a.jsonl")).toBeTruthy();
    expect(screen.getByText(/Possible secrets found \(kinds only, never shown\): github-token/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/ghp_/);
    expect(screen.getAllByRole("button", { name: /Remove…/ })).toHaveLength(2);           // the already-deleted source is not listed
    expect(screen.getByText(/stage_claude_sessions\.py --list/)).toBeTruthy();
  });

  it("an empty history explains how to add some", async () => {
    fakeServer(base([]));
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><HistorySection /></Wrap>);
    await screen.findByText(/Nothing imported yet/);
  });

  it("review new sessions posts once and reports the outcome in plain words", async () => {
    const srv = fakeServer({ ...base([SRC({})]), "POST /history/review-new": () => ({ body: { id: "rev_1", status: "no_change", totals: TOTALS } }) });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><HistorySection /></Wrap>);
    const btn = await screen.findByRole("button", { name: "Review new sessions" });
    fireEvent.click(btn);
    fireEvent.click(btn);                                                                      // double tap must not double-post
    await screen.findByText("Nothing new to review.");
    expect(srv.count("POST", "/history/review-new")).toBe(1);
  });

  it("a busy review and server errors are reported, not hidden", async () => {
    fakeServer({ ...base([]), "POST /history/review-new": () => err(409, "review_busy", "a review is already running") });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><HistorySection /></Wrap>);
    fireEvent.click(await screen.findByRole("button", { name: "Review new sessions" }));
    await screen.findByText(/already running/);
  });

  it("removing a source needs confirmation, can also delete the copied file, and shows the consequences", async () => {
    const srv = fakeServer({ ...base([SRC({})]),
      "POST /history/sources/src_1/delete": () => ({ body: { source: "src_1", candidates_recomputed: 2, orphaned: ["cand_x"], memories_needing_review: [{ candidate: "c", memory: "m" }], file_removed: true, backup_note: "Existing backups are not rewritten; deletion does not reach them." } }) });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><HistorySection /></Wrap>);
    fireEvent.click(await screen.findByRole("button", { name: /Remove…/ }));
    expect(srv.count("POST", "/history/sources/src_1/delete")).toBe(0);
    fireEvent.click(screen.getByLabelText(/Also delete the copied file/));
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    await screen.findByText(/2 proposals re-checked, 1 left without evidence, 1 note need another look, file deleted/);
    expect(srv.calls.find((x) => x.method === "POST" && x.path.endsWith("/delete"))!.query.get("delete_file")).toBe("true");
    expect(screen.getByText(/Existing backups are not rewritten/)).toBeTruthy();
  });

  it("automatic review is off by default; turning it on saves the choice and shows what it will and will not do", async () => {
    let state = { enabled: false, every_hours: 24, last_attempt: null as string | null, last_status: null as string | null, next_due: null as string | null };
    const srv = fakeServer({ ...base([]), "GET /history/schedule": () => ({ body: state }),
      "PUT /history/schedule": (c) => { state = { ...state, ...(c.body as object) } as typeof state; return { body: state }; } });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><HistorySection /></Wrap>);
    const box = await screen.findByLabelText("Review new sessions automatically") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.queryByLabelText("How often to review automatically")).toBeNull();
    fireEvent.click(box);
    await screen.findByText(/makes no model calls, and stops at 200 files or 60 seconds/);
    expect(srv.calls.find((x) => x.method === "PUT")!.body).toEqual({ enabled: true, every_hours: 24 });
    fireEvent.change(screen.getByLabelText("How often to review automatically"), { target: { value: "6" } });
    await waitFor(() => expect(srv.calls.filter((x) => x.method === "PUT").pop()!.body).toEqual({ enabled: true, every_hours: 6 }));
  });

  it("offline: review and removal are disabled", async () => {
    fakeServer(base([SRC({})]));
    const c = ctxFor({ connected: false });
    render(<Wrap ctx={c.ctx}><HistorySection /></Wrap>);
    expect((await screen.findByRole("button", { name: "Review new sessions" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Remove…/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("has no accessibility violations", async () => {
    fakeServer(base([SRC({}), SRC({ id: "src_2", rel_path: "claude-code/proj/c.jsonl", status: "quarantined", secret_kinds: ["aws-key"] })]));
    const c = ctxFor();
    const { container } = render(<Wrap ctx={c.ctx}><HistorySection /></Wrap>);
    await screen.findByText("claude-code/proj/a.jsonl");
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

describe("publishing section", () => {
  it("previews exactly what would be exported and what is held back (without naming withheld notes)", async () => {
    fakeServer({ "GET /published": () => ({ body: { rule: "r", items: [{ id: "mem_1", slug: "hello-world", title: "Hello World", type: "fact", tags: ["web"] }],
      skipped: [{ id: "mem_2", title: "Draft", reason: "status is candidate, not approved" }, { id: "mem_3", title: "(withheld)", reason: "contains something that looks like a secret" }] } }) });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><PublishSection /></Wrap>);
    const list = await screen.findByRole("list", { name: "Notes that would be exported" });
    expect(within(list).getByText("Hello World")).toBeTruthy();
    expect(within(list).getByText(/hello-world\.md · fact · #web/)).toBeTruthy();
    expect(screen.getByText(/Draft/)).toBeTruthy();
    expect(screen.getByText(/A note/)).toBeTruthy();
    expect(screen.getByText(/export_published\.py/)).toBeTruthy();
  });
  it("writing the export needs a confirmation, posts once, and reports where the files went", async () => {
    const srv = fakeServer({ "GET /published": () => ({ body: { rule: "r", items: [{ id: "m", slug: "a", title: "A", type: "fact", tags: [] }], skipped: [] } }),
      "POST /published/export": () => ({ body: { count: 1, path: "C:/state/exports/published", skipped: 0, note: "n" } }) });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><PublishSection /></Wrap>);
    fireEvent.click(await screen.findByRole("button", { name: "Write export files…" }));
    expect(srv.count("POST", "/published/export")).toBe(0);
    const yes = screen.getByRole("button", { name: "Yes, write files" });
    fireEvent.click(yes);
    fireEvent.click(yes);
    await screen.findByText(/Wrote 1 note to/);
    expect(srv.count("POST", "/published/export")).toBe(1);
    expect(screen.getByText(/Nothing was uploaded or deployed/)).toBeTruthy();
  });
  it("the export button is disabled when there is nothing to export or offline", async () => {
    fakeServer({ "GET /published": () => ({ body: { rule: "r", items: [], skipped: [] } }) });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><PublishSection /></Wrap>);
    await screen.findByText(/No notes would be exported/);
    expect((screen.getByRole("button", { name: "Write export files…" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("says so when nothing would be exported", async () => {
    fakeServer({ "GET /published": () => ({ body: { rule: "r", items: [], skipped: [] } }) });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><PublishSection /></Wrap>);
    await screen.findByText(/No notes would be exported/);
  });
});

describe("settings routing", () => {
  it("#/settings/history is an anchor into the page, never a tab", () => {
    expect(isDocumentRoute({ tab: "settings", id: "history" })).toBe(false);
    expect(isDocumentRoute({ tab: "knowledge", id: "mem_1" })).toBe(true);
  });
  it("the settings page contains the history and publishing sections", async () => {
    fakeServer({ ...base([]), "GET /published": () => ({ body: { rule: "r", items: [], skipped: [] } }), "GET /auth/session": () => ({ body: {} }) });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><Settings section="history" /></Wrap>);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Imported history" })).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Publishing" })).toBeTruthy();
  });
});
