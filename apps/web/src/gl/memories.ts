import * as THREE from "three";
import type { World } from "../core/scene";
import type { Star3, Vec3 } from "../core/space3d";
import { memoryColor } from "./procedural";
import type { BuildEnv, FrameCtx, Part } from "./util";

// Memories as one THREE.Points draw call (a glow sprite per star), constellation lines as one LineSegments, and a soft
// glow at each constellation's centre where the page puts its label.

const VERT = /* glsl */ `
attribute vec3 aColor; attribute float aSize; attribute float aPhase; attribute float aHollow; attribute float aBoost;
uniform float uTime, uFocal, uTwinkle;
varying vec3 vColor; varying float vHollow;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 1.0 + uTwinkle * 0.14 * sin(uTime * (0.8 + aPhase * 1.6) + aPhase * 31.0);
  gl_PointSize = clamp(aSize * (1.0 + 0.25 * aBoost) * uFocal / max(-mv.z, 1.0), 2.0, 1024.0);
  vColor = aColor * tw * (1.0 + aBoost * 1.6);
  vHollow = aHollow;
}`;
const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vColor; varying float vHollow;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  float glow = texture2D(uMap, gl_PointCoord).a;
  float ring = exp(-((r - 0.2) / 0.045) * ((r - 0.2) / 0.045)) * 0.9 + glow * 0.22 * smoothstep(0.12, 0.3, r);
  float a = mix(glow, ring, vHollow);
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

export const starKey = (id: string) => (id.startsWith("star:") ? id.slice("star:".length) : id);

/** Per-star rendering attributes; pure so it can be tested. */
export function memoryAttributes(stars: Star3[]): { color: Float32Array; size: Float32Array; hollow: Float32Array; phase: Float32Array } {
  const n = stars.length;
  const color = new Float32Array(n * 3), size = new Float32Array(n), hollow = new Float32Array(n), phase = new Float32Array(n);
  stars.forEach((s, i) => {
    let c = memoryColor(s.star.type);
    let k = 0.75 + 0.75 * Math.max(0, Math.min(1, s.star.brightness));
    if (s.star.state === "stale" || s.star.state === "superseded") { c = [c[0] * 0.55 + 0.45, c[1] * 0.45 + 0.08, c[2] * 0.35 + 0.05]; k *= 0.4; }
    else if (s.star.state === "candidate") k *= 0.7;
    color.set([c[0] * k, c[1] * k, c[2] * k], i * 3);
    size[i] = s.r * 2.1;
    hollow[i] = s.star.hollow ? 1 : 0;
    let h = 0; for (let j = 0; j < s.star.id.length; j++) h = (h * 31 + s.star.id.charCodeAt(j)) >>> 0;
    phase[i] = (h % 1000) / 1000;
  });
  return { color, size, hollow, phase };
}

/** Constellation lines: a nearest-neighbour spanning tree inside each cluster (Prim's algorithm). */
export function constellationEdges(stars: Star3[]): [number, number][] {
  const groups = new Map<string, number[]>();
  stars.forEach((s, i) => { const k = s.star.project ?? "Everywhere"; groups.set(k, [...(groups.get(k) ?? []), i]); });
  const d2 = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const edges: [number, number][] = [];
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    const inTree = new Uint8Array(idx.length), best = new Float64Array(idx.length).fill(Infinity), from = new Int32Array(idx.length).fill(-1);
    best[0] = 0;
    for (let step = 0; step < idx.length; step++) {
      let u = -1;
      for (let i = 0; i < idx.length; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
      inTree[u] = 1;
      if (from[u] >= 0) edges.push([idx[from[u]], idx[u]]);
      for (let v = 0; v < idx.length; v++) {
        if (inTree[v]) continue;
        const d = d2(stars[idx[u]].pos, stars[idx[v]].pos);
        if (d < best[v]) { best[v] = d; from[v] = u; }
      }
    }
  }
  return edges;
}

