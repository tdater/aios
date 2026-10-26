import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANION_SITES, openCompanion } from "../core/companion";
import { MyAIs } from "../screens/MyAIs";
import { Companion, CompanionToggle } from "../ui/Companion";
import { fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

const item = (id: string, title: string, o: object = {}) => ({ id, title, why: `why ${id}`, prompt: `PROMPT ${id}`, chars: 9, includes_project_text: false, includes_memories: 0, ...o });
const info = (name: string, items: object[]) => ({ provider: name.toLowerCase(), name, url: "x", blurb: "A blurb.", level: "public", items, notice: `A prompt only leaves this computer when you paste it into ${name}. AIOS does not open, read or control that page.` });

beforeEach(() => { resetRoute(""); setWidth(1200, 900); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } }); });
afterEach(() => { vi.restoreAllMocks(); cleanup(); });

describe("the companion windows", () => {
  it("only ever opens the two official sites, in a window that cannot see back into AIOS", () => {
    expect(COMPANION_SITES).toEqual({ gemini: "https://gemini.google.com/app", perplexity: "https://www.perplexity.ai/" });
    const open = vi.fn();
    expect(openCompanion("gemini", { open } as never)).toBe(true);
    expect(open).toHaveBeenCalledWith("https://gemini.google.com/app", "aios-gemini", expect.stringContaining("noopener"));
    expect(open.mock.calls[0][2]).toContain("noreferrer");
    expect(openCompanion("antigravity", { open } as never)).toBe(false);
    expect(openCompanion("https://evil.example", { open } as never)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("shows prompts with what they contain, copies one, and records that it was prepared", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const srv = fakeServer({
      "GET /companion/gemini": () => ({ body: info("Gemini", [item("introduce", "Introduce me to Gemini", { chars: 123, includes_memories: 2 }), item("second_opinion", "Ask Gemini to double-check the change")]) }),
      "POST /companion/gemini/copied": () => ({ status: 201, body: { recorded: true } }),
    } as never);
    render(<Wrap ctx={ctxFor().ctx}><Companion provider="gemini" name="Gemini" conversationId="cnv_1" /></Wrap>);
    expect(await screen.findByText("Introduce me to Gemini")).toBeTruthy();
    expect(srv.calls[0].query.get("conversation_id")).toBe("cnv_1");
    expect(screen.getByText(/does not open, read or control that page/)).toBeTruthy();
    expect((screen.getByLabelText("Prompt: Introduce me to Gemini") as HTMLTextAreaElement).value).toBe("PROMPT introduce");
    fireEvent.click(screen.getAllByRole("button", { name: "Copy this prompt" })[0]);
    await waitFor(() => expect(srv.count("POST", "/companion/gemini/copied")).toBe(1));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("PROMPT introduce");
    expect(srv.calls.find((c) => c.method === "POST")!.body).toEqual({ suggestion_id: "introduce", conversation_id: "cnv_1" });
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Gemini in a new window" }));
    expect(open).toHaveBeenCalledWith("https://gemini.google.com/app", "aios-gemini", expect.stringContaining("noopener"));
  });

  it("does not record a prepared prompt when copying fails, and says so", async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("denied"));
    const srv = fakeServer({ "GET /companion/perplexity": () => ({ body: info("Perplexity", [item("research", "Look up current information on this topic")]) }), "POST /companion/perplexity/copied": () => ({ status: 201, body: {} }) } as never);
    render(<Wrap ctx={ctxFor().ctx}><Companion provider="perplexity" name="Perplexity" /></Wrap>);
    fireEvent.click(await screen.findByRole("button", { name: "Copy this prompt" }));
    expect(await screen.findByText(/Could not copy automatically/)).toBeTruthy();
    expect(srv.count("POST", "/companion/perplexity/copied")).toBe(0);
  });

  it("explains an empty list instead of showing nothing", async () => {
    fakeServer({ "GET /companion/gemini": () => ({ body: info("Gemini", []) }) } as never);
    render(<Wrap ctx={ctxFor().ctx}><Companion provider="gemini" name="Gemini" /></Wrap>);
    expect(await screen.findByText(/No suggested prompts yet/)).toBeTruthy();
  });

  it("the toggle fetches nothing until asked, and is absent for AIs with no website", async () => {
    const srv = fakeServer({ "GET /companion/gemini": () => ({ body: info("Gemini", [item("introduce", "Introduce me to Gemini")]) }) } as never);
    render(<Wrap ctx={ctxFor().ctx}><CompanionToggle provider="antigravity" name="Antigravity" /><CompanionToggle provider="gemini" name="Gemini" /></Wrap>);
    expect(screen.queryByRole("button", { name: /Antigravity/ })).toBeNull();
    expect(srv.calls.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Use my Gemini subscription" }));
    expect(await screen.findByText("Introduce me to Gemini")).toBeTruthy();
  });

  it("has its own tab in My AIs, switches between the two, and is accessible", async () => {
    fakeServer({
      "GET /learning": () => ({ body: { enabled: true } }),
      "GET /companion/gemini": () => ({ body: info("Gemini", [item("introduce", "Introduce me to Gemini")]) }),
      "GET /companion/perplexity": () => ({ body: info("Perplexity", [item("introduce", "Introduce me to Perplexity")]) }),
    } as never);
    const { container } = render(<Wrap ctx={ctxFor().ctx}><MyAIs section="subs" /></Wrap>);
    expect(await screen.findByText("Introduce me to Gemini")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Gemini and Perplexity" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/Antigravity cannot be used/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Which one?"), { target: { value: "perplexity" } });
    expect(await screen.findByText("Introduce me to Perplexity")).toBeTruthy();
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
  });
});
