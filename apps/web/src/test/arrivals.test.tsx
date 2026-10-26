import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UObject } from "../core/scene";
import { playPing, setPingEnabled } from "../core/ping";
import { ArrivalCaption, PingToggle, ReplayArrival } from "../ui/ArrivalCaption";
import { useArrivals } from "../ui/useArrivals";

const o = (id: string, type: UObject["type"] = "probe"): UObject => ({ id, type, region: "yards", name: id, job: "", state: { tone: "ok", text: "" } });

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("useArrivals", () => {
  it("stays quiet on the first look, plays for a new object, and can skip or replay", () => {
    let now = 1000;
    const { result, rerender } = renderHook(({ list }) => useArrivals(list, { now: () => now, reduced: false }), { initialProps: { list: [o("a")] } });
    expect(result.current.active).toHaveLength(0) ; expect(result.current.caption).toBeNull();
    rerender({ list: [o("a"), o("b")] });
    expect(result.current.active.map((x) => x.id)).toEqual(["b"]);
    expect(result.current.caption).toBe("New probe: b is in orbit");
    expect(result.current.focusId).toBe("b");
    act(() => result.current.skip());
    expect(result.current.active).toHaveLength(0);
    now += 10;
    act(() => result.current.replay("a"));
    expect(result.current.active.map((x) => x.id)).toEqual(["a"]);
  });
  it("uses the plain fade when motion is reduced", () => {
    const { result, rerender } = renderHook(({ list }) => useArrivals(list, { now: () => 0, reduced: true }), { initialProps: { list: [o("a", "planet")] } });
    rerender({ list: [o("a", "planet"), o("b", "planet")] });
    expect(result.current.active[0].style).toBe("fade");
  });
});

describe("arrival controls", () => {
  it("shows the caption with a Skip button, and nothing when idle", () => {
    const skip = vi.fn();
    const { rerender } = render(<ArrivalCaption caption={null} onSkip={skip} />);
    expect(screen.queryByText("Skip")).toBeNull();
    rerender(<ArrivalCaption caption="New probe: Top 3 is in orbit" onSkip={skip} />);
    fireEvent.click(screen.getByText("Skip"));
    expect(skip).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Top 3");
  });
  it("replays from the card", () => {
    const f = vi.fn();
    render(<ReplayArrival onReplay={f} />);
    fireEvent.click(screen.getByText("Replay arrival"));
    expect(f).toHaveBeenCalled();
  });
  it("the sound is off by default, remembered when turned on, and never throws without audio", () => {
    expect(playPing()).toBe(false);
    render(<PingToggle />);
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(localStorage.getItem("aios.arrival.ping")).toBe("1");
    setPingEnabled(true);
    expect(() => playPing()).not.toThrow();   // jsdom has no AudioContext: returns false instead of failing
    expect(playPing()).toBe(false);
  });
});