export function buildMemories(world: World, env: BuildEnv): Part & { boostFor(selected: string | null, hovered: string | null, told: Set<string>): void } {
  const group = new THREE.Group();
  const stars = world.stars;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(stars.length * 3);
  stars.forEach((s, i) => pos.set(s.pos, i * 3));
  const a = memoryAttributes(stars);
  const boost = new Float32Array(stars.length);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(a.color, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(a.size, 1));
  geo.setAttribute("aHollow", new THREE.BufferAttribute(a.hollow, 1));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(a.phase, 1));
  const boostAttr = new THREE.BufferAttribute(boost, 1);
  geo.setAttribute("aBoost", boostAttr);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFocal: { value: 500 }, uTwinkle: { value: 1 }, uMap: { value: env.glowSpikes } },
    vertexShader: VERT, fragmentShader: FRAG, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = 6;
  group.add(points);

  const edges = constellationEdges(stars);
  if (edges.length) {
    const lp = new Float32Array(edges.length * 6), lc = new Float32Array(edges.length * 6);
    edges.forEach(([i, j], k) => {
      lp.set(stars[i].pos, k * 6); lp.set(stars[j].pos, k * 6 + 3);
      lc.set([0.05, 0.065, 0.1, 0.05, 0.065, 0.1], k * 6);
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(lp, 3));
    lg.setAttribute("color", new THREE.BufferAttribute(lc, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    lines.renderOrder = 5;
    group.add(lines);
  }

  if (world.clusters.length) {
    const cg = new THREE.BufferGeometry();
    const cp = new Float32Array(world.clusters.length * 3), cs = new Float32Array(world.clusters.length), cc = new Float32Array(world.clusters.length * 3), ch = new Float32Array(world.clusters.length), cph = new Float32Array(world.clusters.length);
    world.clusters.forEach((c, i) => { cp.set(c.pos, i * 3); cs[i] = c.radius * 2.4; cc.set([0.018, 0.022, 0.04], i * 3); });
    cg.setAttribute("position", new THREE.BufferAttribute(cp, 3));
    cg.setAttribute("aColor", new THREE.BufferAttribute(cc, 3));
    cg.setAttribute("aSize", new THREE.BufferAttribute(cs, 1));
    cg.setAttribute("aHollow", new THREE.BufferAttribute(ch, 1));
    cg.setAttribute("aPhase", new THREE.BufferAttribute(cph, 1));
    cg.setAttribute("aBoost", new THREE.BufferAttribute(new Float32Array(world.clusters.length), 1));
    const cm = mat.clone();
    cm.uniforms.uMap = { value: env.glow };
    cm.uniforms.uTwinkle = { value: 0 };
    const glows = new THREE.Points(cg, cm);
    glows.renderOrder = 4;
    group.add(glows);
  }
  env.tracker.track(group);

  const index = new Map(stars.map((s, i) => [s.star.id, i] as const));
  let lastKey = "";
  return {
    object: group,
    boostFor(selected, hovered, told) {
      const key = `${selected}|${hovered}|${[...told].join(",")}`;
      if (key === lastKey) return;
      lastKey = key;
      boost.fill(0);
      for (const id of told) { const i = index.get(starKey(id)); if (i !== undefined) boost[i] = 1; }
      for (const [id, v] of [[hovered, 0.8], [selected, 1.6]] as const) {
        if (!id) continue;
        if (id.startsWith("star:")) { const i = index.get(starKey(id)); if (i !== undefined) boost[i] = Math.max(boost[i], v); }
        if (id.startsWith("constellation:")) { const name = id.slice("constellation:".length); stars.forEach((s, i) => { if ((s.star.project ?? "Everywhere") === name) boost[i] = Math.max(boost[i], v * 0.5); }); }
      }
      boostAttr.needsUpdate = true;
    },
    update(c: FrameCtx) {
      mat.uniforms.uTime.value = c.t;
      mat.uniforms.uTwinkle.value = c.reduced ? 0 : 1;
    },
  };
}

/** Set the focal length (device pixels) used to size points in world units. */
export function setPointFocal(obj: THREE.Object3D, focal: number) {
  obj.traverse((o) => {
    const m = (o as THREE.Points).material as THREE.ShaderMaterial | undefined;
    if ((o as THREE.Points).isPoints && m?.uniforms?.uFocal) m.uniforms.uFocal.value = focal;
  });
}
