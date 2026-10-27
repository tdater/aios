import { useEffect, useId, useState } from "react";
import { ApiError } from "../core/client";
import {
  AbilityStatus, Catalog, CatalogItem, Widget, addFromCatalog, filterCatalog, getAbilities, getCatalog, isAbilityOn, setAbility,
} from "../core/widgets";
import { useApp } from "./Context";
import { ErrorBox } from "./kit";

const msgOf = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);
type Who = "All" | "Everyone" | "Technical";

/** Everything the owner can add to My Day, grouped, with a plain name first. Adding needs the "widgets" ability; if it is off
 *  the gallery explains what it allows and asks before turning it on. */
export function WidgetGallery({ onAdded, onClose }: { onAdded?: (w: Widget) => void; onClose?: () => void }) {
  const { client, connected } = useApp();
  const [cat, setCat] = useState<Catalog | null>(null);
  const [abil, setAbil] = useState<AbilityStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState<Who>("All");
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [asking, setAsking] = useState<CatalogItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const searchId = useId();

  useEffect(() => {
    let alive = true;
    void Promise.all([getCatalog(client), getAbilities(client)]).then(([c, a]) => { if (alive) { setCat(c); setAbil(a); } }, (e) => { if (alive) setErr(msgOf(e)); });
    return () => { alive = false; };
  }, [client]);

  const widgetsOn = isAbilityOn(abil, "widgets");
  const routinesOn = isAbilityOn(abil, "routines");

  const add = async (t: CatalogItem, turnOn = false) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (turnOn) setAbil(await setAbility(client, "widgets", true));
      const w = await addFromCatalog(client, t.id);
      setAsking(null);
      setAdded(t.id);
      onAdded?.(w);
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  const onAddClick = (t: CatalogItem) => (widgetsOn ? void add(t) : setAsking(t));

  const shown = cat ? filterCatalog(cat.items, who, q) : [];
  const widgetsAbility = abil?.abilities.find((a) => a.name === "widgets");
  return (
    <section className="wgallery" aria-label="Widget gallery">
      <header className="row">
        <h2>Add to My Day</h2>
        {onClose && <button type="button" className="btn ghost" onClick={onClose}>Close</button>}
      </header>
      <ErrorBox msg={err} />
      {added && <p className="note ok" role="status">Added. It is now in My Day.</p>}
      <div className="row wgallery-filter">
        <label htmlFor={searchId}>Search</label>
        <input id={searchId} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or what it does" />
        <div role="group" aria-label="Who it is for">
          {(["All", "Everyone", "Technical"] as Who[]).map((x) => (
            <button key={x} type="button" className={`btn ${who === x ? "primary" : "ghost"}`} aria-pressed={who === x} onClick={() => setWho(x)}>{x}</button>))}
        </div>
      </div>
      {!cat && !err && <p className="muted" aria-busy="true">Loading…</p>}
      {cat && shown.length === 0 && <p className="empty">Nothing matches. Try a different word.</p>}
      {cat?.groups.map((g) => {
        const rows = shown.filter((i) => i.group === g);
        if (rows.length === 0) return null;
        return (
          <section key={g} aria-label={g} className="wgallery-group">
            <h3>{g}</h3>
            <ul className="plain wgallery-list">
              {rows.map((t) => (
                <li key={t.id} className="wgallery-item" aria-label={t.name}>
                  <div className="row">
                    <strong>{t.name}</strong>
                    {t.needs_claude && <span className="badge info">Needs Claude</span>}
                    {t.who === "Technical" && <span className="badge muted">Technical</span>}
                  </div>
                  <div className="muted small">{t.space}</div>
                  <p>{t.blurb}</p>
                  <div className="row">
                    <button type="button" className="btn ghost" aria-expanded={preview === t.id} aria-label={`Preview ${t.name}`} onClick={() => setPreview(preview === t.id ? null : t.id)}>
                      {preview === t.id ? "Hide preview" : "Preview"}</button>
                    <button type="button" className="btn primary" aria-label={`Add ${t.name}`} disabled={!connected || busy} onClick={() => onAddClick(t)}>Add</button>
                  </div>
                  {preview === t.id && <Preview t={t} routinesOn={routinesOn} />}
                  {asking?.id === t.id && (
                    <div className="note warn" role="group" aria-label="Turn on widgets">
                      <p><strong>Turn on small panels?</strong> {widgetsAbility?.title ?? "Small panels"} lets AIOS keep the lists, counters and notes you add. They hold only
                        what you type, and they never run code. You can remove any of them, or turn this off, whenever you like.</p>
                      <button type="button" className="btn primary" disabled={busy} onClick={() => void add(t, true)}>Yes, turn it on and add</button>{" "}
                      <button type="button" className="btn ghost" onClick={() => setAsking(null)}>Not now</button>
                    </div>)}
                </li>))}
            </ul>
          </section>);
      })}
    </section>
  );
}

function Preview({ t, routinesOn }: { t: CatalogItem; routinesOn: boolean }) {
  const c = t.config as { steps?: { text: string }[]; items?: { text: string; label?: string; value?: string }[]; text?: string; prompt?: string; focus?: number; rest?: number; step?: number; per_week?: number };
  return (
    <div className="wgallery-preview" role="region" aria-label={`Preview of ${t.name}`}>
      {t.kind === "checklist" && <ul>{(c.items ?? []).map((i, n) => <li key={n}>{i.text}</li>)}</ul>}
      {t.kind === "facts" && <ul>{(c.items ?? []).map((i, n) => <li key={n}>{i.label}: {i.value}</li>)}</ul>}
      {t.kind === "mission" && <ul>{(c.steps ?? []).map((i, n) => <li key={n}>{i.text}</li>)}</ul>}
      {t.kind === "note" && <p>{c.text}</p>}
      {t.kind === "counter" && <p>A number you add to or take from, {c.step} at a time.</p>}
      {t.kind === "habit" && <p>A daily check with a streak. Goal: {c.per_week} days a week.</p>}
      {t.kind === "timer" && <p>{c.focus} minutes of focus, then {c.rest} minutes of rest.</p>}
      {t.kind === "routine" && (
        <>
          <p>Sends this request to Claude when you press Run now:</p>
          <blockquote>{c.prompt}</blockquote>
          <p className="muted small">Running it by hand needs nothing extra. To let it run by itself on a schedule, the separate "Run my routines on a schedule" ability must be on{routinesOn ? " (it is)" : " (it is off right now)"}.</p>
        </>)}
      {t.you_can_change && <p className="muted small">You can change: {t.you_can_change}.</p>}
    </div>
  );
}
