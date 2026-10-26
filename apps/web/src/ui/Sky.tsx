import { useMemo } from "react";
import { SKY_H, SKY_W, buildingSummary, layoutConstellation, layoutSkyline, shapePath, starSummary } from "../core/sky";
import { Building, Constellation as ConstellationData } from "../core/types";

/** The Constellation: one shape per approved memory. Shape = type, glow = verified use, hollow = used but never verified. */
export function ConstellationView({ data, selected, onSelect }: { data: ConstellationData; selected: string | null; onSelect: (id: string) => void }) {
  const layout = useMemo(() => layoutConstellation(data.stars), [data.stars]);
  const at = new Map(layout.placed.map((p) => [p.star.id, p]));
  return (
    <svg className="constellation" viewBox={`0 0 ${SKY_W} ${SKY_H}`} role="group" aria-label="Constellation of memories">
      {layout.clusters.map((c) => (
        <g key={c.name}><circle className="cluster" cx={c.x} cy={c.y} r={c.radius + 14} /><text className="clabel" x={c.x} y={c.y - c.radius - 20} textAnchor="middle">{c.name}</text></g>))}
      {data.links.map((l) => {
        const a = at.get(l.from), b = at.get(l.to);
        return a && b ? <line key={`${l.from}-${l.to}`} className="slink" x1={a.x} y1={a.y} x2={b.x} y2={b.y}><title>replaces an older memory</title></line> : null;
      })}
      {layout.placed.map(({ star: s, x, y, r }) => (
        <g key={s.id} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-pressed={selected === s.id} aria-label={starSummary(s)}
          className={`star st-${s.state}${s.hollow ? " hollow" : ""}${selected === s.id ? " sel" : ""}`} style={{ opacity: 0.35 + 0.65 * s.brightness }}
          onClick={() => onSelect(s.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(s.id); } }}>
          <path d={shapePath(s.type, r)} /><title>{starSummary(s)}</title>
        </g>))}
    </svg>
  );
}

/** The Skyline: a building per project, a floor per verified outcome, lit windows while work runs, scaffolding while waiting for you. */
export function SkylineView({ projects, onOpen }: { projects: Building[]; onOpen: (id: string) => void }) {
  const { towers, width, ground } = useMemo(() => layoutSkyline(projects), [projects]);
  return (
    <svg className="skyline" viewBox={`0 0 ${width} 260`} role="group" aria-label="Skyline of projects">
      <line className="ground" x1="0" y1={ground} x2={width} y2={ground} />
      {towers.map((t) => (
        <g key={t.b.id} role="button" tabIndex={0} aria-label={buildingSummary(t.b)} className={`tower${t.b.waiting ? " scaffold" : ""}`}
          onClick={() => onOpen(t.b.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(t.b.id); } }}>
          <rect className="body" x={t.x} y={t.y} width={t.w} height={t.h} />
          {Array.from({ length: t.shown }, (_, i) => <line key={i} className="floor" x1={t.x} x2={t.x + t.w} y1={ground - 22 - i * 14} y2={ground - 22 - i * 14} />)}
          {Array.from({ length: t.windows }, (_, i) => <rect key={i} className="win" x={t.x + 8 + (i % 3) * 18} y={t.y + 8 + Math.floor(i / 3) * 10} width="10" height="6" />)}
          {t.b.waiting > 0 && <path className="scaf" d={`M${t.x - 4} ${t.y} L${t.x - 4} ${ground} M${t.x + t.w + 4} ${t.y} L${t.x + t.w + 4} ${ground} M${t.x - 4} ${t.y + t.h / 2} L${t.x + t.w + 4} ${t.y + t.h / 2}`} />}
          {t.extra > 0 && <text className="clabel" x={t.x + t.w / 2} y={t.y - 4} textAnchor="middle">+{t.extra}</text>}
          <text className="clabel" x={t.x + t.w / 2} y={ground + 14} textAnchor="middle">{t.b.name.length > 10 ? t.b.name.slice(0, 9) + "…" : t.b.name}</text>
          <title>{buildingSummary(t.b)}</title>
        </g>))}
    </svg>
  );
}
