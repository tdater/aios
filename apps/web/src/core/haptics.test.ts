import { describe, expect, it, vi } from "vitest";
import { buzz } from "./haptics";

describe("haptics", () => {
  it("vibrates with a short tick, a success pattern and a warning pattern", () => {
    const vibrate = vi.fn().mockReturnValue(true);
    expect(buzz("tick", { nav: { vibrate } })).toBe(true);
    buzz("success", { nav: { vibrate } }); buzz("warn", { nav: { vibrate } });
    expect(vibrate.mock.calls.map((c) => c[0])).toEqual([8, [14, 40, 22], [30, 60, 30]]);
  });
  it("stays silent when motion is reduced, when there is no vibration motor, or when the call throws", () => {
    const vibrate = vi.fn();
    expect(buzz("tick", { reducedMotion: true, nav: { vibrate } })).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    expect(buzz("tick", { nav: null })).toBe(false);
    expect(buzz("tick", { nav: {} as never })).toBe(false);
    expect(buzz("tick", { nav: { vibrate: () => { throw new Error("blocked"); } } })).toBe(false);
  });
});
