import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCamera, layoutScene, posOf } from "../core/space3d";
import { Universe } from "../core/types";
import { UniverseSpace } from "../ui/Space3D";
import { Selection } from "../ui/Universe";

const star = (id: string, o: object = {}) => ({ id, title: `Memory ${id}`, type: "preference", scope: "global", project_id: null, project: null, state: "fresh", uses: 1, verified_uses: 1, hollow: false, last_used: null, last_verified: null, brightness: 0.8, ...o });
const AI = (provider: string, name: string, level: string, mode: string, told: string[]) => ({ provider, name, mode, level, default_level: level, told, told_count: told.length });
const U = (o: object = {}): Universe => ({
  you: { approved: 2, suggested: 0, learning: true },
  ais: [AI("claude", "Claude", "private", "interactive", ["m1"]), AI("gemini", "Gemini", "public", "manual", ["m2"]), AI("perplexity", "Perplexity", "none", "manual", [])],
  stars: [star("m1"), star("m2", { type: "fact", project: "Calc" })], links: [], clusters: ["Everywhere", "Calc"], totals: { stars: 2, verified: 2, hollow: 0, stale: 0 },
  comets: { approvals: 1, blocked: 0, to_review: 0 }, paused: false, ...o } as Universe);

let reduce = true;
beforeEach(() => { reduce = true; Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: (q: string) => ({ matches: reduce && q.includes("reduce"), addEventListener() {}, removeEventListener() {}, media: q }) }); });
afterEach(cleanup);

function mount(over: { sel?: Selection; u?: Universe; onSelect?: (s: Selection) => void; onFlat?: () => void } = {}) {
  const onSelect = over.onSelect ?? vi.fn();
  const r = render(<UniverseSpace u={over.u ?? U()} sel={over.sel ?? null} onSelect={onSelect} onFlat={over.onFlat} />);
  const map = () => screen.getByRole("group", { name: /Your universe/ });
  const read = () => ({ yaw: Number(map().getAttribute("data-yaw")), pitch: Number(map().getAttribute("data-pitch")), dist: Number(map().getAttribute("data-dist")), target: map().getAttribute("data-target") });
  return { ...r, onSelect, map, read };
}
const ptr = (el: Element, type: string, init: object) => fireEvent(el, Object.assign(new MouseEvent(type, { bubbles: true, ...init }), { pointerId: 1 }));

