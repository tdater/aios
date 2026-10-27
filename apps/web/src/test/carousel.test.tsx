import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { proposalQuestion, quickCheck } from "../core/proposals";
import { Inbox } from "../screens/Inbox";
import { fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

const cand = (id: string, over: object = {}) => ({ id, type: "memory", title: `Fact ${id}`, scope: "project", status: "candidate", confidence: 0.6, score: 1, validation: "historically_reported",
  distinct_occurrences: 2, distinct_sources: 1, flags: [], uncertainty: "", active: 0, version: 3, ...over });

beforeEach(() => { resetRoute(""); setWidth(1200, 900); });
afterEach(() => cleanup());

describe("quick review rules", () => {
  it("allows one tap only when no extra safeguard applies", () => {
    expect(quickCheck({ scope: "project", flags: [], status: "candidate" }).quick).toBe(true);
    expect(quickCheck({ scope: "project", flags: [], status: "deferred" }).quick).toBe(true);
    expect(quickCheck({ scope: "global", flags: [], status: "candidate" }).why).toContain("everywhere");
    expect(quickCheck({ scope: "project", flags: ["injection_suspect"], status: "candidate" }).why).toContain("instruction to an AI");
    expect(quickCheck({ scope: "project", flags: ["conflict"], status: "candidate" }).quick).toBe(false);
    expect(quickCheck({ scope: "project", flags: [], status: "approved" }).quick).toBe(false);
  });
  it("asks in plain words", () => {
    expect(proposalQuestion({ title: "You prefer aisle seats", type: "memory" })).toBe("AIOS noticed this about you: “You prefer aisle seats”. Remember it?");
    expect(proposalQuestion({ title: "Check the logs first", type: "skill" })).toContain("suggests a skill");
  });
});

describe("the suggestion cards", () => {
  const open = () => render(<Wrap ctx={ctxFor().ctx}><Inbox sub="candidate" /></Wrap>);

  it("shows one at a time; Remember this approves exactly that version, then moves to the next", async () => {
    const srv = fakeServer({
      "GET /candidates": () => ({ body: { items: [cand("a"), cand("b")], next_cursor: null } }),
      "POST /candidates/a/approve": () => ({ body: {} }),
    } as never);
    open();
    expect(await screen.findByText(/Fact a/)).toBeTruthy();
    expect(screen.getByText("2 waiting")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remember this" }));
    await waitFor(() => expect(screen.getByText(/Fact b/)).toBeTruthy());
    expect(srv.calls.find((c) => c.path === "/candidates/a/approve")!.body).toEqual({ note: "", expected_version: 3, confirm_global: false, override_injection: false });
    expect(screen.getByText(/1 done/)).toBeTruthy();
  });

  it("never offers one tap for a global or flagged suggestion, and Look closer opens the full review", async () => {
    const srv = fakeServer({ "GET /candidates": () => ({ body: { items: [cand("g", { scope: "global" })], next_cursor: null } }) } as never);
    open();
    await screen.findByText(/Fact g/);
    for (const n of ["Remember this", "Not now", "Ignore"]) expect((screen.getByRole("button", { name: n }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/needs the full review/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Look closer" }));
    expect(location.hash).toBe("#/inbox/candidate/g");
    expect(srv.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("Ignore rejects, Skip only hides it for now, and an empty list says so", async () => {
    const srv = fakeServer({
      "GET /candidates": () => ({ body: { items: [cand("a"), cand("b")], next_cursor: null } }),
      "POST /candidates/a/reject": () => ({ body: {} }),
    } as never);
    open();
    await screen.findByText(/Fact a/);
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    await screen.findByText(/Fact b/);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByText(/All caught up/)).toBeTruthy();
    expect(srv.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["/candidates/a/reject"]);
  });

  it("can switch to the full list", async () => {
    fakeServer({ "GET /candidates": () => ({ body: { items: [cand("a")], next_cursor: null } }) } as never);
    open();
    await screen.findByText(/Fact a/);
    fireEvent.click(screen.getByLabelText("Show one at a time"));
    expect(await screen.findByText(/Proposals extracted from approved history/)).toBeTruthy();
  });
});
