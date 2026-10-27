import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../core/client";
import { AssistView } from "../core/assist";
import { celebrate } from "../core/celebrate";
import { canSpeak, speak, stopAllVoice } from "../core/voice";
import {
  ChecklistItem, ConfigByKind, Fact, findFacts, MAX_FACTS, MAX_ITEMS, RoutineConfig, RoutineWhen, Widget, WEEKDAYS, doneToday, isAbilityOn, listWidgets, getAbilities, mmss, nextRunText,
  progressText, removeWidget, runRoutine, saveWidget, streak, timerNext, toggleToday,
} from "../core/widgets";
import { useApp } from "./Context";
import { go, routeHref } from "./hooks";
import { ErrorBox } from "./kit";
import { MissionCard } from "./Mission";
import { VoiceButton } from "./VoiceButton";

type Save = <K extends Widget["kind"]>(w: Extract<Widget, { kind: K }>, config: ConfigByKind[K], title?: string) => Promise<void>;
const msgOf = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

/** The "My Day" dock: a collapsible panel that sits over the universe and lists the owner's widgets as small interactive cards.
 *  Everything a widget holds is shown as text. `onAdd` opens the gallery. */
export function MyDay({ startOpen = true, onAdd, refreshKey = 0 }: { startOpen?: boolean; onAdd?: () => void; refreshKey?: number }) {
  const { client, connected } = useApp();
  const [open, setOpen] = useState(startOpen);
  const [items, setItems] = useState<Widget[] | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bodyId = useId();

  const load = async () => {
    try {
      const [list, ab] = await Promise.all([listWidgets(client), getAbilities(client).catch(() => null)]);
      setItems(list);
      setScheduling(isAbilityOn(ab, "routines"));
      setErr(null);
    } catch (e) { setErr(msgOf(e)); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [client, refreshKey]);

  const replace = (n: Widget) => setItems((cur) => (cur ?? []).map((w) => (w.id === n.id ? n : w)));
  const save: Save = async (w, config, title) => {
    setErr(null);
    try { replace(await saveWidget(client, w.id, config, title)); } catch (e) { setErr(msgOf(e)); }
  };
  const remove = async (w: Widget) => {
    setErr(null);
    try { await removeWidget(client, w.id); setItems((cur) => (cur ?? []).filter((x) => x.id !== w.id)); } catch (e) { setErr(msgOf(e)); }
  };

  const count = items?.length ?? 0;
  return (
    <aside className={`myday${open ? " open" : ""}`} aria-label="My Day">
      <div className="myday-head">
        <button type="button" className="myday-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> My Day{count > 0 ? ` (${count})` : ""}
        </button>
        {open && count > 0 && onAdd && <button type="button" className="btn ghost" onClick={onAdd}>Add a widget</button>}
      </div>
      {open && (
        <div id={bodyId} className="myday-body">
          <ErrorBox msg={err} />
          {items === null && !err && <p className="muted" aria-busy="true">Loading…</p>}
          {items !== null && count === 0 && (
            <div className="myday-empty">
              <p>Nothing here yet. Pick a small tool for your day, like a checklist or a habit.</p>
              {onAdd && <button type="button" className="btn primary" onClick={onAdd}>Launch your first probe</button>}
            </div>)}
          {items?.map((w) => <WidgetCard key={w.id} w={w} save={save} remove={remove} reload={load} connected={connected} scheduling={scheduling} setErr={setErr} />)}
        </div>)}
    </aside>
  );
}

interface CardProps { w: Widget; save: Save; remove: (w: Widget) => Promise<void>; reload: () => Promise<void>; connected: boolean; scheduling: boolean; setErr: (m: string | null) => void }

function WidgetCard(p: CardProps) {
  const { w, save, remove, connected } = p;
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(w.title);
  const [confirm, setConfirm] = useState(false);
  const hid = `myday-${w.id}`;
  const rename = async () => {
    const t = title.trim();
    if (!t) return;
    if (t !== w.title) await save(w as never, w.config as never, t);
    setRenaming(false);
  };
  return (
    <article className={`myday-card kind-${w.kind}`} aria-labelledby={hid}>
      <header className="myday-card-head">
        {renaming ? (
          <form className="row" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
            <input aria-label={`New title for ${w.title}`} value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} autoFocus />
            <button type="submit" className="btn primary" disabled={!connected || !title.trim()}>Save title</button>
            <button type="button" className="btn ghost" onClick={() => { setTitle(w.title); setRenaming(false); }}>Cancel</button>
          </form>
        ) : <h3 id={hid}>{w.title}</h3>}
        {!renaming && (
          <span className="myday-tools">
            <button type="button" className="btn ghost" aria-label={`Rename ${w.title}`} disabled={!connected} onClick={() => setRenaming(true)}>Rename</button>
            <button type="button" className="btn ghost" aria-label={`Remove ${w.title}`} disabled={!connected} onClick={() => setConfirm(true)}>Remove</button>
          </span>)}
      </header>
      {confirm && (
        <div className="note warn" role="group" aria-label={`Remove ${w.title}?`}>
          <p>Remove "{w.title}" from My Day? What it holds will be gone.</p>
          <button type="button" className="btn danger" onClick={() => void remove(w)}>Yes, remove it</button>{" "}
          <button type="button" className="btn ghost" onClick={() => setConfirm(false)}>Keep it</button>
        </div>)}
      {w.kind === "checklist" && <Checklist w={w} save={save} connected={connected} />}
      {w.kind === "counter" && <Counter w={w} save={save} connected={connected} />}
      {w.kind === "note" && <Note w={w} save={save} connected={connected} />}
      {w.kind === "mission" && <MissionCard w={w} save={(x, config) => save(x, config)} connected={connected} />}
      {w.kind === "facts" && <Facts w={w} save={save} connected={connected} />}
      {w.kind === "habit" && <Habit w={w} save={save} connected={connected} />}
      {w.kind === "timer" && <Timer w={w} save={save} connected={connected} />}
      {w.kind === "routine" && <Routine w={w} save={save} connected={connected} reload={p.reload} scheduling={p.scheduling} setErr={p.setErr} />}
      <p className="muted small myday-progress">{progressText(w)}</p>
    </article>
  );
}

