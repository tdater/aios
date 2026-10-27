import { useMemo, useState } from "react";
import { TYPE_LABEL, applyCardFilter, cardFilters } from "../core/vault";
import { go, useStore, useViewport } from "../ui/hooks";
import { Icon } from "../ui/icons";
import { Btn, Empty, ago } from "../ui/kit";
import { layoutPrefs, setExplorer } from "../ui/uiState";
import { Explorer } from "./knowledge/Explorer";
import { NewNote } from "./knowledge/NewNote";
import { NoteView } from "./knowledge/NoteView";
import { VaultContext, useVault, useVaultProvider } from "./knowledge/vaultContext";

/** Notes as cards you can scan, with filter chips: the friendlier face of the same notes. */
function CardGrid({ notes }: { notes: ReturnType<typeof useVault>["notes"] }) {
  const [filter, setFilter] = useState("all");
  const chips = useMemo(() => cardFilters(notes), [notes]);
  const shown = applyCardFilter(notes, chips.some((c) => c.id === filter) ? filter : "all");
  return (
    <section aria-label="Notes as cards">
      <div className="chips" role="group" aria-label="Show">
        {chips.map((c) => <button key={c.id} type="button" className={`chip btnchip ${filter === c.id ? "on" : ""}`} aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>{c.label}</button>)}
      </div>
      <ul className="notegrid">{shown.map((n) => (
        <li key={n.id}><button type="button" className="notecard" onClick={() => go({ tab: "knowledge", id: n.id })}>
          <strong>{n.title}</strong>
          <span className="muted small">{TYPE_LABEL[n.type] ?? n.type} · {ago(n.last_reviewed_at ?? n.created_at)}</span>
          {n.tags.length > 0 && <span className="notetags">{n.tags.slice(0, 4).map((t) => <span key={t} className="chip">#{t}</span>)}</span>}
        </button></li>))}</ul>
    </section>
  );
}

function Overview() {
  const vault = useVault();
  const [cards, setCards] = useState(true);
  const recent = useMemo(() => [...vault.notes].sort((a, b) => (b.last_reviewed_at ?? b.created_at ?? "").localeCompare(a.last_reviewed_at ?? a.created_at ?? "")).slice(0, 6), [vault.notes]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    vault.notes.forEach((n) => { c[n.type] = (c[n.type] ?? 0) + 1; });
    return c;
  }, [vault.notes]);
  return (
    <div className="screen" style={{ margin: 0 }}>
      <h2>Knowledge vault</h2>
      <p className="muted">Durable, human-readable memory. Each note is a markdown file; link notes with <code>[[Note title]]</code>, tag with <code>#tags</code>.</p>
      <div className="row" style={{ justifyContent: "flex-start", marginBottom: 16 }}>
        <Btn onClick={() => go({ tab: "knowledge", id: "new" })}><Icon name="edit" size={15} />New note</Btn>
        <Btn kind="ghost" onClick={() => go({ tab: "graph" })}><Icon name="graph" size={15} />Open graph</Btn>
      </div>
      {vault.notes.length === 0 ? <Empty>No notes yet. Create one, or approve a proposal from the Inbox to turn history into memory.</Empty> : (
        <>
          <label className="check"><input type="checkbox" checked={cards} onChange={(e) => setCards(e.target.checked)} /> Show notes as cards</label>
          {cards && <CardGrid notes={vault.notes} />}
          <div className="chips">{Object.entries(counts).map(([t, n]) => <span key={t} className="chip">{TYPE_LABEL[t] ?? t}: {n}</span>)}</div>
          <h3>Recently touched</h3>
          <ul className="cards">{recent.map((n) => (
            <li key={n.id}><button className="card-btn" onClick={() => go({ tab: "knowledge", id: n.id })}>
              <strong>{n.title}</strong><span className="muted small">{TYPE_LABEL[n.type] ?? n.type} · {ago(n.last_reviewed_at ?? n.created_at)}{n.tags.length ? ` · ${n.tags.map((t) => `#${t}`).join(" ")}` : ""}</span></button></li>))}</ul>
        </>
      )}
      <h3>Tips</h3>
      <ul className="plain muted small"><li>Press <kbd>/</kbd> to search; try <kbd>tag:#android type:lesson</kbd>.</li><li>Press <kbd>E</kbd> in a note to edit; <kbd>Ctrl</kbd>+<kbd>S</kbd> saves.</li><li>Hover a <code>[[link]]</code> to preview the note.</li></ul>
    </div>
  );
}

export function Knowledge({ id }: { id?: string }) {
  const vault = useVaultProvider();
  const vp = useViewport();
  const prefs = useStore(layoutPrefs);
  const wide = vp.w >= 900;
  const showExplorer = wide && prefs.explorer;
  const hasNote = !!id && id !== "new";
  return (
    <VaultContext.Provider value={vault}>
      <div className={`vault ${hasNote ? "hasnote" : ""} ${showExplorer ? "" : "noexplorer"}`}>
        {showExplorer && <Explorer selectedId={id} />}
        {id === "new" ? <div className="notecol">{wide && !prefs.explorer && <ShowExplorer />}<NewNote /></div>
          : hasNote ? <NoteView key={id} id={id!} />
            : <div className="notecol">{wide ? <>{!prefs.explorer && <ShowExplorer />}<Overview /></> : <Explorer variant="page" />}</div>}
      </div>
    </VaultContext.Provider>
  );
}

function ShowExplorer() {
  return <button className="iconbtn" style={{ marginBottom: 6 }} onClick={() => setExplorer(true)} aria-label="Show explorer" title="Show explorer (Ctrl \)"><Icon name="sidebar" /> <span className="small" style={{ marginLeft: 6 }}>Explorer</span></button>;
}
