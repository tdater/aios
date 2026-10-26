import * as THREE from "three";
import type { Body } from "../core/scene";
import { NOISE } from "./glsl";
import { hsl, mulberry32 } from "./procedural";
import { billboard, lin, type BuildEnv, type FrameCtx, type Part } from "./util";

// The nebula (layered fbm billboards, one instanced draw for glow and one for dark dust) and the wormhole
// (an event-horizon sphere, a Keplerian accretion disc with Doppler beaming, and a lensing photon ring).

const NEB_VERT = /* glsl */ `
attribute vec3 aColor; attribute float aSeed; attribute float aScale;
uniform float uTime;
varying vec2 vUv; varying vec3 vColor; varying float vSeed;
void main() {
  vUv = position.xy; vColor = aColor; vSeed = aSeed;
  vec4 c = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  c.xyz += vec3(sin(uTime * 0.03 + aSeed * 6.0), cos(uTime * 0.025 + aSeed * 4.0), sin(uTime * 0.02 + aSeed * 9.0)) * aScale * 0.06;
  vec4 mv = modelViewMatrix * c;
  float rot = aSeed * 6.2831 + uTime * 0.01 * (fract(aSeed * 13.0) - 0.5);
  mv.xy += mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * position.xy * aScale;
  gl_Position = projectionMatrix * mv;
}`;
// Cloud shapes are baked once into a 2x2 atlas (R = density, G = brightness); the sprites only sample it.
const NEB_BAKE = /* glsl */ `
varying vec2 vUv;
${NOISE}
void main() {
  vec2 cell = floor(vUv * 2.0), uv = fract(vUv * 2.0) * 2.0 - 1.0;
  float r = length(uv);
  vec3 q = vec3(uv * 1.7, (cell.x + cell.y * 2.0) * 17.0 + 3.0);
  float w = gnoise(q * 0.8 + 3.0);
  float n = fbm(q + vec3(w * 0.8), 7);
  float a = smoothstep(1.0, 0.15, r) * smoothstep(-0.15, 0.45, n + 0.3 * (1.0 - r) - 0.12);
  gl_FragColor = vec4(a, 0.7 + 0.6 * max(n, 0.0), 0.0, 1.0);
}`;
const NEB_FRAG = /* glsl */ `
uniform sampler2D uMap; uniform float uIntensity, uDark;
varying vec2 vUv; varying vec3 vColor; varying float vSeed;
void main() {
  if (dot(vUv, vUv) > 1.0) discard;
  float k = floor(fract(vSeed * 7.31) * 4.0);
  vec2 cell = vec2(mod(k, 2.0), floor(k / 2.0));
  vec4 s = texture2D(uMap, (cell + vUv * 0.49 + 0.5) * 0.5);
  if (uDark > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, s.r * 0.55); return; }
  gl_FragColor = vec4(vColor * s.r * s.g * uIntensity, 1.0);
}`;

export function nebulaLayers(body: Body, count = 26): { offset: [number, number, number]; scale: number; color: [number, number, number]; seed: number; dark: boolean }[] {
  const rnd = mulberry32(body.look.seed * 131 + 7);
  const palette = [hsl(285, 0.6, 0.55), hsl(176, 0.6, 0.48), hsl(338, 0.65, 0.6), hsl(255, 0.5, 0.6), hsl(200, 0.6, 0.55)];
  return Array.from({ length: count }, (_, i) => {
    const dark = i >= count - 5;
    const rr = body.r * Math.pow(rnd(), 0.7) * 0.75, th = rnd() * Math.PI * 2, ph = Math.acos(rnd() * 2 - 1);
    return {
      offset: [rr * Math.sin(ph) * Math.cos(th), rr * Math.cos(ph) * 0.55, rr * Math.sin(ph) * Math.sin(th)] as [number, number, number],
      scale: body.r * (dark ? 0.45 + rnd() * 0.3 : 0.5 + rnd() * 0.6),
      color: palette[Math.floor(rnd() * palette.length)],
      seed: rnd(), dark,
    };
  });
}

