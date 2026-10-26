import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UniverseHome } from "../ui/UniverseHome";
import { openTour, tourStore } from "../ui/uiState";
import { fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

beforeEach(() => { resetRoute(""); setWidth(1300, 900); tourStore.set({ open: false, step: 0, waiting: false }); });
afterEach(cleanup);

const star = (id: string, o: object = {}) => ({ id, title: `Memory ${id}`, type: "preference", scope: "global", project_id: null, project: null, state: "fresh", uses: 1, verified_uses: 1, hollow: false, last_used: null, last_verified: null, brightness: 0.8, ...o });
const AI = (provider: string, name: string, level: string, mode: string, told: string[]) => ({ provider, name, mode, level, default_level: level, told, told_count: told.length });
const UNI = (o: object = {}) => ({
  you: { approved: 2, suggested: 1, learning: true },
  ais: [AI("claude", "Claude", "private", "interactive", ["m1", "m2"]), AI("gemini", "Gemini", "public", "manual", ["m2"]), AI("perplexity", "Perplexity", "none", "manual", []), AI("antigravity", "Antigravity", "public", "manual", ["m2"])],
  stars: [star("m1"), star("m2", { type: "fact", project: "Calc" })], links: [], clusters: ["Everywhere", "Calc"], totals: { stars: 2, verified: 2, hollow: 0, stale: 0 },
  comets: { approvals: 2, blocked: 0, to_review: 1 }, paused: false, ...o });

const open = async (u = UNI(), extra = {}) => {
  const srv = fakeServer({ "GET /universe": () => ({ body: u }), ...extra });
  const r = render(<Wrap ctx={ctxFor().ctx}><UniverseHome /></Wrap>);
  await screen.findByRole("group", { name: /Your universe/ });
  return { srv, ...r };
};

describe("the universe on Home", () => {
  it("shows you, each AI honestly, each memory and what is waiting, as described buttons", async () => {
    await open();
    expect(screen.getByRole("button", { name: "You: AIOS remembers 2 things about you" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Claude: told 2 of your memories, connected" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gemini: told 1 of your memories, by copy and paste" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Perplexity: told nothing, by copy and paste" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Memory m1 \(preference\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Waiting for you: 2 waiting for your approval" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Waiting for you: 1 to look over" })).toBeTruthy();
  });

  it("explains every part in plain words, with a way to start the tour", async () => {
    await open();
    const legend = screen.getByRole("region", { name: "What am I looking at?" });
    for (const t of ["You (the glowing centre)", "Planets: your AIs", "Rings: how much each AI may be told", "Stars: what AIOS remembers", "Constellations: groups of memories", "Comets: waiting for you"]) expect(within(legend).getByText(t)).toBeTruthy();
    expect(legend.textContent).toContain("Nothing marked secret is ever shared at any ring");
    fireEvent.click(within(legend).getByRole("button", { name: "Take the tour" }));
    expect(tourStore.get()).toEqual({ open: true, step: 0, waiting: false });
  });

  it("picking a planet shows what it was told, lights those memories, and lets you change its ring", async () => {
    let level = "public";
    const { srv, container } = await open(UNI(), { "PUT /sharing/gemini": (c: { body: unknown }) => { level = (c.body as { level: string }).level; return { body: { items: [], levels: [] } }; }, "GET /universe": () => ({ body: UNI({ ais: UNI().ais.map((a) => (a.provider === "gemini" ? { ...a, level } : a)) }) }) });
    fireEvent.click(screen.getByRole("button", { name: /^Gemini:/ }));
    const panel = await screen.findByRole("region", { name: "About Gemini" });
    expect(panel.textContent).toContain("Reached by copy and paste");
    expect(panel.textContent).toContain("It would be told these 1");
    expect(within(panel).getByText("Memory m2")).toBeTruthy();
    expect(container.querySelectorAll("line.beam").length).toBe(1);
    fireEvent.change(within(panel).getByLabelText("What Gemini may be told"), { target: { value: "private" } });
    await waitFor(() => expect(srv.calls.find((c) => c.method === "PUT")!.body).toEqual({ level: "private" }));
  });

  it("Claude's panel says plainly when it is not signed in", async () => {
    await open(UNI({ ais: UNI().ais.map((a) => (a.provider === "claude" ? { ...a, mode: "unavailable" } : a)) }));
    fireEvent.click(screen.getByRole("button", { name: /^Claude: .*not ready/ }));
    expect((await screen.findByRole("region", { name: "About Claude" })).textContent).toContain("not signed in on this PC");
  });

  it("picking you shows what AIOS knows and the learning switch", async () => {
    const { srv } = await open(UNI(), { "PUT /learning": () => ({ body: { enabled: false } }) });
    fireEvent.click(screen.getByRole("button", { name: /^You:/ }));
    const panel = await screen.findByRole("region", { name: "About you" });
    expect(panel.textContent).toContain("remembers 2 things about you and has 1 suggestion waiting");
    expect(panel.textContent).toContain("Learning is on");
    fireEvent.click(within(panel).getByRole("button", { name: "Turn learning off" }));
    await waitFor(() => expect(srv.calls.find((c) => c.method === "PUT")!.body).toEqual({ enabled: false }));
  });

  it("picking a memory shows where it was used; picking a comet says what to do", async () => {
    await open(UNI(), { "GET /constellation/m1": () => ({ body: { memory_id: "m1", total_uses: 1, verified_uses: 1, uses: [{ run_id: "r", conversation_id: "c", conversation: "Fix add", memory_version: "1", at: "2026-10-24T00:00:00+00:00", verified: true }] } }) });
    fireEvent.click(screen.getByRole("button", { name: /Memory m1/ }));
    const ev = await screen.findByRole("region", { name: "Evidence for Memory m1" });
    await waitFor(() => expect(ev.textContent).toContain("Fix add"));
    fireEvent.click(screen.getByRole("button", { name: "Waiting for you: 2 waiting for your approval" }));
    expect((await screen.findByText("Approvals waiting for you"))).toBeTruthy();
  });

  it("the keyboard works on every part, and the map has no accessibility violations", async () => {
    const { container } = await open();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Perplexity:/ }), { key: "Enter" });
    expect(await screen.findByRole("region", { name: "About Perplexity" })).toBeTruthy();
    expect(screen.getByText("It has been told nothing.")).toBeTruthy();
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
  });

  it("says so when paused, and degrades quietly when the map cannot load", async () => {
    await open(UNI({ paused: true }));
    expect(screen.getByText(/Paused: nothing new will start/)).toBeTruthy();
    cleanup();
    fakeServer({ "GET /universe": () => ({ status: 500, body: { error: { code: "boom", message: "nope" } } }) });
    render(<Wrap ctx={ctxFor().ctx}><UniverseHome /></Wrap>);
    expect(await screen.findByText(/The map is not available right now/)).toBeTruthy();
  });

  it("openTour starts at the step it is given", () => {
    openTour(3);
    expect(tourStore.get()).toEqual({ open: true, step: 3, waiting: false });
  });
});