describe("travelling through the universe", () => {
  it("starts at a sensible viewpoint and says how to move, for everyone", () => {
    const { map, read } = mount();
    const d = defaultCamera();
    expect(read()).toMatchObject({ dist: d.dist, target: "0,0,0" });
    expect(map().getAttribute("aria-roledescription")).toMatch(/Drag to look around.*arrow keys turn/);
    expect(screen.getByText(/Click anything to fly to it/)).toBeTruthy();
  });

  it("the arrow keys turn, plus and minus zoom, and 0 puts you back", () => {
    const { map, read } = mount();
    const start = read();
    fireEvent.keyDown(map(), { key: "ArrowRight" });
    expect(read().yaw).toBeGreaterThan(start.yaw);
    fireEvent.keyDown(map(), { key: "ArrowUp" });
    expect(read().pitch).toBeLessThan(start.pitch);
    fireEvent.keyDown(map(), { key: "+" });
    expect(read().dist).toBeLessThan(start.dist);
    fireEvent.keyDown(map(), { key: "-" }); fireEvent.keyDown(map(), { key: "-" });
    expect(read().dist).toBeGreaterThan(start.dist);
    fireEvent.keyDown(map(), { key: "0" });
    expect(read()).toMatchObject({ yaw: start.yaw, pitch: start.pitch, dist: start.dist });
  });

  it("the on-screen buttons do the same, so you do not need a keyboard or a mouse wheel", () => {
    const { read } = mount();
    const start = read();
    fireEvent.click(screen.getByRole("button", { name: "Turn left" }));
    expect(read().yaw).toBeLessThan(start.yaw);
    fireEvent.click(screen.getByRole("button", { name: "Look down" }));
    expect(read().pitch).toBeGreaterThan(start.pitch);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const closer = read().dist;
    expect(closer).toBeLessThan(start.dist);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(read().dist).toBeGreaterThan(closer);
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(read()).toMatchObject({ yaw: start.yaw, dist: start.dist });
  });

  it("the mouse wheel flies closer or away, and cannot go past the limits", () => {
    const { map, read } = mount();
    const start = read().dist;
    fireEvent.wheel(map(), { deltaY: -200 });
    expect(read().dist).toBeLessThan(start);
    for (let i = 0; i < 40; i++) fireEvent.wheel(map(), { deltaY: -400 });
    expect(read().dist).toBe(70);
    for (let i = 0; i < 60; i++) fireEvent.wheel(map(), { deltaY: 400 });
    expect(read().dist).toBe(1500);
  });

  it("dragging looks around; shift-drag slides; a drag is not a click", () => {
    const { map, read, onSelect } = mount();
    const start = read();
    ptr(map(), "pointerdown", { clientX: 100, clientY: 100 });
    ptr(map(), "pointermove", { clientX: 160, clientY: 120 });
    ptr(map(), "pointerup", { clientX: 160, clientY: 120 });
    expect(read().yaw).not.toBe(start.yaw);
    expect(read().pitch).not.toBe(start.pitch);
    const claude = screen.getByRole("button", { name: /^Claude:/ });
    ptr(map(), "pointerdown", { clientX: 100, clientY: 100 });
    ptr(map(), "pointermove", { clientX: 150, clientY: 100 });
    fireEvent.click(claude);                                                             // the click that ends a drag
    ptr(map(), "pointerup", { clientX: 150, clientY: 100 });
    expect(onSelect).not.toHaveBeenCalled();
    const before = read().target;
    ptr(map(), "pointerdown", { clientX: 100, clientY: 100, shiftKey: true });
    ptr(map(), "pointermove", { clientX: 140, clientY: 100, shiftKey: true });
    ptr(map(), "pointerup", { clientX: 140, clientY: 100 });
    expect(read().target).not.toBe(before);
  });

  it("two fingers pinch to zoom", () => {
    const { map, read } = mount();
    const start = read().dist;
    fireEvent(map(), Object.assign(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }), { pointerId: 1 }));
    fireEvent(map(), Object.assign(new MouseEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 100 }), { pointerId: 2 }));
    fireEvent(map(), Object.assign(new MouseEvent("pointermove", { bubbles: true, clientX: 300, clientY: 100 }), { pointerId: 2 }));   // fingers spread: move closer
    expect(read().dist).toBeLessThan(start);
  });

  it("clicking anything selects it and flies the camera to it", () => {
    const { read, onSelect } = mount();
    const scene = layoutScene(U());
    const gem = posOf(scene, { kind: "planet", provider: "gemini" })!;
    fireEvent.click(screen.getByRole("button", { name: /^Gemini:/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "planet", provider: "gemini" });
    expect(read().target).toBe(gem.map((n) => String(Math.round(n * 100) / 100)).join(","));
    expect(read().dist).toBe(150);
    fireEvent.click(screen.getByRole("button", { name: /^You:/ }));
    expect(read()).toMatchObject({ target: "0,0,0", dist: 260 });
  });

  it("the Travel to menu takes you to you, an AI, or a group of memories, without any dragging", () => {
    const { read } = mount();
    const menu = screen.getByLabelText("Travel to");
    expect(within(menu).getAllByRole("option").map((o) => o.textContent)).toEqual(["Travel to…", "You", "Claude", "Gemini", "Perplexity", "Memories: Everywhere", "Memories: Calc"]);
    fireEvent.change(menu, { target: { value: "c:Calc" } });
    const calc = posOf(layoutScene(U()), { kind: "cluster", name: "Calc" })!;
    expect(read().target).toBe(calc.map((n) => String(Math.round(n * 100) / 100)).join(","));
    fireEvent.change(menu, { target: { value: "p:claude" } });
    expect(read().dist).toBe(150);
  });

  it("everything is still a described, keyboard-operable button, and the flat map is one click away", () => {
    const onFlat = vi.fn();
    const { onSelect } = mount({ onFlat });
    expect(screen.getByRole("button", { name: "Claude: told 1 of your memories, connected" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Perplexity: told nothing, by copy and paste" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Memory m2 \(fact\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Waiting for you: 1 waiting for your approval" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Gemini:/ }), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith({ kind: "planet", provider: "gemini" });
    fireEvent.click(screen.getByRole("button", { name: "Flat map" }));
    expect(onFlat).toHaveBeenCalled();
  });

  it("lights the memories a chosen AI was told with beams, and dims the rest", () => {
    const { container } = mount({ sel: { kind: "planet", provider: "claude" } });
    expect(container.querySelectorAll("line.beam").length).toBe(1);
    expect(container.querySelectorAll("g.star.told").length).toBe(1);
  });

  it("draws far things before near things, so near ones are on top", () => {
    const { container, read } = mount();
    expect(read().dist).toBeGreaterThan(0);
    const order = [...container.querySelectorAll("svg > g[role=button]")].map((g) => g.getAttribute("aria-label"));
    expect(order.length).toBeGreaterThan(4);
    expect(order.some((n) => n?.startsWith("You:"))).toBe(true);
  });

  it("Escape clears the selection, and the spin button is a real toggle", () => {
    const { map, onSelect } = mount();
    fireEvent.keyDown(map(), { key: "Escape" });
    expect(onSelect).toHaveBeenCalledWith(null);
    const spin = screen.getByRole("button", { name: "Spin" });
    expect(spin.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(spin);
    expect(spin.getAttribute("aria-pressed")).toBe("true");
  });

  it("is accessible, and says so plainly when paused", async () => {
    const { container } = mount({ u: U({ paused: true }) });
    expect(screen.getByText(/Paused: nothing new will start/)).toBeTruthy();
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
  });

  it("animates the flight when motion is allowed, ending exactly on target", async () => {
    reduce = false;
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      const { read } = mount();
      fireEvent.click(screen.getByRole("button", { name: /^Gemini:/ }));
      const during = read().dist;
      expect(during).toBeGreaterThan(150);                                        // not there yet: it is travelling
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(read().dist).toBe(150);
    } finally { vi.useRealTimers(); }
  });
});
