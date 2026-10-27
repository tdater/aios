import { describe, expect, it } from "vitest";
import { dayBucket, groupByDay, plainKind } from "./timeline";

const NOW = new Date(2026, 9, 27, 15, 0, 0);
const at = (daysAgo: number, h = 9) => new Date(2026, 9, 27 - daysAgo, h).toISOString();

describe("activity timeline", () => {
  it("puts runs in day buckets by calendar day, not by 24-hour windows", () => {
    expect(dayBucket(at(0, 1), NOW)).toBe("Today");
    expect(dayBucket(at(1, 23), NOW)).toBe("Yesterday");
    expect(dayBucket(at(3), NOW)).toBe("This week");
    expect(dayBucket(at(6), NOW)).toBe("This week");
    expect(dayBucket(at(7), NOW)).toBe("Earlier");
    expect(dayBucket("not a date", NOW)).toBe("Earlier");
  });
  it("groups in order and leaves out empty groups", () => {
    const g = groupByDay([{ created_at: at(9), id: "c" }, { created_at: at(0), id: "a" }, { created_at: at(1), id: "b" }], NOW);
    expect(g.map((x) => [x.bucket, x.items.map((i) => (i as { id: string }).id)])).toEqual([["Today", ["a"]], ["Yesterday", ["b"]], ["Earlier", ["c"]]]);
  });
  it("describes known kinds in plain words and never shows an internal name", () => {
    expect(plainKind("claude.review").text).toBe("Reviewed a change");
    expect(plainKind("demo.slow_steps").text).toBe("Ran a test task");
    expect(plainKind("mystery.thing").text).toBe("Did some work");
  });
});
