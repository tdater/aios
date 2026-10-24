/** Safe markdown → AST. No HTML is ever produced here: the renderer turns this AST into React text nodes, so note content can
 *  never inject markup. Unsafe link schemes are dropped; images become placeholders (a note must not make the app fetch anything). */
export type Inline =
  | { t: "text"; v: string } | { t: "code"; v: string } | { t: "br" }
  | { t: "strong" | "em" | "del" | "mark"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] } | { t: "blocked"; c: Inline[]; why: string }
  | { t: "wiki"; target: string; alias?: string; heading?: string }
  | { t: "tag"; tag: string } | { t: "img"; alt: string };

export interface Item { checked: boolean | null; blocks: Block[] }
export type Block =
  | { t: "h"; level: number; id: string; c: Inline[]; text: string }
  | { t: "p"; c: Inline[] } | { t: "hr" } | { t: "code"; lang: string; text: string }
  | { t: "quote"; blocks: Block[] }
  | { t: "callout"; kind: string; title: Inline[]; fold: "open" | "closed" | null; blocks: Block[] }
  | { t: "list"; ordered: boolean; start: number; tasks: boolean; items: Item[] }
  | { t: "table"; head: Inline[][]; align: ("left" | "center" | "right" | null)[]; rows: Inline[][][] };

const MAX = 200_000;
const CALLOUTS = new Set(["note", "info", "tip", "warning", "danger", "success", "question", "quote", "bug", "example", "abstract", "todo", "failure"]);
const CALLOUT_ALIAS: Record<string, string> = { abstract: "note", todo: "info", example: "note", failure: "danger", hint: "tip", important: "tip", caution: "warning", attention: "warning", error: "danger", faq: "question", help: "question", check: "success", done: "success", cite: "quote" };

/** Allow-list, not block-list: only absolute http(s) and mailto links. Everything else (javascript:, data:, vbscript:, file:,
 *  relative paths, scheme tricks with embedded control characters) is refused. */
export function isSafeUrl(u: string): boolean {
  const s = u.trim().replace(/[\u0000-\u001f\u007f\s]+/g, "");     // browsers ignore control chars/whitespace inside schemes
  return /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(s);
}

