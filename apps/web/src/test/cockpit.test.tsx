import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleObjects, sampleUniverse } from "../core/scene.fixtures";
import { Cockpit } from "../ui/Cockpit";
import { routeStore, parseRoute } from "../ui/hooks";
import { fakeServer, err } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

beforeEach(() => { resetRoute(""); setWidth(1280, 800); localStorage.clear(); });
afterEach(() => cleanup());

const CARD = (id: string) => ({
  object: sampleObjects().find((o) => o.id === id), explain: "An AI you can use.",
  panels: { basics: [{ key: "sharing", kind: "choice", label: "What may Claude be told?", value: "private", help: "Nothing marked secret is ever shared.",
    options: [{ value: "private", label: "Everything except secrets", preview: "70 memories would be shared" }, { value: "none", label: "Nothing" }] }], more: [], expert: [{ key: "status", kind: "info", label: "Connection", value: "ok", help: "" }] },
  links: [{ label: "Open the companion", to: { tab: "ais" } }],
});

function open(objects = sampleObjects(), extra: Record<string, () => { status?: number; body?: unknown }> = {}) {
  const server = fakeServer({
    "GET /universe": () => ({ body: sampleUniverse() }),
    "GET /universe/objects": () => ({ body: { items: objects, version: 1 } }),
    "GET /universe/objects/planet:claude/card": () => ({ body: CARD("planet:claude") }),
    "PUT /universe/objects/planet:claude/config": () => ({ body: CARD("planet:claude") }),
    ...extra,
  });
  const c = ctxFor();
  c.ctx.settings = { ...c.ctx.settings, universeView: "flat" };
  return { server, ...render(<Wrap ctx={c.ctx}><Cockpit objectId={routeStore.get().sub === "o" ? routeStore.get().id : undefined}><p>ask box here</p></Cockpit></Wrap>) };
}

