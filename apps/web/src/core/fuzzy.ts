/** Small fuzzy matcher for the command palette / quick switcher (subsequence match with bonuses; no dependencies). */
export interface FuzzyResult { score: number; indices: number[] }

const isBoundary = (s: string, i: number) => i === 0 || /[\s/_\-.:>#]/.test(s[i - 1]) || (s[i - 1] === s[i - 1].toLowerCase() && s[i] !== s[i].toLowerCase());

/** Returns null when `query` is not a subsequence of `text`. Higher score = better. Case-insensitive. */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  const exact = t.indexOf(q);
  if (exact >= 0) {                                        // a contiguous hit beats any scattered one
    const bonus = (exact === 0 ? 40 : 0) + (isBoundary(text, exact) ? 25 : 0);
    return { score: 100 + bonus - exact - (t.length - q.length) * 0.1, indices: Array.from({ length: q.length }, (_, k) => exact + k) };
  }
  const indices: number[] = [];
  let score = 0, ti = 0, streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    streak = found === ti && indices.length ? streak + 1 : 0;
    score += 10 + streak * 6 + (isBoundary(text, found) ? 15 : 0) - Math.min(found - ti, 8);
    indices.push(found);
    ti = found + 1;
  }
  return { score: score - t.length * 0.05, indices };
}

export interface Ranked<T> { item: T; score: number; indices: number[] }
export function rank<T>(query: string, items: T[], text: (t: T) => string, limit = 50): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const m = fuzzyMatch(query, text(item));
    if (m) out.push({ item, score: m.score, indices: m.indices });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
