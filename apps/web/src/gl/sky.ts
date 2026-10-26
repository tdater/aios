import * as THREE from "three";
import { NOISE } from "./glsl";
import { mulberry32, temperatureColor } from "./procedural";
import type { BuildEnv, FrameCtx, Part } from "./util";

// The Milky Way backdrop is expensive to evaluate per pixel, so it is baked once into a cube map at start-up.
// Background stars stay as live points so they can twinkle. Both sit outside the mirrored root and follow the camera.
const GALAXY = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(1.02, 0.35, 0.42)));

const SKY_FRAG = /* glsl */ `
uniform mat3 uGal;
varying vec3 vDir;
${NOISE}
void main() {
  vec3 d = normalize(uGal * normalize(vDir));
  float lat = d.y;
  float n = fbm(d * 3.0, 6);
  float n2 = fbm(d * 11.0 + 3.0, 5);
  float width = 0.13 + 0.06 * n;
  float band = exp(-lat * lat / (width * width));
  float cdist = acos(clamp(d.x, -1.0, 1.0));
  float bulge = exp(-(cdist / 0.42) * (cdist / 0.42)) * exp(-lat * lat / 0.035);
  float lane = fbm(d * 7.0 + vec3(5.0), 6);
  float dust = smoothstep(-0.05, 0.35, lane + 0.1) * exp(-((lat - 0.025 * n) / 0.045) * ((lat - 0.025 * n) / 0.045));
  float light = band * (0.45 + 0.55 * smoothstep(-0.4, 0.5, n2)) + bulge * 1.6;
  light *= 1.0 - 0.88 * dust;
  vec3 col = mix(vec3(0.5, 0.6, 0.9), vec3(1.0, 0.8, 0.55), clamp(bulge * 1.4 + 0.15, 0.0, 1.0)) * light * 0.06;
  float neb = smoothstep(0.3, 0.75, fbm(d * 5.0 + 11.0, 5)) * band;
  col += vec3(0.85, 0.25, 0.35) * neb * 0.014 + vec3(0.2, 0.5, 0.7) * smoothstep(0.4, 0.8, fbm(d * 4.0 + 29.0, 4)) * band * 0.006;
  col += vec3(0.0016, 0.0022, 0.004) * (0.8 + 0.4 * n2);
  gl_FragColor = vec4(col, 1.0);
}`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Bake the galaxy into a cube texture. Returns the render target (dispose it with the engine). */
export function bakeSky(renderer: THREE.WebGLRenderer, size = 1024): THREE.WebGLCubeRenderTarget {
  const target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({ uniforms: { uGal: { value: GALAXY } }, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false });
  const geo = new THREE.SphereGeometry(10, 64, 32);
  scene.add(new THREE.Mesh(geo, mat));
  const cam = new THREE.CubeCamera(1, 100, target);
  cam.update(renderer, scene);
  geo.dispose(); mat.dispose();
  return target;
}

const STAR_VERT = /* glsl */ `
attribute float aSize; attribute vec3 aColor; attribute float aPhase;
uniform float uTime, uPixelRatio, uTwinkle;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 1.0 + uTwinkle * 0.3 * sin(uTime * (1.3 + aPhase * 2.2) + aPhase * 40.0) * step(0.5, fract(aPhase * 7.0));
  gl_PointSize = aSize * uPixelRatio;
  vColor = aColor * tw;
}`;
const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
void main() { vec2 c = gl_PointCoord * 2.0 - 1.0; float a = exp(-dot(c, c) * 4.5); gl_FragColor = vec4(vColor * a, 1.0); }`;

export const BACKGROUND_STARS = 12000;

/** Generate background star attributes. Pure and seeded, so tests can check it. */
export function backgroundStars(n: number, seed = 1): { pos: Float32Array; color: Float32Array; size: Float32Array; phase: Float32Array } {
  const rnd = mulberry32(seed), inv = GALAXY.clone().transpose();
  const pos = new Float32Array(n * 3), color = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const inBand = rnd() < 0.45;
    const lon = rnd() * Math.PI * 2;
    const lat = inBand ? (rnd() + rnd() + rnd() - 1.5) * 0.18 : Math.asin(rnd() * 2 - 1);
    v.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).applyMatrix3(inv).multiplyScalar(15000);
    pos.set([v.x, v.y, v.z], i * 3);
    const r = rnd();
    const k = r < 0.08 ? 9000 + rnd() * 16000 : r < 0.5 ? 5200 + rnd() * 2000 : 3000 + rnd() * 2400;
    const m = Math.pow(rnd(), 9);
    const b = 0.05 + 0.35 * Math.pow(rnd(), 3) + 3.2 * m;
    const c = temperatureColor(k);
    color.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    size[i] = 1.4 + 2.2 * Math.pow(rnd(), 3) + 2.5 * m;
    phase[i] = rnd();
  }
  // Shuffle-free: draw order is already random, so a draw range gives a uniform subset for the low quality tier.
  return { pos, color, size, phase };
}

export function buildBackgroundStars(env: BuildEnv): Part & { points: THREE.Points; material: THREE.ShaderMaterial } {
  const data = backgroundStars(BACKGROUND_STARS);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(data.pos, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(data.color, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(data.size, 1));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(data.phase, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uTwinkle: { value: 1 } },
    vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: false,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = -10;
  env.tracker.track(points);
  return {
    object: points, points, material,
    update(c: FrameCtx) { material.uniforms.uTime.value = c.t; material.uniforms.uTwinkle.value = c.reduced ? 0 : 1; },
    setQuality(level: number) { geo.setDrawRange(0, level >= 3 ? Math.round(BACKGROUND_STARS * 0.35) : BACKGROUND_STARS); },
  };
}
