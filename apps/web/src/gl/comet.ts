import * as THREE from "three";
import type { Body } from "../core/scene";
import type { Vec3 } from "../core/space3d";
import { NOISE } from "./glsl";
import { posExact } from "./motion";
import { cometActivity, mulberry32 } from "./procedural";
import { billboard, type BuildEnv, type FrameCtx, type Part } from "./util";

// Camera-facing ribbons along a centre line (comet tails, engine trails). The centre line is set on the CPU each
// frame (a few dozen points) and widened in the vertex shader perpendicular to the view.
const RIBBON_VERT = /* glsl */ `
attribute vec3 aTangent; attribute float aS; attribute float aSide;
uniform float uW0, uW1;
varying float vS; varying float vSide;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 tg = normalize(mat3(modelMatrix) * aTangent);
  vec3 vd = normalize(cameraPosition - wp);
  vec3 side = cross(tg, vd);
  float l = length(side);
  side = l > 1e-4 ? side / l : vec3(0.0, 1.0, 0.0);
  wp += side * aSide * mix(uW0, uW1, aS);
  vS = aS; vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const RIBBON_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uTime, uBright, uStreak, uFalloff;
varying float vS; varying float vSide;
${NOISE}
void main() {
  float across = exp(-vSide * vSide * 2.6);
  float along = pow(clamp(1.0 - vS, 0.0, 1.0), uFalloff) * smoothstep(0.0, 0.03, vS);
  float st = 1.0 + uStreak * 0.7 * gnoise(vec3(vSide * 4.0, vS * 7.0 - uTime * 0.5, 1.7));
  gl_FragColor = vec4(uColor * across * along * max(st, 0.0) * uBright, 1.0);
}`;

export class Ribbon {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private pos: THREE.BufferAttribute; private tan: THREE.BufferAttribute;
  constructor(readonly n: number, color: THREE.Color, opts: { w0: number; w1: number; streak?: number; falloff?: number }) {
    const geo = new THREE.BufferGeometry();
    const position = new Float32Array(n * 6), tangent = new Float32Array(n * 6), s = new Float32Array(n * 2), side = new Float32Array(n * 2);
    const index: number[] = [];
    for (let i = 0; i < n; i++) {
      s[i * 2] = s[i * 2 + 1] = i / (n - 1);
      side[i * 2] = -1; side[i * 2 + 1] = 1;
      if (i < n - 1) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    this.pos = new THREE.BufferAttribute(position, 3); this.pos.setUsage(THREE.DynamicDrawUsage);
    this.tan = new THREE.BufferAttribute(tangent, 3); this.tan.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.pos);
    geo.setAttribute("aTangent", this.tan);
    geo.setAttribute("aS", new THREE.BufferAttribute(s, 1));
    geo.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    geo.setIndex(index);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color }, uTime: { value: 0 }, uBright: { value: 1 }, uStreak: { value: opts.streak ?? 0 }, uFalloff: { value: opts.falloff ?? 1.5 }, uW0: { value: opts.w0 }, uW1: { value: opts.w1 } },
      vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }
  /** Set the centre line (n points, head first). */
  set(points: Vec3[]) {
    const p = this.pos.array as Float32Array, t = this.tan.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(this.n - 1, i + 1)], c = points[i];
      const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      for (const k of [0, 1]) { p.set(c, (i * 2 + k) * 3); t.set([tx, ty, tz], (i * 2 + k) * 3); }
    }
    this.pos.needsUpdate = true; this.tan.needsUpdate = true;
  }
  get uniforms() { return this.mesh.material.uniforms; }
}

/** A lumpy rock: an icosphere displaced by a few seeded waves. */
export function lumpyGeometry(radius: number, seed: number, detail = 3, rough = 0.28): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const rnd = mulberry32(seed * 97 + 5);
  const waves = Array.from({ length: 7 }, (_, i) => ({ d: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), f: 1.2 + i * 0.9 + rnd(), a: rough / (1 + i * 0.6), ph: rnd() * 6.28 }));
  const p = geo.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
  const squash = new THREE.Vector3(0.75 + rnd() * 0.5, 0.7 + rnd() * 0.4, 0.8 + rnd() * 0.4);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let k = 1;
    for (const w of waves) k += w.a * Math.sin(v.dot(w.d) * w.f * 3 + w.ph);
    v.multiplyScalar(radius * k).multiply(squash);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

