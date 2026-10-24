export type DiffOp = { kind: "same" | "add" | "del"; text: string };

const MAX_LINES = 1500;

/** Line diff (longest common subsequence). Inputs beyond MAX_LINES fall back to "all removed, all added" so it can never hang the UI. */
export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split("\n"), b = after.split("\n");
  if (a.length > MAX_LINES || b.length > MAX_LINES) return [...a.map((text) => ({ kind: "del" as const, text })), ...b.map((text) => ({ kind: "add" as const, text }))];
  const n = a.length, m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ kind: "del", text: a[i++] });
    else out.push({ kind: "add", text: b[j++] });
  }
  while (i < n) out.push({ kind: "del", text: a[i++] });
  while (j < m) out.push({ kind: "add", text: b[j++] });
  return out;
}

/** Keep changed lines with `context` unchanged lines around them; collapsed gaps become a single "skip" marker. */
export function collapseDiff(ops: DiffOp[], context = 2): (DiffOp | { kind: "skip"; count: number })[] {
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, i) => { if (o.kind !== "same") for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true; });
  const out: (DiffOp | { kind: "skip"; count: number })[] = [];
  let skipped = 0;
  ops.forEach((o, i) => {
    if (keep[i]) { if (skipped) { out.push({ kind: "skip", count: skipped }); skipped = 0; } out.push(o); } else skipped++;
  });
  if (skipped) out.push({ kind: "skip", count: skipped });
  return out;
}

export const diffStats = (ops: DiffOp[]) => ({ added: ops.filter((o) => o.kind === "add").length, removed: ops.filter((o) => o.kind === "del").length });
