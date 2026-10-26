import { Frame } from "../core/arrival";
import { Body, World } from "../core/scene";
import { Camera, View, project } from "../core/space3d";

// The flat-drawn universe: every object type as a recognisable shape, projected with the same camera as the WebGL view,
// so labels, clicks and arrival animations behave identically. Used when WebGL is not available or the person picks "Flat picture".

export interface Placed { body: Body; x: number; y: number; r: number; depth: number }

export function place(world: World, cam: Camera, view: View, at: (b: Body) => [number, number, number]): Placed[] {
  const out: Placed[] = [];
  for (const body of world.bodies) {
    const p = project(cam, at(body), view);
    if (p) out.push({ body, x: p.x, y: p.y, r: Math.max(2.5, body.r * p.scale), depth: p.depth });
  }
  return out.sort((a, b) => b.depth - a.depth);
}

const hue = (b: Body) => b.look.hue;
const fillFor = (b: Body) => `hsl(${hue(b)} ${b.look.family === "star" ? 95 : 55}% ${b.look.family === "star" ? 62 : 52}%)`;

function Shape({ p, glow }: { p: Placed; glow: number }) {
  const { body: b, r } = p;
  const fill = fillFor(b), stroke = `hsl(${hue(b)} 60% 80%)`;
  switch (b.look.family) {
    case "star": return <g><circle r={r * 1.9} fill={fill} opacity={0.18} /><circle r={r} fill={fill} /></g>;
    case "cloud": return <g opacity={0.5}><circle r={r} fill={fill} /><circle r={r * 0.62} cx={r * 0.35} cy={-r * 0.2} fill={fill} /></g>;
    case "gate": return <g fill="none" stroke={stroke} strokeWidth={2}><ellipse rx={r} ry={r * 0.55} /><ellipse rx={r * 0.55} ry={r * 0.3} /></g>;
    case "beacon": return <g><circle r={r} fill={b.type === "allstop" ? "hsl(0 75% 52%)" : fill} /><circle r={r * 1.8} fill="none" stroke={stroke} opacity={0.5} /></g>;
    case "station": return <g><rect x={-r} y={-r * 0.55} width={r * 2} height={r * 1.1} rx={r * 0.25} fill={fill} stroke={stroke} /><line x1={-r * 1.5} x2={r * 1.5} stroke={stroke} /></g>;
    case "comet": return <g><circle r={r} fill={fill} /><path d={`M ${-r} 0 L ${-r * 5} ${-r * 0.8} L ${-r * 5} ${r * 0.8} Z`} fill={fill} opacity={0.35} /></g>;
    case "console": return <rect x={-r} y={-r * 0.7} width={r * 2} height={r * 1.4} rx={3} fill={fill} stroke={stroke} />;
    case "rock": return <polygon points={`${-r},0 ${-r * 0.3},${-r} ${r},${-r * 0.4} ${r * 0.6},${r * 0.9} ${-r * 0.5},${r * 0.8}`} fill={fill} />;
    default: return <g>
      {b.look.ring && <ellipse rx={r * 1.9} ry={r * 0.55} fill="none" stroke={stroke} strokeWidth={2} opacity={0.7} />}
      <circle r={r} fill={fill} />{b.look.atmosphere && <circle r={r * 1.12} fill="none" stroke={stroke} opacity={0.35} />}
      {glow > 0 && <circle r={r * (1.4 + glow)} fill="none" stroke="#fff" opacity={glow * 0.6} />}
    </g>;
  }
}

export function ObjectField({ world, cam, view, selected, hovered, frames, simT, onPick, onHover }: {
  world: World; cam: Camera; view: View; selected: string | null; hovered: string | null; frames: Map<string, Frame>; simT: number;
  onPick: (id: string) => void; onHover: (id: string | null) => void;
}) {
  const placed = place(world, cam, view, (b) => b.pos);
  return (
    <svg className="object-field" viewBox={`0 0 ${view.w} ${view.h}`} width="100%" height="100%" role="img" aria-label="Your universe, drawn flat. Use the list view for a text version." data-t={Math.round(simT)}>
      <defs><radialGradient id="deep" cx="50%" cy="50%" r="75%"><stop offset="0%" stopColor="#101a33" /><stop offset="100%" stopColor="#03050c" /></radialGradient></defs>
      <rect width={view.w} height={view.h} fill="url(#deep)" />
      {world.stars.map((s) => { const p = project(cam, s.pos, view); return p ? <circle key={s.star.id} cx={p.x} cy={p.y} r={Math.max(1, s.r * p.scale * 0.5)} fill="#cfe0ff" opacity={0.7} /> : null; })}
      {placed.map((p) => {
        const f = frames.get(p.body.id);
        return (
          <g key={p.body.id} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} opacity={f ? f.alpha : 1} className={`u-body ${selected === p.body.id ? "sel" : ""}`}
            onPointerEnter={() => onHover(p.body.id)} onPointerLeave={() => onHover(null)} onClick={() => onPick(p.body.id)} style={{ cursor: "pointer" }} data-id={p.body.id}>
            <Shape p={p} glow={f?.glow ?? 0} />
            {(selected === p.body.id || hovered === p.body.id) && <circle r={p.r + 7} fill="none" stroke="#fff" strokeWidth={1.5} strokeDasharray="4 3" />}
          </g>);
      })}
    </svg>
  );
}
