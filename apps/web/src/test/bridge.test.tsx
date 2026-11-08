import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { layoutWorld } from "../core/scene";
import { sampleObjects, sampleUniverse } from "../core/scene.fixtures";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../core/settings";
import { destinations } from "../core/travel";
import { Bridge } from "../bridge/Bridge";
import { fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

beforeEach(() => { resetRoute(""); setWidth(1280, 800); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

function show(opts: { objects?: ReturnType<typeof sampleObjects>; reduce?: boolean; fail?: boolean } = {}) {
  fakeServer({
    "GET /universe": () => (opts.fail ? { status: 500, body: { error: "down" } } : { body: sampleUniverse() }),
    "GET /universe/objects": () => (opts.fail ? { status: 500, body: { error: "down" } } : { body: { items: opts.objects ?? sampleObjects(), version: 1 } }),
  });
  const c = ctxFor();
  c.ctx.settings = { ...c.ctx.settings, universeView: "flat", reduceMotion: opts.reduce === false ? "system" : "on" };
  return render(<Wrap ctx={c.ctx}><Bridge><p>ask box here</p></Bridge></Wrap>);
}

describe("the bridge", () => {
  it("shows the window and all four panels on a desktop", async () => {
    show();
    const bridge = await screen.findByTestId("bridge");
    expect(bridge.getAttribute("data-layout")).toBe("desktop");
    expect(screen.getByRole("region", { name: /Viewscreen/ })).toBeTruthy();
    for (const n of [/Operations/, /Alerts/, /Navigation computer/, /^Today$/]) expect(screen.getByRole("region", { name: n })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/job/);
    expect(screen.getByText("ask box here")).toBeTruthy();
  });

  it("lists every destination on the holo-table so nothing is unreachable", async () => {
    show();
    const holo = within(await screen.findByRole("list", { name: "Destinations" }));
    const world = layoutWorld(sampleUniverse(), sampleObjects())!;
    expect(holo.getAllByRole("button")).toHaveLength(destinations(world).length);
  });

  it("does nothing on Engage until something is picked", async () => {
    show();
    const engage = (await screen.findByRole("button", { name: "Engage" })) as HTMLButtonElement;
    expect(engage.disabled).toBe(true);
  });

  it("travels to a picked object (calm motion: a short crossfade, then it arrives)", async () => {
    show();
    const list = within(await screen.findByRole("list", { name: "Destinations" }));
    fireEvent.click(list.getByRole("button", { name: /Claude/ }));
    fireEvent.click(screen.getByRole("button", { name: "Engage" }));
    await waitFor(() => expect(location.hash).toBe("#/home/o/planet%3Aclaude"), { timeout: 2000 });
  });

  it("Escape in the middle of a trip arrives at once and exactly one time", async () => {
    vi.useFakeTimers();
    show({ reduce: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const list = within(screen.getByRole("list", { name: "Destinations" }));
    fireEvent.click(list.getByRole("button", { name: /Claude/ }));
    fireEvent.click(screen.getByRole("button", { name: "Engage" }));
    expect(screen.getByTestId("bridge").getAttribute("data-phase")).toBe("charge");
    fireEvent.keyDown(screen.getByTestId("bridge"), { key: "Escape" });
    expect(location.hash).toBe("#/home/o/planet%3Aclaude");
    expect(screen.getByTestId("bridge").getAttribute("data-phase")).toBe("idle");
    location.hash = "#/home";                                   // if a leftover timer arrived again it would move us back here
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(location.hash).toBe("#/home");
  });

  it("shows what needs you, worst first, and says all clear when nothing does", async () => {
    show();
    const alerts = within(await screen.findByRole("region", { name: /Alerts/ }));
    const names = alerts.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(names[0]).toMatch(/1 stuck/);
    cleanup();
    show({ objects: sampleObjects().filter((o) => o.type !== "comet" && o.state.tone !== "warn" && o.state.tone !== "bad") });
    expect(await screen.findByText(/All clear/)).toBeTruthy();
  });

  it("stacks into one column on a phone", async () => {
    setWidth(500, 900);
    show();
    expect((await screen.findByTestId("bridge")).getAttribute("data-layout")).toBe("phone");
  });

  it("moves between panels with the arrow keys", async () => {
    show();
    const ops = within(await screen.findByRole("region", { name: /Operations/ })).getAllByRole("button")[0];
    ops.focus();
    fireEvent.keyDown(ops, { key: "ArrowRight" });
    expect((document.activeElement as HTMLElement).closest("[data-area]")?.getAttribute("data-area")).toBe("holo");
  });

  it("reaches every item in a panel with the arrow keys alone (a TV remote has no Tab)", async () => {
    show();
    const buttons = within(await screen.findByRole("region", { name: /Operations/ })).getAllByRole("button");
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1], { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("does not trap the remote in the search box", async () => {
    show();
    const search = (await screen.findByLabelText("Where to?")) as HTMLInputElement;
    search.focus();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect((document.activeElement as HTMLElement).closest(".holo-list")).toBeTruthy();
  });

  it("leaves a panel at its last item and goes to the next panel", async () => {
    show();
    const buttons = within(await screen.findByRole("region", { name: /Operations/ })).getAllByRole("button");
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect((document.activeElement as HTMLElement).closest("[data-area]")?.getAttribute("data-area")).toBe("today");
  });

  it("Enter in the search box picks the first match, and a second Enter engages it", async () => {
    show();
    const search = (await screen.findByLabelText("Where to?")) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "claude" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect((screen.getByRole("button", { name: "Engage" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(location.hash).toMatch(/^#\/home\/o\//), { timeout: 2000 });
  });

  it("a trip under way never overrides something chosen elsewhere in the meantime", async () => {
    vi.useFakeTimers();
    show({ reduce: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    fireEvent.click(within(screen.getByRole("list", { name: "Destinations" })).getByRole("button", { name: /Claude/ }));
    fireEvent.click(screen.getByRole("button", { name: "Engage" }));
    const ops = within(screen.getByRole("region", { name: /Operations/ })).getAllByRole("button")[0];
    fireEvent.click(ops);                                         // opens an Ops item instead
    const chosen = location.hash;
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(location.hash).toBe(chosen);
    expect(screen.getByTestId("bridge").getAttribute("data-phase")).toBe("idle");
  });

  it("number keys start a trip to a region, but not while typing in the ask box", async () => {
    show();
    const ops = within(await screen.findByRole("region", { name: /Operations/ })).getAllByRole("button")[0];
    fireEvent.keyDown(ops, { key: "1" });
    expect(screen.getByTestId("bridge").getAttribute("data-phase")).not.toBe("idle");
    await waitFor(() => expect(screen.getByTestId("bridge").getAttribute("data-phase")).toBe("idle"), { timeout: 2000 });
    fireEvent.keyDown(screen.getByText("ask box here"), { key: "1" });
    expect(screen.getByTestId("bridge").getAttribute("data-phase")).toBe("idle");
  });

  it("uses the TV layout when the device says it is a TV", async () => {
    const spy = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 11; AFTMM Build) SmartTV");
    show();
    expect((await screen.findByTestId("bridge")).getAttribute("data-layout")).toBe("tv");
    spy.mockRestore();
  });

  it("explains itself instead of crashing when the server is down", async () => {
    show({ fail: true });
    expect(await screen.findByText(/cannot show your universe/)).toBeTruthy();
  });
});

describe("the home view setting", () => {
  it("defaults to the bridge and falls back when the saved value is nonsense", () => {
    expect(DEFAULT_SETTINGS.homeView).toBe("bridge");
    expect(sanitizeSettings({ homeView: "nonsense" as never }).homeView).toBe("bridge");
    expect(sanitizeSettings({ homeView: "classic" }).homeView).toBe("classic");
  });
});
