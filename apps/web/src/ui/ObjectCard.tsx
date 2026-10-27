import { useState } from "react";
import { ApiError } from "../core/client";
import { Field, LOCAL_DEFS, LocalDef, ObjectCardData, TIERS, objectPath } from "../core/objects";
import { Settings } from "../core/settings";
import { ReplayArrival } from "./ArrivalCaption";
import { CheckUpToggle } from "./CheckUp";
import { RoverPanel } from "./RoverPanel";
import { useApp } from "./Context";
import { go, useLoad } from "./hooks";
import { Btn, ErrorBox, Loading } from "./kit";
import { askPrefill, openTour, toast } from "./uiState";
import { Idea, SummaryRow, factRows } from "../core/scanText";

const say = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

/** The plain-words card for one thing in the universe: what it is, its settings in three tiers, and where to go next. */
export function ObjectCard({ id, onClose, onReplay, reload }: { id: string; onClose: () => void; onReplay?: () => void; reload: () => void }) {
  const app = useApp();
  const { client, connected } = app;
  const card = useLoad(() => client.get<ObjectCardData>(objectPath(id) + "/card"), [client, id], 10000);
  const [tier, setTier] = useState<"basics" | "more" | "expert">("basics");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [pending, setPending] = useState<{ key: string; value: unknown; label: string } | null>(null);

  const change = async (key: string, value: unknown, confirm = false) => {
    setErr(null);
    try {
      const before = card.data?.panels && Object.values(card.data.panels).flat().find((f) => f.key === key)?.value;
      await client.put(objectPath(id) + "/config", { values: { [key]: value }, confirm });
      await card.reload(); reload();
      toast("Changed. Undo is in the card.", 3000);
      setUndo({ key, value: before });
    } catch (e) { setErr(say(e)); }
  };
  const [undo, setUndo] = useState<{ key: string; value: unknown } | null>(null);
  const act = async (f: Field) => {
    setErr(null); setResult(null);
    try { setResult(await client.post<Record<string, unknown>>(objectPath(id) + `/actions/${f.action}`).then((r) => r.data)); }
    catch (e) { setErr(say(e)); }
  };
  const clientAction = (name: string, uri?: string) => {
    if (name === "open_uri" && uri && /^ms-settings:[a-z0-9\-:]*$/i.test(uri)) window.location.href = uri;      // only Windows' own settings pages
    else if (name === "tour") openTour(0);
    else if (name === "open_companion") go({ tab: "ais" });
    else if (name === "rescan") void act({ key: "scan", kind: "action", label: "", value: null, help: "", action: "run_health_check" });
  };

  if (card.loading && !card.data) return <Loading what="Opening this card" />;
  if (!card.data) return <ErrorBox msg={card.error ?? "This card is not available."} code={card.errorCode} />;
  const c = card.data, o = c.object;
  const local = LOCAL_DEFS.filter((d) => d.object === o.id);
  const count = (t: "basics" | "more" | "expert") => c.panels[t].length + local.filter((d) => d.tier === t).length;
  const tiers = TIERS.filter((t) => count(t.id) > 0);
  const shown = tiers.some((t) => t.id === tier) ? tier : tiers[0]?.id;

  return (
    <aside className="object-card" aria-label={`${o.name}: details`}>
      <header className="row">
        <h2>{o.name}</h2>
        <span className={`pill ${o.state.tone}`}>{o.state.text}</span>
        <span className="grow" />
        <button type="button" className="btn btn-quiet" onClick={onClose} aria-label="Close this card">Close</button>
      </header>
      <p>{c.explain}</p>
      {o.job && <p className="muted small">{o.job}</p>}
      {tiers.length > 1 && (
        <div role="tablist" aria-label="Settings level" className="tiers">
          {tiers.map((t) => <button key={t.id} role="tab" aria-selected={shown === t.id} className={shown === t.id ? "on" : ""} onClick={() => setTier(t.id)}>{t.label}</button>)}
        </div>
      )}
      {shown && c.panels[shown].map((f) => (
        <FieldRow key={f.key} f={f} disabled={!connected} onChange={(v) => (f.confirm ? setPending({ key: f.key, value: v, label: f.label }) : void change(f.key, v))} onAction={() => void act(f)} onClient={clientAction} />
      ))}
      {shown && local.filter((d) => d.tier === shown).map((d) => <LocalRow key={d.key} d={d} settings={app.settings} set={(p) => { app.updateSettings(p); toast("Changed on this device"); }} />)}
      {o.id === "home" && <CheckUpToggle />}
      {o.id === "home:rover" && <RoverPanel onChanged={reload} />}
      {pending && (
        <div className="confirm" role="alertdialog" aria-label="Please confirm">
          <p><strong>{pending.label}</strong>: {pending.value === true ? "turn this on?" : pending.value === false ? "turn this off?" : "change this?"} You can undo it afterwards.</p>
          <Btn onClick={() => { const p = pending; setPending(null); void change(p.key, p.value, true); }}>Yes, do it</Btn>
          <Btn kind="ghost" onClick={() => setPending(null)}>Cancel</Btn>
        </div>
      )}
      {undo && <div className="row"><span className="muted small">Changed.</span><Btn kind="ghost" onClick={() => { const u = undo; setUndo(null); void change(u.key, u.value, true); }}>Undo</Btn></div>}
      <ErrorBox msg={err} />
      {result && <ActionResult r={result} />}
      {(c.links.length > 0 || onReplay) && (
        <nav className="links" aria-label="Go further">
          {c.links.map((l) => <button key={l.label} type="button" className="btn btn-quiet" onClick={() => (l.to ? go(l.to as never) : l.client && clientAction(l.client, l.uri))}>{l.label}</button>)}
          {onReplay && <ReplayArrival onReplay={onReplay} />}
        </nav>
      )}
    </aside>
  );
}

