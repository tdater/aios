import { describe, expect, it } from "vitest";
import { fileStateAt, parseTranscript, relPath } from "./flight";

const L = (o: object) => JSON.stringify(o);
const CWD = "C:\\Users\\me\\AppData\\Local\\Temp\\aios-state\\worktrees\\cnv_1";
const TRANSCRIPT = [
  L({ type: "system", subtype: "init", cwd: CWD, model: "claude-sonnet-5-5", tools: ["Read", "Edit"] }),
  L({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: `${CWD}\\calc.py` } }] } }),
  L({ type: "user", message: { content: [{ type: "tool_result", content: "def add..." }] } }),
  L({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }),
  L({ type: "assistant", message: { content: [{ type: "thinking", thinking: "SECRET PRIVATE REASONING" }] } }),
  L({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: `${CWD}\\test_calc.py` } }] } }),
  L({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: `${CWD}\\calc.py`, old_string: "a - b", new_string: "a + b" } }] } }),
  L({ type: "user", message: { content: [{ type: "tool_result", is_error: true, content: [{ type: "text", text: "File has not been read yet" }] }] } }),
  L({ type: "assistant", message: { content: [{ type: "text", text: "I fixed `add` in calc.py." }, { type: "tool_use", name: "Bash", input: { command: "rm -rf /" } }] } }),
  "not json at all",
  L({ type: "result", subtype: "success", num_turns: 4, permission_denials: [{ tool_name: "Write", tool_input: { file_path: `${CWD}\\.github\\ci.yml` } }] }),
].join("\n");

describe("parseTranscript", () => {
  const f = parseTranscript(TRANSCRIPT);
  it("turns a real-shaped run into ordered frames, with paths relative to the working folder", () => {
    expect(f.frames.map((x) => [x.kind, x.label])).toEqual([
      ["start", "Session started (claude-sonnet-5-5)"], ["read", "Reading calc.py"], ["read", "Reading test_calc.py"], ["edit", "Editing calc.py"],
      ["tool_error", "A tool call failed: File has not been read yet"], ["say", "I fixed `add` in calc.py."],
      ["unexpected", "Used a tool that was not allowed: Bash"], ["refused", "Refused: Write on .github/ci.yml"], ["finish", "Finished: success after 4 turn(s)"]]);
    expect(f.frames.map((x) => x.i)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(JSON.stringify(f)).not.toContain("AppData");                                      // never leaks the disk location
    expect(f.model).toBe("claude-sonnet-5-5");
  });
  it("never replays private reasoning, counts lines it could not read, and ignores rate-limit events", () => {
    expect(JSON.stringify(f)).not.toContain("PRIVATE REASONING");
    expect(f.skipped).toBe(1);
  });
  it("tracks which files were touched and how", () => {
    expect(f.files.map((t) => [t.path, t.events.map((e) => `${e.i}:${e.action}`)])).toEqual([["calc.py", ["1:read", "3:edit"]], ["test_calc.py", ["2:read"]]]);
    const calc = f.files[0];
    expect(fileStateAt(calc, 0)).toEqual({ state: "idle", flash: false });
    expect(fileStateAt(calc, 1)).toEqual({ state: "read", flash: true });
    expect(fileStateAt(calc, 2)).toEqual({ state: "read", flash: false });
    expect(fileStateAt(calc, 3)).toEqual({ state: "edited", flash: true });
    expect(fileStateAt(calc, 8)).toEqual({ state: "edited", flash: false });
  });
  it("copes with empty, hostile and enormous input", () => {
    expect(parseTranscript("")).toMatchObject({ frames: [], files: [], skipped: 0, truncated: false });
    expect(parseTranscript("[1,2]\nnull\n42\n{}\n").frames).toEqual([]);
    const many = Array.from({ length: 3000 }, () => L({ type: "assistant", message: { content: [{ type: "text", text: "x" }] } })).join("\n");
    const big = parseTranscript(many);
    expect(big.frames.length).toBe(2000);
    expect(big.truncated).toBe(true);
    const hostile = parseTranscript(L({ type: "assistant", message: { content: [{ type: "text", text: "<img src=x onerror=alert(1)>" + "y".repeat(1000) }] } }));
    expect(hostile.frames[0].label.length).toBeLessThanOrEqual(240);                         // plain text only; the UI renders it as text
  });
  it("honours a custom allowlist", () => {
    const g = parseTranscript(L({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "a.py" } }] } }), ["Read"]);
    expect(g.frames[0].kind).toBe("unexpected");
  });
});

describe("relPath", () => {
  it("strips the working folder case-insensitively and keeps unrelated paths as given", () => {
    expect(relPath("c:/users/me/work/a/b.py", "C:\\Users\\Me\\Work")).toBe("a/b.py");
    expect(relPath("D:\\other\\x.py", "C:\\Users\\Me\\Work")).toBe("D:/other/x.py");
    expect(relPath("x.py", undefined)).toBe("x.py");
  });
});
