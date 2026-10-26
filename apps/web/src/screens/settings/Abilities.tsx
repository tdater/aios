import { useState } from "react";
import { ApiError } from "../../core/client";
import { AbilityInfo, AbilityStatus, Receipt, ScanResult, WidgetData } from "../../core/types";
import { useApp } from "../../ui/Context";
import { useLoad } from "../../ui/hooks";
import { Btn, Collapsible, Empty, ErrorBox, Loading, Notice, ago } from "../../ui/kit";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

/** Opt-in abilities, the pause switch, and the plain-language record of what AIOS did. Everything here is off until you turn it on. */
export function AbilitiesSection() {
  const { client, connected } = useApp();
  const st = useLoad(() => client.get<AbilityStatus>("/abilities"), [client]);
  const rc = useLoad(() => client.get<{ items: Receipt[] }>("/receipts", { query: { limit: 50 } }), [client]);
  const [err, setErr] = useState<string | null>(null);
  const [only, setOnly] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await Promise.all([st.reload(), rc.reload()]); } catch (e) { setErr(msg(e)); } };
  const items = (rc.data?.items ?? []).filter((r) => !only || r.changed);
  return (
    <section className="card" id="abilities" aria-labelledby="abilities-h">
      <h3 id="abilities-h">Extra abilities and safety</h3>
      <ErrorBox msg={err} />
      {st.loading && !st.data && <Loading />}
      {st.data && (
        <>
          <div className="row">
            <strong>{st.data.paused ? "AIOS is paused" : "AIOS is running normally"}</strong>
            <Btn kind={st.data.paused ? "primary" : "danger"} disabled={!connected} onClick={() => void run(() => client.post(st.data!.paused ? "/resume" : "/pause"))}>{st.data.paused ? "Resume" : "Pause everything"}</Btn>
          </div>
          <p className="muted small">Pausing stops new runs from starting and blocks every ability below until you resume.</p>
          {st.data.abilities.map((a) => <Ability key={a.name} a={a} paused={st.data!.paused} onToggle={(on) => run(() => client.put(`/abilities/${a.name}`, { enabled: on, confirm: on }))} />)}
          <Collapsible title="Not built yet" count={st.data.planned.length}>
            <ul className="plain">{st.data.planned.map((p) => <li key={p.name}>{p.title}</li>)}</ul>
            <p className="muted small">These need more safety work first. They do nothing today and cannot be turned on.</p>
          </Collapsible>
        </>)}
      <WidgetMaker enabled={!!st.data?.abilities.find((a) => a.name === "widgets")?.enabled} onChanged={() => void rc.reload()} />
      <Collapsible title="Receipts: what AIOS did" count={items.length}>
        <label className="check"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only things that changed something</label>
        {items.length === 0 ? <Empty>Nothing recorded yet.</Empty> : <ul className="plain">{items.map((r) => <li key={r.id}><span className="muted small">{ago(r.ts)}</span> {r.summary}{r.changed ? <span className="muted small"> (changed something)</span> : null}</li>)}</ul>}
      </Collapsible>
    </section>
  );
}

function Ability({ a, paused, onToggle }: { a: AbilityInfo; paused: boolean; onToggle: (on: boolean) => Promise<void> }) {
  const { client, connected } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="card" role="group" aria-label={a.title}>
      <div className="row"><strong>{a.title}</strong><span className="muted small">{a.enabled ? "On" : "Off"}</span></div>
      <ErrorBox msg={err} />
      {!a.enabled && !confirming && <Btn disabled={!connected} onClick={() => setConfirming(true)}>Turn on…</Btn>}
      {confirming && (
        <Notice tone="warn">
          <p><strong>It can look at:</strong> {a.can_see.join("; ")}.</p>
          <p><strong>It can do:</strong> {a.can_do.join("; ")}.</p>
          <p><strong>It will never:</strong> {a.cannot.join("; ")}.</p>
          <div className="row"><Btn onClick={() => { setConfirming(false); void onToggle(true); }}>Yes, turn it on</Btn><Btn kind="ghost" onClick={() => setConfirming(false)}>Cancel</Btn></div>
        </Notice>)}
      {a.enabled && <Btn kind="ghost" disabled={!connected} onClick={() => { setScan(null); void onToggle(false); }}>Turn off</Btn>}
      {a.enabled && a.name === "system_scan" && (
        <>
          <Btn disabled={!connected || paused} onClick={async () => { setErr(null); try { setScan((await client.post<ScanResult>("/system-scan")).data); } catch (e) { setErr(msg(e)); } }}>Check this PC now</Btn>
          {scan && <ul className="plain" aria-label="What the check found">{scan.suggestions.map((s) => <li key={s.id}>{s.text}</li>)}<li className="muted small">Nothing was changed.</li></ul>}
        </>)}
    </div>
  );
}

function WidgetMaker({ enabled, onChanged }: { enabled: boolean; onChanged: () => void }) {
  const { client, connected } = useApp();
  const list = useLoad(() => client.get<{ items: WidgetData[] }>("/widgets"), [client]);
  const [kind, setKind] = useState<"note" | "counter" | "checklist">("note");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const config = kind === "note" ? { text } : kind === "counter" ? { value: 0, step: 1 } : { items: text.split("\n").map((t) => t.trim()).filter(Boolean).map((t) => ({ text: t, done: false })) };
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await list.reload(); onChanged(); setTitle(""); setText(""); } catch (e) { setErr(msg(e)); } };
  return (
    <Collapsible title="Panels on Today" count={list.data?.items.length ?? 0}>
      <ErrorBox msg={err} />
      {!enabled && <p className="muted small">Turn on &quot;Small panels on Today&quot; above to add panels. Existing panels can always be removed.</p>}
      <ul className="plain">{(list.data?.items ?? []).map((w) => <li key={w.id}>{w.title} <span className="muted small">({w.kind})</span> <Btn kind="ghost" onClick={() => void act(() => client.delete(`/widgets/${w.id}`))}>Remove {w.title}</Btn></li>)}</ul>
      {enabled && (
        <>
          <label className="field"><span>Kind</span><select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="note">Note</option><option value="counter">Counter</option><option value="checklist">Checklist (one item per line)</option></select></label>
          <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} /></label>
          {kind !== "counter" && <label className="field"><span>{kind === "note" ? "Text" : "Items"}</span><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></label>}
          <Btn disabled={!connected || !title.trim()} onClick={() => void act(() => client.post("/widgets", { kind, title, config }))}>Add panel</Btn>
        </>)}
    </Collapsible>
  );
}
