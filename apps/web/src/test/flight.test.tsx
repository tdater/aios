import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlightRecorder, STEP_MS } from "../ui/FlightRecorder";

const L = (o: object) => JSON.stringify(o);
const T = [
  L({ type: "system", subtype: "init", cwd: "/w", model: "m1" }),
  L({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/w/a.py" } }] } }),
  L({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/w/a.py" } }] } }),
  L({ type: "result", subtype: "success", num_turns: 2, permission_denials: [{ tool_name: "Write", tool_input: { file_path: "/w/ci.yml" } }] }),
].join("\n");

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("FlightRecorder", () => {
  it("starts at the end, replays step by step, and shows files changing state", () => {
    render(<FlightRecorder transcript={T} />);
    expect(screen.getByRole("status").textContent).toContain("Finished: success");
    expect(screen.getByText("edited")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(screen.getByRole("status").textContent).toContain("Session started");
    expect(screen.getByText("untouched")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(STEP_MS + 10); });
    expect(screen.getByRole("status").textContent).toContain("Reading a.py");
    expect(screen.getByText("read")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(STEP_MS + 10); });
    expect(screen.getByText("edited")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    act(() => { vi.advanceTimersByTime(STEP_MS * 5); });
    expect(screen.getByRole("status").textContent).toContain("Editing a.py");
  });

  it("the scrubber jumps to a refusal and says so", () => {
    render(<FlightRecorder transcript={T} />);
    fireEvent.change(screen.getByLabelText("Replay position"), { target: { value: "3" } });
    expect(screen.getByRole("status").textContent).toContain("Refused: Write on ci.yml");
  });

  it("says so when there is nothing to replay, and has no a11y violations", async () => {
    const { unmount } = render(<FlightRecorder transcript="" />);
    expect(screen.getByText(/nothing to replay/i)).toBeTruthy();
    unmount();
    vi.useRealTimers();
    const { container } = render(<FlightRecorder transcript={T} />);
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
