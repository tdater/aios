import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZEN_IDLE_MS, useZenOrbit } from "../ui/useZenOrbit";

function Probe({ onDrift, enabled = true, paused = false }: { onDrift: (r: number) => void; enabled?: boolean; paused?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useZenOrbit(ref, { enabled, paused, onDrift });
  return <div ref={ref} data-testid="box" />;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("zen orbit", () => {
  it("stays still while you are active, then drifts after the idle time", () => {
    const drift = vi.fn();
    render(<Probe onDrift={drift} />);
    act(() => { vi.advanceTimersByTime(ZEN_IDLE_MS - 1000); });
    expect(drift).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(drift.mock.calls.length).toBeGreaterThan(5);
    const total = drift.mock.calls.reduce((n, c) => n + (c[0] as number), 0);
    expect(total).toBeGreaterThan(0.04); expect(total).toBeLessThan(0.2);                    // a slow turn, not a spin
  });
  it("any input stops it at once and the quiet period starts over", () => {
    const drift = vi.fn();
    const { getByTestId } = render(<Probe onDrift={drift} />);
    act(() => { vi.advanceTimersByTime(ZEN_IDLE_MS + 500); });
    const before = drift.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    act(() => { getByTestId("box").dispatchEvent(new Event("pointermove", { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(drift.mock.calls.length).toBe(before);
    act(() => { vi.advanceTimersByTime(ZEN_IDLE_MS); });
    expect(drift.mock.calls.length).toBeGreaterThan(before);
  });
  it("never runs when switched off (reduced motion) or paused (a card is open)", () => {
    const off = vi.fn(), paused = vi.fn();
    render(<><Probe onDrift={off} enabled={false} /><Probe onDrift={paused} paused /></>);
    act(() => { vi.advanceTimersByTime(ZEN_IDLE_MS * 2); });
    expect(off).not.toHaveBeenCalled();
    expect(paused).not.toHaveBeenCalled();
  });
});
