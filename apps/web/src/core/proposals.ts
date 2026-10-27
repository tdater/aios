import type { Candidate } from "./types";

export interface QuickCheck { quick: boolean; why: string | null }

/** A proposal can be accepted with one tap only when every extra safeguard is out of the way: it is not global (needs a multi-project review),
 *  has no flags (a conflict needs a written note, a suspected injection needs a deliberate override), and is still waiting. Anything else is sent to the full review. */
export function quickCheck(c: Pick<Candidate, "scope" | "flags" | "status">): QuickCheck {
  if (!["candidate", "deferred"].includes(c.status)) return { quick: false, why: "This one has already been decided." };
  if (c.scope === "global") return { quick: false, why: "This would apply everywhere, so it needs the full review of its evidence." };
  if (c.flags.includes("injection_suspect")) return { quick: false, why: "It contains text that looks like an instruction to an AI, so it needs a closer look." };
  if (c.flags.length > 0) return { quick: false, why: `It was flagged (${c.flags.join(", ").replace(/_/g, " ")}), so it needs a closer look.` };
  return { quick: true, why: null };
}

/** The question shown on the card, in plain words. */
export function proposalQuestion(c: Pick<Candidate, "title" | "type">): string {
  const kind = c.type.replace(/_/g, " ");
  return c.type === "memory" || c.type === "fact" || c.type === "preference"
    ? `AIOS noticed this about you: “${c.title}”. Remember it?`
    : `AIOS suggests a ${kind}: “${c.title}”. Keep it?`;
}
