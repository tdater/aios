import * as THREE from "three";
import type { World } from "../core/scene";
import type { Vec3 } from "../core/space3d";
import { starKey } from "./memories";
import { billboard, type BuildEnv, type FrameCtx, type Part } from "./util";

// Orbit guide rings, selection/hover halos, beams from the selected AI to the memories it was told, and debug markers.

const RING_COLORS: Record<string, [number, number, number]> = { private: [1.0, 0.72, 0.35], public: [0.35, 0.85, 0.85], none: [0.55, 0.6, 0.9] };

export function buildOrbitRings(world: World, env: BuildEnv): Part {
  const group = new THREE.Group();
  for (const ring of world.rings) {
    const c = RING_COLORS[ring.level] ?? [0.6, 0.6, 0.7];
    const g = new THREE.BufferGeometry().setFromPoints(ring.points.map((p) => new THREE.Vector3(...p)));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color(c[0] * 0.16, c[1] * 0.16, c[2] * 0.16), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    line.renderOrder = 3;
    group.add(line);
  }
  env.tracker.track(group);
  return { object: group };
}

const HALO_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uPulse;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float ring = exp(-((r - 0.72) / 0.03) * ((r - 0.72) / 0.03)) + exp(-((r - 0.72) / 0.15) * ((r - 0.72) / 0.15)) * 0.3;
  gl_FragColor = vec4(uColor * ring * uPulse * smoothstep(1.0, 0.9, r), 1.0);
}`;

/** Where an id is and how big it is: body ids, `star:<id>`, `constellation:<name>`. */
export function locate(world: World, id: string, pos: Map<string, Vec3>): { p: Vec3; r: number } | null {
  if (id.startsWith("star:")) { const s = world.stars.find((x) => x.star.id === starKey(id)); return s ? { p: s.pos, r: s.r * 0.9 } : null; }
  if (id.startsWith("constellation:")) { const c = world.clusters.find((x) => `constellation:${x.name}` === id); return c ? { p: c.pos, r: c.radius * 0.8 } : null; }
  const b = world.bodies.find((x) => x.id === id);
  if (!b) return null;
  const k = b.type === "nebula" ? 0.6 : b.type === "sun" ? 1.15 : b.type === "planet" && b.look.ring ? 1.9 : 1.25;
  return { p: pos.get(b.id) ?? b.pos, r: b.r * k };
}

const BEAM_VERT = /* glsl */ `
attribute float aT; varying float vT;
void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uTime; varying float vT;
void main() { float a = mix(0.45, 0.05, vT) * (0.75 + 0.25 * sin(vT * 30.0 - uTime * 4.0)); gl_FragColor = vec4(uColor * a, 1.0); }`;

export function buildSelection(world: World, env: BuildEnv): Part {
  const group = new THREE.Group();
  const sel = billboard(HALO_FRAG, { uColor: { value: new THREE.Color(0.9, 1.1, 1.4) }, uPulse: { value: 1 } }, 1);
  const hov = billboard(HALO_FRAG, { uColor: { value: new THREE.Color(0.5, 0.6, 0.75) }, uPulse: { value: 1 } }, 1);
  sel.renderOrder = hov.renderOrder = 20;
  group.add(sel, hov);
  const maxBeams = Math.max(1, world.stars.length);
  const bp = new Float32Array(maxBeams * 6), bt = new Float32Array(maxBeams * 2);
  for (let i = 0; i < maxBeams; i++) { bt[i * 2] = 0; bt[i * 2 + 1] = 1; }
  const bg = new THREE.BufferGeometry();
  const bpa = new THREE.BufferAttribute(bp, 3); bpa.setUsage(THREE.DynamicDrawUsage);
  bg.setAttribute("position", bpa);
  bg.setAttribute("aT", new THREE.BufferAttribute(bt, 1));
  bg.setDrawRange(0, 0);
  const beams = new THREE.LineSegments(bg, new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(0.35, 0.6, 1.0) }, uTime: { value: 0 } }, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  beams.frustumCulled = false;
  beams.renderOrder = 9;
  group.add(beams);
  env.tracker.track(group);
  const starIndex = new Map(world.stars.map((s) => [s.star.id, s] as const));
  return {
    object: group,
    update(c: FrameCtx) {
      const pulse = c.reduced ? 1 : 0.8 + 0.2 * Math.sin(c.t * 2.4);
      for (const [mesh, id, k] of [[sel, c.selected, 1], [hov, c.hovered !== c.selected ? c.hovered : null, 0.7]] as const) {
        const at = id ? locate(c.world, id, c.pos) : null;
        mesh.visible = !!at;
        if (!at) continue;
        mesh.position.set(...at.p);
        mesh.material.uniforms.uSize.value = at.r * 1.35 * (id === c.selected && !c.reduced ? 1 + 0.03 * Math.sin(c.t * 2.4) : 1);
        mesh.material.uniforms.uPulse.value = pulse * k;
      }
      const from = c.selected ? c.index.get(c.selected) : undefined;
      let n = 0;
      if (from && from.type === "planet") {
        const p = c.pos.get(from.id) ?? from.pos;
        for (const id of c.told) {
          const s = starIndex.get(starKey(id));
          if (!s || n >= maxBeams) continue;
          bp.set(p, n * 6); bp.set(s.pos, n * 6 + 3); n++;
        }
        bpa.needsUpdate = true;
      }
      bg.setDrawRange(0, n * 2);
      (beams.material as THREE.ShaderMaterial).uniforms.uTime.value = c.t;
    },
  };
}

/** Debug markers: bright green points of fixed pixel size, drawn on top of everything (alignment tests). */
export function buildMarkers(points: Vec3[], env: BuildEnv): Part {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points.flat()), 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 5 } },
    vertexShader: "uniform float uPx; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uPx; }",
    fragmentShader: "void main() { gl_FragColor = vec4(0.0, 6.0, 0.0, 1.0); }",
    depthTest: false, depthWrite: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 100;
  env.tracker.track(pts);
  return { object: pts };
}
