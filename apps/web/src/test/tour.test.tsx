import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOUR_STEPS, clampStep, lastStep, progressText } from "../core/tour";
import { Tour } from "../ui/Tour";
import { closeTour, openTour, tourStore } from "../ui/uiState";
import { fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

beforeEach(() => { resetRoute(""); setWidth(1200, 900); closeTour(); });
afterEach(() => { cleanup(); closeTour(); });

const UNI = (mode: string) => ({ you: { approved: 0, suggested: 0, learning: true }, ais: [{ provider: "claude", name: "Claude", mode, level: "private", default_level: "private", told: [], told_count: 0 }],
  stars: [], links: [], clusters: [], totals: { stars: 0, verified: 0, hollow: 0, stale: 0 }, comets: { approvals: 0, blocked: 0, to_review: 0 }, paused: false });

function mount(over: { updateSettings?: (p: object) => void } = {}) {
  const c = ctxFor();
  const updateSettings = vi.fn(over.updateSettings ?? (() => {}));
  render(<Wrap ctx={{ ...c.ctx, updateSettings: updateSettings as never }}><Tour /></Wrap>);
  return { updateSettings };
}
const dialog = () => screen.getByRole("dialog");
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
const goTo = (n: number) => { act(() => openTour(n)); };

describe("the tour's content", () => {
  it("covers the whole setup in a sensible order", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(["welcome", "universe", "claude", "level", "bring", "share", "chat", "control", "done"]);
    for (const s of TOUR_STEPS) { expect(s.title.length).toBeGreaterThan(3); expect(s.lead.length).toBeGreaterThan(30); }
  });
  it("explains each part of the map, and says how to run the tour again", () => {
    const map = TOUR_STEPS.find((s) => s.id === "universe")!.points.join(" ");
    for (const w of ["centre is you", "Planets are your AIs", "Stars are memories", "Comets"]) expect(map).toContain(w);
    const done = TOUR_STEPS[lastStep].points.join(" ");
    for (const w of ["Take the tour again", "Take the tour button", "Ctrl+K"]) expect(done).toContain(w);
  });
  it("clamps odd step numbers and reports progress plainly", () => {
    expect([clampStep(-4), clampStep(99), clampStep(2.6), clampStep(Number.NaN)]).toEqual([0, 8, 3, 0]);
    expect(progressText(0)).toBe("Step 1 of 9");
    expect(progressText(99)).toBe("Step 9 of 9");
  });
});

describe("walking through it", () => {
  it("opens on the welcome step, moves forward and back, and shows progress", () => {
    mount();
    goTo(0);
    expect(within(dialog()).getByRole("heading", { name: "Welcome to AIOS" })).toBeTruthy();
    expect(within(dialog()).getByText("Step 1 of 9")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    next();
    expect(within(dialog()).getByRole("heading", { name: "This is your universe" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(within(dialog()).getByRole("heading", { name: "Welcome to AIOS" })).toBeTruthy();
  });

  it("'do it now' takes you there and waits in the corner until you come back", () => {
    mount();
    goTo(1);
    fireEvent.click(screen.getByRole("button", { name: "Show me the map" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const pill = screen.getByRole("region", { name: "Tour paused" });
    fireEvent.click(within(pill).getByRole("button", { name: "Continue the tour (Step 2 of 9)" }));
    expect(within(dialog()).getByRole("heading", { name: "This is your universe" })).toBeTruthy();
    goTo(4);
    fireEvent.click(screen.getByRole("button", { name: "Bring in memories now" }));
    expect(location.hash).toBe("#/ais/import");
  });

  it("the last step finishes and remembers it, and so does skipping or pressing Escape", () => {
    const a = mount();
    goTo(lastStep);
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(a.updateSettings).toHaveBeenCalledWith({ tourSeen: true });
    expect(tourStore.get().open).toBe(false);
    cleanup(); closeTour();
    const b = mount();
    goTo(2);
    fireEvent.click(screen.getByRole("button", { name: "Skip the tour" }));
    expect(b.updateSettings).toHaveBeenCalledWith({ tourSeen: true });
    cleanup(); closeTour();
    const c = mount();
    goTo(3);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(c.updateSettings).toHaveBeenCalledWith({ tourSeen: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps keyboard focus inside the tour", () => {
    mount();
    goTo(0);
    const buttons = within(dialog()).getAllByRole("button");
    buttons[buttons.length - 1].focus();
    fireEvent.keyDown(buttons[buttons.length - 1], { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it("is an accessible dialog on every step", async () => {
    mount();
    for (let i = 0; i <= lastStep; i++) {
      goTo(i);
      const r = await axe.run(dialog(), { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
      expect(r.violations.map((v) => `${i}: ${v.id}`)).toEqual([]);
    }
    expect(dialog().getAttribute("aria-modal")).toBe("true");
  });
});

describe("the interactive steps do real things", () => {
  it("really checks whether Claude is connected, and tells you what to do if it is not", async () => {
    let mode = "unavailable";
    const srv = fakeServer({ "GET /universe": () => ({ body: UNI(mode) }) });
    mount();
    goTo(2);
    expect(await screen.findByText("Claude is not connected yet.")).toBeTruthy();
    expect(dialog().textContent).toContain("type claude");
    mode = "interactive";
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Claude is connected.")).toBeTruthy();
    expect(srv.count("GET", "/universe")).toBe(2);
  });

  it("choosing how much to see changes the setting straight away", () => {
    const { updateSettings } = mount();
    goTo(3);
    fireEvent.click(screen.getByLabelText(/Simple/));
    expect(updateSettings).toHaveBeenCalledWith({ mode: "simple" });
  });

  it("makes the Everyday space only when asked, then opens the chat", async () => {
    const srv = fakeServer({ "POST /everyday": () => ({ status: 201, body: { id: "prj_1", created: true } }) });
    mount();
    goTo(6);
    expect(srv.count("POST", "/everyday")).toBe(0);                                  // not before you press the button
    fireEvent.click(screen.getByRole("button", { name: "Make my Everyday space" }));
    expect(await screen.findByText("Your Everyday space is ready.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open the chat" }));
    expect(location.hash).toBe("#/work");
    expect(tourStore.get().waiting).toBe(true);
  });

  it("shows why the Everyday space could not be made", async () => {
    fakeServer({ "POST /everyday": () => ({ status: 400, body: { error: { code: "path_violation", message: "That folder cannot be used." } } }) });
    mount();
    goTo(6);
    fireEvent.click(screen.getByRole("button", { name: "Make my Everyday space" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("That folder cannot be used."));
  });
});
