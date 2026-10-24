import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../core/client";
import { outline as outlineOf, parseMarkdown, slug, countWords } from "../../core/markdown";
import { Memory, NoteLinks } from "../../core/types";
import { TYPE_LABEL } from "../../core/vault";
import { useApp } from "../../ui/Context";
import { go, useLoad, useViewport } from "../../ui/hooks";
import { useHotkeys } from "../../ui/hotkeys";
import { Icon } from "../../ui/icons";
import { Markdown } from "../../ui/Markdown";
import { Badge, Btn, Empty, ErrorBox, Loading, Notice, ago, fmtLocal, useOnce } from "../../ui/kit";
import { noteStats, toast, knowledgeQuery } from "../../ui/uiState";
import { useTabTitle } from "../../ui/useTabTitle";
import { Panels } from "./Panels";
import { WikiLink } from "./WikiLink";
import { pendingAnchor, useVault } from "./vaultContext";

type Mode = "read" | "edit" | "split";
interface Draft { title: string; body: string; tags: string[]; status: string; confidence: number; sensitivity: string; type?: string }
const STATUSES = ["candidate", "approved", "superseded", "rejected"];
const SENS = ["public", "private", "secret-adjacent"];

/** Unsaved edits survive navigating away and back within the session (memory only: note text is never written to browser storage). */
const unsaved = new Map<string, Draft>();
export const clearUnsavedDrafts = () => unsaved.clear();

const fromMemory = (m: Memory): Draft => ({ title: m.title, body: m.body ?? "", tags: m.explicit_tags ?? [], status: m.status, confidence: m.confidence, sensitivity: m.sensitivity ?? "private" });
const same = (a: Draft, b: Draft) => a.title === b.title && a.body === b.body && a.status === b.status && a.confidence === b.confidence && a.sensitivity === b.sensitivity && a.tags.join("|") === b.tags.join("|");

export function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "-");
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setText("");
  };
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {tags.map((t) => (
        <span key={t} className="tagchip">#{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", padding: 0, display: "grid", placeItems: "center" }}><Icon name="x" size={11} /></button></span>
      ))}
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="add tag" aria-label="Add a tag" style={{ minHeight: 28, width: 110, padding: "2px 8px", fontSize: ".85rem" }}
        onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} onBlur={add} />
    </span>
  );
}

