import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistPlan, AssistView, Dashboard, EXAMPLES, greeting, splitSteps } from "../core/assist";
import { Task } from "../screens/Task";
import { Agents } from "../ui/Agents";
import { AskBox } from "../ui/Ask";
import { Home } from "../screens/Home";
import { err, fakeServer, HOME } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

beforeEach(() => { resetRoute(""); setWidth(1200, 900); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

const step = (id: string, label: string, agent: string, state: string, why = "because") => ({ id, label, agent, state, why });
const ANSWER_PLAN: AssistPlan = {
  kind: "answer", label: "Answer a question", guessed_kind: "answer", confidence: "high", reasons: ["It asks a question or starts a chat."], high_stakes: false, big: false, blocker: null, uses_project: false,
  kinds: { answer: "Answer a question", write: "Write or edit text", research: "Look something up", plan: "Plan or decide", project_question: "Ask about a project", build: "Build" },
  steps: [step("understand", "AIOS reads your request", "aios", "will"), step("answer", "Claude answers", "claude", "will"), step("second_look", "Second opinion", "gemini", "skip", "A simple request does not need one."), step("build", "Build, test and review", "claude", "skip", "Nothing to build, so nothing to test or review.")] as AssistPlan["steps"],
};
const BUILD_PLAN: AssistPlan = { ...ANSWER_PLAN, kind: "build", label: "Build or fix something in a project", uses_project: true, reasons: ["It asks to change something in code or files."],
  steps: [step("understand", "AIOS reads your request", "aios", "will"), step("implement", "Claude makes the change in a safe copy of your project", "claude", "will"), step("verify", "AIOS runs your project's check", "you", "you"),
    step("review", "A separate Claude reviews the change", "claude", "will"), step("correct", "Claude fixes real problems found", "claude", "will"), step("result", "You see the result and decide whether to apply it", "you", "you")] as AssistPlan["steps"] };
const view = (o: Partial<AssistView> = {}): AssistView => ({
  id: "ast_1", prompt: "What is the capital of Australia?", kind: "answer", label: "Answer a question", confidence: "high", reasons: ["It asks a question or starts a chat."], chosen_by_owner: false, state: "done",
  needs_you: null, conversation_id: "cnv_1", workflow_id: null, created_at: new Date().toISOString(), project: null, uses_project: false, high_stakes: false,
  steps: [{ ...step("understand", "AIOS reads your request", "aios", "will"), status: "done" }, { ...step("answer", "Claude answers", "claude", "will"), status: "done" },
    { ...step("second_look", "Second opinion", "gemini", "skip", "A simple request does not need one."), status: "skipped" }, { ...step("build", "Build, test and review", "claude", "skip", "Nothing to build, so nothing to test or review."), status: "skipped" }] as AssistView["steps"],
  answer: { text: "**Canberra** is the capital.\n\n- It is not Sydney", author: "claude-code 2.1.310 (claude-sonnet-5-5)", at: new Date().toISOString(), message_id: "m1" }, ...o });

const typeInto = (text: string) => fireEvent.change(screen.getByLabelText("Your request"), { target: { value: text } });
const mountAsk = (routes: Record<string, never> | object = {}) => {
  const srv = fakeServer({ "GET /projects": () => ({ body: { items: [{ id: "prj_1", name: "Calc" }, { id: "prj_0", name: "Everyday" }], next_cursor: null } }), ...routes } as never);
  render(<Wrap ctx={ctxFor().ctx}><AskBox /></Wrap>);
  return srv;
};

describe("the single prompt", () => {
  it("is one box for any task, with examples for people who are not sure what to ask", async () => {
    mountAsk();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/What do you want done\?/);
    expect(screen.getByLabelText("Your request")).toBeTruthy();
    const ex = screen.getByRole("group", { name: "Examples" });
    expect(within(ex).getAllByRole("button")).toHaveLength(EXAMPLES.length);
    fireEvent.click(within(ex).getAllByRole("button")[0]);
    expect((screen.getByLabelText("Your request") as HTMLTextAreaElement).value).toBe(EXAMPLES[0].text);
    expect(screen.queryByRole("group", { name: "Examples" })).toBeNull();                       // examples make way once you are typing
  });

  it("shows what AIOS would do as you type, and the steps it leaves out with the reason", async () => {
    const srv = mountAsk({ "POST /assist/plan": () => ({ body: ANSWER_PLAN }) });
    typeInto("What is the capital of Australia?");
    expect(srv.count("POST", "/assist/plan")).toBe(0);                                          // debounced: no call per keystroke
    const plan = await screen.findByRole("region", { name: "How AIOS will handle this" }, { timeout: 2500 });
    expect(within(plan).getByText("Answer a question")).toBeTruthy();
    expect(within(plan).getByText("Claude answers")).toBeTruthy();
    const left = plan.querySelector("details.plan-skipped") as HTMLDetailsElement;
    expect(left.open).toBe(false);
    expect(left.querySelector("summary")!.textContent).toBe("Left out: second opinion, build, test and review");
    expect(left.textContent).toContain("Nothing to build, so nothing to test or review.");
    expect(srv.calls.find((c) => c.path === "/assist/plan")!.body).toEqual({ prompt: "What is the capital of Australia?" });
  });

  it("a build plan shows every step and marks the ones that need you", async () => {
    mountAsk({ "POST /assist/plan": () => ({ body: BUILD_PLAN }) });
    typeInto("Fix the failing test in calc.py");
    const plan = await screen.findByRole("region", { name: "How AIOS will handle this" }, { timeout: 2500 });
    expect(plan.querySelectorAll("li.pstep")).toHaveLength(6);
    expect(plan.querySelector("li.pstep.you")!.textContent).toContain("Needs you");
    expect(plan.querySelector("details.plan-skipped")).toBeNull();                              // nothing is left out of a build
  });

  it("sends the request with the project and the owner's own choice, once, and opens the task", async () => {
    const srv = mountAsk({ "POST /assist": () => ({ status: 201, body: view({ id: "ast_77" }) }), "POST /assist/plan": () => ({ body: ANSWER_PLAN }) });
    await screen.findByRole("option", { name: "Calc" });
    expect(screen.queryByRole("option", { name: "Everyday" })).toBeNull();                      // the chat space is not a project to pick
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "prj_1" } });
    fireEvent.change(screen.getByLabelText("How should AIOS handle this?"), { target: { value: "project_question" } });
    typeInto("What does this project do?");
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(srv.count("POST", "/assist")).toBe(1));
    const post = srv.calls.find((c) => c.method === "POST" && c.path === "/assist")!;
    expect(post.body).toEqual({ prompt: "What does this project do?", project_id: "prj_1", kind: "project_question" });
    expect(post.headers["idempotency-key"]).toMatch(/^ask-/);
    await waitFor(() => expect(location.hash).toBe("#/home/ast_77"));
  });

  it("Enter sends, Shift+Enter makes a new line", async () => {
    const srv = mountAsk({ "POST /assist": () => ({ status: 201, body: view() }), "POST /assist/plan": () => ({ body: ANSWER_PLAN }) });
    typeInto("hello there");
    fireEvent.keyDown(screen.getByLabelText("Your request"), { key: "Enter", shiftKey: true });
    expect(srv.count("POST", "/assist")).toBe(0);
    fireEvent.keyDown(screen.getByLabelText("Your request"), { key: "Enter" });
    await waitFor(() => expect(srv.count("POST", "/assist")).toBe(1));
  });

  it("when a build cannot start it says why and offers the way out, without starting anything", async () => {
    const srv = mountAsk({ "POST /assist": () => err(409, "needs_project", "Pick the project this is about. Until then Claude can only answer in chat."), "POST /assist/plan": () => ({ body: BUILD_PLAN }) });
    typeInto("Fix the failing test in calc.py");
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    const box = await screen.findByRole("alert");
    expect(box.textContent).toContain("Pick the project this is about");
    expect(within(box).getByRole("button", { name: "Choose a project" })).toBeTruthy();
    srv.calls.length = 0;
    fireEvent.click(within(box).getByRole("button", { name: "Just answer in chat" }));
    await waitFor(() => expect(srv.calls.find((c) => c.method === "POST" && c.path === "/assist")?.body).toMatchObject({ kind: "answer" }));
  });

  it("will not send an empty request, and Claude not being signed in is said up front", async () => {
    mountAsk({ "POST /assist/plan": () => ({ body: { ...ANSWER_PLAN, blocker: { code: "claude_not_ready", message: "Claude is not signed in on this computer yet." } } }) });
    expect((screen.getByRole("button", { name: "Send request" }) as HTMLButtonElement).disabled).toBe(true);
    typeInto("hello");
    await screen.findByText("Claude is not signed in on this computer yet.", {}, { timeout: 2000 });
    expect((screen.getByRole("button", { name: "Send request" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("has no accessibility violations", async () => {
    mountAsk({ "POST /assist/plan": () => ({ body: ANSWER_PLAN }) });
    typeInto("What is the capital of Australia?");
    await screen.findByRole("region", { name: "How AIOS will handle this" }, { timeout: 2000 });
    const r = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
  });
});

describe("your agents", () => {
  const agents: Dashboard["agents"] = [
    { id: "claude", name: "Claude", role: "Does the work", how: "Runs inside AIOS with your own sign-in", ready: true, status: "working", doing: "Fix the add bug", quota: { five_hour: { utilization: 0.67 } } },
    { id: "gemini", name: "Gemini", role: "Second opinions", how: "Copy and paste: AIOS writes the prompt, you paste it", ready: true, status: "on_call", doing: null, quota: null },
    { id: "perplexity", name: "Perplexity", role: "Finds sources", how: "Copy and paste: AIOS writes the prompt, you paste it", ready: true, status: "on_call", doing: null, quota: null },
    { id: "antigravity", name: "Antigravity", role: "Big coding jobs", how: "Manual handoff only; AIOS never starts it", ready: true, status: "manual", doing: null, quota: null },
  ];
  it("says what each AI is for and doing, how you reach it, and never offers a window for the ones that have none", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<Wrap ctx={ctxFor().ctx}><Agents agents={agents} /></Wrap>);
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(4);
    expect(cards[0].textContent).toContain("Working");
    expect(cards[0].textContent).toContain("Now: Fix the add bug");
    expect(screen.getByRole("img", { name: "67 percent of your 5-hour Claude usage" })).toBeTruthy();
    expect(cards[3].textContent).toContain("AIOS never starts it");
    expect(within(cards[3]).queryByRole("button")).toBeNull();                                 // Antigravity: no window, ever
    expect(within(cards[0]).queryByRole("button")).toBeNull();                                 // Claude runs inside AIOS
    fireEvent.click(within(cards[1]).getByRole("button", { name: "Open Gemini" }));
    expect(open).toHaveBeenCalledWith("https://gemini.google.com/app", "aios-gemini", expect.stringContaining("noopener"));
  });
  it("a Claude that is not signed in says how to fix it", () => {
    render(<Wrap ctx={ctxFor().ctx}><Agents agents={[{ ...agents[0], status: "offline", ready: false, doing: null }]} /></Wrap>);
    expect(screen.getByText("Not signed in")).toBeTruthy();
    expect(screen.getByText(/Sign in once by running/)).toBeTruthy();
  });
});

describe("a task", () => {
  const show = (v: AssistView, extra: object = {}) => {
    const srv = fakeServer({ "GET /assist/ast_1": () => ({ body: v }), ...extra } as never);
    const r = render(<Wrap ctx={ctxFor().ctx}><Task id="ast_1" /></Wrap>);
    return { srv, ...r };
  };
  it("shows a finished answer first in plain words, the steps that happened, and tucks away the ones left out", async () => {
    const { container } = show(view());
    expect(await screen.findByRole("heading", { level: 1, name: "What is the capital of Australia?" })).toBeTruthy();
    const result = await screen.findByRole("region", { name: "Result" });
    expect(within(result).getByText("Canberra").tagName).toBe("STRONG");                       // the answer is rendered as safe markdown
    expect(result.textContent).toContain("AI answers can be wrong");
    const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
    expect(steps.map((s) => s.querySelector("strong")!.textContent)).toEqual(["AIOS reads your request", "Claude answers"]);
    expect(container.querySelector("details.left-out summary")!.textContent).toBe("Left out: second opinion, build, test and review");
  });
  it("lets you ask a follow-up in the same conversation", async () => {
    const { srv } = show(view(), { "POST /conversations/cnv_1/messages": () => ({ status: 201, body: {} }) });
    await screen.findByRole("region", { name: "Result" });
    fireEvent.change(screen.getByLabelText("Reply to Claude"), { target: { value: "and New Zealand?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send follow-up" }));
    await waitFor(() => expect(srv.count("POST", "/conversations/cnv_1/messages")).toBe(1));
    expect(srv.calls.find((c) => c.method === "POST")!.body).toEqual({ content: "and New Zealand?", mode: "read" });
  });
  it("a build waiting on the check says it needs you and sends you to approve, with no follow-up box", async () => {
    const b = view({ kind: "build", label: "Build or fix something in a project", workflow_id: "wf_1", state: "waiting_you", answer: null, needs_you: "Approve or decline the check to continue.", project: { id: "p", name: "Calc" },
      steps: [{ ...step("understand", "AIOS reads your request", "aios", "will"), status: "done" }, { ...step("implement", "Claude makes the change", "claude", "will"), status: "done" }, { ...step("verify", "AIOS runs your project's check", "you", "you"), status: "waiting" },
        { ...step("review", "A separate Claude reviews the change", "claude", "will"), status: "pending", why: "A fresh session." }] as AssistView["steps"] });
    show(b);
    expect((await screen.findAllByText("Waiting for you")).length).toBe(2);                      // the task's state and the step that is waiting
    expect(screen.getByText("Approve or decline the check to continue.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open and decide" })).toBeTruthy();
    expect(screen.queryByLabelText("Reply to Claude")).toBeNull();
    expect(screen.getByText("Waiting for you", { selector: ".tl-status" })).toBeTruthy();
  });
  it("offered steps are the owner's to do: the prompt is only fetched when asked for", async () => {
    const v = view({ steps: [...view().steps.slice(0, 2), { ...step("second_look", "A second AI double-checks it (recommended)", "gemini", "offer", "This touches health, money or law."), status: "offer" }] as AssistView["steps"] });
    const { srv } = show(v, { "GET /companion/gemini": () => ({ body: { provider: "gemini", name: "Gemini", url: "x", blurb: "b", level: "public", notice: "n", items: [{ id: "fact_check", title: "Ask Gemini to double-check Claude's answer", why: "w", prompt: "CHECK THIS", chars: 10, includes_project_text: true, includes_memories: 0 }, { id: "explain", title: "other", why: "w", prompt: "NO", chars: 2, includes_project_text: true, includes_memories: 0 }] } }) });
    await screen.findByRole("region", { name: "Result" });
    expect(srv.count("GET", "/companion/gemini")).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Get the prompt for Gemini" }));
    expect(await screen.findByDisplayValue("CHECK THIS")).toBeTruthy();
    expect(screen.queryByDisplayValue("NO")).toBeNull();                                        // only the prompt this step is about
  });
  it("a missing task is said plainly", async () => {
    fakeServer({ "GET /assist/ast_1": () => err(404, "not_found", "No such task.") } as never);
    render(<Wrap ctx={ctxFor().ctx}><Task id="ast_1" /></Wrap>);
    expect(await screen.findByText(/No such task/)).toBeTruthy();
  });
  it("is accessible", async () => {
    const { container } = show(view());
    await screen.findByRole("region", { name: "Result" });
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("|")}`)).toEqual([]);
  });
});

describe("Home as a dashboard", () => {
  const dash = { agents: [], claude_ready: true, needs_you: { approvals: 0, blocked: 0, to_review: 0, items: [] }, recent: [] };
  const open = (mode: "simple" | "power") => {
    fakeServer({ "GET /home": () => ({ body: HOME }), "GET /dashboard": () => ({ body: dash }), "GET /skyline": () => ({ body: { projects: [], totals: { projects: 0, floors: 0, waiting: 0 } } }) } as never);
    const c = ctxFor();
    return render(<Wrap ctx={{ ...c.ctx, settings: { ...c.ctx.settings, mode } }}><Home /></Wrap>);
  };
  it("leads with the one prompt, and folds the technical lists away in Simple mode only", async () => {
    const { container, unmount } = open("simple");
    await screen.findByText("Current runs");
    expect(container.querySelector("h1.ask-title")).toBeTruthy();
    expect((container.querySelector("details.tech") as HTMLDetailsElement).open).toBe(false);
    unmount();
    const power = open("power");
    await screen.findByText("Current runs");
    expect((power.container.querySelector("details.tech") as HTMLDetailsElement).open).toBe(true);
  });
  it("does not repeat the 'ask anything' card, because the prompt box is that", async () => {
    open("power");
    const today = await screen.findByRole("region", { name: "Today" });
    expect(within(today).queryByText("Ask anything")).toBeNull();
    expect(within(today).getByText("Needs you")).toBeTruthy();
  });
});

describe("the helpers", () => {
  it("greets by time of day and splits steps into done-by-AIOS and left-out", () => {
    expect([2, 8, 14, 20].map((h) => greeting(new Date(2026, 0, 1, h)))).toEqual(["Hello", "Good morning", "Good afternoon", "Good evening"]);
    const { active, skipped } = splitSteps(ANSWER_PLAN.steps);
    expect(active.map((s) => s.id)).toEqual(["understand", "answer"]);
    expect(skipped.map((s) => s.id)).toEqual(["second_look", "build"]);
  });
});
