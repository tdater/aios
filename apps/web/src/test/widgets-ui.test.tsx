import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CatalogItem, RoutineConfig, Widget, dayKey, filterCatalog, mmss, nextRunText, progressText, streak, timerNext, toggleToday, weekCount,
} from "../core/widgets";
import { FirstLaunch, firstLaunchPending } from "../ui/FirstLaunch";
import { MyDay } from "../ui/MyDay";
import { WidgetGallery } from "../ui/WidgetGallery";
import { fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

beforeEach(() => { resetRoute(""); setWidth(390, 800); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12, 0);
const ROUTINE: RoutineConfig = { prompt: "Plan my day", when: "manual", at: "08:00", day: 6, last_run: "", last_task: "" };

describe("widget helpers", () => {
  it("streak counts back from today, or from yesterday when today is not yet checked", () => {
    const today = d(2026, 10, 26);
    expect(streak([], today)).toBe(0);
    expect(streak(["2026-10-26", "2026-10-25", "2026-10-24", "2026-10-20"], today)).toBe(3);
    expect(streak(["2026-10-25", "2026-10-24"], today)).toBe(2);
    expect(streak(["2026-10-23"], today)).toBe(0);
    expect(streak(["2026-02-28", "2026-03-01"], d(2026, 3, 1))).toBe(2);        // across a month boundary
  });
  it("weekCount is Monday to today and toggleToday keeps days sorted and unique", () => {
    const wed = d(2026, 10, 28);                                                  // a Wednesday
    expect(weekCount(["2026-10-25", "2026-10-26", "2026-10-28"], wed)).toBe(2);   // Sunday the 25th belongs to the previous week
    expect(toggleToday(["2026-10-20"], wed)).toEqual(["2026-10-20", "2026-10-28"]);
    expect(toggleToday(["2026-10-20", "2026-10-28"], wed)).toEqual(["2026-10-20"]);
    expect(dayKey(d(2026, 1, 5))).toBe("2026-01-05");
  });
  it("progress text is plain words per kind", () => {
    const today = d(2026, 10, 26);
    const w = (kind: string, config: unknown) => ({ id: "w", kind, title: "t", config }) as Widget;
    expect(progressText(w("checklist", { items: [{ text: "a", done: true }, { text: "b", done: false }] }))).toBe("1 of 2 done");
    expect(progressText(w("checklist", { items: [] }))).toBe("Nothing on the list yet");
    expect(progressText(w("checklist", { items: [{ text: "a", done: true }] }))).toBe("All 1 done");
    expect(progressText(w("habit", { days: ["2026-10-26", "2026-10-25"], per_week: 5 }), today)).toBe("1 of 5 this week, 2 days in a row");
    expect(progressText(w("timer", { focus: 25, rest: 5, sessions: 1 }))).toBe("1 session finished");
    expect(progressText(w("routine", ROUTINE))).toBe("Not run yet");
  });
  it("next-run text covers manual, scheduled, already-ran-today and ability-off", () => {
    const now = new Date(2026, 9, 26, 7, 0);                                      // Monday 07:00
    expect(nextRunText(ROUTINE, now)).toBe("Runs only when you press Run now");
    expect(nextRunText({ ...ROUTINE, when: "daily" }, now)).toContain("Next: today");
    expect(nextRunText({ ...ROUTINE, when: "daily", last_run: new Date(2026, 9, 26, 6, 0).toISOString() }, now)).toContain("Next: tomorrow");
    expect(nextRunText({ ...ROUTINE, when: "weekly", day: 4 }, now)).toContain("Next: Friday");
    expect(nextRunText({ ...ROUTINE, when: "weekdays" }, new Date(2026, 9, 31, 7, 0))).toContain("Next: Monday");   // Saturday
    expect(nextRunText({ ...ROUTINE, when: "daily" }, now, false)).toContain("only once you turn on scheduled routines");
  });
  it("timer helpers and catalog filter", () => {
    expect(mmss(1500)).toBe("25:00");
    expect(timerNext("focus", { focus: 25, rest: 5, sessions: 2 })).toEqual({ phase: "rest", remaining: 300, sessions: 3 });
    expect(timerNext("focus", { focus: 25, rest: 0, sessions: 0 })).toEqual({ phase: "focus", remaining: 1500, sessions: 1 });
    expect(timerNext("rest", { focus: 25, rest: 5, sessions: 3 })).toEqual({ phase: "focus", remaining: 1500, sessions: 3 });
    const items = [{ name: "Top 3", space: "Flight plan", blurb: "x", group: "g", who: "Everyone" }, { name: "Release", space: "Launch", blurb: "ship", group: "g", who: "Technical" }] as CatalogItem[];
    expect(filterCatalog(items, "Technical", "").map((i) => i.name)).toEqual(["Release"]);
    expect(filterCatalog(items, "All", "flight").map((i) => i.name)).toEqual(["Top 3"]);
  });
});

// ---- a small stateful fake of the widgets API ----
function server(initial: Widget[], opts: { widgets?: boolean; routines?: boolean } = {}) {
  let list = [...initial];
  let widgetsOn = opts.widgets ?? true;
  const abilities = () => ({ paused: false, abilities: [
    { name: "widgets", title: "Small panels on Today", enabled: widgetsOn }, { name: "routines", title: "Run my routines on a schedule", enabled: opts.routines ?? false }] });
  const CATALOG = {
    groups: ["Plan your day", "Track", "For technical work"],
    items: [
      { id: "top3", group: "Plan your day", kind: "checklist", title: "Today's top 3", name: "Today's top 3", blurb: "The three things that matter most today.", space: "Flight plan", you_can_change: "the three items", who: "Everyone", needs_claude: false, config: { items: [{ text: "First thing", done: false }] } },
      { id: "briefing", group: "Plan your day", kind: "routine", title: "Morning briefing", name: "Morning briefing", blurb: "A short plan for the day.", space: "Mission briefing", you_can_change: "the request", who: "Everyone", needs_claude: true, config: { ...ROUTINE } },
      { id: "water", group: "Track", kind: "counter", title: "Glasses of water", name: "Glasses of water", blurb: "A counter.", space: "Fuel gauge", you_can_change: "the step", who: "Everyone", needs_claude: false, config: { value: 0, step: 1 } },
      { id: "release", group: "For technical work", kind: "checklist", title: "Release checklist", name: "Release checklist", blurb: "Steps to ship.", space: "Launch checklist", you_can_change: "the steps", who: "Technical", needs_claude: false, config: { items: [{ text: "Tests pass", done: false }] } },
    ],
  };
  const srv = fakeServer({
    "GET /widgets": () => ({ body: { items: list } }),
    "GET /widgets/catalog": () => ({ body: CATALOG }),
    "GET /abilities": () => ({ body: abilities() }),
    "PUT /abilities/widgets": () => { widgetsOn = true; return { body: abilities() }; },
    "POST /widgets/from-catalog": (c) => {
      if (!widgetsOn) return { status: 403, body: { error: { code: "ability_off", message: "Turn on small panels first.", details: {} }, request_id: "r" } };
      const t = CATALOG.items.find((i) => i.id === (c.body as { template: string }).template)!;
      const w = { id: `wdg_${list.length + 1}`, kind: t.kind, title: t.title, config: t.config } as Widget;
      list = [...list, w];
      return { status: 201, body: w };
    },
    "PUT /widgets/*": (c) => {
      const id = c.path.split("/")[2];
      const b = c.body as { config: never; title?: string };
      list = list.map((w) => (w.id === id ? ({ ...w, config: b.config, title: b.title ?? w.title } as Widget) : w));
      return { body: list.find((w) => w.id === id) };
    },
    "DELETE /widgets/*": (c) => { list = list.filter((w) => w.id !== c.path.split("/")[2]); return { body: {} }; },
    "POST /widgets/*": (c) => {
      const id = c.path.split("/")[2];
      list = list.map((w) => (w.id === id && w.kind === "routine" ? { ...w, config: { ...w.config, last_run: "2026-10-26T10:00:00+00:00", last_task: "task_9" } } as Widget : w));
      return { status: 201, body: { id: "task_9" } };
    },
  });
  const puts = () => srv.calls.filter((c) => c.method === "PUT" && c.path.startsWith("/widgets/"));
  return { srv, puts };
}
const mount = (ui: JSX.Element, over = {}) => render(<Wrap ctx={ctxFor(over).ctx}>{ui}</Wrap>);
const w = (id: string, kind: Widget["kind"], title: string, config: unknown) => ({ id, kind, title, config }) as Widget;

describe("My Day dock", () => {
  it("shows an empty state whose button opens the gallery, and collapses", async () => {
    server([]);
    const onAdd = vi.fn();
    mount(<MyDay onAdd={onAdd} />);
    fireEvent.click(await screen.findByRole("button", { name: "Launch your first probe" }));
    expect(onAdd).toHaveBeenCalled();
    const toggle = screen.getByRole("button", { name: /My Day/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Launch your first probe")).toBeNull();
  });

  it("checklist: toggle, add and remove items each save the whole list", async () => {
    const { puts } = server([w("c1", "checklist", "Top 3", { items: [{ text: "Write", done: false }, { text: "Walk", done: false }] })]);
    mount(<MyDay />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Write/ }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ config: { items: [{ text: "Write", done: true }, { text: "Walk", done: false }] } });
    await waitFor(() => expect((screen.getByRole("checkbox", { name: /Write/ }) as HTMLInputElement).checked).toBe(true));
    fireEvent.change(screen.getByLabelText("New item for Top 3"), { target: { value: "Call mum" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect((puts()[1].body as { config: { items: unknown[] } }).config.items).toHaveLength(3);
    fireEvent.click(await screen.findByRole("button", { name: "Remove item Walk" }));
    await waitFor(() => expect(puts()).toHaveLength(3));
    expect(screen.queryByText("Walk")).toBeNull();
    expect(screen.getByText("1 of 2 done")).toBeTruthy();
  });

  it("counter steps by its step, and the note saves only when changed", async () => {
    const { puts } = server([w("n1", "counter", "Water", { value: 2, step: 3 }), w("t1", "note", "Gratitude", { text: "Today" })]);
    mount(<MyDay />);
    fireEvent.click(await screen.findByRole("button", { name: "Add 3 to Water" }));
    await waitFor(() => expect(puts()[0].body).toEqual({ config: { value: 5, step: 3 } }));
    await waitFor(() => expect(screen.getByLabelText("Water count").textContent).toBe("5"));
    fireEvent.click(screen.getByRole("button", { name: "Subtract 3 from Water" }));
    await waitFor(() => expect(puts()[1].body).toEqual({ config: { value: 2, step: 3 } }));
    const save = screen.getByRole("button", { name: "Save Gratitude" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Text of Gratitude"), { target: { value: "Today I am grateful" } });
    fireEvent.click(save);
    await waitFor(() => expect(puts()[2].body).toEqual({ config: { text: "Today I am grateful" } }));
  });

  it("habit: check today adds today's date and shows the streak; checking again removes it", async () => {
    const yesterday = dayKey(new Date(Date.now() - 86400000));
    const { puts } = server([w("h1", "habit", "Read", { days: [yesterday], per_week: 5 })]);
    mount(<MyDay />);
    expect(await screen.findByText("1 day in a row")).toBeTruthy();
    const btn = screen.getByRole("button", { name: "Done today: Read" });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText("2 days in a row")).toBeTruthy());
    expect((puts()[0].body as { config: { days: string[] } }).config.days).toEqual([yesterday, dayKey()].sort());
    expect(screen.getByRole("button", { name: "Done today: Read" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Done today: Read" }));
    await waitFor(() => expect(screen.getByText("1 day in a row")).toBeTruthy());
  });

  it("focus timer counts down on its own clock, pauses, resets, and records a finished session without sound", async () => {
    const { puts } = server([w("f1", "timer", "Focus", { focus: 1, rest: 1, sessions: 0 })]);
    mount(<MyDay />);
    const clock = await screen.findByRole("timer");
    expect(clock.textContent).toBe("01:00");
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Start Focus" }));
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(clock.textContent).toBe("00:50");
    fireEvent.click(screen.getByRole("button", { name: "Pause Focus" }));
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(clock.textContent).toBe("00:50");
    fireEvent.click(screen.getByRole("button", { name: "Reset Focus" }));
    expect(clock.textContent).toBe("01:00");
    fireEvent.click(screen.getByRole("button", { name: "Start Focus" }));
    act(() => { vi.advanceTimersByTime(60_000); });
    vi.useRealTimers();
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ config: { focus: 1, rest: 1, sessions: 1 } });
    expect(screen.getByRole("timer").textContent).toBe("01:00");                      // now the rest stretch, waiting to be started
    expect(screen.getByText("Rest")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("1 session finished")).toBeTruthy());
  });

  it("routine: Run now starts it, a result link appears, schedule and request can be changed", async () => {
    const { srv, puts } = server([w("r1", "routine", "Morning briefing", ROUTINE)]);
    mount(<MyDay />);
    expect(await screen.findByText("Runs only when you press Run now")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Last result/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run now: Morning briefing" }));
    const link = await screen.findByRole("link", { name: "Last result of Morning briefing" });
    expect(srv.calls.some((c) => c.method === "POST" && c.path === "/widgets/r1/run")).toBe(true);
    expect(link.getAttribute("href")).toBe("#/home/task_9");
    fireEvent.click(link);
    expect(location.hash).toBe("#/home/task_9");

    fireEvent.change(screen.getByLabelText("When Morning briefing runs"), { target: { value: "weekly" } });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect((puts()[0].body as { config: RoutineConfig }).config).toMatchObject({ when: "weekly", prompt: "Plan my day", last_task: "task_9" });
    fireEvent.change(await screen.findByLabelText("Day for Morning briefing"), { target: { value: "2" } });
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(screen.getByText(/Scheduling is off/)).toBeTruthy();                       // the routines ability is off in this fake

    fireEvent.change(screen.getByLabelText("Request for Morning briefing"), { target: { value: "New request" } });
    fireEvent.click(screen.getByRole("button", { name: "Save request for Morning briefing" }));
    await waitFor(() => expect(puts()).toHaveLength(3));
    expect((puts()[2].body as { config: RoutineConfig }).config.prompt).toBe("New request");
  });

  it("rename saves the title; remove asks first and then deletes", async () => {
    const { srv, puts } = server([w("n1", "note", "Old name", { text: "" })]);
    mount(<MyDay />);
    fireEvent.click(await screen.findByRole("button", { name: "Rename Old name" }));
    fireEvent.change(screen.getByLabelText("New title for Old name"), { target: { value: "New name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save title" }));
    expect(await screen.findByRole("heading", { name: "New name" })).toBeTruthy();
    expect((puts()[0].body as { title: string }).title).toBe("New name");
    fireEvent.click(screen.getByRole("button", { name: "Remove New name" }));
    expect(srv.calls.some((c) => c.method === "DELETE")).toBe(false);                 // nothing happens until confirmed
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove it" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "New name" })).toBeNull());
    expect(srv.calls.find((c) => c.method === "DELETE")!.path).toBe("/widgets/n1");
    expect(await screen.findByText("Launch your first probe").catch(() => null)).toBeNull();   // no onAdd given, so no button
  });

  it("shows the server's words when a save is refused", async () => {
    fakeServer({
      "GET /widgets": () => ({ body: { items: [w("n1", "counter", "Water", { value: 0, step: 1 })] } }), "GET /abilities": () => ({ body: { paused: false, abilities: [] } }),
      "PUT /widgets/*": () => ({ status: 403, body: { error: { code: "ability_off", message: "Turn on small panels first.", details: {} }, request_id: "r" } }),
    });
    mount(<MyDay />);
    fireEvent.click(await screen.findByRole("button", { name: "Add 1 to Water" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Turn on small panels first.");
    expect(screen.getByLabelText("Water count").textContent).toBe("0");
  });

  it("has no accessibility violations with every kind shown, at phone width", async () => {
    server([w("a", "checklist", "List", { items: [{ text: "x", done: false }] }), w("b", "counter", "Count", { value: 1, step: 1 }), w("c", "note", "Note", { text: "hi" }),
      w("d", "habit", "Habit", { days: [], per_week: 3 }), w("e", "timer", "Timer", { focus: 25, rest: 5, sessions: 0 }), w("f", "routine", "Routine", ROUTINE)]);
    const { container } = mount(<MyDay />);
    await screen.findByText("Routine");
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
  });
});

describe("widget gallery", () => {
  it("groups by group, names first with the space beneath, and flags Needs Claude and Technical", async () => {
    server([]);
    mount(<WidgetGallery />);
    const plan = await screen.findByRole("region", { name: "Plan your day" });
    const item = within(plan).getByRole("listitem", { name: "Morning briefing" });
    expect(item.textContent).toContain("Needs Claude");
    expect(item.textContent!.indexOf("Morning briefing")).toBeLessThan(item.textContent!.indexOf("Mission briefing"));
    expect(within(screen.getByRole("region", { name: "For technical work" })).getByText("Technical")).toBeTruthy();
    expect(within(plan).getByRole("listitem", { name: "Today's top 3" }).textContent).not.toContain("Needs Claude");
  });

  it("filters by audience and by search", async () => {
    server([]);
    mount(<WidgetGallery />);
    await screen.findByRole("region", { name: "Plan your day" });
    fireEvent.click(screen.getByRole("button", { name: "Technical" }));
    expect(screen.queryByRole("region", { name: "Plan your day" })).toBeNull();
    expect(screen.getByRole("listitem", { name: "Release checklist" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "fuel" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "zzzz" } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });

  it("previews a routine's request and mentions scheduling as a separate ability", async () => {
    server([], { routines: false });
    mount(<WidgetGallery />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview Morning briefing" }));
    const p = screen.getByRole("region", { name: "Preview of Morning briefing" });
    expect(p.textContent).toContain("Plan my day");
    expect(p.textContent).toContain("Run my routines on a schedule");
    expect(p.textContent).toContain("it is off right now");
    expect(screen.getByRole("button", { name: "Preview Morning briefing" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("adds straight away when the widgets ability is on", async () => {
    const { srv } = server([], { widgets: true });
    const onAdded = vi.fn();
    mount(<WidgetGallery onAdded={onAdded} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Glasses of water" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(srv.calls.some((c) => c.path === "/abilities/widgets")).toBe(false);
    expect(srv.calls.find((c) => c.path === "/widgets/from-catalog")!.body).toEqual({ template: "water" });
    expect(screen.getByText(/Added/)).toBeTruthy();
  });

  it("when the ability is off it explains and asks first, then turns it on and adds", async () => {
    const { srv } = server([], { widgets: false });
    const onAdded = vi.fn();
    mount(<WidgetGallery onAdded={onAdded} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Today's top 3" }));
    const ask = screen.getByRole("group", { name: "Turn on widgets" });
    expect(ask.textContent).toContain("never run code");
    expect(srv.calls.some((c) => c.method === "PUT" || c.path === "/widgets/from-catalog")).toBe(false);   // nothing sent yet
    fireEvent.click(within(ask).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("group", { name: "Turn on widgets" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add Today's top 3" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Turn on widgets" })).getByRole("button", { name: "Yes, turn it on and add" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    const order = srv.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);
    expect(order).toEqual(["PUT /abilities/widgets", "POST /widgets/from-catalog"]);
    expect(srv.calls.find((c) => c.method === "PUT")!.body).toEqual({ enabled: true, confirm: true });
  });

  it("shows the server's error if adding fails, and has no accessibility violations", async () => {
    fakeServer({
      "GET /widgets/catalog": () => ({ body: { groups: ["Track"], items: [{ id: "water", group: "Track", kind: "counter", title: "Water", name: "Water", blurb: "b", space: "Fuel", you_can_change: "", who: "Everyone", needs_claude: false, config: { value: 0, step: 1 } }] } }),
      "GET /abilities": () => ({ body: { paused: false, abilities: [{ name: "widgets", title: "Small panels", enabled: true }] } }),
      "POST /widgets/from-catalog": () => ({ status: 409, body: { error: { code: "too_many_widgets", message: "up to 24 widgets", details: {} }, request_id: "r" } }),
    });
    const { container } = mount(<WidgetGallery />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Water" }));
    expect((await screen.findByRole("alert")).textContent).toContain("up to 24 widgets");
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
  });
});

describe("first launch showcase", () => {
  it("is a labelled modal dialog with focus inside; Skip remembers and closes", () => {
    const onDone = vi.fn();
    const { container } = render(<FirstLaunch onDone={onDone} />);
    const dlg = screen.getByRole("dialog", { name: "Your day, in one place" });
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.querySelectorAll("p")).toHaveLength(3);
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(firstLaunchPending()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(firstLaunchPending()).toBe(false);
    expect(container).toBeTruthy();
  });

  it("Escape closes it, Tab stays inside, and it survives blocked storage", async () => {
    const onDone = vi.fn();
    const { container } = render(<FirstLaunch onDone={onDone} />);
    const skip = screen.getByRole("button", { name: "Skip" }), ok = screen.getByRole("button", { name: "Got it" });
    ok.focus();
    fireEvent.keyDown(ok, { key: "Tab" });
    expect(document.activeElement).toBe(skip);
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations).toEqual([]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("does not animate when the user prefers reduced motion", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<FirstLaunch onDone={() => {}} />);
    expect(screen.getByRole("dialog").className).not.toContain("animate");
    cleanup();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    render(<FirstLaunch onDone={() => {}} />);
    expect(screen.getByRole("dialog").className).toContain("animate");
  });
});