function FieldRow({ f, disabled, onChange, onAction, onClient }: { f: Field; disabled: boolean; onChange: (v: unknown) => void; onAction: () => void; onClient: (n: string) => void }) {
  const [text, setText] = useState(String(f.value ?? ""));
  const id = `f-${f.key}`;
  return (
    <div className="field-row">
      {f.kind === "toggle" && <label className="row"><input type="checkbox" checked={f.value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span>{f.label}</span></label>}
      {f.kind === "choice" && (
        <fieldset disabled={disabled}><legend>{f.label}</legend>
          {f.options?.map((op) => (
            <label key={op.value} className="row"><input type="radio" name={id} checked={f.value === op.value} onChange={() => onChange(op.value)} /><span>{op.label}</span>{op.preview && <span className="muted small">{op.preview}</span>}</label>
          ))}
        </fieldset>)}
      {(f.kind === "text" || f.kind === "number") && (
        <div className="row"><label htmlFor={id}>{f.label}</label><input id={id} type={f.kind === "number" ? "number" : "text"} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
          <Btn kind="ghost" disabled={disabled || text === String(f.value ?? "")} onClick={() => onChange(f.kind === "number" ? Number(text) : text)}>Save</Btn></div>)}
      {f.kind === "info" && <p><strong>{f.label}:</strong> {String(f.value ?? "")}</p>}
      {f.kind === "action" && <Btn kind="ghost" disabled={disabled && !f.client} onClick={() => (f.client ? onClient(f.client) : onAction())}>{f.label}</Btn>}
      {f.help && <p className="muted small">{f.help}</p>}
    </div>
  );
}

function LocalRow({ d, settings, set }: { d: LocalDef; settings: Settings; set: (p: Partial<Settings>) => void }) {
  const value = settings[d.key];
  if (d.control === "hidden") return <p className="muted small"><strong>{d.label}:</strong> {Array.isArray(value) ? (value.length ? value.join(", ") : "none") : String(value)}. {d.help}</p>;
  return (
    <div className="field-row">
      {d.control === "toggle" && <label className="row"><input type="checkbox" checked={value === true} onChange={(e) => set({ [d.key]: e.target.checked } as Partial<Settings>)} /><span>{d.label}</span></label>}
      {d.control === "choice" && (
        <fieldset><legend>{d.label}</legend>
          {d.options?.map((op) => <label key={op.value} className="row"><input type="radio" name={`l-${d.key}`} checked={String(value) === op.value} onChange={() => set({ [d.key]: op.value } as Partial<Settings>)} /><span>{op.label}</span></label>)}
        </fieldset>)}
      {d.control === "number" && <label className="row"><span>{d.label}</span><input type="number" min={d.min} max={d.max} value={Number(value)} onChange={(e) => set({ [d.key]: Math.min(d.max ?? 99, Math.max(d.min ?? 0, Number(e.target.value) || (d.min ?? 0))) } as Partial<Settings>)} /></label>}
      <p className="muted small">{d.help} <em>(this device only)</em></p>
    </div>
  );
}

export function ActionResult({ r }: { r: Record<string, unknown> }) {
  const facts = r.facts as Record<string, unknown> | undefined;
  const summary = r.summary as SummaryRow[] | undefined;
  const suggestions = r.suggestions as { title?: string; text?: string }[] | undefined;
  const ideas = r.ideas as Idea[] | undefined;
  return (
    <div className="action-result" role="status">
      {typeof r.title === "string" && <h3>{r.title}</h3>}
      {typeof r.text === "string" && <pre className="untrusted-inline">{r.text}</pre>}
      {typeof r.code === "string" && <p>Code: <strong>{r.code}</strong>. {String(r.note ?? "")}</p>}
      {r.ok === true && <p>Done.</p>}
      {summary?.length ? (
        <ul className="scan-rows">{summary.map((row) => <li key={row.label} className={row.tone}><strong>{row.label}:</strong> {row.value}</li>)}</ul>
      ) : facts ? <ul>{factRows(facts).map((row) => <li key={row.label}>{row.label}: {row.value}</li>)}</ul> : null}
      {suggestions && suggestions.map((s, i) => <p key={i}>{s.title ?? s.text}</p>)}
      {ideas && ideas.length > 0 && (
        <section className="scan-ideas" aria-label="Ideas">
          <h4>Ideas</h4>
          <ul className="plain">{ideas.map((i) => (
            <li key={i.id}><strong>{i.title}</strong><span className="muted small"> {i.why}</span>
              {i.ask && <> <button type="button" className="btn btn-quiet" onClick={() => { askPrefill.set(i.ask!); go({ tab: "home" }); }}>Ask AIOS about this</button></>}</li>))}</ul>
          <p className="muted small">AIOS only reads and explains. Nothing is changed or deleted for you.</p>
        </section>)}
    </div>
  );
}
