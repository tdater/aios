import { useMemo, useState } from "react";
import { ApiError } from "../core/client";
import { shapePath, starSummary } from "../core/sky";
import { AiPlanet, ShareLevel, SharingRow, Universe } from "../core/types";
import { CORE, H, LEGEND, LEVEL_TEXT, PLANET_STATUS, W, layoutUniverse, starTitles } from "../core/universe";
import { Evidence } from "../screens/Insights";
import { useApp } from "./Context";
import { go } from "./hooks";
import { Btn, ErrorBox, Notice } from "./kit";
import { openTour } from "./uiState";

export type Selection = { kind: "core" } | { kind: "planet"; provider: string } | { kind: "star"; id: string } | { kind: "comet"; which: "approvals" | "blocked" | "review" } | null;

const key = (e: React.KeyboardEvent, fn: () => void) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } };

/** The map. Every element is a described button: you, each AI, each memory, each thing waiting for you. */
export function UniverseMap({ u, sel, onSelect }: { u: Universe; sel: Selection; onSelect: (s: Selection) => void }) {
  const L = useMemo(() => layoutUniverse(u), [u]);
  const at = new Map(L.stars.map((s) => [s.star.id, s]));
  const chosen = sel?.kind === "planet" ? L.planets.find((p) => p.ai.provider === sel.provider) : undefined;
  return (
    <svg className={`universe${u.paused ? " paused" : ""}`} viewBox={L.view.join(" ")} role="group" aria-label="Your universe: you, your AIs and what AIOS remembers">
      {L.orbits.map((o) => <circle key={o.level} className={`orbit o-${o.level}`} cx={CORE.x} cy={CORE.y} r={o.r}><title>{`Ring: ${LEVEL_TEXT[o.level].short}`}</title></circle>)}
      {L.clusters.map((c) => (
        <g key={c.name}><circle className="cluster" cx={c.x} cy={c.y} r={c.radius + 12} /><text className="clabel" x={c.x} y={c.y - c.radius - 18} textAnchor="middle">{c.name}</text></g>))}
      {chosen && chosen.ai.told.map((id) => { const s = at.get(id); return s ? <line key={id} className="beam" x1={chosen.x} y1={chosen.y} x2={s.x} y2={s.y} /> : null; })}
      {L.stars.map(({ star: s, x, y, r }) => (
        <g key={s.id} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-pressed={sel?.kind === "star" && sel.id === s.id} aria-label={starSummary(s)}
          className={`star st-${s.state}${s.hollow ? " hollow" : ""}${chosen?.ai.told.includes(s.id) ? " told" : ""}${sel?.kind === "star" && sel.id === s.id ? " sel" : ""}`}
          style={{ opacity: chosen && !chosen.ai.told.includes(s.id) ? 0.25 : 0.4 + 0.6 * s.brightness }}
          onClick={() => onSelect({ kind: "star", id: s.id })} onKeyDown={(e) => key(e, () => onSelect({ kind: "star", id: s.id }))}>
          <path d={shapePath(s.type, r)} /><title>{starSummary(s)}</title>
        </g>))}
      <g role="button" tabIndex={0} className={`core${sel?.kind === "core" ? " sel" : ""}`} aria-label={`You: AIOS remembers ${u.you.approved} things about you`}
        onClick={() => onSelect({ kind: "core" })} onKeyDown={(e) => key(e, () => onSelect({ kind: "core" }))}>
        <circle className="halo" cx={CORE.x} cy={CORE.y} r={CORE.r + 10} /><circle className="sun" cx={CORE.x} cy={CORE.y} r={CORE.r} />
        <text x={CORE.x} y={CORE.y + 5} textAnchor="middle" className="corelabel">You</text><title>You</title>
      </g>
      {L.planets.map((p) => (
        <g key={p.ai.provider} role="button" tabIndex={0} aria-pressed={sel?.kind === "planet" && sel.provider === p.ai.provider}
          aria-label={`${p.ai.name}: ${p.ai.level === "none" ? "told nothing" : `told ${p.ai.told_count} of your memories`}, ${p.ai.provider === "claude" && p.ai.mode === "interactive" ? "connected" : p.ai.provider === "claude" ? "not ready" : "by copy and paste"}`}
          className={`planet pl-${p.ai.provider === "claude" ? (p.ai.mode === "interactive" ? "real" : "down") : "manual"}${sel?.kind === "planet" && sel.provider === p.ai.provider ? " sel" : ""}`}
          onClick={() => onSelect({ kind: "planet", provider: p.ai.provider })} onKeyDown={(e) => key(e, () => onSelect({ kind: "planet", provider: p.ai.provider }))}>
          <circle cx={p.x} cy={p.y} r={p.r} /><text x={p.x} y={p.y + p.r + 13} textAnchor="middle" className="plabel">{p.ai.name}</text><title>{p.ai.name}</title>
        </g>))}
      {L.comets.map((c) => (
        <g key={c.kind} role="button" tabIndex={0} className={`comet cm-${c.kind}${sel?.kind === "comet" && sel.which === c.kind ? " sel" : ""}`} aria-label={`Waiting for you: ${c.label}`}
          onClick={() => onSelect({ kind: "comet", which: c.kind })} onKeyDown={(e) => key(e, () => onSelect({ kind: "comet", which: c.kind }))}>
          <path className="tail" d={`M${c.x - 46} ${c.y - 12} L${c.x - 10} ${c.y - 2}`} /><circle cx={c.x} cy={c.y} r="9" /><text x={c.x + 16} y={c.y + 4} className="clabel">{c.label}</text><title>{c.label}</title>
        </g>))}
      {u.paused && <text x={W / 2} y={H - 14} textAnchor="middle" className="pausedlabel">Paused: nothing new will start until you resume</text>}
    </svg>
  );
}

