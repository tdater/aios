import * as THREE from "three";
import type { Body, World } from "../core/scene";
import { lumpyGeometry } from "./comet";
import { mulberry32 } from "./procedural";
import type { BuildEnv, FrameCtx, Part } from "./util";

// The asteroid belt around Home Base: three rock shapes drawn as instanced meshes (tumbling, lit by the sun), a dust
// ring of points, and the named finding rocks, larger and with an amber rim glow so they stand out.
const BELT_PERIOD = 240;        // matches the named rocks' orbit period in layoutWorld

const RIM_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const RIM_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uPulse;
varying vec3 vN; varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
  gl_FragColor = vec4(uColor * f * uPulse, 1.0);
}`;

const DUST_VERT = /* glsl */ `
attribute float aSize; uniform float uFocal;
varying float vLit;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * w;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uFocal / max(-mv.z, 1.0), 1.0, 6.0);
  vLit = 0.6 + 0.4 * dot(normalize(cameraPosition - w.xyz), normalize(-w.xyz));
}`;
const DUST_FRAG = /* glsl */ `
uniform vec3 uColor; varying float vLit;
void main() { vec2 c = gl_PointCoord * 2.0 - 1.0; gl_FragColor = vec4(uColor * vLit * exp(-dot(c, c) * 3.0), 1.0); }`;

export function buildBelt(world: World, findings: Body[], env: BuildEnv): Part | null {
  const belt = world.belt;
  if (!belt) return null;
  const root = new THREE.Group();
  const spin = new THREE.Group();
  spin.position.set(...belt.center);
  root.add(spin);
  const dustRocks = belt.rocks.filter((r) => !r.finding).map((r) => ({ ...r }));
  const shapes = [0, 1, 2].map((i) => lumpyGeometry(1, 300 + i * 17, 3, 0.34));
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.04 });
  const groups = shapes.map((g, i) => {
    const list = dustRocks.filter((_, k) => k % 3 === i);
    const mesh = new THREE.InstancedMesh(g, mat, Math.max(1, list.length));
    mesh.count = list.length;
    mesh.frustumCulled = false;
    const rnd = mulberry32(900 + i);
    // The layout's angles come from hashes of similar strings and bunch up; spread the unnamed dust evenly instead.
    list.forEach((r, k) => { r.angle = ((k * 3 + i) / Math.max(1, dustRocks.length)) * Math.PI * 2 + (rnd() - 0.5) * 0.05; r.radius = belt.inner + (belt.outer - belt.inner) * (0.15 + 0.7 * rnd()); });
    list.forEach((_, k) => { const c = 0.13 + rnd() * 0.12; mesh.setColorAt(k, new THREE.Color(c * 1.06, c * 0.97, c * 0.88)); });
    spin.add(mesh);
    const axes = list.map(() => new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize());
    const rates = list.map(() => 0.1 + rnd() * 0.5);
    return { mesh, list, axes, rates };
  });

  const dustN = 3200, rnd = mulberry32(77);
  const dp = new Float32Array(dustN * 3), ds = new Float32Array(dustN);
  for (let i = 0; i < dustN; i++) {
    const a = rnd() * Math.PI * 2, rr = belt.inner + (belt.outer - belt.inner) * (0.5 + (rnd() + rnd() + rnd() - 1.5) * 0.45);
    dp.set([Math.cos(a) * rr, (rnd() + rnd() - 1) * 6, Math.sin(a) * rr], i * 3);
    ds[i] = 0.5 + rnd() * 0.9;
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  dg.setAttribute("aSize", new THREE.BufferAttribute(ds, 1));
  const dust = new THREE.Points(dg, new THREE.ShaderMaterial({ uniforms: { uFocal: { value: 500 }, uColor: { value: new THREE.Color(0.11, 0.09, 0.07) } }, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  dust.frustumCulled = false;
  spin.add(dust);

  const named = findings.map((b) => {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(lumpyGeometry(b.r, b.look.seed + 11, 3, 0.3), new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.9, metalness: 0.05 }));
    const rimMat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(1.8, 0.95, 0.25) }, uPulse: { value: 1 } }, vertexShader: RIM_VERT, fragmentShader: RIM_FRAG, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.BackSide });
    const rim = new THREE.Mesh(lumpyGeometry(b.r * 1.18, b.look.seed + 11, 3, 0.3), rimMat);
    g.add(rock, rim);
    root.add(g);
    return { b, g, rimMat };
  });
  env.tracker.track(root);
  const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  let firstFrame = true;
  return {
    object: root,
    update(c: FrameCtx) {
      spin.rotation.y = -(2 * Math.PI * c.t) / BELT_PERIOD;
      if (!c.reduced || firstFrame) {
        for (const grp of groups) {
          grp.list.forEach((r, k) => {
            v.set(Math.cos(r.angle) * r.radius, r.y, Math.sin(r.angle) * r.radius);
            qq.setFromAxisAngle(grp.axes[k], c.t * grp.rates[k] + k);
            m.compose(v, qq, s.setScalar(r.r));
            grp.mesh.setMatrixAt(k, m);
          });
          grp.mesh.instanceMatrix.needsUpdate = true;
        }
        firstFrame = false;
      }
      for (const n of named) {
        const p = c.pos.get(n.b.id) ?? n.b.pos;
        n.g.position.set(p[0], p[1], p[2]);
        n.g.rotation.set(c.t * n.b.spin * 0.5, c.t * n.b.spin, 0);
        n.rimMat.uniforms.uPulse.value = c.reduced ? 1 : 0.8 + 0.35 * Math.sin(c.t * 1.6 + n.b.look.seed);
      }
    },
  };
}