const COMA_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uBright;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float core = exp(-r * r * 90.0) * 3.0;
  float coma = exp(-r * r * 9.0) * 0.55 + exp(-r * 3.0) * 0.1;
  gl_FragColor = vec4((vec3(1.0) * core + uColor * coma) * uBright * smoothstep(1.0, 0.85, r), 1.0);
}`;

export function buildComet(body: Body, env: BuildEnv): Part {
  const group = new THREE.Group();
  const head = new THREE.Group();
  group.add(head);
  const nucleus = new THREE.Mesh(lumpyGeometry(body.r * 0.38, body.look.seed, 3, 0.3), new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 1, metalness: 0, flatShading: false }));
  head.add(nucleus);
  const coma = billboard(COMA_FRAG, { uColor: { value: new THREE.Color(0.35, 0.75, 0.8) }, uBright: { value: 1 } }, body.r * 6);
  coma.renderOrder = 7;
  head.add(coma);
  const N = 32;
  const ion = new Ribbon(N, new THREE.Color(0.25, 0.5, 1.4), { w0: body.r * 0.25, w1: body.r * 2.2, streak: 1, falloff: 1.2 });
  const dust = new Ribbon(N, new THREE.Color(1.3, 1.0, 0.62), { w0: body.r * 0.35, w1: body.r * 5.5, streak: 0.45, falloff: 1.5 });
  group.add(ion.mesh, dust.mesh);
  env.tracker.track(group);
  const ionPts: Vec3[] = Array.from({ length: N }, () => [0, 0, 0]), dustPts: Vec3[] = Array.from({ length: N }, () => [0, 0, 0]);
  return {
    object: group, anchor: { id: body.id, obj: head, r: body.r },
    update(c: FrameCtx) {
      const p = c.pos.get(body.id) ?? body.pos;
      head.position.set(p[0], p[1], p[2]);
      nucleus.rotation.set(c.t * body.spin * 0.7, c.t * body.spin, 0);
      const d = Math.hypot(p[0], p[1], p[2]) || 1;
      const anti: Vec3 = [p[0] / d, p[1] / d, p[2] / d];
      const cur = c.index.get(body.id) ?? body;
      const a = posExact(c.world, cur, c.t + 0.5, c.index), b = posExact(c.world, cur, c.t - 0.5, c.index);
      let v: Vec3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const along = v[0] * anti[0] + v[1] * anti[1] + v[2] * anti[2];
      v = [v[0] - along * anti[0], v[1] - along * anti[1], v[2] - along * anti[2]];
      const vl = Math.hypot(...v) || 1;
      const lag: Vec3 = [-v[0] / vl, -v[1] / vl, -v[2] / vl];
      const act = cometActivity(d);
      const L = act.length;
      for (let i = 0; i < N; i++) {
        const s = i / (N - 1);
        ionPts[i] = [p[0] + anti[0] * s * L, p[1] + anti[1] * s * L, p[2] + anti[2] * s * L];
        const k1 = s * L * 0.75, k2 = s * s * L * 0.38;
        dustPts[i] = [p[0] + anti[0] * k1 + lag[0] * k2, p[1] + anti[1] * k1 + lag[1] * k2, p[2] + anti[2] * k1 + lag[2] * k2];
      }
      ion.set(ionPts); dust.set(dustPts);
      ion.uniforms.uBright.value = 0.55 * act.brightness; dust.uniforms.uBright.value = 0.2 * act.brightness;
      ion.uniforms.uW1.value = body.r * 0.6 + L * 0.035; dust.uniforms.uW1.value = body.r + L * 0.075;
      ion.uniforms.uTime.value = c.t; dust.uniforms.uTime.value = c.t;
      coma.material.uniforms.uBright.value = 0.5 + 0.8 * Math.min(1.5, act.brightness);
      coma.material.uniforms.uSize.value = body.r * (3 + 3 * Math.min(1.5, act.brightness));
    },
  };
}
