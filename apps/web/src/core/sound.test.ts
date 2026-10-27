import { beforeEach, describe, expect, it, vi } from "vitest";
import { playSound, setSoundEnabled, soundEnabled } from "./sound";

function fakeCtx() {
  const oscillators: { type: string; start: ReturnType<typeof vi.fn> }[] = [];
  const param = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), value: 0 });
  const node = () => { const n: Record<string, unknown> = {}; n.connect = vi.fn((x: unknown) => x ?? n); return n; };
  return {
    oscillators, state: "running", currentTime: 1, destination: {}, resume: vi.fn(),
    createOscillator: vi.fn(() => { const o = { ...node(), type: "", frequency: param(), start: vi.fn(), stop: vi.fn() }; oscillators.push(o as never); return o; }),
    createGain: vi.fn(() => ({ ...node(), gain: param() })),
    createBiquadFilter: vi.fn(() => ({ ...node(), type: "", frequency: { value: 0 } })),
  };
}

beforeEach(() => { localStorage.clear(); });

describe("interface sounds", () => {
  it("are off until turned on, and the choice sticks on this device", () => {
    expect(soundEnabled()).toBe(false);
    const ctx = fakeCtx();
    expect(playSound("chime", { make: () => ctx as never })).toBe(false);
    expect(ctx.createOscillator).not.toHaveBeenCalled();
    setSoundEnabled(true);
    expect(soundEnabled()).toBe(true);
    expect(playSound("chime", { make: () => ctx as never })).toBe(true);
  });
  it("never play when motion is reduced, and say so by returning false", () => {
    const ctx = fakeCtx();
    expect(playSound("warp", { enabled: true, reducedMotion: true, make: () => ctx as never })).toBe(false);
    expect(ctx.createOscillator).not.toHaveBeenCalled();
  });
  it("synthesise each sound from oscillators only: a rising pair, a low filtered sweep, a 20 ms tick", () => {
    const chime = fakeCtx(); playSound("chime", { enabled: true, make: () => chime as never });
    expect(chime.oscillators).toHaveLength(2);
    const warp = fakeCtx(); playSound("warp", { enabled: true, make: () => warp as never });
    expect(warp.oscillators).toHaveLength(1); expect(warp.createBiquadFilter).toHaveBeenCalled(); expect(warp.oscillators[0].type).toBe("sawtooth");
    const tick = fakeCtx(); playSound("tick", { enabled: true, make: () => tick as never });
    expect(tick.oscillators[0].type).toBe("square");
  });
  it("do nothing, without throwing, where there is no audio", () => {
    expect(playSound("chime", { enabled: true, make: () => null })).toBe(false);
    expect(playSound("chime", { enabled: true, make: () => { throw new Error("blocked"); } })).toBe(false);
  });
});