export function buildNebula(body: Body, env: BuildEnv): Part {
  const group = new THREE.Group();
  group.position.set(...body.pos);
  const layers = nebulaLayers(body);
  const atlas = env.bake(NEB_BAKE, 1024);
  const make = (list: typeof layers, dark: boolean) => {
    const geo = new THREE.PlaneGeometry(2, 2);
    const color = new Float32Array(list.length * 3), seed = new Float32Array(list.length), scale = new Float32Array(list.length);
    list.forEach((l, i) => { const c = lin(l.color, 0.32); color.set([c.r, c.g, c.b], i * 3); seed[i] = l.seed; scale[i] = l.scale; });
    geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(color, 3));
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
    geo.setAttribute("aScale", new THREE.InstancedBufferAttribute(scale, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 }, uDark: { value: dark ? 1 : 0 }, uMap: { value: atlas } },
      vertexShader: NEB_VERT, fragmentShader: NEB_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: dark ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    list.forEach((l, i) => mesh.setMatrixAt(i, m.makeTranslation(...l.offset)));
    mesh.frustumCulled = false;
    mesh.renderOrder = dark ? 8 : 7;
    return mesh;
  };
  const glow = make(layers.filter((l) => !l.dark), false), dust = make(layers.filter((l) => l.dark), true);
  group.add(glow, dust);
  // A few young stars embedded in the cloud.
  const rnd = mulberry32(body.look.seed + 99);
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: env.glowSpikes, color: lin(hsl(200 + rnd() * 60, 0.5, 0.8), 2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.set((rnd() - 0.5) * body.r, (rnd() - 0.5) * body.r * 0.5, (rnd() - 0.5) * body.r);
    s.scale.setScalar(6 + rnd() * 8);
    group.add(s);
  }
  env.tracker.track(group);
  const mats = [glow.material, dust.material] as THREE.ShaderMaterial[];
  return { object: group, anchor: { id: body.id, obj: group, r: body.r }, update(c: FrameCtx) { for (const m of mats) m.uniforms.uTime.value = c.t; } };
}

const DISC_VERT = /* glsl */ `
varying vec3 vLocal; varying vec3 vPosW; varying vec3 vVel;
void main() {
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  vVel = normalize(mat3(modelMatrix) * vec3(-position.y, position.x, 0.0));
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const DISC_FRAG = /* glsl */ `
uniform float uTime, uInner, uOuter; uniform vec3 uHot, uCool;
varying vec3 vLocal; varying vec3 vPosW; varying vec3 vVel;
${NOISE}
void main() {
  float r = length(vLocal.xy), u = (r - uInner) / (uOuter - uInner);
  if (u < 0.0 || u > 1.0) discard;
  float ang = atan(vLocal.y, vLocal.x);
  float s = ang - uTime * 0.35 * pow(r / uInner, -1.5) + log(r / uInner) * 2.2;
  vec3 a = vec3(cos(s), sin(s), 0.0);
  float n = fbm(a * 2.5 + vec3(0.0, 0.0, u * 4.0), 4);
  float streak = 0.5 + 0.5 * gnoise(a * 9.0 + vec3(0.0, 0.0, u * 28.0));
  float I = pow(1.0 - u, 2.0) * (0.55 + 0.9 * max(n, -0.3) + 0.35 * streak) * smoothstep(0.0, 0.04, u);
  vec3 col = mix(uCool, uHot, pow(1.0 - u, 3.0)) * I;
  float dop = 1.0 + 0.5 * dot(vVel, normalize(cameraPosition - vPosW));
  gl_FragColor = vec4(col * dop * dop * dop, 1.0);
}`;
const LENS_FRAG = /* glsl */ `
uniform float uSize, uR, uTime; uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float r = length(vUv) * uSize / uR;
  float ring = exp(-((r - 0.43) / 0.018) * ((r - 0.43) / 0.018)) * 3.0 + exp(-((r - 0.48) / 0.05) * ((r - 0.48) / 0.05)) * 0.45;
  float halo = step(0.43, r) * exp(-(r - 0.43) * 5.0) * 0.18;
  float flicker = 1.0 + 0.08 * sin(uTime * 2.0 + atan(vUv.y, vUv.x) * 3.0);
  gl_FragColor = vec4(uColor * (ring + halo) * flicker * smoothstep(1.0, 0.8, length(vUv)), 1.0);
}`;

export function buildWormhole(body: Body, env: BuildEnv): Part {
  const group = new THREE.Group();
  group.position.set(...body.pos);
  const R = body.r;
  const hole = new THREE.Mesh(new THREE.SphereGeometry(R * 0.42, 48, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  group.add(hole);
  const tilt = new THREE.Group();
  tilt.rotation.set(-1.25, 0.2, 0.35);
  group.add(tilt);
  const disc = new THREE.Mesh(new THREE.RingGeometry(R * 0.5, R * 1.45, 160, 4), new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uInner: { value: R * 0.5 }, uOuter: { value: R * 1.45 }, uHot: { value: lin(hsl(body.look.hue, 0.35, 0.9), 0.85) }, uCool: { value: lin(hsl(body.look.hue + 60, 0.75, 0.45), 0.35) } },
    vertexShader: DISC_VERT, fragmentShader: DISC_FRAG, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  disc.renderOrder = 6;
  tilt.add(disc);
  const lens = billboard(LENS_FRAG, { uR: { value: R }, uTime: { value: 0 }, uColor: { value: lin(hsl(body.look.hue, 0.4, 0.85), 0.6) } }, R * 1.6);
  lens.renderOrder = 7;
  group.add(lens);
  env.tracker.track(group);
  return {
    object: group, anchor: { id: body.id, obj: group, r: body.r },
    update(c: FrameCtx) {
      (disc.material as THREE.ShaderMaterial).uniforms.uTime.value = c.t;
      lens.material.uniforms.uTime.value = c.t;
    },
  };
}