// ---------------------------------------------------------------- inline
const TAG = /^#([A-Za-z][\w/-]{0,39})/;
const HEXISH = /^[0-9a-fA-F]{3,8}$/;
const URL_RX = /^https?:\/\/[^\s<>\]\)"']+[^\s<>\]\)"'.,;:!?]/;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ t: "text", v: buf }); buf = ""; } };
  const isWordCh = (ch: string | undefined) => !!ch && /[A-Za-z0-9]/.test(ch);
  let i = 0;
  while (i < src.length) {
    const ch = src[i], rest = src.slice(i);
    if (ch === "\\" && i + 1 < src.length && /[\\`*_{}\[\]()#+\-.!~=|>]/.test(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
    if (ch === "\n") { flush(); out.push({ t: "br" }); i++; continue; }
    if (ch === "`") {
      const run = /^`+/.exec(rest)![0];
      const end = src.indexOf(run, i + run.length);
      if (end > i) { flush(); out.push({ t: "code", v: src.slice(i + run.length, end).replace(/^ (.*) $/s, "$1") }); i = end + run.length; continue; }
    }
    if (rest.startsWith("[[")) {
      const end = src.indexOf("]]", i + 2);
      if (end > 0 && !src.slice(i + 2, end).includes("\n") && end - i < 200) {
        const inner = src.slice(i + 2, end);
        const [left, alias] = inner.split("|", 2);
        const [target, heading] = left.split("#", 2);
        if (target.trim()) { flush(); out.push({ t: "wiki", target: target.trim(), alias: alias?.trim() || undefined, heading: heading?.trim() || undefined }); i = end + 2; continue; }
      }
    }
    if (rest.startsWith("![")) {
      const m = /^!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(rest);
      if (m) { flush(); out.push({ t: "img", alt: m[1] }); i += m[0].length; continue; }
    }
    if (ch === "[") {
      const m = /^\[((?:[^\[\]\\]|\\.)*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(rest);
      if (m) {
        flush();
        const c = parseInline(m[1]);
        out.push(isSafeUrl(m[2]) ? { t: "link", href: m[2].trim(), c } : { t: "blocked", c, why: "Link blocked: only http(s) and mailto links are allowed" });
        i += m[0].length;
        continue;
      }
    }
    const pair = (mark: string, kind: "strong" | "em" | "del" | "mark") => {
      if (!rest.startsWith(mark) || rest[mark.length] === " " || rest[mark.length] === undefined) return false;
      if ((mark === "__" || mark === "_") && isWordCh(src[i - 1])) return false;     // snake_case stays text
      let from = i + mark.length;
      for (let tries = 0; tries < 8; tries++) {                    // bounded: hostile input must not make parsing superlinear
        const end = src.indexOf(mark, from);
        if (end < 0 || end - i > 4000) return false;
        if (src[end - 1] === " " || end === i + mark.length || (mark.startsWith("_") && isWordCh(src[end + mark.length]))) { from = end + 1; continue; }
        flush();
        out.push({ t: kind, c: parseInline(src.slice(i + mark.length, end)) });
        i = end + mark.length;
        return true;
      }
      return false;
    };
    if (pair("**", "strong") || pair("__", "strong") || pair("~~", "del") || pair("==", "mark") || pair("*", "em") || pair("_", "em")) continue;
    if (ch === "#" && (i === 0 || /[\s(>]/.test(src[i - 1]))) {
      const m = TAG.exec(rest);
      if (m && !HEXISH.test(m[1])) { flush(); out.push({ t: "tag", tag: m[1].toLowerCase() }); i += m[0].length; continue; }
    }
    if (ch === "h" && (i === 0 || !isWordCh(src[i - 1]))) {
      const m = URL_RX.exec(rest);
      if (m && isSafeUrl(m[0])) { flush(); out.push({ t: "link", href: m[0], c: [{ t: "text", v: m[0] }] }); i += m[0].length; continue; }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

export const inlineText = (c: Inline[]): string => c.map((n) => (n.t === "text" || n.t === "code" ? n.v : n.t === "wiki" ? (n.alias ?? n.target) : n.t === "tag" ? `#${n.tag}` : n.t === "img" ? n.alt : n.t === "br" ? " " : "c" in n ? inlineText(n.c) : "")).join("");

// ---------------------------------------------------------------- blocks
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") { cur += "|"; i++; } else if (t[i] === "|") { cells.push(cur.trim()); cur = ""; } else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}
export function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "section";
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.slice(0, MAX).replace(/\r\n?/g, "\n").split("\n");
  const used = new Map<string, number>();
  const uniqueId = (text: string) => { const base = slug(text); const n = used.get(base) ?? 0; used.set(base, n + 1); return n ? `${base}-${n}` : base; };
  return parseBlocks(lines, uniqueId, 0);
}

function parseBlocks(lines: string[], uniqueId: (t: string) => string, depth: number): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  const para: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push({ t: "p", c: parseInline(para.join("\n").replace(/ {2,}\n/g, "\n")) }); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flushPara(); i++; continue; }
    const f = FENCE.exec(line);
    if (f) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(f[2][0].repeat(f[2].length)) && /^\s*(`{3,}|~{3,})\s*$/.test(lines[i]))) body.push(lines[i++].replace(new RegExp(`^ {0,${f[1].length}}`), ""));
      i++;                                                       // closing fence (or end of input)
      blocks.push({ t: "code", lang: f[3], text: body.join("\n") });
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { flushPara(); const c = parseInline(h[2]); const text = inlineText(c); blocks.push({ t: "h", level: h[1].length, id: uniqueId(text), c, text }); i++; continue; }
    if (HR.test(line) && !para.length) { blocks.push({ t: "hr" }); i++; continue; }
    if (HR.test(line) && para.length && /^\s{0,3}=+\s*$|^\s{0,3}-{3,}\s*$/.test(line)) { /* setext not supported: treat as hr */ flushPara(); blocks.push({ t: "hr" }); i++; continue; }
    if (/^\s{0,3}>/.test(line)) {
      flushPara();
      const q: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) q.push(lines[i++].replace(/^\s{0,3}> ?/, ""));
      const co = depth < 6 ? /^\[!([A-Za-z]+)\]([+-]?)[ \t]*(.*)$/.exec(q[0] ?? "") : null;
      if (co) {
        const raw = co[1].toLowerCase();
        const kind = CALLOUTS.has(raw) && !CALLOUT_ALIAS[raw] ? raw : CALLOUT_ALIAS[raw] ?? "note";
        const title = co[3].trim() ? parseInline(co[3].trim()) : [{ t: "text", v: raw.charAt(0).toUpperCase() + raw.slice(1) } as Inline];
        blocks.push({ t: "callout", kind, title, fold: co[2] === "-" ? "closed" : co[2] === "+" ? "open" : null, blocks: parseBlocks(q.slice(1), uniqueId, depth + 1) });
      } else blocks.push({ t: "quote", blocks: depth < 6 ? parseBlocks(q, uniqueId, depth + 1) : [{ t: "p", c: parseInline(q.join("\n")) }] });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      flushPara();
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null)) as ("left" | "center" | "right" | null)[];
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(splitRow(lines[i++]).map(parseInline));
      blocks.push({ t: "table", head: head.map(parseInline), align, rows });
      continue;
    }
    const li = LIST.exec(line);
    if (li && depth < 8) {
      flushPara();
      const res = parseList(lines, i, uniqueId, depth);
      blocks.push(res.block);
      i = res.next;
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}

function parseList(lines: string[], start: number, uniqueId: (t: string) => string, depth: number): { block: Block; next: number } {
  const first = LIST.exec(lines[start])!;
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: Item[] = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST.exec(lines[i]);
    if (!m || m[1].length !== baseIndent || /\d/.test(m[2]) !== ordered) break;
    const itemLines = [m[3]];
    i++;
    for (;;) {
      if (i >= lines.length) break;
      const ln = lines[i];
      if (!ln.trim()) {                                          // blank: continue only if the next non-blank line is indented deeper or a sibling
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && (/^\s+/.test(lines[j]) && (lines[j].match(/^\s*/)![0].length > baseIndent))) { itemLines.push(""); i++; continue; }
        break;
      }
      const ind = ln.match(/^\s*/)![0].length;
      if (ind > baseIndent) { itemLines.push(ln.slice(Math.min(ind, baseIndent + 2))); i++; continue; }
      break;
    }
    let text = itemLines[0];
    let checked: boolean | null = null;
    const t = /^\[([ xX])\]\s+(.*)$/.exec(text);
    if (t) { checked = t[1] !== " "; text = t[2]; }
    items.push({ checked, blocks: parseBlocks([text, ...itemLines.slice(1)], uniqueId, depth + 1) });
    while (i < lines.length && !lines[i].trim() && i + 1 < lines.length && LIST.test(lines[i + 1]) && LIST.exec(lines[i + 1])![1].length === baseIndent) i++;
  }
  const startNum = ordered ? parseInt(first[2], 10) || 1 : 1;
  return { block: { t: "list", ordered, start: startNum, tasks: items.some((x) => x.checked !== null), items }, next: i };
}

// ---------------------------------------------------------------- helpers used by the note view
export interface OutlineItem { level: number; id: string; text: string }
export function outline(blocks: Block[]): OutlineItem[] {
  const out: OutlineItem[] = [];
  const walk = (bs: Block[]) => bs.forEach((b) => {
    if (b.t === "h") out.push({ level: b.level, id: b.id, text: b.text });
    else if (b.t === "quote" || b.t === "callout") walk(b.blocks);
  });
  walk(blocks);
  return out;
}
export function countWords(src: string): number {
  return (src.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~=\[\]()|!-]+/g, " ").match(/[\p{L}\p{N}']+/gu) ?? []).length;
}
