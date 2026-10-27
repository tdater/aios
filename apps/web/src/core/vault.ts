import { AiosClient } from "./client";
import { Memory, Paged } from "./types";

export type NoteRow = Pick<Memory, "id" | "title" | "type" | "status" | "scope" | "confidence" | "version"> & { tags: string[]; project_id?: string | null; created_at?: string; last_reviewed_at?: string | null };
export type GroupBy = "type" | "project" | "status";

export const TYPE_LABEL: Record<string, string> = { preference: "Preferences", fact: "Facts", decision: "Decisions", lesson: "Lessons", procedure: "Procedures" };
const TYPE_ORDER = ["preference", "fact", "decision", "lesson", "procedure"];
const STATUS_ORDER = ["approved", "candidate", "superseded", "rejected"];

/** Load every note row (bounded: a personal vault, 1000 notes max here). */
export async function fetchAllNotes(client: AiosClient, status?: string): Promise<NoteRow[]> {
  const out: NoteRow[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const r = await client.get<Paged<NoteRow>>("/memories", { query: { limit: 200, cursor, status } });
    out.push(...r.items);
    if (!r.next_cursor) break;
    cursor = r.next_cursor;
  }
  return out;
}

export interface Folder { key: string; label: string; notes: NoteRow[] }
const byTitle = (a: NoteRow, b: NoteRow) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

export function buildTree(notes: NoteRow[], group: GroupBy, projectName: (id: string | null | undefined) => string = () => "Unassigned"): Folder[] {
  const map = new Map<string, Folder>();
  const add = (key: string, label: string, n: NoteRow) => { const f = map.get(key) ?? { key, label, notes: [] }; f.notes.push(n); map.set(key, f); };
  for (const n of notes) {
    if (group === "type") add(n.type, TYPE_LABEL[n.type] ?? n.type, n);
    else if (group === "status") add(n.status, n.status[0].toUpperCase() + n.status.slice(1), n);
    else add(n.project_id ?? "-", n.project_id ? projectName(n.project_id) : n.scope === "global" ? "Global (no project)" : "Unassigned", n);
  }
  const rank = (f: Folder) => (group === "type" ? TYPE_ORDER.indexOf(f.key) : group === "status" ? STATUS_ORDER.indexOf(f.key) : 0);
  return [...map.values()].map((f) => ({ ...f, notes: f.notes.sort(byTitle) }))
    .sort((a, b) => (rank(a) - rank(b)) || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

export interface TagNode { name: string; full: string; count: number; children: TagNode[] }
/** "a/b" nests under "a" (Obsidian nested tags). A parent's count includes its children. */
export function buildTagTree(tags: { tag: string; count: number }[]): TagNode[] {
  const root: TagNode = { name: "", full: "", count: 0, children: [] };
  for (const { tag, count } of tags) {
    let node = root;
    const parts = tag.split("/").filter(Boolean);
    parts.forEach((part, i) => {
      let child = node.children.find((c) => c.name === part);
      if (!child) { child = { name: part, full: parts.slice(0, i + 1).join("/"), count: 0, children: [] }; node.children.push(child); }
      child.count += count;
      node = child;
    });
  }
  const sort = (n: TagNode) => { n.children.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)); n.children.forEach(sort); };
  sort(root);
  return root.children;
}

export type TitleIndex = Map<string, string>;
/** casefolded title → note id, plus each id → itself. The oldest note wins duplicate titles (as the server does). */
export function titleIndex(notes: NoteRow[]): TitleIndex {
  const idx: TitleIndex = new Map();
  const sorted = [...notes].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  for (const n of sorted) {
    if (!idx.has(n.title.toLocaleLowerCase())) idx.set(n.title.toLocaleLowerCase(), n.id);
    idx.set(n.id, n.id);
  }
  return idx;
}
export const resolveWiki = (target: string, idx: TitleIndex): string | null => idx.get(target) ?? idx.get(target.toLocaleLowerCase()) ?? null;

/** Client-side filter used while the full-text API is not needed (structured filters or empty text). */
export function filterNotes(notes: NoteRow[], f: { tag?: string; type?: string; scope?: string; status?: string }): NoteRow[] {
  return notes.filter((n) => (!f.tag || n.tags.some((t) => t === f.tag || t.startsWith(`${f.tag}/`))) && (!f.type || n.type === f.type) && (!f.scope || n.scope === f.scope) && (!f.status || n.status === f.status));
}

export interface CardFilter { id: string; label: string }

/** Filter chips for the card view: everything, each kind of note that exists, and the most used tags. */
export function cardFilters(notes: NoteRow[], maxTags = 6): CardFilter[] {
  const types = TYPE_ORDER.filter((t) => notes.some((n) => n.type === t)).map((t) => ({ id: `type:${t}`, label: TYPE_LABEL[t] ?? t }));
  const counts = new Map<string, number>();
  for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxTags).map(([t]) => ({ id: `tag:${t}`, label: `#${t}` }));
  return [{ id: "all", label: "All notes" }, ...types, ...tags];
}

export function applyCardFilter(notes: NoteRow[], filter: string): NoteRow[] {
  if (filter.startsWith("type:")) return notes.filter((n) => n.type === filter.slice(5));
  if (filter.startsWith("tag:")) return notes.filter((n) => n.tags.includes(filter.slice(4)));
  return notes;
}
