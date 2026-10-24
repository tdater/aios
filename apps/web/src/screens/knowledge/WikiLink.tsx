import { useEffect, useRef, useState } from "react";
import { Memory } from "../../core/types";
import { resolveWiki } from "../../core/vault";
import { Markdown } from "../../ui/Markdown";
import { useApp } from "../../ui/Context";
import { go } from "../../ui/hooks";
import { Badge } from "../../ui/kit";
import { newNoteTitle, pendingAnchor, useVault } from "./vaultContext";

const previews = new Map<string, Memory>();

/** A [[wiki link]]: resolved links open the note (with a hover/focus preview), unresolved ones offer to create it. */
export function WikiLink({ target, alias, heading }: { target: string; alias?: string; heading?: string }) {
  const { client } = useApp();
  const vault = useVault();
  const id = resolveWiki(target, vault.index);
  const label = alias ?? (heading ? `${target} › ${heading}` : target);
  const [card, setCard] = useState<{ x: number; y: number; flip: boolean } | null>(null);
  const [data, setData] = useState<Memory | null>(id ? previews.get(id) ?? null : null);
  const ref = useRef<HTMLButtonElement>(null);
  const timers = useRef<{ open?: ReturnType<typeof setTimeout>; close?: ReturnType<typeof setTimeout> }>({});
  useEffect(() => () => { clearTimeout(timers.current.open); clearTimeout(timers.current.close); }, []);

  if (!id) {
    return (
      <button type="button" className="wikilink ghost" title={`“${target}” does not exist yet. Click to create it.`}
        onClick={() => { newNoteTitle.set(target); go({ tab: "knowledge", id: "new" }); }}>{label}</button>
    );
  }
  const show = () => {
    clearTimeout(timers.current.close);
    timers.current.open = setTimeout(async () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const flip = r.bottom + 220 > window.innerHeight;
      setCard({ x: Math.max(8, Math.min(r.left, window.innerWidth - 360)), y: flip ? r.top - 8 : r.bottom + 6, flip });
      if (!previews.has(id)) {
        try { previews.set(id, await client.get<Memory>(`/memories/${id}`)); } catch { return; }
      }
      setData(previews.get(id) ?? null);
    }, 350);
  };
  const hide = () => { clearTimeout(timers.current.open); timers.current.close = setTimeout(() => setCard(null), 140); };
  return (
    <>
      <button type="button" ref={ref} className="wikilink" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        onClick={() => { setCard(null); pendingAnchor.set(heading ?? null); go({ tab: "knowledge", id }); }} aria-describedby={card ? `wp-${id}` : undefined}>{label}</button>
      {card && data && (
        <div className="hovercard" id={`wp-${id}`} role="tooltip" style={{ left: card.x, top: card.y, transform: card.flip ? "translateY(-100%)" : undefined }}
          onMouseEnter={() => clearTimeout(timers.current.close)} onMouseLeave={hide}>
          <h4>{data.title}</h4>
          <div className="row" style={{ justifyContent: "flex-start", marginBottom: 6 }}><Badge s={data.status === "approved" ? "approved" : "pending"} label={data.status} /><span className="muted small">{data.type}</span></div>
          <div style={{ maxHeight: 150, overflow: "hidden" }}><Markdown source={(data.body ?? "").slice(0, 520)} wiki={(t, a) => <span className="wikilink ghost">{a ?? t}</span>} /></div>
        </div>
      )}
    </>
  );
}
