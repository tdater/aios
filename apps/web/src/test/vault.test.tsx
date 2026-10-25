import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARM_MS, HOLD_MS, VaultDoor } from "../ui/VaultDoor";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

const door = (p: Partial<Parameters<typeof VaultDoor>[0]> = {}) => {
  const onOpen = vi.fn();
  render(<VaultDoor heavy label="Approve it" hint="Hold it." onOpen={onOpen} {...p} />);
  return { onOpen, btn: screen.getByRole("button", { name: "Approve it" }) as HTMLButtonElement };
};
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("a light door", () => {
  it("opens with one press", () => {
    const { onOpen, btn } = door({ heavy: false });
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Opened")).toBeTruthy();
  });
});

describe("a heavy door asks for a deliberate hold", () => {
  it("opens only after the ring is full, and only once", () => {
    const { onOpen, btn } = door();
    expect(btn.textContent).toContain("Hold to open");
    fireEvent.pointerDown(btn);
    tick(HOLD_MS - 200);
    expect(onOpen).not.toHaveBeenCalled();
    tick(300);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(btn); fireEvent.click(btn);                      // the click that ends the hold changes nothing
    tick(ARM_MS + 1000);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("a tap, or letting go early, does nothing", () => {
    const { onOpen, btn } = door();
    fireEvent.pointerDown(btn); tick(300); fireEvent.pointerUp(btn); fireEvent.click(btn);
    tick(HOLD_MS * 2);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.pointerDown(btn); tick(500); fireEvent.pointerLeave(btn); tick(HOLD_MS * 2);   // sliding off the door cancels too
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("holding Enter or Space works like a pointer hold", () => {
    const { onOpen, btn } = door();
    fireEvent.keyDown(btn, { key: " " }); tick(HOLD_MS + 100);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(btn, { key: " " });
  });

  it("a keyboard or screen-reader press arms it, and a second press confirms", () => {
    const { onOpen, btn } = door();
    fireEvent.click(btn);                                                // no pointer or key hold behind it
    expect(onOpen).not.toHaveBeenCalled();
    expect(btn.textContent).toContain("Press again to open");
    expect(screen.getByRole("status").textContent).toMatch(/Armed/);
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("an armed door disarms itself after a few seconds", () => {
    const { onOpen, btn } = door();
    fireEvent.click(btn);
    tick(ARM_MS + 100);
    expect(btn.textContent).toContain("Hold to open");
    fireEvent.click(btn);                                                // that is a fresh arm, not a confirm
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a keyboard press soon after a hold is not swallowed by that hold", () => {
    const { onOpen, btn } = door();
    fireEvent.pointerDown(btn); tick(300); fireEvent.pointerUp(btn);     // aborted hold, no click arrives
    tick(600);
    fireEvent.click(btn);                                                // screen-reader press: arms
    expect(btn.textContent).toContain("Press again to open");
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("a door that cannot open", () => {
  it("does nothing while disabled or busy", () => {
    const a = door({ disabled: true });
    expect(a.btn.disabled).toBe(true);
    fireEvent.pointerDown(a.btn); tick(HOLD_MS + 100); fireEvent.click(a.btn);
    expect(a.onOpen).not.toHaveBeenCalled();
    cleanup();
    const b = door({ busy: true });
    fireEvent.pointerDown(b.btn); tick(HOLD_MS + 100);
    expect(b.onOpen).not.toHaveBeenCalled();
    expect(b.btn.textContent).toContain("Working");
  });

  it("disarms when it becomes disabled", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<VaultDoor heavy label="Approve it" onOpen={onOpen} />);
    const btn = screen.getByRole("button", { name: "Approve it" });
    fireEvent.click(btn);
    expect(btn.textContent).toContain("Press again");
    rerender(<VaultDoor heavy label="Approve it" disabled onOpen={onOpen} />);
    rerender(<VaultDoor heavy label="Approve it" onOpen={onOpen} />);
    expect(btn.textContent).toContain("Hold to open");
  });
});

describe("accessibility", () => {
  it("has a named button, a described hint and no axe violations", async () => {
    vi.useRealTimers();
    const { container } = render(<VaultDoor heavy label="Approve it" hint="Hold for a second." onOpen={() => {}} />);
    const btn = screen.getByRole("button", { name: "Approve it" });
    expect(btn.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(btn.getAttribute("aria-describedby")!)?.textContent).toBe("Hold for a second.");
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