/** What each part is and what it does, in plain words. Always on screen next to the map. */
export function UniverseLegend() {
  return (
    <section className="legend-cards" aria-label="What am I looking at?">
      <h3>What am I looking at?</h3>
      <ul>{LEGEND.map((i) => (
        <li key={i.id}><span className="sym" aria-hidden="true">{i.symbol}</span><div><strong>{i.name}</strong><p>{i.what}</p><p className="muted small">{i.does}</p></div></li>))}</ul>
      <Btn kind="ghost" onClick={() => openTour(0)}>Take the tour</Btn>
    </section>
  );
}

function PlanetPanel({ ai, u, reload }: { ai: AiPlanet; u: Universe; reload: () => Promise<void> }) {
  const { client, connected } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const set = async (level: ShareLevel) => {
    setErr(null);
    try { await client.put<{ items: SharingRow[] }>(`/sharing/${ai.provider}`, { level }); await reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); }
  };
  const told = starTitles(u, ai.told);
  return (
    <div className="card" role="region" aria-label={`About ${ai.name}`}>
      <h3>{ai.name}</h3>
      <p>{PLANET_STATUS(ai)}</p>
      <ErrorBox msg={err} />
      <label className="field"><span>What {ai.name} may be told</span>
        <select value={ai.level} disabled={!connected} onChange={(e) => void set(e.target.value as ShareLevel)}>
          <option value="private">Public and private memories</option><option value="public">Only memories I marked public</option><option value="none">Nothing</option>
        </select></label>
      <p className="muted small">{ai.name} {LEVEL_TEXT[ai.level].long}. Anything marked secret is never shared.</p>
      {ai.level === "none" ? <p>It has been told nothing.</p> : told.length === 0 ? <p>Right now there is nothing at this level to tell it.</p> : (
        <><p><strong>It would be told these {told.length}:</strong> (they are lit on the map)</p>
          <ul className="plain">{told.slice(0, 8).map((s) => <li key={s.id}>{s.title}</li>)}{told.length > 8 && <li className="muted small">…and {told.length - 8} more</li>}</ul></>)}
      <div className="row"><Btn onClick={() => go({ tab: "work" })}>{ai.provider === "claude" ? "Chat with Claude" : `Ask ${ai.name}`}</Btn>
        <Btn kind="ghost" onClick={() => go({ tab: "ais", id: "share" })}>Choose per memory</Btn></div>
    </div>
  );
}

export function UniversePanel({ u, sel, reload, onClose }: { u: Universe; sel: Selection; reload: () => Promise<void>; onClose: () => void }) {
  const { client, connected } = useApp();
  const [err, setErr] = useState<string | null>(null);
  if (!sel) return <p className="muted">Pick anything on the map to see what it is and what you can do with it.</p>;
  if (sel.kind === "planet") { const ai = u.ais.find((a) => a.provider === sel.provider); return ai ? <PlanetPanel ai={ai} u={u} reload={reload} /> : null; }
  if (sel.kind === "star") { const s = u.stars.find((x) => x.id === sel.id); return s ? <Evidence star={s} onClose={onClose} /> : null; }
  if (sel.kind === "comet") {
    const m = { approvals: ["Approvals waiting for you", "AIOS will not act until you decide. Open them to read exactly what would happen.", "inbox"], blocked: ["Work that is stuck", "A run stopped and needs a decision.", "runs"], review: ["Suggestions to look over", "Memories AIOS noticed or imported. None are used until you approve them.", "ais"] }[sel.which] as [string, string, "inbox" | "runs" | "ais"];
    return <div className="card"><h3>{m[0]}</h3><p>{m[1]}</p><Btn onClick={() => go(m[2] === "ais" ? { tab: "ais", id: "knows" } : { tab: m[2] })}>Open</Btn></div>;
  }
  const toggle = async () => { setErr(null); try { await client.put("/learning", { enabled: !u.you.learning }); await reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); } };
  return (
    <div className="card" role="region" aria-label="About you">
      <h3>You</h3>
      <p>AIOS remembers <strong>{u.you.approved}</strong> thing{u.you.approved === 1 ? "" : "s"} about you{u.you.suggested ? <> and has <strong>{u.you.suggested}</strong> suggestion{u.you.suggested === 1 ? "" : "s"} waiting for your yes or no</> : ""}.</p>
      <ErrorBox msg={err} />
      <Notice tone="info">{u.you.learning ? "Learning is on: when you say “remember…” or “always…”, AIOS suggests a memory. Nothing is used until you approve it." : "Learning is off: AIOS will not suggest memories on its own."}</Notice>
      <div className="row">
        <Btn onClick={() => go({ tab: "ais", id: "knows" })}>See and correct what AIOS knows</Btn>
        <Btn kind="ghost" onClick={() => go({ tab: "ais", id: "import" })}>Bring in memories from another AI</Btn>
        <Btn kind="ghost" disabled={!connected} onClick={() => void toggle()}>{u.you.learning ? "Turn learning off" : "Turn learning on"}</Btn>
      </div>
    </div>
  );
}
