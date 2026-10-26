import { useState } from "react";
import { UObject } from "../core/scene";
import { TONE_DOT, systems, tiles } from "../core/hud";
import { useApp } from "./Context";
import { go, useLoad } from "./hooks";
import { ago } from "./kit";

interface Receipt { id: string; ts: string; actor: string; kind: string; summary: string; changed: number }

/** Glass panels along the right edge: a few real numbers, how each system is, and the ship's log. */
export function Hud({ objects, memories, onOpen }: { objects: readonly UObject[]; memories: number | null; onOpen: (id: string) => void }) {
  const { client } = useApp();
  const [open, setOpen] = useState(true);
  const log = useLoad(() => client.get<{ items: Receipt[] }>("/receipts", { query: { limit: 6 } }), [client], 20000);
  if (!open) return <button type="button" className="btn btn-quiet hud-toggle hud-show" onClick={() => setOpen(true)} aria-expanded="false">Show panels</button>;
  return (
    <aside className="hud" aria-label="At a glance">
      <button type="button" className="btn btn-quiet hud-toggle" onClick={() => setOpen(false)} aria-expanded="true">Hide panels</button>
      <div className="tiles">
        {tiles(objects, memories).map((t) => (
          <button key={t.id} type="button" className={`tile ${t.tone}`} title={t.hint} onClick={() => (t.to ? go(t.to as never) : undefined)}>
            <span className="tile-label">{t.label}</span><span className="tile-value">{t.value}</span>
          </button>))}
      </div>
      <section className="glass" aria-label="Systems">
        <h2>Systems</h2>
        <ul className="systems">
          {systems(objects).map((s) => (
            <li key={s.id}><button type="button" onClick={() => onOpen(s.id)}><span className="dot" style={{ background: TONE_DOT[s.tone] }} aria-hidden="true" /><span>{s.name}</span><span className="muted small">{s.text}</span></button></li>))}
        </ul>
      </section>
      <section className="glass" aria-label="Ship's log">
        <h2>Ship's log</h2>
        {log.data?.items.length ? (
          <ul className="shiplog">{log.data.items.map((r) => <li key={r.id}><span className="muted small">{ago(r.ts)}</span> {r.summary}</li>)}</ul>
        ) : <p className="muted small">Nothing yet. What AIOS does will show up here in plain words.</p>}
      </section>
    </aside>
  );
}