type Sub<K extends Widget["kind"]> = { w: Extract<Widget, { kind: K }>; save: Save; connected: boolean };

function Checklist({ w, save, connected }: Sub<"checklist">) {
  const [text, setText] = useState("");
  const items = w.config.items;
  const put = (next: ChecklistItem[]) => save(w, { items: next });
  const add = async () => {
    const t = text.trim();
    if (!t) return;
    await put([...items, { text: t, done: false }]);
    setText("");
  };
  return (
    <div>
      <ul className="plain">
        {items.map((it, i) => (
          <li key={i} className="row">
            <label className="check"><input type="checkbox" checked={it.done} disabled={!connected} onChange={() => { if (!it.done) celebrate(w.id); void put(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x))); }} /> {it.text}</label>
            <button type="button" className="btn ghost" aria-label={`Remove item ${it.text}`} disabled={!connected} onClick={() => void put(items.filter((_, j) => j !== i))}>×</button>
          </li>))}
      </ul>
      {items.length < MAX_ITEMS ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input aria-label={`New item for ${w.title}`} value={text} maxLength={120} onChange={(e) => setText(e.target.value)} placeholder="Add an item" />
          <button type="submit" className="btn ghost" disabled={!connected || !text.trim()}>Add item</button>
        </form>) : <p className="muted small">A checklist holds up to {MAX_ITEMS} items.</p>}
    </div>
  );
}

