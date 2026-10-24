import { useMemo, useState } from "react";
import { localGraphFromLinks } from "../../core/graph";
import { OutlineItem } from "../../core/markdown";
import { Memory, NoteLinks } from "../../core/types";
import { GraphView } from "../../ui/GraphView";
import { go } from "../../ui/hooks";
import { openNode } from "../Graph";
import { Icon } from "../../ui/icons";
import { Empty, Loading } from "../../ui/kit";

type PanelTab = "links" | "outline" | "graph";

/** Backlinks, outgoing links, unlinked mentions and the heading outline for the open note. */
export function Panels({ memory, links, loading, outline, onJump }: { memory: Memory; links: NoteLinks | null; loading: boolean; outline: OutlineItem[]; onJump: (id: string) => void }) {
  const [tab, setTab] = useState<PanelTab>("links");
  const open = (id: string) => go({ tab: "knowledge", id });
  const local = useMemo(() => (links ? localGraphFromLinks({ id: memory.id, title: memory.title }, links) : null), [links, memory.id, memory.title]);
  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Note panels" style={{ marginTop: 0 }}>
        <button role="tab" aria-selected={tab === "links"} className={`tab ${tab === "links" ? "on" : ""}`} onClick={() => setTab("links")}>Links{links ? ` (${links.backlinks.length})` : ""}</button>
        <button role="tab" aria-selected={tab === "outline"} className={`tab ${tab === "outline" ? "on" : ""}`} onClick={() => setTab("outline")}>Outline{outline.length ? ` (${outline.length})` : ""}</button>
        <button role="tab" aria-selected={tab === "graph"} className={`tab ${tab === "graph" ? "on" : ""}`} onClick={() => setTab("graph")}>Graph</button>
      </div>
      {tab === "graph" ? (
        !local || local.nodes.length < 2 ? <Empty>No connections yet. Link this note with <code>[[Note title]]</code> to see its neighbourhood.</Empty> : (
          <>
            <GraphView compact data={local} focusId={memory.id} ariaLabel={`Links around ${memory.title}`} height={260}
              onOpen={(n) => { if (n.id !== memory.id) openNode(n); }} />
            <div style={{ marginTop: 8 }}><button className="link small" onClick={() => go({ tab: "graph", id: memory.id })}>Open in the full graph →</button></div>
          </>
        )
      ) : tab === "outline" ? (
        outline.length === 0 ? <Empty>No headings yet. Use # Heading in the note.</Empty> :
          <nav className="outline" aria-label="Outline">{outline.map((o) => <a key={o.id} href={`#md-${o.id}`} className={`l${Math.min(o.level, 4)}`} onClick={(e) => { e.preventDefault(); onJump(o.id); }}>{o.text}</a>)}</nav>
      ) : loading && !links ? <Loading /> : !links ? <Empty>Links are unavailable right now.</Empty> : (
        <>
          <h2 className="subh">Backlinks <span className="muted">({links.backlinks.length})</span></h2>
          {links.backlinks.length === 0 ? <p className="muted small">No other note links here yet.</p> : (
            <ul className="linklist">{links.backlinks.map((b) => (
              <li key={b.id}><button onClick={() => open(b.id)}><Icon name="file" size={13} /> {b.title}{b.excerpt && <span className="ctx">{b.excerpt}</span>}</button></li>))}</ul>
          )}
          <h2 className="subh">Outgoing links <span className="muted">({links.outgoing.length})</span></h2>
          {links.outgoing.length === 0 && links.unresolved.length === 0 ? <p className="muted small">This note does not link to others.</p> : (
            <ul className="linklist">
              {links.outgoing.map((o) => <li key={o.id}><button onClick={() => open(o.id)}><Icon name="link" size={13} /> {o.title}</button></li>)}
              {links.unresolved.map((u) => <li key={u}><span className="muted small" style={{ padding: "6px 8px", display: "block" }} title="No note with this title exists yet">⌁ {u} (not created)</span></li>)}
            </ul>
          )}
          {links.unlinked_mentions.length > 0 && (
            <>
              <h2 className="subh">Unlinked mentions <span className="muted">({links.unlinked_mentions.length})</span></h2>
              <p className="muted small">These notes mention this title without linking to it.</p>
              <ul className="linklist">{links.unlinked_mentions.map((u) => <li key={u.id}><button onClick={() => open(u.id)}><Icon name="file" size={13} /> {u.title}</button></li>)}</ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
