import type { Route } from "../ui/hooks";

// The on-screen tour. Steps are data so the wording can be read, tested and changed in one place. Three steps are
// interactive (checking Claude, choosing how much to see, creating the Everyday space); the component supplies those.
export type TourStepId = "welcome" | "universe" | "claude" | "level" | "bring" | "share" | "chat" | "control" | "done";
export interface TourStep {
  id: TourStepId; title: string; lead: string; points: string[];
  action?: { label: string; to: Route };            // "do it now": jumps there, and the tour waits in the corner
}

export const TOUR_STEPS: TourStep[] = [
  { id: "welcome", title: "Welcome to AIOS",
    lead: "AIOS is one place for all your AI assistants. They share one memory of you, so none of them starts from scratch, and you stay in charge of what each one knows.",
    points: ["You type one request in the box on Home, for any task: a question, a letter, a plan, a code change. AIOS works out the steps it needs, and tells you which ones it left out and why.",
      "This takes about five minutes, and you can stop at any time.", "Everything it learns about you is something you can read, correct or delete.", "You can run this tour again whenever you like."] },
  { id: "universe", title: "This is your universe",
    lead: "Home opens on a map of everything AIOS is. Every part of it is a real thing:",
    points: ["The glowing centre is you. Everything else exists to serve you.", "Planets are your AIs. The closer a planet is to you, the more private memories it may be told.",
      "Stars are memories. Their shape is the kind of memory; brighter means it was used and the work checked out.", "Comets are things waiting for you: approvals, stuck work, suggestions to look over.",
      "Click anything on the map to see what it is and what you can do with it."],
    action: { label: "Show me the map", to: { tab: "home" } } },
  { id: "claude", title: "Connect Claude",
    lead: "Claude is the one AI AIOS can talk to directly, using your own Claude account. AIOS never sees your password and never uses a paid key.",
    points: ["AIOS checks it for you below.", "Gemini, Perplexity and Antigravity work by copy and paste: AIOS writes the question and you paste the answer back."] },
  { id: "level", title: "Choose how much to see",
    lead: "AIOS can show everything or keep things calm. Nothing is deleted when you change this, and you can change it later in Settings.",
    points: [] },
  { id: "bring", title: "Bring what your other AIs know about you",
    lead: "If you have used ChatGPT, Gemini, Claude or Perplexity before, they already know things about you. Bring that over so you do not start from scratch.",
    points: ["AIOS writes a short request. You paste it into the other AI, then paste its answer back.", "What comes back is only ever a suggestion. Nothing is used until you approve it.",
      "Anything that looks like a password, or like an instruction to an AI, is left out."],
    action: { label: "Bring in memories now", to: { tab: "ais", id: "import" } } },
  { id: "share", title: "Choose what each AI may be told",
    lead: "Each AI has a ring around you. You decide how much it may know.",
    points: ["Inner ring: public and private memories. Middle ring: only memories you mark public. Outer ring: nothing.", "AIs you reach by copy and paste start in the middle ring, because what you paste leaves this computer.",
      "Memories marked secret are never shared with anyone."],
    action: { label: "Review what each AI may be told", to: { tab: "ais", id: "share" } } },
  { id: "chat", title: "Try your first request",
    lead: "Type anything in the box on Home. You do not need a project for that: AIOS keeps an Everyday space for ordinary questions and writing.",
    points: ["A simple question gets an answer and nothing more. A bigger job gets more steps, and the plan is shown before it starts.", "Say “remember that…” or “always…” and AIOS suggests a memory for you to approve.",
      "If you work with code, choose a project and AIOS lets Claude make changes in a safe separate copy, asks before running your tests, and has a second Claude review the result."] },
  { id: "control", title: "You stay in control",
    lead: "Nothing important happens without you.",
    points: ["Approvals wait in your Inbox until you decide.", "Extra abilities, such as checking your PC, are off until you turn each one on.", "The Pause button in Settings stops everything at once.",
      "Receipts list, in plain words, everything AIOS has done."],
    action: { label: "See the safety controls", to: { tab: "settings", id: "abilities" } } },
  { id: "done", title: "You are set",
    lead: "That is everything. Your universe will grow as you use it.",
    points: ["To see this tour again: Settings, then Take the tour again. Or press the Take the tour button under the map. Or press Ctrl+K and type “tour”.",
      "Anything unclear on any screen? Look for the plain-words explanation beside it."] },
];

export const lastStep = TOUR_STEPS.length - 1;
export const clampStep = (n: number): number => Math.max(0, Math.min(lastStep, Math.round(Number.isFinite(n) ? n : 0)));
export const progressText = (step: number): string => `Step ${clampStep(step) + 1} of ${TOUR_STEPS.length}`;
