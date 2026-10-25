import { describe, expect, it } from "vitest";
import { argvToText, commandToArgv, diffTotals, findingsPrompt, locationText, parseUnifiedDiff, quotaBars, showCommand, sortFindings } from "./work";
import type { Finding } from "./types";

const PATCH = `diff --git a/calc.py b/calc.py
index 1111111..2222222 100644
--- a/calc.py
+++ b/calc.py
@@ -1,6 +1,6 @@
 def add(a, b):
-    return a - b
+    return a + b


 def multiply(a, b):
     return a * b
diff --git a/notes/new.txt b/notes/new.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/notes/new.txt
@@ -0,0 +1,2 @@
+hello
+world
diff --git a/old.txt b/old.txt
deleted file mode 100644
index 4444444..0000000
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/img.png b/img.png
index 5555555..6666666 100644
Binary files a/img.png and b/img.png differ
`;

describe("parseUnifiedDiff", () => {
  it("reads files, statuses, counts and line numbers", () => {
    const files = parseUnifiedDiff(PATCH);
    expect(files.map((f) => [f.path, f.status, f.added, f.removed])).toEqual([
      ["calc.py", "modified", 1, 1], ["notes/new.txt", "added", 2, 0], ["old.txt", "deleted", 0, 1], ["img.png", "binary", 0, 0]]);
    const calc = files[0].lines;
    expect(calc[0].kind).toBe("hunk");
    expect(calc.find((l) => l.kind === "del")).toMatchObject({ text: "    return a - b", oldNo: 2, newNo: null });
    expect(calc.find((l) => l.kind === "add")).toMatchObject({ text: "    return a + b", oldNo: null, newNo: 2 });
    expect(diffTotals(files)).toEqual({ files: 4, added: 3, removed: 2 });
  });

  it("treats a removed line that starts with '--' as content, not a file header", () => {
    const tricky = `diff --git a/x.sql b/x.sql
index 1..2 100644
--- a/x.sql
+++ b/x.sql
@@ -1,3 +1,3 @@
 keep
--- a comment
+++ b/not-a-header
 end
`;
    const [f] = parseUnifiedDiff(tricky);
    expect(parseUnifiedDiff(tricky)).toHaveLength(1);
    expect(f.path).toBe("x.sql");
    expect(f.lines.filter((l) => l.kind === "del").map((l) => l.text)).toEqual(["-- a comment"]);
    expect(f.lines.filter((l) => l.kind === "add").map((l) => l.text)).toEqual(["++ b/not-a-header"]);
  });

  it("handles renames, no-newline markers, CRLF content and truncated input", () => {
    const rn = parseUnifiedDiff("diff --git a/a.txt b/b.txt\nsimilarity index 100%\nrename from a.txt\nrename to b.txt\n");
    expect(rn[0]).toMatchObject({ status: "renamed", oldPath: "a.txt", path: "b.txt" });
    const nn = parseUnifiedDiff("diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\r\n");
    expect(nn[0].lines.map((l) => l.kind)).toEqual(["hunk", "del", "note", "add"]);
    expect(nn[0].lines[3].text).toBe("b");                       // the \r of a CRLF file is not shown
    const cut = parseUnifiedDiff("diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,50 +1,50 @@\n-a\n+b\n");   // ends mid-hunk
    expect(cut[0].added).toBe(1);
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("garbage\nmore garbage")).toEqual([]);
  });

  it("a wrong or truncated hunk count never swallows the next file", () => {
    const bad = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,9 +1,9 @@\n-x\n+y\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-p\n+q\n";
    const files = parseUnifiedDiff(bad);
    expect(files.map((f) => [f.path, f.added, f.removed])).toEqual([["a", 1, 1], ["b", 1, 1]]);
  });

  it("keeps file names with spaces", () => {
    expect(parseUnifiedDiff("diff --git a/my file.txt b/my file.txt\n")[0].path).toBe("my file.txt");
  });
});

describe("quotaBars", () => {
  it("shows the two real windows and never invents a missing number", () => {
    const bars = quotaBars({ five_hour: { utilization: 0.39, resets_at: 1792975200, status: "allowed" }, seven_day: { utilization: 0.071 } });
    expect(bars.map((b) => [b.label, b.pct])).toEqual([["5-hour window", 39], ["7-day window", 7]]);
    expect(bars[0].resetsAt?.getTime()).toBe(1792975200 * 1000);
    expect(bars[1].resetsAt).toBeNull();
    expect(quotaBars({ five_hour: {} })[0].pct).toBeNull();
    expect(quotaBars(null)).toEqual([]);
    expect(quotaBars({ five_hour: { utilization: 7 } })[0].pct).toBe(100);   // clamped
  });
});

describe("verification command editing", () => {
  it("one argument per line, blank lines dropped, no shell parsing", () => {
    expect(commandToArgv("python\r\n -B \n\n-m\nunittest\n  test_calc  \n")).toEqual(["python", "-B", "-m", "unittest", "test_calc"]);
    expect(commandToArgv("echo $HOME && rm -rf /")).toEqual(["echo $HOME && rm -rf /"]);   // one literal argument
    expect(argvToText(["a", "b c"])).toBe("a\nb c");
    expect(argvToText(null)).toBe("");
    expect(showCommand(["C:\\Program Files\\py\\python.exe", "-m", "unittest"])).toBe('"C:\\Program Files\\py\\python.exe" -m unittest');
  });
});

describe("review findings", () => {
  const f = (o: Partial<Finding>): Finding => ({ id: "f1", severity: "low", title: "t", detail: "", file: null, line: null, suggestion: null, grounded: null, ...o });
  it("sorts by severity and describes locations honestly", () => {
    expect(sortFindings([f({ severity: "low", id: "a" }), f({ severity: "high", id: "b" }), f({ severity: "medium", id: "c" })]).map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(locationText(f({}))).toBe("no location given");
    expect(locationText(f({ file: "a.py", line: 3, grounded: true }))).toBe("a.py:3 (location confirmed)");
    expect(locationText(f({ file: "a.py", grounded: false }))).toBe("a.py (AIOS could not find this location)");
  });
  it("turns chosen findings into the owner's next request", () => {
    const text = findingsPrompt([f({ severity: "medium", title: "Weak test", detail: "Only one input." }),
      f({ severity: "high", title: "Wrong result", file: "calc.py", line: 2, suggestion: "Use a + b." })], "abcdef1234567890");
    expect(text).toContain("reviewed revision abcdef123456");
    expect(text.indexOf("[HIGH] Wrong result (calc.py:2)")).toBeLessThan(text.indexOf("[MEDIUM] Weak test"));
    expect(text).toContain("Suggested: Use a + b.");
    expect(text).toContain("do not modify tests unless a finding says a test is wrong");
    const huge = findingsPrompt(Array.from({ length: 200 }, (_, i) => f({ id: `f${i}`, title: "x".repeat(300), detail: "y".repeat(300) })), null);
    expect(huge.length).toBeLessThanOrEqual(18000);
    expect(huge.endsWith("[list truncated]")).toBe(true);
  });
});
