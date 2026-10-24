import { describe, expect, it } from "vitest";
import { collapseDiff, diffLines, diffStats } from "./diff";

const render = (ops: ReturnType<typeof diffLines>) => ops.map((o) => `${o.kind === "add" ? "+" : o.kind === "del" ? "-" : " "}${o.text}`);

describe("line diff", () => {
  it("identical text has no changes", () => {
    const ops = diffLines("a\nb", "a\nb");
    expect(diffStats(ops)).toEqual({ added: 0, removed: 0 });
  });
  it("shows additions, removals and replacements in order", () => {
    expect(render(diffLines("a\nb\nc", "a\nB\nc\nd"))).toEqual([" a", "-b", "+B", " c", "+d"]);
    expect(render(diffLines("", "x"))).toEqual(["-", "+x"]);
  });
  it("collapses long unchanged stretches but keeps context around changes", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const after = before.replace("l10", "CHANGED");
    const c = collapseDiff(diffLines(before, after), 2);
    expect(c.filter((x) => x.kind === "skip")).toEqual([{ kind: "skip", count: 8 }, { kind: "skip", count: 7 }]);
    expect(c.some((x) => x.kind === "add" && "text" in x && x.text === "CHANGED")).toBe(true);
  });
  it("very large inputs degrade to replace-all instead of hanging", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `x${i}`).join("\n");
    const t = performance.now();
    expect(diffStats(diffLines(big, big + "\nmore"))).toEqual({ added: 2001, removed: 2000 });
    expect(performance.now() - t).toBeLessThan(1000);
  });
});
