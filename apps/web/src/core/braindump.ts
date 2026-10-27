/** Sorts a spoken or typed brain dump into things to do, things to buy and things to remember, with fixed rules on this computer.
 *  It only proposes: nothing is saved until the person reviews the list and presses Save. */

export type DumpKind = "todo" | "shopping" | "note";
export interface DumpItem { id: number; kind: DumpKind; text: string; due: string | null }

const VERBS = "remember|don't|do not|call|email|text|book|schedule|pay|renew|order|send|pick up|fix|clean|cancel|sign up|register|buy|return|check|plan|write|make a note|note|need|we|i";
const SPLIT = new RegExp(String.raw`,\s*(?:and\s+|also\s+)?(?=(?:${VERBS})\b)|\s+and\s+(?=(?:${VERBS})\b)`, "i");
const DUE = /\b(today|tonight|tomorrow(?: morning| afternoon| evening)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|this weekend|end of the month)\b/i;

const NOTE_LEAD = /^(?:(?:i )?need to |also,? )*(?:remember that|write (?:this )?down(?: a note)?(?: that)?|make a note(?: that)?|note that|keep in mind(?: that)?|fyi)[:,]?\s*/i;
const SHOP = /^(?:also,? )?(?:we(?:'re| are)|i(?:'m| am)) (?:out of|low on|running low on) (.+)$|^(?:also,? )?(?:we|i) need (?!to\b)(?:some |more )?(.+)$/i;
const TODO_LEAD = /^(?:also,? )?(?:(?:remember|don't forget|do not forget) to |i need to |i have to |need to |have to |i should |i must )?/i;
const TODO_CUE = /^(?:also,? )?(?:(?:remember|don't forget|do not forget) to |i need to |i have to |need to |have to |i should |i must |(?:call|email|text|book|schedule|pay|renew|order|send|pick up|fix|clean|cancel|sign up|register|buy|return|check|plan|make an appointment)\b)/i;

const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/^(?:and|then|so|um|uh|okay|ok)[, ]+/i, "").replace(/[\s,;]+$/g, "").replace(/[.!?]+$/, "").trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function pieces(text: string): string[] {
  const guarded = text.replace(/\s+/g, " ").replace(/\b(Dr|Mr|Mrs|Ms|St|Jr|Sr)\./g, "$1~dot~");     // "Dr. Smith" is not the end of a sentence
  return guarded.split(/(?<=[.!?])\s+(?=[A-Z])/).flatMap((s) => s.split(SPLIT)).map((x) => tidy(x.replace(/~dot~/g, "."))).filter((p) => p.length >= 4);
}

export function sortBrainDump(text: string): DumpItem[] {
  const out: DumpItem[] = [];
  let id = 1;
  for (const raw of pieces(text)) {
    if (NOTE_LEAD.test(raw)) {
      const note = tidy(raw.replace(NOTE_LEAD, ""));
      if (note.length >= 4) out.push({ id: id++, kind: "note", text: cap(note), due: null });
      continue;
    }
    const shop = SHOP.exec(raw);
    if (shop) { const what = tidy(shop[1] ?? shop[2] ?? ""); if (what) out.push({ id: id++, kind: "shopping", text: cap(what), due: null }); continue; }
    if (TODO_CUE.test(raw) || /\bneed to\b|\bhave to\b/i.test(raw)) {
      const task = tidy(raw.replace(TODO_LEAD, "").replace(/^also,?\s+/i, ""));
      if (task.length >= 4) out.push({ id: id++, kind: "todo", text: cap(task), due: DUE.exec(task)?.[1] ?? /\bby (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(task)?.[1] ?? null });
    }
  }
  return out;
}

/** What one reviewed item is saved as. */
export function itemTitle(i: DumpItem): string {
  return i.text;
}
