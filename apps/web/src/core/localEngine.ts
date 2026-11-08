import { AiosClient, ApiError, ReqOpts, newKey } from "./client";
import { LOCAL_CATALOG } from "./localCatalog.generated";
import { KV, LocalKV } from "./storage";
import { API_VERSION } from "./types";

/** The standalone phone app: the same API contract the server speaks, answered on this device from local storage. There is no server, no
 *  Claude and no network in here. Anything that needs the PC answers 409 `needs_pc` with a plain explanation, never a fake result. */

export const STANDALONE_URL = "standalone:";
const P = "aios.local.";
const MAX_WIDGETS = 24;
const KINDS = ["counter", "checklist", "note", "habit", "timer", "facts", "mission"] as const;

type Json = Record<string, unknown>;
interface Note { id: string; title: string; body: string; type: string; status: string; scope: string; confidence: number; version: number; tags: string[]; project_id: string | null; created_at: string; last_reviewed_at: string | null }
interface Wdg { id: string; kind: string; title: string; config: Json; created_at: string }
interface Receipt { id: string; ts: string; actor: string; kind: string; summary: string; changed: number }
export interface Reply { status: number; data: unknown }

const ok = (data: unknown, status = 200): Reply => ({ status, data });
const fail = (status: number, code: string, message: string, details: Json = {}): never => { throw new ApiError(status, code, message, details); };
const needsPc = (what: string): never => fail(409, "needs_pc", `${what} needs AIOS running on your PC. Connect to it in Settings, under "Connect to my PC".`);
const text = (v: unknown, max: number, what: string, empty = false): string => {
  if (typeof v !== "string") return fail(422, "bad_widget", `${what} must be text`);
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  if ((!t && !empty) || t.length > max) return fail(422, "bad_widget", `${what} must be ${empty ? "up to" : "1 to"} ${max} characters`);
  return t;
};
const whole = (v: unknown, lo: number, hi: number, what: string): number => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : fail(422, "bad_widget", `${what} must be a whole number from ${lo} to ${hi}`));
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const list = (v: unknown, max: number, what: string): unknown[] => (Array.isArray(v) && v.length <= max ? v : fail(422, "bad_widget", `${what} holds up to ${max} entries`));

/** The same rules as the server's widgets.validate for the kinds the phone supports. Unknown settings are refused, not ignored. */
export function validateWidget(kind: string, title: unknown, config: unknown): { title: string; config: Json } {
  if (!(KINDS as readonly string[]).includes(kind)) return fail(422, "bad_widget", kind === "routine" ? "Routines need Claude on your PC." : `kind must be one of ${KINDS.join(", ")}`);
  if (typeof config !== "object" || config === null || Array.isArray(config)) return fail(422, "bad_widget", "settings must be an object");
  const c = config as Json, t = text(title, 60, "title");
  const allowed: Record<string, string[]> = { counter: ["value", "step"], checklist: ["items"], note: ["text"], habit: ["days", "per_week"], timer: ["focus", "rest", "sessions"], facts: ["items"], mission: ["target", "steps", "note"] };
  const extra = Object.keys(c).filter((k) => !allowed[kind].includes(k));
  if (extra.length) return fail(422, "bad_widget", `unknown setting(s): ${extra.sort().join(", ")}`);
  switch (kind) {
    case "counter": return { title: t, config: { value: whole(c.value ?? 0, -1_000_000, 1_000_000, "value"), step: whole(c.step ?? 1, 1, 1000, "step") } };
    case "note": return { title: t, config: { text: text(c.text ?? "", 500, "text", true) } };
    case "habit": {
      const days = list(c.days ?? [], 400, "days");
      if (!days.every(isDate)) return fail(422, "bad_widget", "days must be a list of dates like 2026-10-26");
      return { title: t, config: { days: [...new Set(days as string[])].sort().slice(-400), per_week: whole(c.per_week ?? 7, 1, 7, "days per week") } };
    }
    case "timer": return { title: t, config: { focus: whole(c.focus ?? 25, 1, 180, "focus minutes"), rest: whole(c.rest ?? 5, 0, 60, "rest minutes"), sessions: whole(c.sessions ?? 0, 0, 99999, "sessions") } };
    case "facts": {
      const items = list(c.items ?? [], 60, "a household vault").map((f) => {
        const o = f as Json;
        if (typeof f !== "object" || !f || Object.keys(o).sort().join() !== "label,value") return fail(422, "bad_widget", "each fact is {label, value}");
        return { label: text(o.label, 60, "label"), value: text(o.value, 200, "value") };
      });
      return { title: t, config: { items } };
    }
    case "mission": {
      const target = c.target ?? "";
      if (target !== "" && !isDate(target)) return fail(422, "bad_widget", "target must be a date like 2026-12-31, or empty");
      const steps = list(c.steps ?? [], 30, "a mission").map((s) => {
        const o = s as Json;
        if (typeof s !== "object" || !s || Object.keys(o).some((k) => k !== "text" && k !== "done")) return fail(422, "bad_widget", "each step is {text, done}");
        return { text: text(o.text, 120, "step text"), done: Boolean(o.done) };
      });
      return { title: t, config: { target, steps, note: text(c.note ?? "", 500, "note", true) } };
    }
    default: {
      const items = list(c.items ?? [], 20, "a checklist").map((i) => {
        const o = i as Json;
        if (typeof i !== "object" || !i || Object.keys(o).some((k) => k !== "text" && k !== "done")) return fail(422, "bad_widget", "each item is {text, done}");
        return { text: text(o.text, 120, "item text"), done: Boolean(o.done) };
      });
      return { title: t, config: { items } };
    }
  }
}