export function NoteView({ id }: { id: string }) {
  const { client, connected } = useApp();
  const vault = useVault();
  const vp = useViewport();
  const mem = useLoad(() => client.get<Memory>(`/memories/${id}`), [client, id]);
  const links = useLoad(() => client.get<NoteLinks>(`/memories/${id}/links`), [client, id, mem.at?.getTime()]);
  const [mode, setMode] = useState<Mode>("read");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<{ code: string; msg: string } | null>(null);
  const [restored, setRestored] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const m = mem.data;
  useTabTitle(m?.title);

  // load → draft; restore unsaved edits from earlier in this session
  useEffect(() => {
    if (!m) return;
    const saved = unsaved.get(id);
    if (saved && !same(saved, fromMemory(m))) { setDraft(saved); setMode("edit"); setRestored(true); }
    else { setDraft(null); setMode("read"); setRestored(false); }
    setErr(null);
    setConfirmForget(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.id, id]);

  const base = m ? fromMemory(m) : null;
  const working = draft ?? base;
  const dirty = !!(draft && base && !same(draft, base));
  // draft === null means "not editing yet" (e.g. still loading), which must not wipe edits saved from earlier in the session
  useEffect(() => { if (!draft) return; if (dirty) unsaved.set(id, draft); else unsaved.delete(id); }, [dirty, draft, id]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const body = working?.body ?? "";
  const blocks = useMemo(() => parseMarkdown(body), [body]);
  const outline = useMemo(() => outlineOf(blocks), [blocks]);
  useEffect(() => {
    if (!m) return;
    noteStats.set({ words: countWords(body), links: links.data?.outgoing.length ?? 0 });
    return () => noteStats.set(null);
  }, [m, body, links.data]);

  // [[Note#Heading]] jumps
  useEffect(() => {
    const a = pendingAnchor.get();
    if (a && m) { setTimeout(() => document.getElementById(`md-${slug(a)}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); pendingAnchor.set(null); }
  }, [m]);

  const edit = (p: Partial<Draft>) => setDraft((d) => ({ ...(d ?? base!), ...p }));
  const startEdit = (next: Mode) => { if (!draft && base) setDraft(base); setMode(next); };
  const save = useOnce(async () => {
    if (!m || !draft || !base) return;
    setErr(null);
    const changes: Record<string, unknown> = {};
    if (draft.title !== base.title) changes.title = draft.title;
    if (draft.body !== base.body) changes.body = draft.body;
    if (draft.status !== base.status) changes.status = draft.status;
    if (draft.confidence !== base.confidence) changes.confidence = draft.confidence;
    if (draft.sensitivity !== base.sensitivity) changes.sensitivity = draft.sensitivity;
    if (draft.tags.join("|") !== base.tags.join("|")) changes.tags = draft.tags;
    try {
      await client.patch(`/memories/${id}`, { ...changes, expected_version: m.version });
      unsaved.delete(id);
      setDraft(null); setMode("read"); setRestored(false);
      await Promise.all([mem.reload(), vault.reload()]);
      toast("Saved");
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") setErr({ code: e.code, msg: "This note was changed somewhere else after you opened it. Your edits are still here and were NOT saved. Copy what you need, then reload the latest version." });
      else setErr({ code: e instanceof ApiError ? e.code : "error", msg: e instanceof Error ? e.message : String(e) });
    }
  });
  const discard = () => { unsaved.delete(id); setDraft(null); setMode("read"); setRestored(false); setErr(null); };
  const forget = useOnce(async () => {
    try { await client.post(`/memories/${id}/forget`); unsaved.delete(id); await vault.reload(); toast("Note forgotten"); go({ tab: "knowledge" }); }
    catch (e) { setErr({ code: "error", msg: e instanceof Error ? e.message : String(e) }); }
  });

  useHotkeys({
    e: () => { if (mode === "read") startEdit("edit"); else if (!dirty) { setDraft(null); setMode("read"); } },
    "mod+s": () => { if (mode !== "read" && dirty && connected) void save.run(); },
    escape: () => { if (mode !== "read" && !dirty) { setDraft(null); setMode("read"); } },
  });

  if (mem.error && !m) return <div className="notecol"><ErrorBox msg={mem.error} code={mem.errorCode} /><Btn kind="ghost" onClick={() => go({ tab: "knowledge" })}>← Back to the vault</Btn></div>;
  if (!m || !working) return <div className="notecol"><Loading what="Opening note" /></div>;

  const editing = mode !== "read";
  const wiki = (t: string, a?: string, h?: string) => <WikiLink target={t} alias={a} heading={h} />;
  const onTag = (t: string) => { knowledgeQuery.set(`#${t}`); go({ tab: "knowledge" }); };
  const panels = <Panels memory={m} links={links.data} loading={links.loading} outline={outline} onJump={(hid) => document.getElementById(`md-${hid}`)?.scrollIntoView({ behavior: "smooth", block: "start" })} />;
  const preview = <Markdown source={body} wiki={wiki} onTag={onTag} />;

  return (
    <>
      <div className="notecol" ref={scroller}>
        <div className="crumbs"><button className="link" style={{ textDecoration: "none", color: "inherit" }} onClick={() => go({ tab: "knowledge" })}>Knowledge</button><Icon name="chevronRight" size={12} />
          <span>{TYPE_LABEL[m.type]?.toLowerCase() ?? m.type}</span><Icon name="chevronRight" size={12} /><span>{working.title}</span></div>
        <div className="notehead">
          {editing ? <input className="titleinput" value={working.title} onChange={(e) => edit({ title: e.target.value })} aria-label="Title" maxLength={200} />
            : <h1 className="noteh1" style={{ flex: 1 }}>{m.title}</h1>}
          <Badge s={m.status === "approved" ? "approved" : m.status === "superseded" ? "superseded" : m.status === "rejected" ? "rejected" : "pending"} label={m.status} />
        </div>
        <div className="toolbar" role="toolbar" aria-label="Note actions">
          <button className={`iconbtn ${mode === "read" ? "on" : ""}`} aria-pressed={mode === "read"} title="Reading view" onClick={() => { if (!dirty) { setDraft(null); } setMode("read"); }}><Icon name="eye" /><span className="sr">Reading view</span></button>
          <button className={`iconbtn ${mode === "edit" ? "on" : ""}`} aria-pressed={mode === "edit"} title="Edit (E)" disabled={!connected} onClick={() => startEdit("edit")}><Icon name="edit" /><span className="sr">Edit</span></button>
          {vp.w >= 900 && <button className={`iconbtn ${mode === "split" ? "on" : ""}`} aria-pressed={mode === "split"} title="Edit with live preview" disabled={!connected} onClick={() => startEdit("split")}><Icon name="columns" /><span className="sr">Edit with live preview</span></button>}
          <span className="sep" />
          <button className="iconbtn" title="Copy [[link]]" onClick={() => { void navigator.clipboard?.writeText(`[[${m.title}]]`); toast("Link copied"); }}><Icon name="link" /><span className="sr">Copy link</span></button>
          <button className="iconbtn" title="Show in graph" onClick={() => go({ tab: "graph", id: m.id })}><Icon name="graph" /><span className="sr">Show in graph</span></button>
          <span style={{ flex: 1 }} />
          {editing && <>
            {dirty && <span className="muted small">Unsaved changes</span>}
            <Btn kind="ghost" onClick={discard}>{dirty ? "Discard" : "Done"}</Btn>
            <Btn busy={save.busy} disabled={!dirty || !connected} onClick={() => void save.run()}><Icon name="save" size={15} />Save</Btn>
          </>}
        </div>
        {!connected && editing && <Notice tone="warn">You are offline. Your edits stay on this page but cannot be saved until you reconnect.</Notice>}
        {restored && <Notice tone="info">Restored your unsaved edits from earlier in this session.</Notice>}
        {err && <Notice tone="bad"><strong>{err.code.replace(/_/g, " ")}:</strong> {err.msg}{err.code === "version_conflict" && <> <Btn kind="ghost" onClick={() => { discard(); void mem.reload(); }}>Discard mine and reload</Btn></>}</Notice>}

        <details className="card" key={editing ? "editing" : "reading"} open={editing} style={{ padding: "4px 12px" }}>
          <summary style={{ cursor: "pointer", minHeight: 32, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", color: "var(--muted)", fontSize: ".88rem" }}>
            <strong style={{ color: "var(--text)" }}>Properties</strong>
            <span>{TYPE_LABEL[m.type]?.replace(/s$/, "") ?? m.type}</span><span>·</span><span>{m.scope}</span><span>·</span><span>{Math.round(m.confidence * 100)}% confidence</span>
            {(m.tags ?? []).slice(0, 4).map((t) => <span key={t} className="tagchip" style={{ pointerEvents: "none" }}>#{t}</span>)}
          </summary>
          <dl className="props" style={{ border: 0, padding: "6px 0 2px", margin: 0, background: "none" }}>
            <dt><Icon name="file" size={14} />Type</dt><dd>{TYPE_LABEL[m.type] ?? m.type} · {m.basis ?? "observation"}</dd>
            <dt><Icon name="folder" size={14} />Scope</dt><dd>{m.scope}{m.project_id ? ` · ${vault.projectName(m.project_id)}` : ""}</dd>
            <dt><Icon name="check" size={14} />Status</dt>
            <dd>{editing ? <select value={working.status} onChange={(e) => edit({ status: e.target.value })} aria-label="Status" style={{ minHeight: 30, width: "auto" }}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select> : m.status}</dd>
            <dt><Icon name="tag" size={14} />Tags</dt>
            <dd>{editing ? <TagEditor tags={working.tags} onChange={(t) => edit({ tags: t })} />
              : (m.tags ?? []).length ? (m.tags ?? []).map((t) => <button key={t} className="tagchip" onClick={() => onTag(t)}>#{t}</button>) : <span className="muted">none</span>}</dd>
            <dt><Icon name="info" size={14} />Confidence</dt>
            <dd>{editing ? <><input type="range" min={0} max={1} step={0.05} value={working.confidence} onChange={(e) => edit({ confidence: Number(e.target.value) })} aria-label="Confidence" style={{ width: 140 }} />{Math.round(working.confidence * 100)}%</> : `${Math.round(m.confidence * 100)}%`}</dd>
            <dt><Icon name="shield" size={14} />Sensitivity</dt>
            <dd>{editing ? <select value={working.sensitivity} onChange={(e) => edit({ sensitivity: e.target.value })} aria-label="Sensitivity" style={{ minHeight: 30, width: "auto" }}>{SENS.map((s) => <option key={s}>{s}</option>)}</select> : m.sensitivity ?? "private"}</dd>
            <dt><Icon name="clock" size={14} />Created</dt><dd>{fmtLocal(m.created_at)}</dd>
            <dt><Icon name="check" size={14} />Reviewed</dt><dd>{m.last_reviewed_at ? `${fmtLocal(m.last_reviewed_at)} (${ago(m.last_reviewed_at)})` : "never"}</dd>
            <dt><Icon name="history" size={14} />Sources</dt><dd>{m.evidence?.length ? `${m.evidence.length} reference${m.evidence.length === 1 ? "" : "s"}` : "none recorded"} · v{m.version}</dd>
          </dl>
        </details>

        {editing ? (
          <div className={`editor ${mode === "split" ? "split" : ""}`}>
            <label className="field" style={{ margin: 0 }}><span className="sr">Note body (markdown)</span>
              <textarea value={working.body} onChange={(e) => edit({ body: e.target.value })} aria-label="Note body" spellCheck placeholder="Write in markdown. Link notes with [[Note title]], tag with #tags, callouts with > [!tip]" /></label>
            {mode === "split" && <div style={{ minWidth: 0, overflow: "auto", maxHeight: "60vh" }}>{preview}</div>}
          </div>
        ) : working.body.trim() ? preview : <Empty>This note is empty. Press <kbd>E</kbd> to start writing.</Empty>}

        {!editing && vp.w < 1280 && <div className="inline-panels" style={{ marginTop: 24 }}>{panels}</div>}
        {!editing && (
          <div style={{ marginTop: 28 }}>
            {confirmForget ? (
              <Notice tone="bad">Forget this note permanently? Its file is removed from the vault. Existing backups are not rewritten.
                <div className="row" style={{ marginTop: 8 }}><Btn kind="danger" busy={forget.busy} disabled={!connected} onClick={() => void forget.run()}>Yes, forget</Btn><Btn kind="ghost" onClick={() => setConfirmForget(false)}>Keep</Btn></div></Notice>
            ) : <Btn kind="ghost" disabled={!connected} onClick={() => setConfirmForget(true)}><Icon name="trash" size={15} />Forget…</Btn>}
          </div>
        )}
      </div>
      {vp.w >= 1280 && <aside className="rightpanel" aria-label="Note details"><div className="scroll">{panels}</div></aside>}
    </>
  );
}