function Facts({ w, save, connected }: Sub<"facts">) {
  const [q, setQ] = useState("");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const items = w.config.items;
  const shown = findFacts(items, q);
  const put = (next: Fact[]) => save(w, { items: next });
  const add = async () => {
    if (!label.trim() || !value.trim()) return;
    await put([...items, { label: label.trim(), value: value.trim() }]);
    setLabel(""); setValue("");
  };
  return (
    <div>
      <div className="row">
        <label className="grow">Find a fact{" "}<input type="search" aria-label={`Find in ${w.title}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter, paint, size…" /></label>
        <VoiceButton label={`Say what to find in ${w.title}`} onText={setQ} />
      </div>
      <ul className="plain" aria-live="polite">
        {shown.map((f) => (
          <li key={`${f.label}|${f.value}`} className="row">
            <span><strong>{f.label}:</strong> {f.value}</span>
            <button type="button" className="btn ghost" aria-label={`Remove fact ${f.label}`} disabled={!connected} onClick={() => void put(items.filter((x) => x !== f))}>×</button>
          </li>))}
      </ul>
      {items.length > 0 && shown.length === 0 && <p className="muted small">Nothing matches &ldquo;{q}&rdquo;.</p>}
      {items.length < MAX_FACTS ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input aria-label={`New fact name for ${w.title}`} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="What (Furnace filter)" />
          <input aria-label={`New fact value for ${w.title}`} value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} placeholder="Answer (16x25x4)" />
          <button type="submit" className="btn ghost" disabled={!connected || !label.trim() || !value.trim()}>Add fact</button>
        </form>) : <p className="muted small">The vault holds up to {MAX_FACTS} facts.</p>}
    </div>
  );
}

function Counter({ w, save, connected }: Sub<"counter">) {
  const { value, step } = w.config;
  return (
    <div className="row">
      <strong aria-live="polite" aria-label={`${w.title} count`}>{value}</strong>
      <button type="button" className="btn ghost" aria-label={`Subtract ${step} from ${w.title}`} disabled={!connected} onClick={() => void save(w, { ...w.config, value: value - step })}>−{step}</button>
      <button type="button" className="btn ghost" aria-label={`Add ${step} to ${w.title}`} disabled={!connected} onClick={() => void save(w, { ...w.config, value: value + step })}>+{step}</button>
    </div>
  );
}

function Note({ w, save, connected }: Sub<"note">) {
  const [text, setText] = useState(w.config.text);
  const dirty = text !== w.config.text;
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(w, { text }); }}>
      <textarea aria-label={`Text of ${w.title}`} value={text} maxLength={500} rows={3} onChange={(e) => setText(e.target.value)} />
      <button type="submit" className="btn ghost" aria-label={`Save ${w.title}`} disabled={!connected || !dirty}>Save note</button>
    </form>
  );
}

function Habit({ w, save, connected }: Sub<"habit">) {
  const done = doneToday(w.config.days);
  const s = streak(w.config.days);
  return (
    <div className="row">
      <button type="button" className={`btn ${done ? "primary" : "ghost"}`} aria-pressed={done} aria-label={`Done today: ${w.title}`} disabled={!connected}
        onClick={() => { if (!done) celebrate(w.id); void save(w, { ...w.config, days: toggleToday(w.config.days) }); }}>{done ? "Done today" : "Check today"}</button>
      <span aria-live="polite">{s === 0 ? "No streak yet" : `${s} ${s === 1 ? "day" : "days"} in a row`}</span>
    </div>
  );
}

function Timer({ w, save, connected }: Sub<"timer">) {
  const { focus, rest } = w.config;
  const [phase, setPhase] = useState<"focus" | "rest">("focus");
  const [remaining, setRemaining] = useState(focus * 60);
  const [running, setRunning] = useState(false);
  const cfg = useRef(w.config);
  cfg.current = w.config;
  useEffect(() => { if (!running) setRemaining((phase === "focus" ? focus : rest) * 60); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [focus, rest]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => {
    if (!running || remaining > 0) return;
    const n = timerNext(phase, cfg.current);
    setPhase(n.phase);
    setRemaining(n.remaining);
    setRunning(false);                                    // no sound and no auto-restart: the owner decides when the next stretch begins
    if (n.sessions !== cfg.current.sessions) void save(w, { ...cfg.current, sessions: n.sessions });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, running]);
  const reset = () => { setRunning(false); setPhase("focus"); setRemaining(focus * 60); };
  return (
    <div className="row">
      <strong role="timer" aria-label={`${phase === "focus" ? "Focus" : "Rest"} time left`}>{mmss(remaining)}</strong>
      <span className="muted small">{phase === "focus" ? "Focus" : "Rest"}</span>
      <button type="button" className="btn ghost" aria-label={`${running ? "Pause" : "Start"} ${w.title}`} onClick={() => setRunning(!running)}>{running ? "Pause" : "Start"}</button>
      <button type="button" className="btn ghost" aria-label={`Reset ${w.title}`} onClick={reset}>Reset</button>
    </div>
  );
}

function Routine({ w, save, connected, reload, scheduling, setErr }: Sub<"routine"> & { reload: () => Promise<void>; scheduling: boolean; setErr: (m: string | null) => void }) {
  const { client } = useApp();
  const c = w.config;
  const [prompt, setPrompt] = useState(c.prompt);
  const [busy, setBusy] = useState(false);
  const setCfg = (patch: Partial<RoutineConfig>) => save(w, { ...c, ...patch });
  const [reading, setReading] = useState(false);
  /** Reads the last answer aloud with this device's own voice. Nothing is sent anywhere; Stop (or Esc) silences it. */
  const readAloud = async () => {
    if (reading) { stopAllVoice(); setReading(false); return; }
    setErr(null);
    try {
      const a = (await client.get<AssistView>(`/assist/${c.last_task}`)).answer;
      if (!a?.text) { setErr("There is no finished answer to read yet."); return; }
      if (speak(a.text, () => setReading(false))) setReading(true); else setErr("This device has no voice to read with.");
    } catch (e) { setErr(msgOf(e)); }
  };
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try { await runRoutine(client, w.id); await reload(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  return (
    <div>
      <p className="muted small">{nextRunText(c, new Date(), scheduling)}</p>
      <div className="row">
        <button type="button" className="btn primary" aria-label={`Run now: ${w.title}`} disabled={!connected || busy} aria-busy={busy} onClick={() => void run()}>{busy ? "Starting…" : "Run now"}</button>
        {c.last_task && (
          <a href={routeHref({ tab: "home", id: c.last_task })} aria-label={`Last result of ${w.title}`} onClick={(e) => { e.preventDefault(); go({ tab: "home", id: c.last_task }); }}>Last result</a>)}
        {c.last_task && canSpeak() && (
          <button type="button" className="btn ghost" aria-label={`${reading ? "Stop reading" : "Read aloud"}: ${w.title}`} disabled={!connected} onClick={() => void readAloud()}>{reading ? "Stop reading" : "Read aloud"}</button>)}
      </div>
      <div className="row">
        <label>Runs{" "}
          <select aria-label={`When ${w.title} runs`} value={c.when} disabled={!connected} onChange={(e) => void setCfg({ when: e.target.value as RoutineWhen })}>
            <option value="manual">Only when I press Run now</option><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Once a week</option>
          </select></label>
        {c.when !== "manual" && (
          <label>At{" "}<input type="time" aria-label={`Time for ${w.title}`} value={c.at} disabled={!connected} onChange={(e) => e.target.value && void setCfg({ at: e.target.value })} /></label>)}
        {c.when === "weekly" && (
          <label>On{" "}
            <select aria-label={`Day for ${w.title}`} value={c.day} disabled={!connected} onChange={(e) => void setCfg({ day: Number(e.target.value) })}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>)}
      </div>
      {c.when !== "manual" && !scheduling && <p className="note warn" role="status">Scheduling is off. Turn on "Run my routines on a schedule" in Settings, under Abilities, for this to run by itself.</p>}
      <form onSubmit={(e) => { e.preventDefault(); void setCfg({ prompt }); }}>
        <textarea aria-label={`Request for ${w.title}`} value={prompt} maxLength={1500} rows={4} onChange={(e) => setPrompt(e.target.value)} />
        <button type="submit" className="btn ghost" aria-label={`Save request for ${w.title}`} disabled={!connected || !prompt.trim() || prompt === c.prompt}>Save request</button>
      </form>
    </div>
  );
}
