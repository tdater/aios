import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { daysToTarget, missionProgress, targetText } from "../core/widgets";
import { Projects } from "../screens/Projects";
import { err, fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

const mission = (id: string, title: string, config: object = {}) => ({ id, kind: "mission", title, config: { target: "", steps: [], note: "", ...config } });
beforeEach(() => { resetRoute(""); setWidth(1200, 900); localStorage.clear(); });
afterEach(() => cleanup());

describe("mission helpers", () => {
  it("measures progress and names the next step", () => {
    expect(missionProgress({ target: "", steps: [], note: "" })).toEqual({ percent: 0, next: null, done: 0, total: 0 });
    const p = missionProgress({ target: "", note: "", steps: [{ text: "a", done: true }, { text: "b", done: false }, { text: "c", done: false }] });
    expect(p).toEqual({ percent: 33, next: "b", done: 1, total: 3 });
  });
  it("counts days by calendar day and words them plainly", () => {
    const today = new Date(2026, 9, 27, 18, 0, 0);
    expect(daysToTarget("2026-10-27", today)).toBe(0);
    expect(daysToTarget("2026-11-01", today)).toBe(5);
    expect(daysToTarget("", today)).toBeNull();
    expect(targetText("2026-10-27", today)).toBe("Due today");
    expect(targetText("2026-10-28", today)).toBe("Due tomorrow");
    expect(targetText("2026-11-01", today)).toBe("Due in 5 days (2026-11-01)");
    expect(targetText("2026-10-25", today)).toBe("2 days past 2026-10-25");
    expect(targetText("", today)).toBe("No target date");
  });
});

describe("the Projects screen has a Life missions side", () => {
  const open = () => render(<Wrap ctx={ctxFor().ctx}><Projects /></Wrap>);
  const base = (list: object[], extra: Record<string, unknown> = {}) => fakeServer({
    "GET /projects": () => ({ body: { items: [], next_cursor: null, limit: 20 } }),
    "GET /widgets": () => ({ body: { items: list } }), ...extra } as never);

  it("switches between developer projects and life missions, and remembers the choice", async () => {
    base([]);
    open();
    expect((await screen.findByRole("button", { name: /Developer projects/ })).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Life missions/ }));
    expect(await screen.findByRole("region", { name: "Life missions" })).toBeTruthy();
    expect(localStorage.getItem("aios.projects.persona")).toBe("life");
    cleanup();
    base([]);
    open();
    expect(await screen.findByRole("region", { name: "Life missions" })).toBeTruthy();       // it comes back as you left it
  });

  it("lists missions with progress, ticks a step, adds one, and sorts the soonest date first", async () => {
    localStorage.setItem("aios.projects.persona", "life");
    const srv = base([
      mission("w_late", "Marathon", { target: "2027-05-01", steps: [{ text: "Buy shoes", done: false }] }),
      mission("w_soon", "Kitchen", { target: "2026-12-01", steps: [{ text: "Get quotes", done: false }, { text: "Pick tiles", done: false }] })],
      { "PUT /widgets/w_soon": () => ({ body: {} }) });
    open();
    const cards = await screen.findAllByRole("listitem", {}, { timeout: 3000 }).then((l) => l.filter((x) => x.classList.contains("card")));
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual(["Kitchen", "Marathon"]);
    const kitchen = within(cards[0]);
    expect(kitchen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(kitchen.getByText(/Next: Get quotes/)).toBeTruthy();
    fireEvent.click(kitchen.getByLabelText("Get quotes"));
    await waitFor(() => expect(srv.calls.some((c) => c.method === "PUT" && c.path === "/widgets/w_soon")).toBe(true));
    const sent = srv.calls.find((c) => c.method === "PUT")!.body as { config: { steps: { text: string; done: boolean }[]; target: string } };
    expect(sent.config.steps).toEqual([{ text: "Get quotes", done: true }, { text: "Pick tiles", done: false }]);
    expect(sent.config.target).toBe("2026-12-01");
    fireEvent.change(kitchen.getByLabelText("New step for Kitchen"), { target: { value: "Book plumber" } });
    fireEvent.click(kitchen.getByRole("button", { name: "Add step" }));
    await waitFor(() => expect(srv.calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    expect((srv.calls.filter((c) => c.method === "PUT")[1].body as { config: { steps: unknown[] } }).config.steps).toHaveLength(3);
  });

  it("starts a mission, and asks before switching small panels on when they are off", async () => {
    localStorage.setItem("aios.projects.persona", "life");
    let allowed = false;
    const srv = base([], {
      "POST /widgets": () => (allowed ? { status: 201, body: mission("w_new", "Summer trip") } : err(403, "ability_off", "Turn on small panels first.")),
      "PUT /abilities/widgets": () => { allowed = true; return { body: {} }; },
    });
    open();
    fireEvent.change(await screen.findByPlaceholderText("Plan the summer trip"), { target: { value: "Summer trip" } });
    fireEvent.click(screen.getByRole("button", { name: "Start mission" }));
    expect(await screen.findByText(/small panels, which are switched off/)).toBeTruthy();
    expect(srv.calls.filter((c) => c.method === "PUT")).toHaveLength(0);                    // nothing is switched on without a click
    fireEvent.click(screen.getByRole("button", { name: "Turn on small panels" }));
    await waitFor(() => expect(srv.calls.filter((c) => c.path === "/widgets" && c.method === "POST")).toHaveLength(2));
    expect(srv.calls.find((c) => c.path === "/abilities/widgets")!.body).toEqual({ enabled: true, confirm: true });
    expect((srv.calls.filter((c) => c.path === "/widgets" && c.method === "POST")[1].body as { kind: string; title: string }).kind).toBe("mission");
  });
});
