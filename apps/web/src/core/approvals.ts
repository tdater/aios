import type { Approval } from "./types";

export interface PlainApproval { headline: string; safety: string; tone: "info" | "warn" | "bad"; approveLabel: string }

const base = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** What an approval means in everyday words. Built only from what AIOS recorded about the exact action (type, target, side effects),
 *  and never softer than the facts: a command that runs on your computer is said to run on your computer. */
export function plainApproval(a: Pick<Approval, "review" | "destructive">): PlainApproval {
  const { type, target, side_effects } = a.review;
  const effects = side_effects.join(" ");
  if (type === "write_file") {
    const replaces = /^overwrites/i.test(side_effects[0] ?? "");
    return {
      headline: `AIOS wants to ${replaces ? "replace" : "create"} the file ${base(target) || "(unnamed)"}.`,
      safety: replaces ? "This overwrites a file that already exists. Check the content under Technical details before you approve." : "This adds a new file. Nothing that exists now is changed.",
      tone: replaces || a.destructive ? "warn" : "info", approveLabel: replaces ? "Approve replacing the file" : "Approve creating the file",
    };
  }
  if (type === "run_verification") {
    return {
      headline: "AIOS wants to run your project's check (its tests) on the change it just made.",
      safety: "The command runs on your computer with your Windows rights. It is not a sandbox, so only approve it if you are happy with the command shown under Technical details.",
      tone: "warn", approveLabel: "Approve running the check",
    };
  }
  if (type === "apply_revision") {
    return {
      headline: "AIOS wants to merge the reviewed change into your real project.",
      safety: effects || "Only a change that passed its check can be merged, and AIOS stops if your project has moved on or has unsaved work.",
      tone: "warn", approveLabel: "Approve merging the change",
    };
  }
  return {
    headline: "AIOS wants to do something it does not recognise.",
    safety: "Assume it changes things and cannot be undone. Read the details before approving, or reject it.",
    tone: "bad", approveLabel: "Approve this action",
  };
}
