/** Obsidian-style search operators for the Knowledge screen:  tag:#x  type:lesson  scope:project  status:approved  "exact phrase" */
export interface ParsedQuery {
  text: string;                       // free text sent to full-text search
  tag?: string;
  type?: string;
  scope?: string;
  status?: string;
  phrases: string[];
  unknown: string[];                  // operators we did not recognise (shown to the user, never silently dropped)
}

const TYPES = ["preference", "fact", "decision", "lesson", "procedure"];
const SCOPES = ["global", "project"];
const STATUSES = ["candidate", "approved", "superseded", "rejected"];

export function parseQuery(input: string): ParsedQuery {
  const out: ParsedQuery = { text: "", phrases: [], unknown: [] };
  const free: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    if (m[1] !== undefined) { out.phrases.push(m[1]); free.push(m[1]); continue; }
    const tok = m[2];
    const op = /^(tag|type|scope|status|path):(.*)$/i.exec(tok);
    if (!op) {
      if (tok.startsWith("#") && tok.length > 1) out.tag = tok.slice(1).toLowerCase();     // bare #tag is a tag filter, as in Obsidian
      else free.push(tok);
      continue;
    }
    const key = op[1].toLowerCase();
    const val = op[2].replace(/^#/, "").toLowerCase();
    if (!val) { free.push(tok); continue; }
    if (key === "tag") out.tag = val;
    else if (key === "type" && TYPES.includes(val)) out.type = val;
    else if (key === "scope" && SCOPES.includes(val)) out.scope = val;
    else if (key === "status" && STATUSES.includes(val)) out.status = val;
    else out.unknown.push(tok);
  }
  out.text = free.join(" ").trim();
  return out;
}

/** Replace (or remove, with null) the tag filter inside a query string, keeping everything else the user typed. */
export function setTagFilter(query: string, tag: string | null): string {
  const kept = (query.match(/"[^"]*"|\S+/g) ?? []).filter((tok) => !/^(tag:)?#?[\w/-]+$/i.test(tok) || (!/^tag:/i.test(tok) && !tok.startsWith("#")));
  return [...kept, ...(tag ? [`#${tag}`] : [])].join(" ").trim();
}

/** Canonical string for a parsed query (used for the filter chips). */
export function describeFilters(p: ParsedQuery): { key: string; value: string }[] {
  return (["tag", "type", "scope", "status"] as const).filter((k) => p[k]).map((k) => ({ key: k, value: p[k]! }));
}
