import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AMBIENT_VIEWS, Ambient, ROTATE_MS, stepView } from "../screens/Ambient";
import { fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

const WIDGETS = [
  { id: "t", kind: "checklist", title: "Today's top 3", config: { items: [{ text: "Call the dentist", done: false }, { text: "Done thing", done: true }] } },
  { id: "m", kind: "mission", title: "Kitchen", config: { target: "2026-12-01", steps: [{ text: "a", done: true }, { text: "b", done: false }], note: "" } },
];
const NOTES = [{ id: "n1", title: "Furnace filter is 16x25x4", type: "fact", status: "approved", scope: "global", confidence: 1, version: 1, tags: [] }];

beforeEach(() => {
  resetRoute("#/home/ambient"); setWidth(1920, 1080);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  fakeServer({ "GET /widgets": () => ({ body: { items: WIDGETS } }), "GET /memories": () => ({ body: { items: NOTES, next_cursor: null, limit: 200 } }) } as never);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const open = async () => { render(<Wrap ctx={ctxFor().ctx}><Ambient /></Wrap>); await vi.waitFor(() => expect(screen.getByText("Call the dentist")).toBeTruthy()); };

describe("ambient display", () => {
  it("steps through the views and wraps at the ends", () => {
    expect(stepView(0, 1)).toBe(1); expect(stepView(2, 1)).toBe(0); expect(stepView(0, -1)).toBe(AMBIENT_VIEWS.length - 1);
  });
  it("starts on today's priorities, and rotates by itself every 30 seconds", async () => {
    await open();
    expect(screen.getByRole("region", { name: "Today" })).toBeTruthy();
    expect(screen.queryByText("Done thing")).toBeNull();
    act(() => { vi.advanceTimersByTime(ROTATE_MS + 100); });
    expect(screen.getByRole("region", { name: "Missions" })).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(ROTATE_MS); });
    expect(screen.getByText("Furnace filter is 16x25x4")).toBeTruthy();
  });
  it("answers the remote: arrows change the view, OK pauses the rotation, Back leaves", async () => {
    await open();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("region", { name: "Missions" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByRole("region", { name: "Today" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByText(/Paused/)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(ROTATE_MS * 3); });
    expect(screen.getByRole("region", { name: "Today" })).toBeTruthy();                     // paused: it stays put
    fireEvent.keyDown(window, { key: "Escape" });
    expect(location.hash).toBe("#/home");
  });
});
