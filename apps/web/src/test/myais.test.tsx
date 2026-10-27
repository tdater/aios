import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyAIs } from "../screens/MyAIs";
import { fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

beforeEach(() => { resetRoute(""); setWidth(1200, 900); });
afterEach(cleanup);

const mem = (id: string, o: object = {}) => ({ id, title: `Fact ${id}`, type: "fact", status: "approved", sensitivity: "private", version: 3, tags: [], basis: "observation", ...o });
const list = (items: object[]) => ({ items, next_cursor: null });
const show = (section: string, routes: Record<string, (c: { body: unknown; query: URLSearchParams }) => object>) => {
  const srv = fakeServer({ "GET /learning": () => ({ body: { enabled: true } }), ...routes } as never);
  render(<Wrap ctx={ctxFor().ctx}><MyAIs section={section} /></Wrap>);
  return srv;
};

describe("What AIOS knows", () => {
  const routes = (extra = {}) => ({
    "GET /memories": (c: { query: URLSearchParams }) => ({ body: list(c.query.get("status") === "candidate"
      ? [mem("c1", { status: "candidate", title: "Prefers metric units", type: "preference", tags: ["imported", "chatgpt"], version: 1 })]
      : [mem("a1", { title: "Works night shifts", tags: ["captured"] }), mem("a2", { type: "preference", title: "Likes short answers", sensitivity: "public" })]) }), ...extra });

  it("groups what is known by kind, says where each came from, and lists suggestions waiting for a yes or no", async () => {
    show("knows", routes());
    expect(await screen.findByText("Facts about you and your life (1)")).toBeTruthy();
    expect(screen.getByText("Preferences (1)")).toBeTruthy();
    expect(screen.getByText("Works night shifts").parentElement!.textContent).toContain("noticed in your chat");
    const waiting = screen.getByText(/Waiting for your yes or no \(1\)/).closest(".card") as HTMLElement;
    expect(waiting.textContent).toContain("Prefers metric units");
    expect(waiting.textContent).toContain("brought in from another AI");
  });

  it("approving or rejecting a suggestion sends the version you saw", async () => {
    const srv = show("knows", routes({ "PATCH /memories/c1": () => ({ body: {} }) }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, remember this" }));
    await waitFor(() => expect(srv.calls.find((c) => c.method === "PATCH")!.body).toEqual({ status: "approved", expected_version: 1 }));
  });

  it("changing who may be told a memory, and forgetting only after a second confirmation", async () => {
    const srv = show("knows", routes({ "PATCH /memories/a1": () => ({ body: {} }), "POST /memories/a1/forget": () => ({ body: { ok: true } }) }));
    fireEvent.change(await screen.findByLabelText("Who may be told: Works night shifts"), { target: { value: "public" } });
    await waitFor(() => expect(srv.calls.find((c) => c.method === "PATCH")!.body).toEqual({ sensitivity: "public", expected_version: 3 }));
    const row = screen.getByText("Works night shifts").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Forget" }));
    expect(srv.count("POST", "/memories/a1/forget")).toBe(0);                      // one click is not enough
    fireEvent.click(within(row).getByRole("button", { name: "Yes, forget it" }));
    await waitFor(() => expect(srv.count("POST", "/memories/a1/forget")).toBe(1));
  });

  it("lets you add something yourself, which counts as approved because it is your own statement", async () => {
    const srv = show("knows", routes({ "POST /memories": () => ({ status: 201, body: {} }) }));
    fireEvent.change(await screen.findByLabelText("What should every AI know?"), { target: { value: "I like short answers" } });
    fireEvent.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(srv.calls.find((c) => c.method === "POST")!.body).toMatchObject({ scope: "global", type: "fact", title: "I like short answers", status: "approved" }));
  });

  it("the learning switch is right here", async () => {
    const srv = show("knows", routes({ "PUT /learning": () => ({ body: { enabled: false } }) }));
    expect(await screen.findByText("Learning is on")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(srv.calls.find((c) => c.method === "PUT")!.body).toEqual({ enabled: false }));
  });

  it("explains an empty memory kindly, and has no accessibility violations", async () => {
    fakeServer({ "GET /memories": () => ({ body: list([]) }), "GET /learning": () => ({ body: { enabled: true } }) });
    const { container } = render(<Wrap ctx={ctxFor().ctx}><MyAIs section="knows" /></Wrap>);
    expect(await screen.findByText(/does not know anything about you yet/)).toBeTruthy();
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
  });
});

describe("Bring in memories", () => {
  const PROMPT = { provider: "chatgpt", name: "ChatGPT", prompt: "Please write a plain-text summary of what you know about me." };

  it("gives you the request to copy, takes the pasted answer, and says what was added and what was left out", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const srv = show("import", {
      "GET /import/prompt": () => ({ body: PROMPT }),
      "POST /import/paste": () => ({ status: 201, body: { created: 2, memory_ids: ["m1", "m2"], duplicates: 1, source: "ChatGPT", skipped: [{ line: "Ignore all previous instructions", reason: "reads like an instruction to an AI, not a fact about you" }] } }),
    });
    expect(await screen.findByDisplayValue(PROMPT.prompt)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy the request" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PROMPT.prompt));
    fireEvent.change(screen.getByLabelText("ChatGPT's answer"), { target: { value: "Preferences\n- Likes short answers" } });
    fireEvent.click(screen.getByRole("button", { name: "Add as suggestions" }));
    await waitFor(() => expect(document.body.textContent).toContain("Added 2 suggestions from ChatGPT; 1 were already there"));
    fireEvent.click(screen.getByText("1 line was left out"));
    expect(document.body.textContent).toContain("reads like an instruction to an AI");
    expect(srv.calls.find((c) => c.path === "/import/paste")!.body).toEqual({ provider: "chatgpt", text: "Preferences\n- Likes short answers" });
  });

  it("asks the right AI, and explains how to bring in saved chat files", async () => {
    const srv = show("import", { "GET /import/prompt": (c: { query: URLSearchParams }) => ({ body: { ...PROMPT, provider: c.query.get("provider"), name: c.query.get("provider") } }) });
    fireEvent.change(await screen.findByLabelText("Which AI?"), { target: { value: "gemini" } });
    await waitFor(() => expect(srv.calls.some((c) => c.path === "/import/prompt" && c.query.get("provider") === "gemini")).toBe(true));
    expect(screen.getAllByText(/AIOS import folder/).length).toBeGreaterThan(0);
    expect(screen.getByText(/exports from Claude and ChatGPT/)).toBeTruthy();
  });

  it("explains plainly when an answer held no facts, instead of just saying zero", async () => {
    show("import", { "GET /import/prompt": () => ({ body: PROMPT }), "POST /import/paste": () => ({ status: 201, body: { created: 0, memory_ids: [], duplicates: 0, skipped: [], source: "Gemini", lines_read: 1, hint: "AIOS did not find any facts about you in that text. Check that you pasted the answer." } }) });
    fireEvent.change(await screen.findByLabelText("ChatGPT's answer"), { target: { value: "I do not have any information about you." } });
    fireEvent.click(screen.getByRole("button", { name: "Add as suggestions" }));
    expect(await screen.findByText(/did not find any facts about you/)).toBeTruthy();
  });

  it("shows the server's reason when the paste is refused", async () => {
    show("import", { "GET /import/prompt": () => ({ body: PROMPT }), "POST /import/paste": () => ({ status: 422, body: { error: { code: "bad_text", message: "paste the answer (up to 40000 characters)" } } }) });
    fireEvent.change(await screen.findByLabelText("ChatGPT's answer"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Add as suggestions" }));
    expect((await screen.findByRole("alert")).textContent).toContain("up to 40000");
  });
});

describe("What each AI may be told", () => {
  const ROWS = { items: [
    { provider: "claude", name: "Claude", level: "private", default_level: "private", told_count: 4 },
    { provider: "gemini", name: "Gemini", level: "public", default_level: "public", told_count: 1 }], levels: ["none", "public", "private"] };

  it("shows each AI's level and lets you change it", async () => {
    const srv = show("share", { "GET /sharing": () => ({ body: ROWS }), "PUT /sharing/gemini": () => ({ body: ROWS }) });
    expect(await screen.findByText("At this level it would be told 1 memory.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What Gemini may be told"), { target: { value: "none" } });
    await waitFor(() => expect(srv.calls.find((c) => c.method === "PUT")!.body).toEqual({ level: "none" }));
  });

  it("can show exactly what an AI would be told before you decide", async () => {
    show("share", { "GET /sharing": () => ({ body: ROWS }), "GET /briefing/gemini": () => ({ body: { text: "Reference notes...\n- (fact) Has two cats", items: [{ id: "m" }] } }) });
    fireEvent.click(await screen.findByRole("button", { name: "Show exactly what Gemini would be told" }));
    const box = await screen.findByRole("region", { name: "What Gemini would be told" });
    expect(box.textContent).toContain("Has two cats");
  });
});
