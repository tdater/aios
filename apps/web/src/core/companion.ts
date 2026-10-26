export interface CompanionItem { id: string; title: string; why: string; prompt: string; chars: number; includes_project_text: boolean; includes_memories: number }
export interface CompanionInfo { provider: string; name: string; url: string; blurb: string; level: string; items: CompanionItem[]; notice: string }

/** The only addresses AIOS will ever open for a companion window. Anything the server sends that is not on this list is ignored. */
export const COMPANION_SITES: Record<string, string> = { gemini: "https://gemini.google.com/app", perplexity: "https://www.perplexity.ai/" };
export const COMPANIONS: [string, string][] = [["gemini", "Gemini"], ["perplexity", "Perplexity"]];

/** Opens the official site in its own window. AIOS cannot see or control it: no opener link, no referrer. */
export function openCompanion(provider: string, win: Pick<Window, "open"> = window): boolean {
  const url = COMPANION_SITES[provider];
  if (!url) return false;
  win.open(url, `aios-${provider}`, "popup=yes,width=520,height=860,noopener,noreferrer");   // returns null with noopener, so success cannot be read back
  return true;
}
