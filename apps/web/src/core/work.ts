// Pure helpers for the Workspace screens. No React, no network: everything here is unit-tested.
import type { Finding, Quota } from "./types";

// ---------------------------------------------------------------- unified diff
export type DiffLineKind = "add" | "del" | "ctx" | "hunk" | "note";
export interface UDiffLine { kind: DiffLineKind; text: string; oldNo: number | null; newNo: number | null }
export interface UDiffFile {
  path: string; oldPath: string; status: "modified" | "added" | "deleted" | "renamed" | "binary";
  added: number; removed: number; lines: UDiffLine[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parses `git diff` output. Inside a hunk it trusts the line counts from the @@ header, so a removed line whose
 *  text starts with "--" (shown as "--- ...") is content, not a file header. A truncated diff ends cleanly. */
export function parseUnifiedDiff(text: string): UDiffFile[] {
  const files: UDiffFile[] = [];
  let cur: UDiffFile | null = null;
  let oldLeft = 0, newLeft = 0, oldNo = 0, newNo = 0;
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (cur && (oldLeft > 0 || newLeft > 0)) {
      const c = line[0];
      // A real hunk line starts with a space, + , - or \ (an empty line is a context line whose space was
      // stripped). Anything else cannot belong to the hunk, so a wrong count never swallows the next file.
      if (c === undefined || c === "+" || c === "-" || c === " " || c === "\\") {
        if (c === "\\") cur.lines.push({ kind: "note", text: line, oldNo: null, newNo: null });
        else if (c === "+") { cur.lines.push({ kind: "add", text: line.slice(1), oldNo: null, newNo: newNo++ }); cur.added++; newLeft--; }
        else if (c === "-") { cur.lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++, newNo: null }); cur.removed++; oldLeft--; }
        else { cur.lines.push({ kind: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ }); oldLeft--; newLeft--; }
        continue;
      }
      oldLeft = newLeft = 0;
    }
    const g = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (g) {
      cur = { path: g[2], oldPath: g[1], status: "modified", added: 0, removed: 0, lines: [] };
      files.push(cur);
      oldLeft = newLeft = 0;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("new file mode")) cur.status = "added";
    else if (line.startsWith("deleted file mode")) cur.status = "deleted";
    else if (line.startsWith("rename from ")) { cur.oldPath = line.slice(12); cur.status = "renamed"; }
    else if (line.startsWith("rename to ")) cur.path = line.slice(10);
    else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) cur.status = "binary";
    else if (line.startsWith("+++ b/")) cur.path = line.slice(6);
    else if (line.startsWith("--- a/") && cur.status === "deleted") cur.path = line.slice(6);
    else {
      const h = HUNK.exec(line);
      if (h) {
        oldNo = Number(h[1]); newNo = Number(h[3]);
        oldLeft = h[2] === undefined ? 1 : Number(h[2]);
        newLeft = h[4] === undefined ? 1 : Number(h[4]);
        cur.lines.push({ kind: "hunk", text: line, oldNo: null, newNo: null });
      }
    }
  }
  return files;
}

export const diffTotals = (files: UDiffFile[]) => ({ files: files.length, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0) });

// ---------------------------------------------------------------- quota
export interface QuotaBar { label: string; pct: number | null; resetsAt: Date | null; status: string | null }

/** The two subscription windows Claude Code reports. A missing number stays missing: nothing is invented. */
export function quotaBars(q: Quota | null | undefined): QuotaBar[] {
  if (!q) return [];
  const bar = (label: string, w?: Quota["five_hour"]): QuotaBar | null => w ? {
    label, status: w.status ?? null,
    pct: typeof w.utilization === "number" ? Math.max(0, Math.min(100, Math.round(w.utilization * 100))) : null,
    resetsAt: typeof w.resets_at === "number" ? new Date(w.resets_at * 1000) : null,
  } : null;
  return [bar("5-hour window", q.five_hour), bar("7-day window", q.seven_day)].filter((b): b is QuotaBar => b !== null);
}

// ---------------------------------------------------------------- verification command
/** One argument per line, as a person edits it. No shell is involved: the lines are the argument list. */
export const commandToArgv = (text: string): string[] => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
export const argvToText = (argv: string[] | null | undefined): string => (argv ?? []).join("\n");
export const showCommand = (argv: string[]): string => argv.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");

// ---------------------------------------------------------------- review findings
export const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
export const sevTone = (s: string): "failed" | "pending" | "running" => (s === "high" ? "failed" : s === "medium" ? "pending" : "running");
export const sortFindings = (fs: Finding[]): Finding[] => [...fs].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));

export const locationText = (f: Pick<Finding, "file" | "line" | "grounded">): string => {
  if (!f.file) return "no location given";
  const where = f.line ? `${f.file}:${f.line}` : f.file;
  return f.grounded === false ? `${where} (AIOS could not find this location)` : `${where} (location confirmed)`;
};

const MAX_PROMPT = 18000;
/** The owner's next request, built from review findings they chose to act on. The findings are quoted
 *  from the reviewer; the request asks only for those fixes. */
export function findingsPrompt(findings: Finding[], revision: string | null): string {
  const head = `Please fix these review findings${revision ? ` (reviewed revision ${revision.slice(0, 12)})` : ""}. ` +
    "They are quoted from an independent reviewer: treat them as a to-do list, make the smallest changes that fix " +
    "them, and do not modify tests unless a finding says a test is wrong.\n";
  const body = sortFindings(findings).map((f, i) => {
    const parts = [`${i + 1}. [${f.severity.toUpperCase()}] ${f.title}${f.file ? ` (${f.line ? `${f.file}:${f.line}` : f.file})` : ""}`];
    if (f.detail) parts.push(`   ${f.detail}`);
    if (f.suggestion) parts.push(`   Suggested: ${f.suggestion}`);
    return parts.join("\n");
  }).join("\n\n");
  const text = `${head}\n${body}`;
  return text.length > MAX_PROMPT ? text.slice(0, MAX_PROMPT - 20) + "\n[list truncated]" : text;
}

// ---------------------------------------------------------------- misc
export const shortRev = (r: string | null | undefined) => (r ? r.slice(0, 12) : "—");
export const ACTIVE_RUN_STATES = new Set(["queued", "running", "awaiting_approval", "blocked", "interrupted"]);
export const MODEL_CHOICES: [string, string][] = [
  ["", "Account default"], ["sonnet", "Sonnet (lighter on your limits)"], ["opus", "Opus (strongest, uses more of your limits)"], ["haiku", "Haiku (fastest, simplest tasks)"],
];
