import type { Route } from "../ui/hooks";

// "Today" is a handful of cards computed from counts AIOS already has. The suggested next step is a fixed rule, not a model's guess,
// and it always says why.
export interface TodayInput { approvals: number; blocked: number; running: number; toReview: number; verifiedOutcomes: number; projects: number | null }
export interface TodayCard { id: "needs" | "done" | "next" | "ask"; title: string; body: string; action?: { label: string; to: Route } }
export const CARD_IDS = ["needs", "done", "next", "ask"] as const;
export const CARD_NAMES: Record<TodayCard["id"], string> = { needs: "Needs you", done: "Done so far", next: "Suggested next step", ask: "Ask anything" };

const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;

export function nextStep(i: TodayInput): { text: string; why: string; to: Route; label: string } {
  if (i.approvals > 0) return { text: "Review what is waiting for your approval.", why: `${n(i.approvals, "action")} cannot go ahead until you decide.`, to: { tab: "inbox" }, label: "Open approvals" };
  if (i.blocked > 0) return { text: "Unblock the stuck work.", why: `${n(i.blocked, "run")} stopped and needs a decision.`, to: { tab: "runs" }, label: "See blocked work" };
  if (i.toReview > 0) return { text: "Look over what AIOS suggests remembering.", why: `${n(i.toReview, "suggested memory", "suggested memories")} waiting for a yes or no.`, to: { tab: "inbox" }, label: "Review suggestions" };
  if (i.projects === 0) return { text: "Add your first project folder.", why: "Nothing can be worked on until AIOS knows where it lives.", to: { tab: "projects" }, label: "Add a project" };
  return { text: "Start a conversation about a project.", why: "Nothing needs you right now.", to: { tab: "work" }, label: "Open Workspace" };
}

export function todayCards(i: TodayInput, hidden: readonly string[] = []): TodayCard[] {
  const waiting = i.approvals + i.blocked;
  const step = nextStep(i);
  const cards: TodayCard[] = [
    { id: "needs", title: CARD_NAMES.needs, body: waiting === 0 ? "Nothing is waiting for you." : `${n(i.approvals, "approval")} and ${n(i.blocked, "blocked run")}.`,
      action: waiting ? { label: i.approvals ? "Open approvals" : "See blocked work", to: { tab: i.approvals ? "inbox" : "runs" } } : undefined },
    { id: "done", title: CARD_NAMES.done, body: i.verifiedOutcomes === 0 ? "No change has passed its tests yet." : `${n(i.verifiedOutcomes, "change")} passed tests that AIOS ran itself.`,
      action: i.verifiedOutcomes ? { label: "See your projects", to: { tab: "insights" } } : undefined },
    { id: "next", title: CARD_NAMES.next, body: `${step.text} ${step.why}`, action: { label: step.label, to: step.to } },
    { id: "ask", title: CARD_NAMES.ask, body: "Chat with Claude about a project. Anything it changes is checked before you accept it.", action: { label: "Start chatting", to: { tab: "work" } } },
  ];
  return cards.filter((c) => !hidden.includes(c.id));
}
