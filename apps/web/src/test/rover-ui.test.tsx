import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoverPanel } from "../ui/RoverPanel";
import { fakeServer, err } from "./fakeServer";
import { ctxFor, resetRoute, Wrap } from "./helpers";

beforeEach(() => resetRoute(""));
afterEach(() => cleanup());

const LEVELS = [
  { level: 1, name: "Look", available: true }, { level: 2, name: "Guide", available: true },
  { level: 3, name: "Browser", available: false, reason: "Not proven yet." }, { level: 4, name: "Screen", available: false, reason: "No supported way yet." },
];
const IDLE = { status: "idle", ring: false, task: null, last_task: null, levels: LEVELS, input_injection: false };

function show(routes: Record<string, () => { status?: number; body?: unknown }> = {}) {
  const server = fakeServer({ "GET /rover": () => ({ body: IDLE }), ...routes });
  const c = ctxFor();
  render(<Wrap ctx={c.ctx}><RoverPanel /></Wrap>);
  return server;
}

describe("the Rover panel", () => {
  it("says it never clicks or types, and lists the levels that are not available", async () => {
    show();
    expect(await screen.findByText(/It never clicks or types/)).toBeTruthy();
    expect(screen.getByText(/Browser: not available/)).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Browser/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: /Look/ }) as HTMLInputElement).disabled).toBe(false);
  });

  it("cannot start until you say yes to this one task, then sends exactly that", async () => {
    const server = show({ "POST /rover/tasks": () => ({ status: 201, body: {} }) });
    const start = await screen.findByRole("button", { name: "Start" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("What do you need help with?"), { target: { value: "Find the print button" } });
    fireEvent.change(screen.getByLabelText(/Which window/), { target: { value: "Notepad" } });
    expect(start.disabled).toBe(true);                                 // no opt-in yet
    fireEvent.click(screen.getByRole("checkbox"));
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    await waitFor(() => expect(server.calls.find((c) => c.method === "POST" && c.path === "/rover/tasks")?.body).toEqual({ goal: "Find the print button", level: 1, target: "Notepad", opt_in: true }));
  });

  it("shows the refusal in plain words when the block list stops it", async () => {
    show({ "POST /rover/tasks": () => err(403, "rover_blocked", "The Rover will not look at banking pages.") });
    fireEvent.change(await screen.findByLabelText("What do you need help with?"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/Which window/), { target: { value: "My Bank" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText(/will not look at banking pages/)).toBeTruthy();
  });

  it("Stop is always there, and a live task shows its steps and a Finish", async () => {
    const live = { ...IDLE, status: "guiding", ring: true, task: { id: "t1", goal: "Find print", level: 2, target: "Notepad", steps: [] } };
    const server = show({ "GET /rover": () => ({ body: live }), "POST /rover/stop": () => ({ body: {} }), "POST /rover/tasks/t1/step": () => ({ body: { instructions: ["Open the File menu", "Choose Print"] } }) });
    expect(await screen.findByText(/The Rover is active/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take a look now" }));
    expect(await screen.findByText("Open the File menu")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(server.count("POST", "/rover/stop")).toBe(1));
    expect(screen.getByRole("button", { name: "Finish" })).toBeTruthy();
  });
});

import { CheckUpToggle } from "../ui/CheckUp";
describe("the weekly check-up switch", () => {
  it("is off until turned on, and turning it on is one explicit PUT", async () => {
    const server = fakeServer({ "GET /home/check-up": () => ({ body: { enabled: false, last_run: null, due: false, every_days: 7 } }), "PUT /home/check-up": () => ({ body: {} }) });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><CheckUpToggle /></Wrap>);
    const box = await screen.findByRole("checkbox", { name: /once a week/ }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText(/Not checked yet/)).toBeTruthy();
    fireEvent.click(box);
    await waitFor(() => expect(server.calls.find((x) => x.method === "PUT")?.body).toEqual({ enabled: true }));
  });
});

describe("the popup explainer preset", () => {
  it("fills in the explain request at Guide level, and still needs a window name and your yes", async () => {
    const server = show({ "POST /rover/tasks": () => ({ status: 201, body: {} }) });
    fireEvent.click(await screen.findByRole("button", { name: "Use this for my popup" }));
    expect((screen.getByLabelText("What do you need help with?") as HTMLInputElement).value).toMatch(/^Explain this window or popup in plain words/);
    expect((screen.getByRole("radio", { name: /Guide/ }) as HTMLInputElement).checked).toBe(true);
    const start = screen.getByRole("button", { name: "Start" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(screen.getByText(/will not look at banking, payment, password or settings windows/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Which window/), { target: { value: "Windows notification" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(start);
    await waitFor(() => expect(server.calls.find((c) => c.method === "POST")!.body).toMatchObject({ level: 2, target: "Windows notification", opt_in: true }));
    expect((server.calls.find((c) => c.method === "POST")!.body as { goal: string }).goal).toMatch(/^Explain this window or popup in plain words/);
  });
});
