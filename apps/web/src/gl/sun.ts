import * as THREE from "three";
import type { Body } from "../core/scene";
import { NOISE } from "./glsl";
import { billboard, type BuildEnv, type FrameCtx, type Part } from "./util";

const VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vPosW; varying vec3 vNormW;
void main() {
  vObj = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz; vNormW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const PHOTOSPHERE = /* glsl */ `
uniform float uTime;
varying vec3 vObj; varying vec3 vPosW; varying vec3 vNormW;
${NOISE}
void main() {
  vec3 p = normalize(vObj);
  vec3 N = normalize(vNormW), V = normalize(cameraPosition - vPosW);
  float mu = clamp(dot(N, V), 0.0, 1.0);
  float tt = uTime * 0.05;
  vec3 q = p * 26.0;
  float warp = fbm(q * 0.5 + vec3(tt, -tt, 0.7 * tt), 3);
  float cells = 1.0 - abs(gnoise(q + warp * 2.2 + vec3(0.0, tt * 3.0, 0.0)));
  float gran = smoothstep(0.2, 1.0, cells);
  float super = fbm(p * 6.0 + vec3(tt * 0.3), 3);
  float sn = gnoise(p * 2.4 + vec3(11.0, 3.0, 7.0)) + 0.12 * fbm(p * 12.0, 3);
  float pen = smoothstep(0.5, 0.58, sn), umbra = smoothstep(0.62, 0.68, sn);
  float I = 0.7 + 0.45 * gran + 0.2 * super;
  I *= 1.0 - 0.45 * pen - 0.4 * umbra;
  I += smoothstep(0.2, 0.6, fbm(p * 9.0 + 3.0, 3)) * pow(1.0 - mu, 2.0) * 0.6 * (1.0 - pen);
  float x = 1.0 - mu;
  float limb = 1.0 - 0.6 * x - 0.22 * x * x;
  vec3 hot = vec3(1.0, 0.8, 0.55), warm = vec3(1.0, 0.42, 0.12);
  vec3 col = mix(warm, hot, limb) * I * limb * 1.25;
  gl_FragColor = vec4(col, 1.0);
}`;

const CORONA = /* glsl */ `
uniform float uTime, uR, uSize;
varying vec2 vUv;
${NOISE}
void main() {
  float len = length(vUv);
  float r = len * uSize / uR;
  float ang = atan(vUv.y, vUv.x);
  vec3 a = vec3(cos(ang), sin(ang), 0.0);
  float streak = fbm(a * 5.0 + vec3(0.0, 0.0, r * 0.25 - uTime * 0.02), 4);
  float fine = gnoise(a * 22.0 + vec3(0.0, 0.0, uTime * 0.01));
  float rr = max(r - 1.0, 0.0);
  float corona = exp(-rr * 3.2) * (0.5 + 1.1 * max(streak + 0.15 * fine, 0.0)) + exp(-rr * 1.1) * 0.12 * (0.6 + max(streak, 0.0));
  float glow = 0.035 / (1.0 + rr * rr * 2.0) + 0.003 * exp(-rr * 0.4);
  vec3 col = vec3(1.0, 0.74, 0.45) * corona * 0.9 + vec3(1.0, 0.62, 0.32) * glow;
  col *= smoothstep(1.0, 0.7, len) * smoothstep(0.9, 1.0, r);
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildSun(body: Body, env: BuildEnv): Part {
  const group = new THREE.Group();
  const photo = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: VERT, fragmentShader: PHOTOSPHERE });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(body.r, 128, 64), photo);
  group.add(sphere);
  const size = body.r * 16;
  const corona = billboard(CORONA, { uTime: { value: 0 }, uR: { value: body.r } }, size);
  corona.renderOrder = 5;
  group.add(corona);
  env.tracker.track(group);
  return {
    object: group, anchor: { id: body.id, obj: group, r: body.r },
    update(c: FrameCtx) {
      photo.uniforms.uTime.value = c.t;
      corona.material.uniforms.uTime.value = c.t;
      sphere.rotation.y = c.t * body.spin;
    },
  };
}
