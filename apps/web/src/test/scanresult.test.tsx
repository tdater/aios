import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionResult } from "../ui/ObjectCard";
import { askPrefill } from "../ui/uiState";
import { resetRoute } from "./helpers";

beforeEach(() => { resetRoute(""); askPrefill.set(""); });
afterEach(() => cleanup());

const RESULT = {
  facts: { memory: { total_bytes: 1, available_bytes: 1 }, startup_items: 9 },
  summary: [{ label: "Memory", value: "14.3 of 16.0 GB in use (89%)", tone: "warn" }, { label: "Programs that start with Windows", value: "9: OneDrive, Steam", tone: "ok" }],
  suggestions: [{ id: "memory", level: "attention", text: "Memory is 89% in use. Closing programs you are not using, or restarting, usually helps most." }],
  ideas: [{ id: "weekly", title: "Turn on the weekly check-up", why: "AIOS reads these numbers weekly." },
    { id: "memory_help", title: "Ask what is using your memory", why: "Memory is mostly in use.", ask: "My computer's memory is nearly full. The programs using the most are: chrome (2.0 GB)." }],
};

describe("the computer check result", () => {
  it("shows readable rows, never [object Object], with the findings and ideas", () => {
    const { container } = render(<ActionResult r={RESULT} />);
    expect(container.textContent).not.toContain("[object");
    expect(screen.getByText(/14.3 of 16.0 GB in use/)).toBeTruthy();
    expect(screen.getByText(/9: OneDrive, Steam/)).toBeTruthy();
    expect(screen.getByText(/Closing programs you are not using/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Ideas" })).toBeTruthy();
    expect(screen.getByText(/Nothing is changed or deleted for you/)).toBeTruthy();
  });
  it("an idea with a ready-made question puts it in the Ask box without sending it", () => {
    render(<ActionResult r={RESULT} />);
    expect(screen.getAllByRole("button", { name: "Ask AIOS about this" })).toHaveLength(1);       // only the idea that carries a question
    fireEvent.click(screen.getByRole("button", { name: "Ask AIOS about this" }));
    expect(askPrefill.get()).toContain("memory is nearly full");
    expect(location.hash).toBe("#/home");
  });
  it("an older result with only raw facts is still readable", () => {
    const { container } = render(<ActionResult r={{ facts: RESULT.facts }} />);
    expect(container.textContent).not.toContain("[object");
    expect(screen.getByText(/memory: total 1.0 GB|memory: total 0.0 GB/)).toBeTruthy();
    expect(screen.getByText("startup items: 9")).toBeTruthy();
  });
});
