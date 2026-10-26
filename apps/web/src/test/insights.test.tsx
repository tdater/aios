import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InsightsScreen } from "../screens/Insights";
import { fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

beforeEach(() => { resetRoute(""); setWidth(1200, 800); });
afterEach(cleanup);

const star = (id: string, o: object = {}) => ({ id, title: `Memory ${id}`, type: "lesson", scope: "global", project_id: null, project: null, state: "fresh", uses: 0, verified_uses: 0, hollow: false, last_used: null, last_verified: null, brightness: 0.1, ...o });
const CON = { stars: [star("mem_a", { uses: 2, verified_uses: 1, brightness: 0.8 }), star("mem_b", { uses: 1, hollow: true, type: "fact" }), star("mem_c", { state: "stale", project: "Calc", type: "decision" })],
  links: [], clusters: ["Calc", "Everywhere"], link_kinds: ["supersedes"], totals: { stars: 3, verified: 1, hollow: 1, stale: 1 } };
const SKY = { projects: [{ id: "prj_1", name: "Calc", floors: 2, working: 1, waiting: 1, conversations: 1 }], totals: { projects: 1, floors: 2, waiting: 1 } };
const EV = { memory_id: "mem_a", total_uses: 2, verified_uses: 1, uses: [{ run_id: "run_1", conversation_id: "c", conversation: "Fix add", memory_version: "1", at: "2026-10-24T00:00:00+00:00", verified: true }] };

const open = async (routes = {}) => {
  fakeServer({ "GET /constellation": () => ({ body: CON }), "GET /skyline": () => ({ body: SKY }), "GET /constellation/mem_a": () => ({ body: EV }), ...routes });
  const r = render(<Wrap ctx={ctxFor().ctx}><InsightsScreen /></Wrap>);
  await screen.findByRole("group", { name: "Constellation of memories" });
  return r;
};

describe("Insights: constellation", () => {
  it("every star is a described button, and opening one shows the runs that used it", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Memory mem_b (fact): used 1 time, 0 followed by passing tests, never verified" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Memory mem_c \(decision, stale\): never used/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Memory mem_a \(lesson\): used 2 times, 1 followed/ }));
    const ev = await screen.findByRole("region", { name: "Evidence for Memory mem_a" });
    await waitFor(() => expect(ev.textContent).toContain("Fix add"));
    expect(ev.textContent).toContain("tests passed afterwards");
  });
  it("the keyboard can open a star, and the list view offers the same stars", async () => {
    await open();
    const b = screen.getByRole("button", { name: /Memory mem_a \(lesson\)/ });
    fireEvent.keyDown(b, { key: "Enter" });
    expect(await screen.findByRole("region", { name: /Evidence for/ })).toBeTruthy();
    expect(screen.getByText(/3 memories · 1 followed by passing tests · 1 used but never verified · 1 due for review/)).toBeTruthy();
  });
  it("says so when nothing is remembered", async () => {
    fakeServer({ "GET /constellation": () => ({ body: { ...CON, stars: [], totals: { stars: 0, verified: 0, hollow: 0, stale: 0 } } }), "GET /skyline": () => ({ body: SKY }) });
    render(<Wrap ctx={ctxFor().ctx}><InsightsScreen /></Wrap>);
    expect(await screen.findByText(/Nothing is remembered yet/)).toBeTruthy();
  });
  it("has no accessibility violations", async () => {
    const { container } = await open();
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
  });
});

describe("Insights: skyline", () => {
  it("shows one building per project with a plain description", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: "Your projects" }));
    expect(await screen.findByRole("button", { name: "Calc: 2 verified outcomes, 1 running now, 1 waiting for you" })).toBeTruthy();
  });
  it("shows an error instead of an empty sky when the server fails", async () => {
    fakeServer({ "GET /constellation": () => ({ body: CON }), "GET /skyline": () => ({ status: 500, body: { error: { code: "boom", message: "Skyline broke" } } }) });
    render(<Wrap ctx={ctxFor().ctx}><InsightsScreen /></Wrap>);
    await screen.findByRole("group", { name: "Constellation of memories" });
    fireEvent.click(screen.getByRole("tab", { name: "Your projects" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Skyline broke|boom|500/));
  });
});