const noteId = () => `mem_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
const wdgId = () => `wdg_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
const tagsIn = (body: string): string[] => [...new Set([...body.matchAll(/(?:^|\s)#([A-Za-z][\w/-]{1,40})/g)].map((m) => m[1].toLowerCase()))];
const linksIn = (body: string): string[] => [...new Set([...body.matchAll(/\[\[([^\]\n]{1,200})\]\]/g)].map((m) => m[1].trim()))];

export class LocalEngine {
  constructor(private kv: KV = new LocalKV(), private now: () => Date = () => new Date()) { this.seed(); }

  private read<T>(key: string, fallback: T): T { try { const raw = this.kv.get(P + key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; } }
  private write(key: string, value: unknown) { this.kv.set(P + key, JSON.stringify(value)); }
  private iso() { return this.now().toISOString(); }

  private seed() {
    if (this.kv.get(`${P}seeded`)) return;
    const t = this.iso();
    const welcome: Note = { id: noteId(), title: "Welcome to AIOS on your phone", type: "fact", status: "approved", scope: "global", confidence: 1, version: 1, project_id: null, created_at: t, last_reviewed_at: null,
      tags: ["welcome"], body: "# Welcome to AIOS on your phone\n\nThis is your own copy of AIOS, running only on this phone. Nothing leaves it.\n\n- **My Day** holds small panels: checklists, habits, missions, a household vault.\n- **Knowledge** holds your notes. Link notes with [[Note title]] and tag them with #tags.\n- To use Claude, the reviewer and the rest, connect to AIOS on your PC in Settings.\n" };
    this.write("notes", [welcome]);
    const top = LOCAL_CATALOG.items.find((i) => i.id === "top3")!;
    this.write("widgets", [{ id: wdgId(), kind: top.kind, title: top.title, config: JSON.parse(JSON.stringify(top.config)), created_at: t }]);
    this.write("receipts", []);
    this.kv.set(`${P}seeded`, "1");
  }

  private notes() { return this.read<Note[]>("notes", []); }
  private widgets() { return this.read<Wdg[]>("widgets", []); }
  private receipt(kind: string, summary: string) {
    const r: Receipt = { id: newKey(), ts: this.iso(), actor: "you", kind, summary, changed: 1 };
    this.write("receipts", [r, ...this.read<Receipt[]>("receipts", [])].slice(0, 50));
  }

  private row(n: Note) { const { body: _b, ...rest } = n; void _b; return rest; }
  private full(n: Note) { return { ...n, explicit_tags: n.tags, basis: "observation", sensitivity: "private", evidence: [] }; }

  /** Answers one request the way the server would. Throws ApiError for refusals. */
  handle(method: string, path: string, o: { query?: ReqOpts["query"]; body?: unknown } = {}): Reply {
    const q = o.query ?? {};
    const body = (o.body ?? {}) as Json;
    let m: RegExpMatchArray | null;

    if (method === "GET" && path === "/meta") return ok({ api_version: API_VERSION, min_client_api: 1, server_version: "standalone", server_id: this.read("id", "") || this.makeId(), time: this.iso(), auth: { required: false }, capabilities: { standalone: true } });
    if (method === "GET" && path === "/health") return ok({ status: "ok", db: "this phone", schema: [0], run_counts: {}, backup_status: "Kept on this phone only" });
    if (method === "GET" && path === "/providers") return ok({ items: [] });
    if (method === "GET" && path === "/auth/me") return ok({ device: "This phone", kind: "local", created_at: this.iso() });
    if (method === "POST" && path === "/auth/logout") return ok({});
    if (method === "GET" && path === "/home") return ok({ server_time: this.iso(), counts: { active_runs: 0, blocked_runs: 0, pending_approvals: 0, pending_candidates: 0 }, current_runs: [], blocked_runs: [], providers: [] });
    if (method === "GET" && ["/approvals", "/runs", "/candidates", "/projects", "/conversations"].includes(path)) return ok({ items: [], next_cursor: null, limit: 20 });

    // ---- universe
    if (method === "GET" && path === "/universe") {
      const notes = this.notes().filter((n) => n.status === "approved");
      const stars = notes.map((n) => ({ id: n.id, title: n.title, type: n.type, scope: "global", project_id: null, project: null, state: "fresh", uses: 0, verified_uses: 0, hollow: false, last_used: null, last_verified: null, brightness: 0.6 }));
      return ok({ you: { approved: notes.length, suggested: 0, learning: false }, ais: [], stars, links: [], clusters: ["Everywhere"], totals: { stars: stars.length, verified: 0, hollow: 0, stale: 0 }, comets: { approvals: 0, blocked: 0, to_review: 0 }, paused: false });
    }
    if (method === "GET" && path === "/universe/objects") return ok({ items: this.objects(), version: 1 });
    if (method === "GET" && (m = path.match(/^\/universe\/objects\/(.+?)\/card$/))) {
      const obj = this.objects().find((x) => x.id === decodeURIComponent(m![1]));
      if (!obj) return fail(404, "not_found", "No such object.");
      const links = obj.id === "wormhole:pc" ? [{ label: "Connect to my PC", to: { tab: "settings" } }] : obj.id.startsWith("probe:") ? [{ label: "Open My Day" }] : [];
      return ok({ object: obj, explain: obj.job, panels: { basics: [], more: [], expert: [] }, links });
    }

    // ---- abilities and receipts (the owner is the one holding the phone, so small panels are simply on)
    if (method === "PUT" && /^\/universe\/objects\/.+\/config$/.test(path)) return needsPc("Changing that setting");
    if (method === "GET" && path === "/abilities") return ok(this.abilities());
    if (method === "PUT" && path.startsWith("/abilities/")) return ok(this.abilities());
    if (method === "GET" && path === "/receipts") return ok({ items: this.read<Receipt[]>("receipts", []) });

    // ---- My Day panels
    if (method === "GET" && path === "/widgets") return ok({ items: this.widgets() });
    if (method === "GET" && path === "/widgets/catalog") return ok(LOCAL_CATALOG);
    if (method === "POST" && path === "/widgets/preview") { const v = validateWidget(String(body.kind), body.title, body.config); return ok({ kind: body.kind, ...v }); }
    if (method === "POST" && (path === "/widgets" || path === "/widgets/from-catalog")) {
      let kind = String(body.kind), title = body.title, config = body.config;
      if (path === "/widgets/from-catalog") {
        const t = LOCAL_CATALOG.items.find((i) => i.id === body.template);
        if (!t) return fail(404, "no_such_template", "That panel is not in the catalog.");
        kind = t.kind; title = body.title ?? t.title; config = { ...JSON.parse(JSON.stringify(t.config)), ...((body.config as Json) ?? {}) };
      }
      const v = validateWidget(kind, title, config);
      if (this.widgets().length >= MAX_WIDGETS) return fail(409, "too_many_widgets", `up to ${MAX_WIDGETS} panels`);
      const w: Wdg = { id: wdgId(), kind, title: v.title, config: v.config, created_at: this.iso() };
      this.write("widgets", [...this.widgets(), w]);
      this.receipt("widget.created", `Added a ${kind} panel called "${v.title}" to Today.`);
      return ok(w, 201);
    }
    if (method === "POST" && /^\/widgets\/[^/]+\/run$/.test(path)) return needsPc("Running a routine");
    if ((m = path.match(/^\/widgets\/([^/]+)$/)) && (method === "PUT" || method === "DELETE")) {
      const all = this.widgets(), w = all.find((x) => x.id === m![1]);
      if (!w) return fail(404, "not_found", "No such panel.");
      if (method === "DELETE") { this.write("widgets", all.filter((x) => x.id !== w.id)); this.receipt("widget.deleted", `Removed the panel "${w.title}".`); return ok({}, 204); }
      const v = validateWidget(w.kind, body.title ?? w.title, body.config);
      const next = { ...w, title: v.title, config: v.config };
      this.write("widgets", all.map((x) => (x.id === w.id ? next : x)));
      return ok(next);
    }

    // ---- notes (the Knowledge vault)
    if (method === "GET" && path === "/memories") {
      let rows = this.notes();
      if (q.status) rows = rows.filter((n) => n.status === q.status);
      if (q.type) rows = rows.filter((n) => n.type === q.type);
      if (q.tag) rows = rows.filter((n) => n.tags.some((t) => t === q.tag || t.startsWith(`${q.tag}/`)));
      if (q.q) { const needle = String(q.q).toLowerCase(); rows = rows.filter((n) => `${n.title} ${n.body}`.toLowerCase().includes(needle)); }
      return ok({ items: rows.map((n) => ({ ...this.row(n), ...(q.q ? { excerpt: n.body.replace(/\s+/g, " ").slice(0, 160) } : {}) })), next_cursor: null, limit: Number(q.limit ?? 200) });
    }
    if (method === "GET" && path === "/memories/tags") {
      const counts = new Map<string, number>();
      for (const n of this.notes()) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
      return ok({ items: [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)) });
    }
    if (method === "POST" && path === "/memories") {
      const title = text(body.title, 200, "title"), b = typeof body.body === "string" ? body.body.slice(0, 40_000) : `# ${title}\n`;
      const t = this.iso();
      const n: Note = { id: noteId(), title, body: b, type: typeof body.type === "string" ? body.type : "fact", status: "approved", scope: "global", confidence: 1, version: 1, project_id: null, created_at: t, last_reviewed_at: null,
        tags: [...new Set([...(Array.isArray(body.tags) ? body.tags.map(String) : []), ...tagsIn(b)])] };
      this.write("notes", [n, ...this.notes()]);
      this.receipt("memory.created", `Saved the note "${title}".`);
      return ok(this.full(n), 201);
    }
    if ((m = path.match(/^\/memories\/([^/]+)(\/links)?$/))) {
      const all = this.notes(), n = all.find((x) => x.id === m![1]);
      if (!n) return fail(404, "not_found", "No such note.");
      if (m[2] && method === "GET") return ok(this.links(n, all));
      if (method === "GET") return ok(this.full(n));
      if (method === "DELETE") { this.write("notes", all.filter((x) => x.id !== n.id)); this.receipt("memory.forgotten", `Forgot the note "${n.title}".`); return ok({}, 204); }
      if (method === "PUT" || method === "PATCH") {
        if (body.expected_version !== undefined && body.expected_version !== n.version) return fail(409, "version_conflict", "This note changed since you opened it. Nothing was saved.", { current_version: n.version });
        const b = typeof body.body === "string" ? body.body.slice(0, 40_000) : n.body;
        const next: Note = { ...n, title: body.title !== undefined ? text(body.title, 200, "title") : n.title, body: b, version: n.version + 1,
          tags: Array.isArray(body.tags) ? body.tags.map(String) : [...new Set([...n.tags, ...tagsIn(b)])] };
        this.write("notes", all.map((x) => (x.id === n.id ? next : x)));
        return ok(this.full(next));
      }
    }
    if (method === "GET" && path === "/graph") {
      const all = this.notes(), byTitle = new Map(all.map((n) => [n.title.toLowerCase(), n]));
      const edges = all.flatMap((n) => linksIn(n.body).flatMap((t) => { const to = byTitle.get(t.toLowerCase()); return to ? [{ source: n.id, target: to.id, kind: "link" }] : []; }));
      const degree = new Map<string, number>();
      for (const e of edges) { degree.set(e.source, (degree.get(e.source) ?? 0) + 1); degree.set(e.target, (degree.get(e.target) ?? 0) + 1); }
      return ok({ nodes: all.map((n) => ({ id: n.id, kind: "memory", label: n.title, degree: degree.get(n.id) ?? 0, type: n.type, status: n.status, scope: n.scope, project_id: null, created_at: n.created_at })), edges, truncated: false });
    }

    // ---- what only the PC can do
    if (path.startsWith("/assist") || path.startsWith("/companion") || path.startsWith("/rover") || path.startsWith("/system-scan") || path.startsWith("/home/")) return needsPc("That");
    return needsPc("That");
  }

  private makeId(): string { const id = `local_${newKey().slice(0, 12)}`; this.write("id", id); return id; }

  private abilities() {
    return { paused: false, planned: [], abilities: [{ name: "widgets", title: "Small panels on Today", can_see: ["What you type into a panel"], can_do: ["Show and change your panels"], cannot: ["Send anything off this phone"], enabled: true }] };
  }

  private objects() {
    const notes = this.notes().length;
    const sun = { id: "sun", type: "sun", region: "sun", name: "You", job: "Your phone's own AIOS. Everything here stays on this device.", state: { tone: "ok", text: `${notes} note${notes === 1 ? "" : "s"} kept` } };
    const pc = { id: "wormhole:pc", type: "wormhole", region: "fleet", name: "Connect to my PC", job: "Use Claude, the reviewer and your projects by connecting to AIOS on your PC.", state: { tone: "info", text: "Not connected" } };
    const probes = this.widgets().map((w) => ({ id: `probe:${w.id}`, type: "probe", region: "yards", name: w.title, job: `A ${w.kind} panel on your Today screen.`, state: { tone: "ok", text: "On this phone" } }));
    return [sun, pc, ...probes];
  }

  private links(n: Note, all: Note[]) {
    const byTitle = new Map(all.map((x) => [x.title.toLowerCase(), x]));
    const outgoing = linksIn(n.body).flatMap((t) => { const to = byTitle.get(t.toLowerCase()); return to ? [{ target: t, id: to.id, title: to.title }] : []; });
    const unresolved = linksIn(n.body).filter((t) => !byTitle.has(t.toLowerCase()));
    const backlinks = all.filter((x) => x.id !== n.id && linksIn(x.body).some((t) => t.toLowerCase() === n.title.toLowerCase())).map((x) => ({ id: x.id, title: x.title, excerpt: x.body.replace(/\s+/g, " ").slice(0, 120) }));
    return { id: n.id, outgoing, backlinks, unresolved, unlinked_mentions: [] };
  }
}

/** An AiosClient that answers from this device. Everything that uses a client (screens, the connection monitor) works unchanged. */
export class LocalClient extends AiosClient {
  constructor(public engine: LocalEngine = new LocalEngine()) { super(STANDALONE_URL, null); }
  async request<T>(method: string, path: string, o: ReqOpts = {}): Promise<{ data: T; status: number; headers: Headers }> {
    const r = this.engine.handle(method, path, { query: o.query, body: o.body });
    return { data: r.data as T, status: r.status, headers: new Headers() };
  }
}
