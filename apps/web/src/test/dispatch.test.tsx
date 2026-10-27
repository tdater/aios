import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { carryOver, flashbacks, habitsDue, isEvening, morningText, topChecklist, topThree } from "../core/dispatch";
import { Widget, dayKey } from "../core/widgets";
import { Dispatch } from "../ui/Dispatch";
import { fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

const NOW = new Date(2026, 9, 27, 8, 0, 0);
const w = (id: string, kind: string, title: string, config: object) => ({ id, kind, title, config }) as Widget;
const WIDGETS: Widget[] = [
  w("c0", "checklist", "Shopping list", { items: [{ text: "Milk", done: false }] }),
  w("c1", "checklist", "Today's top 3", { items: [{ text: "Call the dentist", done: true }, { text: "Order filters", done: false }, { text: "Review the quote", done: false }, { text: "Fourth thing", done: false }, { text: "Fifth thing", done: false }] }),
  w("h1", "habit", "Water", { days: [], per_week: 7 }), w("h2", "habit", "Walk", { days: [dayKey(NOW)], per_week: 5 }),
];

describe("daily dispatch helpers", () => {
  it("finds the top-3 list by name and offers at most three open priorities", () => {
    expect(topChecklist(WIDGETS)!.id).toBe("c1");
    expect(topThree(WIDGETS).map((i) => i.text)).toEqual(["Order filters", "Review the quote", "Fourth thing"]);
    expect(topChecklist([WIDGETS[0]])!.id).toBe("c0");                                   // otherwise the first checklist
    expect(topChecklist([WIDGETS[2]])).toBeNull();
  });
  it("lists habits not yet done today", () => {
    expect(habitsDue(WIDGETS, NOW).map((h) => h.title)).toEqual(["Water"]);
  });
  it("finds notes written on this date in an earlier year, oldest first", () => {
    const notes = [{ title: "Patio finished", created_at: "2025-10-27T09:00:00Z" }, { title: "Older", created_at: "2023-10-27T09:00:00Z" }, { title: "Today", created_at: "2026-10-27T01:00:00Z" }, { title: "Other day", created_at: "2025-10-28T09:00:00Z" }, { title: "No date" }];
    expect(flashbacks(notes, NOW).map((f) => [f.note.title, f.yearsAgo])).toEqual([["Older", 3], ["Patio finished", 1]]);
  });
  it("carries open items over and clears the done ones, keeping the order", () => {
    const r = carryOver([{ text: "a", done: true }, { text: "b", done: false }, { text: "c", done: true }, { text: "d", done: false }]);
    expect(r.next.map((i) => i.text)).toEqual(["b", "d"]);
    expect(r.cleared).toBe(2);
  });
  it("says the morning dispatch in one paragraph, and switches to the evening at five", () => {
    const text = morningText(WIDGETS, { note: { title: "Patio finished" }, yearsAgo: 1 }, NOW);
    expect(text).toBe("Good morning. Your top 3 priorities: Order filters, Review the quote, Fourth thing. Habits still to do today: Water. A year ago today you wrote: Patio finished.");
    expect(isEvening(new Date(2026, 9, 27, 16, 59))).toBe(false);
    expect(isEvening(new Date(2026, 9, 27, 17, 0))).toBe(true);
  });
});

describe("the dispatch panel", () => {
  beforeEach(() => { resetRoute(""); setWidth(1200, 900); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const show = (save = vi.fn().mockResolvedValue(undefined)) => {
    fakeServer({ "GET /memories": () => ({ body: { items: [{ id: "m1", title: "Patio finished", type: "fact", status: "approved", scope: "global", confidence: 1, version: 1, tags: [], created_at: "2025-10-27T09:00:00Z" }], next_cursor: null, limit: 200 } }) } as never);
    render(<Wrap ctx={ctxFor().ctx}><Dispatch widgets={WIDGETS} connected saveChecklist={save} /></Wrap>);
    return save;
  };

  it("opens as the morning dispatch with priorities, habits and a flashback", async () => {
    show();
    expect(screen.getByRole("region", { name: "Morning dispatch" })).toBeTruthy();
    expect(screen.getByText("Order filters")).toBeTruthy();
    expect(screen.getByText(/Habits still to do today: Water/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Patio finished")).toBeTruthy());
  });

  it("the evening wrap-up asks before clearing what is done, then keeps the rest", () => {
    const save = show();
    fireEvent.click(screen.getByRole("button", { name: "Show the evening wrap-up" }));
    expect(screen.getByRole("region", { name: "Evening wrap-up" })).toBeTruthy();
    expect(screen.getByText("You finished 1 thing today.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start tomorrow fresh" }));
    expect(save).not.toHaveBeenCalled();                                                     // nothing changes until the second click
    fireEvent.click(screen.getByRole("button", { name: "Yes, clear 1 done and keep 4" }));
    expect(save).toHaveBeenCalledTimes(1);
    expect((save.mock.calls[0][1] as { text: string }[]).map((i) => i.text)).toEqual(["Order filters", "Review the quote", "Fourth thing", "Fifth thing"]);
  });
});
