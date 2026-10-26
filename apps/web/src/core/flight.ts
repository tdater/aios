// Flight Recorder: turns the saved stream-json transcript of a run into frames to replay. Shapes were observed on
// Claude Code 2.1.310: system/init, assistant blocks (text, thinking, tool_use), user tool_result blocks,
// rate_limit_event, and a final result that lists permission_denials. Everything shown is something the run did;
// private reasoning ("thinking") is never replayed.
export type FrameKind = "start" | "read" | "list" | "search" | "edit" | "write" | "say" | "schema" | "tool_error" | "refused" | "unexpected" | "other" | "finish";
export interface Frame { i: number; kind: FrameKind; label: string; path?: string }
export interface FileTrack { path: string; events: { i: number; action: "read" | "edit" | "write" }[] }
export interface Flight { frames: Frame[]; files: FileTrack[]; skipped: number; truncated: boolean; model?: string }
export type FileState = { state: "idle" | "read" | "edited" | "written"; flash: boolean };

export const DEFAULT_ALLOWED = ["Read", "Glob", "Grep", "Edit", "Write", "StructuredOutput"];
const MAX_FRAMES = 2000;

const clip = (s: unknown, n = 240) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
/** Show paths relative to the folder Claude worked in, so a replay never leaks where on your disk it lives. */
export function relPath(p: string, cwd?: string): string {
  const n = String(p).replace(/\\/g, "/");
  const c = (cwd ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  return c && n.toLowerCase().startsWith(c.toLowerCase() + "/") ? n.slice(c.length + 1) : n;
}

export function parseTranscript(text: string, allowed: string[] = DEFAULT_ALLOWED): Flight {
  const frames: Frame[] = [];
  const tracks = new Map<string, FileTrack>();
  let skipped = 0, cwd: string | undefined, model: string | undefined, truncated = false;
  const push = (kind: FrameKind, label: string, path?: string) => {
    if (frames.length >= MAX_FRAMES) { truncated = true; return; }
    const i = frames.length;
    frames.push({ i, kind, label, path });
    if (path && (kind === "read" || kind === "edit" || kind === "write")) {
      const t = tracks.get(path) ?? { path, events: [] };
      t.events.push({ i, action: kind });
      tracks.set(path, t);
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(line); } catch { skipped++; continue; }
    if (!ev || typeof ev !== "object") { skipped++; continue; }
    const type = ev.type;
    if (type === "system" && ev.subtype === "init") {
      cwd = typeof ev.cwd === "string" ? ev.cwd : undefined;
      model = typeof ev.model === "string" ? ev.model : undefined;
      push("start", `Session started${model ? ` (${model})` : ""}`);
    } else if (type === "assistant") {
      const content = (ev.message as { content?: unknown } | undefined)?.content;
      for (const b of Array.isArray(content) ? content : []) {
        if (!b || typeof b !== "object") continue;
        const blk = b as { type?: string; text?: string; name?: string; input?: Record<string, unknown> };
        if (blk.type === "text" && blk.text?.trim()) push("say", clip(blk.text));
        else if (blk.type === "tool_use") {
          const name = String(blk.name ?? "?"), inp = blk.input ?? {};
          const path = typeof inp.file_path === "string" ? relPath(inp.file_path, cwd) : undefined;
          if (!allowed.includes(name)) push("unexpected", `Used a tool that was not allowed: ${name}`);
          else if (name === "Read") push("read", `Reading ${path ?? "a file"}`, path);
          else if (name === "Edit") push("edit", `Editing ${path ?? "a file"}`, path);
          else if (name === "Write") push("write", `Writing ${path ?? "a file"}`, path);
          else if (name === "Glob") push("list", `Listing files matching ${clip(inp.pattern, 80)}`);
          else if (name === "Grep") push("search", `Searching for ${clip(inp.pattern, 80)}`);
          else if (name === "StructuredOutput") push("schema", "Reporting its findings");
          else push("other", `Used tool ${name}`);
        }                                                          // "thinking" blocks are deliberately skipped
      }
    } else if (type === "user") {
      const content = (ev.message as { content?: unknown } | undefined)?.content;
      for (const b of Array.isArray(content) ? content : []) {
        const blk = b as { type?: string; is_error?: boolean; content?: unknown };
        if (blk?.type === "tool_result" && blk.is_error) {
          const c = Array.isArray(blk.content) ? blk.content.map((x) => (x as { text?: string })?.text ?? "").join(" ") : blk.content;
          push("tool_error", `A tool call failed: ${clip(c, 160)}`);
        }
      }
    } else if (type === "result") {
      const denials = Array.isArray(ev.permission_denials) ? (ev.permission_denials as { tool_name?: string; tool_input?: { file_path?: string } }[]) : [];
      for (const d of denials) {
        const p = typeof d?.tool_input?.file_path === "string" ? relPath(d.tool_input.file_path, cwd) : "";
        push("refused", `Refused: ${d?.tool_name ?? "a request"}${p ? ` on ${p}` : ""}`);
      }
      push("finish", `Finished: ${String(ev.subtype ?? "done")}${typeof ev.num_turns === "number" ? ` after ${ev.num_turns} turn(s)` : ""}`);
    } else if (type !== "rate_limit_event" && type !== "system") skipped++;
  }
  return { frames, files: [...tracks.values()], skipped, truncated, model };
}

/** How a file looks at frame k: idle until touched, then read, edited or written; `flash` only on the frame that did it. */
export function fileStateAt(t: FileTrack, k: number): FileState {
  let last: FileTrack["events"][number] | undefined;
  for (const e of t.events) if (e.i <= k) last = e;
  if (!last) return { state: "idle", flash: false };
  const wrote = t.events.some((e) => e.i <= k && e.action !== "read");
  return { state: last.action === "read" && !wrote ? "read" : wrote ? (t.events.some((e) => e.i <= k && e.action === "write") ? "written" : "edited") : "read", flash: last.i === k };
}
