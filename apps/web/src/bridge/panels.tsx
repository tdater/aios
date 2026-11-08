import { useState } from "react";
import { Destination, destinations, goTo } from "../core/travel";
import { TONE_DOT, tiles } from "../core/hud";
import { UObject, World } from "../core/scene";
import { go } from "../ui/hooks";
import { alertItems, opsItems, summary } from "./panelData";

// The consoles around the window. Each one is a real work surface bound to what the server reports.

const open = (id: string) => go({ tab: "home", sub: "o", id });

export function OpsWall({ objects }: { objects: readonly UObject[] }) {
  const items = opsItems(objects);
  return (
    <section className="bridge-panel bridge-ops" data-area="ops" aria-label="Operations: jobs and systems">
      <h2>Ops</h2>
      {items.length ? (
        <ul>{items.map((i) => (
          <li key={i.id}><button type="button" onClick={() => open(i.id)}>
            <span className="dot" style={{ background: TONE_DOT[i.tone] }} aria-hidden="true" />
            <span className="bp-name">{i.name}</span><span className="muted small">{i.text}</span>
          </button></li>))}
        </ul>
      ) : <p className="muted small">No jobs running and no systems reported yet.</p>}
    </section>
  );
}

/** The only panel that pulses or uses strong red and amber: a calm bridge means nothing is waiting. */
export function AlertsWall({ objects }: { objects: readonly UObject[] }) {
  const items = alertItems(objects);
  const approvals = items.some((i) => i.id === "comet:approvals");
  return (
    <section className={`bridge-panel bridge-alerts ${items.length ? "has-alerts" : ""}`} data-area="alerts" aria-label="Alerts: what needs you">
      <h2>Alerts</h2>
      <div aria-live="polite">
        {items.length ? (
          <ul>{items.map((i) => (
            <li key={i.id}><button type="button" className={`alert-${i.tone}`} onClick={() => open(i.id)}>
              <span className="bp-name">{i.name}</span><span className="small">{i.text}</span>
            </button></li>))}
          </ul>
        ) : <p className="all-clear">All clear. Nothing needs you.</p>}
      </div>
      {approvals && <button type="button" className="btn btn-quiet" onClick={() => go({ tab: "inbox" })}>Open the inbox</button>}
    </section>
  );
}

export function TodayBank({ objects, memories }: { objects: readonly UObject[]; memories: number | null }) {
  return (
    <section className="bridge-panel bridge-today" data-area="today" aria-label="Today">
      <h2>Today</h2>
      <div className="bp-tiles">
        {tiles(objects, memories).map((t) => (
          <button key={t.id} type="button" className={`bp-tile ${t.tone}`} title={t.hint} onClick={() => (t.to ? go(t.to as never) : undefined)}>
            <span className="small">{t.label}</span><strong>{t.value}</strong>
          </button>))}
      </div>
      <div className="bp-links">
        <button type="button" className="btn btn-quiet" onClick={() => go({ tab: "home", sub: "details" })}>Today and details</button>
        <button type="button" className="btn btn-quiet" onClick={() => go({ tab: "home", sub: "tools" })}>Tools and check-up</button>
        <button type="button" className="btn btn-quiet" onClick={() => go({ tab: "runs" })}>Runs and outcomes</button>
      </div>
    </section>
  );
}

export function StatusStrip({ objects }: { objects: readonly UObject[] }) {
  const stop = objects.find((o) => o.type === "allstop");
  return (
    <div className="bridge-status" role="status">
      <span>{summary(objects)}</span>
      {stop && <button type="button" className="btn btn-quiet" onClick={() => open(stop.id)}>All Stop</button>}
    </div>
  );
}

/** The navigation computer: every destination, search, and a confirm step before the trip. */
export function HoloTable({ world, target, onTarget, onEngage, searchRef }: {
  world: World; target: Destination | null; onTarget: (d: Destination | null) => void; onEngage: (d: Destination) => void; searchRef: React.RefObject<HTMLInputElement>;
}) {
  const [q, setQ] = useState("");
  const rows = q.trim() ? goTo(world, q, 60) : destinations(world);
  const key = (d: Destination) => `${d.kind}:${d.id}`;
  return (
    <section className="bridge-panel bridge-holo" data-area="holo" aria-label="Navigation computer">
      <h2>Navigation</h2>
      <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Where to? A region, an AI, a project…" aria-label="Where to?"
        onKeyDown={(e) => { if (e.key === "Enter" && rows[0]) { e.preventDefault(); if (target && key(target) === key(rows[0])) onEngage(rows[0]); else onTarget(rows[0]); } }} />
      <ul className="holo-list" aria-label="Destinations">
        {rows.map((d) => (
          <li key={key(d)}><button type="button" aria-pressed={!!target && key(target) === key(d)} onClick={() => onTarget(d)} onDoubleClick={() => onEngage(d)}>
            <strong>{d.label}</strong> <span className="muted small">{d.sub}</span>
          </button></li>))}
        {!rows.length && <li className="muted small">Nothing by that name.</li>}
      </ul>
      <div className="holo-card" aria-live="polite">
        {target ? <><strong>{target.label}</strong><span className="muted small">{target.sub}</span></> : <span className="muted small">Pick a destination, then engage.</span>}
        <button type="button" className="btn engage" disabled={!target} onClick={() => target && onEngage(target)}>Engage</button>
      </div>
    </section>
  );
}
