import type { IconName } from "../ui/icons";

export type AssistKind = "answer" | "write" | "research" | "plan" | "project_question" | "build";
export type StepState = "will" | "you" | "offer" | "skip";
export type StepStatus = "pending" | "running" | "waiting" | "done" | "failed" | "skipped" | "offer";
export type TaskState = "working" | "waiting_you" | "needs_you" | "done" | "failed" | "cancelled";

export interface PlanStep { id: string; label: string; agent: string; state: StepState; why: string; status?: StepStatus }
export interface Blocker { code: string; message: string; alternatives?: string[] }
export interface AssistPlan {
  kind: AssistKind; label: string; guessed_kind: AssistKind; confidence: "high" | "medium" | "low" | "chosen"; reasons: string[];
  steps: PlanStep[]; high_stakes: boolean; big: boolean; blocker: Blocker | null; kinds: Record<AssistKind, string>; uses_project: boolean;
}
export interface AssistView {
  id: string; prompt: string; kind: AssistKind; label: string; confidence: string; reasons: string[]; chosen_by_owner: boolean; state: TaskState;
  needs_you: string | null; steps: (PlanStep & { status: StepStatus })[]; answer: { text: string; author: string; at: string; message_id: string | null } | null;
  conversation_id: string; workflow_id: string | null; created_at: string; project: { id: string; name: string } | null; uses_project: boolean; high_stakes: boolean;
}
export interface AssistRecent { id: string; prompt: string; kind: AssistKind; label: string; state: TaskState; needs_you: string | null; snippet: string; created_at: string; project: { id: string; name: string } | null }
export interface AgentCardData {
  id: "claude" | "gemini" | "perplexity" | "antigravity"; name: string; role: string; how: string; ready: boolean; status: "working" | "needs_you" | "idle" | "offline" | "on_call" | "manual";
  doing: string | null; quota: { five_hour?: { utilization: number }; seven_day?: { utilization: number } } | null;
}
export interface Dashboard {
  agents: AgentCardData[]; claude_ready: boolean; recent: AssistRecent[];
  needs_you: { approvals: number; blocked: number; to_review: number; items: { kind: string; title: string; href: string }[] };
}

export const KIND_ICON: Record<AssistKind, IconName> = { answer: "help", write: "edit", research: "search", plan: "list", project_question: "folder", build: "play" };
export const KIND_SHORT: Record<AssistKind, string> = { answer: "Answer", write: "Write", research: "Look up", plan: "Plan", project_question: "About a project", build: "Build" };
/** Kinds the owner may pick by hand, in the order shown. A project-based kind is offered only once a project is chosen. */
export const PICKABLE: AssistKind[] = ["answer", "write", "research", "plan", "project_question", "build"];

export const EXAMPLES: { text: string; kind: AssistKind }[] = [
  { text: "Explain how a mortgage escrow account works", kind: "answer" },
  { text: "Write a friendly email asking my landlord to fix the heating", kind: "write" },
  { text: "Plan a 3-day trip to Lisbon on a modest budget", kind: "plan" },
  { text: "What are the best budget laptops for students this year?", kind: "research" },
];

export const STEP_STATE_TEXT: Record<StepState, string> = { will: "AIOS does this", you: "Needs you", offer: "Optional", skip: "Not needed" };
export const STATUS_TEXT: Record<StepStatus, string> = { pending: "Next", running: "Working", waiting: "Waiting for you", done: "Done", failed: "Stopped", skipped: "Skipped", offer: "Optional" };
export const TASK_TEXT: Record<TaskState, string> = { working: "Working", waiting_you: "Waiting for you", needs_you: "Needs you", done: "Done", failed: "Stopped", cancelled: "Cancelled" };

export const AGENT_GLYPH: Record<string, string> = { claude: "C", gemini: "G", perplexity: "P", antigravity: "A", aios: "AI", you: "You" };
export const AGENT_NAME: Record<string, string> = { claude: "Claude", gemini: "Gemini", perplexity: "Perplexity", antigravity: "Antigravity", aios: "AIOS", you: "You" };

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 5 ? "Hello" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** The steps that will be done, need the owner, or are offered; and the ones left out, each with its reason. */
export function splitSteps<T extends PlanStep>(steps: T[]): { active: T[]; skipped: T[] } {
  return { active: steps.filter((s) => s.state !== "skip"), skipped: steps.filter((s) => s.state === "skip") };
}