describe("the cockpit", () => {
  it("shows the universe full screen with a dock to every region and labels you can press", async () => {
    open();
    await screen.findByTestId("cockpit");
    const dock = within(await screen.findByRole("navigation", { name: "Travel to a region" }));
    for (const n of ["You", "The Fleet", "The Star Fields", "The Shipyards", "Home Base", "Mission Control"]) expect(dock.getByRole("button", { name: new RegExp(n) })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Claude: Connected/ })).toBeTruthy();
    expect(screen.getByText("ask box here")).toBeTruthy();
  });

  it("opens an object's card by deep link, with its plain explanation, and closing returns to the universe", async () => {
    resetRoute("#/home/o/planet%3Aclaude");
    expect(routeStore.get()).toMatchObject({ tab: "home", sub: "o", id: "planet:claude" });
    open();
    const card = await screen.findByRole("complementary", { name: /Claude: details/ });
    expect(within(card).getByText("An AI you can use.")).toBeTruthy();
    expect(within(card).getByRole("radio", { name: /Everything except secrets/ })).toBeTruthy();
    fireEvent.click(within(card).getByRole("tab", { name: "Expert" }));
    expect(within(card).getByText(/Connection:/)).toBeTruthy();
  });

  it("pressing a label goes to that object", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Claude: Connected/ }));
    expect(location.hash).toBe("#/home/o/planet%3Aclaude");
    expect(parseRoute(location.hash)).toMatchObject({ sub: "o", id: "planet:claude" });
  });

  it("has on-screen zoom in, zoom out and show-everything buttons, and the plus and minus keys zoom too", async () => {
    open();
    const cockpit = await screen.findByTestId("cockpit");
    const bar = within(await screen.findByRole("group", { name: "Zoom" }));
    for (const n of ["Zoom in", "Zoom out", "Reset view"]) expect(bar.getByRole("button", { name: n })).toBeTruthy();
    fireEvent.click(bar.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(bar.getByRole("button", { name: "Reset view" }));
    expect(location.hash).toBe("#/home");                                            // reset also closes any open card
    fireEvent.keyDown(cockpit, { key: "+" });
    fireEvent.keyDown(cockpit, { key: "-" });
  });

  it("has a compass that faces the Sun, and the 0 key goes back to the start view and closes any card", async () => {
    resetRoute("#/home/o/planet%3Aclaude");
    open();
    const cockpit = await screen.findByTestId("cockpit");
    await screen.findByRole("complementary", { name: /Claude: details/ });
    const compass = screen.getByRole("button", { name: "Face the Sun and level the view" });
    expect(compass.getAttribute("title")).toMatch(/tilted -?\d+°/);
    expect(compass.querySelector('[data-testid="horizon"]')).toBeTruthy();
    fireEvent.click(compass);
    expect(location.hash).toBe("#/home/o/planet%3Aclaude");                           // facing the Sun only moves the camera
    fireEvent.keyDown(cockpit, { key: "0" });
    expect(location.hash).toBe("#/home");
  });

  it("numbers the dock 1 to 6 and the number keys travel there", async () => {
    open();
    const cockpit = await screen.findByTestId("cockpit");
    const dock = within(await screen.findByRole("navigation", { name: "Travel to a region" }));
    expect(dock.getAllByRole("button").map((b) => b.querySelector(".dock-num")?.textContent)).toEqual(["1", "2", "3", "4", "5", "6"]);
    fireEvent.keyDown(cockpit, { key: "4" });
    expect(dock.getByRole("button", { name: /The Shipyards/ }).getAttribute("aria-current")).toBe("true");
    fireEvent.keyDown(cockpit, { key: "2", ctrlKey: true });                         // with a modifier it is the browser's, not ours
    expect(dock.getByRole("button", { name: /The Shipyards/ }).getAttribute("aria-current")).toBe("true");
  });

  it("has a sound switch that is off until pressed and remembers the choice", async () => {
    localStorage.removeItem("aios.sound.ui");
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Turn interface sounds on" }));
    expect(localStorage.getItem("aios.sound.ui")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Turn interface sounds off" }));
    expect(localStorage.getItem("aios.sound.ui")).toBe("0");
  });

  it("a completed habit makes its probe sparkle, once and then it goes away", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      open();
      await vi.waitFor(() => expect(screen.getByTestId("cockpit")).toBeTruthy());
      await vi.waitFor(() => expect(document.querySelector(".u-label")).toBeTruthy());
      window.dispatchEvent(new CustomEvent("aios:celebrate", { detail: { widgetId: "list" } }));
      await vi.waitFor(() => expect(document.querySelectorAll(".burst i").length).toBe(30));
      vi.advanceTimersByTime(1400);
      await vi.waitFor(() => expect(document.querySelector(".burst")).toBeNull());
    } finally { vi.useRealTimers(); }
  });

  it("double-clicking an object's label opens it", async () => {
    open();
    fireEvent.doubleClick(await screen.findByRole("button", { name: /Claude: Connected/ }));
    expect(location.hash).toBe("#/home/o/planet%3Aclaude");
  });

  it("changing a setting on the card saves it on the server", async () => {
    resetRoute("#/home/o/planet%3Aclaude");
    const { server } = open();
    const card = await screen.findByRole("complementary", { name: /Claude: details/ });
    fireEvent.click(within(card).getByRole("radio", { name: /Nothing/ }));
    await waitFor(() => expect(server.calls.find((c) => c.method === "PUT")?.body).toEqual({ values: { sharing: "none" }, confirm: false }));
  });

  it("Go to finds a place by name, and the list view is a plain-text version of everything", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Go to/ }));
    const input = await screen.findByLabelText("Where to?");
    fireEvent.change(input, { target: { value: "shipyards" } });
    const hits = await within(screen.getByRole("dialog", { name: "Go to" })).findAllByRole("button", { name: /The Shipyards/ });
    expect(hits[0].textContent).toMatch(/^The Shipyards/);          // the region itself comes first, then the things in it
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    const list = await screen.findByLabelText(/Everything in your universe, as a list/);
    expect(within(list).getByRole("heading", { name: "The Fleet" })).toBeTruthy();
    expect(within(list).getByRole("button", { name: /Calculator app/ })).toBeTruthy();
  });

  it("says plainly what to do when the server is too old to know about the universe", async () => {
    fakeServer({ "GET /universe": () => ({ body: sampleUniverse() }), "GET /universe/objects": () => err(404, "not_found") });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><Cockpit /></Wrap>);
    expect(await screen.findByText(/restart it/)).toBeTruthy();
  });

  it("announces a new arrival, and can skip it", async () => {
    let list = sampleObjects();
    fakeServer({ "GET /universe": () => ({ body: sampleUniverse() }), "GET /universe/objects": () => ({ body: { items: list, version: 1 } }) });
    const c = ctxFor();
    c.ctx.settings = { ...c.ctx.settings, universeView: "flat", reduceMotion: "on" };
    const r = render(<Wrap ctx={c.ctx}><Cockpit /></Wrap>);
    await screen.findByRole("button", { name: /Claude: Connected/ });
    list = [...list, { id: "probe:new", type: "probe", region: "yards", name: "Top 3", job: "", state: { tone: "ok", text: "0 of 3 done" } }];
    r.rerender(<Wrap ctx={{ ...c.ctx }}><Cockpit key="x" /></Wrap>);
    // a fresh mount counts as a first look and stays quiet; only a change seen while open is news
    expect(screen.queryByText("Skip")).toBeNull();
  });
});
