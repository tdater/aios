import * as THREE from "three";
import type { Body } from "../core/scene";
import { BUMP, NOISE } from "./glsl";
import { FAMILY_ID, planetParams, type PlanetParams } from "./procedural";
import { lin, type BuildEnv, type FrameCtx, type Part } from "./util";

// Planets and moons: one procedural surface shader per family (compiled with a FAMILY define), a cloud layer for ocean
// worlds, an atmosphere shell scattered from the sun-facing limb, and a ring system with the planet's shadow on it.
// The sun is always at the origin, so every shader lights itself from there in world space.

const SURFACE_VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vPosW; varying vec3 vNormW;
void main() {
  vObj = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz; vNormW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// The surface is expensive procedural noise, so it is evaluated once per planet into cube maps at build time
// (albedo + height, and emission + specular mask) and the per-frame shader only samples and lights it.
const BAKE_VERT = /* glsl */ `
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const BAKE_FRAG = /* glsl */ `
uniform vec3 uC0, uC1, uC2, uC3, uC4, uOffset;
uniform float uSea, uCraters, uBand, uStormLat, uStormLon, uStormSize, uCover;
varying vec3 vDir;
${NOISE}
float gPx;
// Fade detail smaller than a texel, so the baked map is already filtered.
float lod(float freq) { return 1.0 - smoothstep(0.15, 0.6, freq * gPx); }
void main() {
  vec3 p = normalize(vDir);
  gPx = length(fwidth(p));
#if OUT == 2
  vec3 q = p * 2.4 + uOffset * 0.7;
  vec3 w = vec3(fbm(q, 4), fbm(q + 5.2, 4), fbm(q + 9.7, 4));
  float c = fbm(q * 1.7 + w * 1.6, 7);
  float lat = abs(p.y);
  c += 0.12 * smoothstep(0.25, 0.55, lat) - 0.1 * smoothstep(0.1, 0.0, abs(lat - 0.08));
  gl_FragColor = vec4(smoothstep(0.05, 0.38, c + (uCover - 0.5) * 0.3) * 0.88, 0.0, 0.0, 1.0);
#else
  float h = 0.0, spec = 0.0;
  vec3 albedo = uC1, emit = vec3(0.0);
  #if FAMILY == 0
  float cont = fbm(p * 1.6 + uOffset, 6);
  float high = smoothstep(0.05, 0.35, cont);
  float mount = ridged(p * 4.2 + uOffset, 5);
  float cr = craters(p * 6.0 + uOffset, uCraters) * lod(6.0) + 0.5 * craters(p * 15.0 + uOffset.yzx, uCraters) * lod(15.0);
  h = cont * 0.6 + high * mount * 0.7 + cr * 0.6;
  albedo = mix(uC0, uC1, smoothstep(-0.3, 0.08, cont));
  albedo = mix(albedo, uC2, high);
  albedo = mix(albedo, uC3, smoothstep(0.35, 0.75, mount * high));
  albedo *= 0.82 + 0.36 * (0.5 + 0.5 * fbm(p * 28.0 + uOffset, 3) * lod(28.0));
  albedo *= 1.0 + clamp(cr, -0.4, 0.2) * 0.8;
  albedo = mix(albedo, uC4, smoothstep(0.8, 0.88, abs(p.y) + 0.07 * fbm(p * 8.0, 3)));
#elif FAMILY == 1
  float cont = fbm(p * 1.8 + uOffset, 7) + 0.08 * fbm(p * 7.0 + uOffset, 3);
  float land = smoothstep(uSea, uSea + 0.015, cont);
  float depth = smoothstep(uSea - 0.3, uSea, cont);
  vec3 water = mix(uC0, uC1, depth * depth * depth);
  float elev = smoothstep(uSea + 0.04, uSea + 0.32, cont);
  vec3 ground = mix(uC2, uC3, elev) * (0.78 + 0.44 * (0.5 + 0.5 * fbm(p * 22.0 + uOffset, 3) * lod(22.0)));
  float desert = smoothstep(0.1, 0.4, fbm(p * 3.0 + uOffset.zxy, 3)) * (1.0 - smoothstep(0.25, 0.5, abs(p.y)));
  ground = mix(ground, uC3 * 1.25, desert * 0.6);
  albedo = mix(water, ground, land);
  float polar = smoothstep(0.74, 0.8, abs(p.y) + 0.08 * fbm(p * 5.0 + uOffset, 4));
  albedo = mix(albedo, uC4, polar);
  spec = (1.0 - land) * (1.0 - polar);
  h = land * (cont - uSea) * 1.2 + land * ridged(p * 5.0 + uOffset, 4) * 0.4 * elev;
  float metro = smoothstep(0.05, 0.3, fbm(p * 7.0 + uOffset, 3)) * smoothstep(0.55, 0.8, gnoise(p * 60.0 + uOffset) * 0.5 + 0.5 + 0.25 * gnoise(p * 18.0));
  float specks = mix(0.35, smoothstep(0.55, 0.9, gnoise(p * 320.0 + uOffset.yzx) * 0.5 + 0.5), lod(320.0));
  float city = metro * specks;
  emit = vec3(1.0, 0.66, 0.34) * city * land * (1.0 - polar) * (1.0 - elev * 0.7) * 1.6;
#elif FAMILY == 2
  float base = fbm(p * 2.5 + uOffset, 5);
  float region = smoothstep(-0.05, 0.3, fbm(p * 2.0 + uOffset.zyx, 3));
  float c1 = 1.0 - smoothstep(0.0, 0.018 + gPx * 4.0, abs(gnoise(p * vec3(2.2, 4.5, 2.2) + uOffset) + 0.08 * gnoise(p * 21.0) * lod(21.0)));
  float c2 = (1.0 - smoothstep(0.0, 0.015 + gPx * 8.0, abs(gnoise(p * vec3(6.0, 2.5, 6.0) + uOffset.zxy)))) * lod(6.0) * region;
  float crack = max(c1 * (0.4 + 0.6 * region), c2 * 0.7);
  albedo = mix(uC1, uC0, smoothstep(-0.3, 0.4, base));
  albedo = mix(albedo, uC3, smoothstep(0.3, 0.6, fbm(p * 3.0 + 7.0, 4)) * 0.45);
  albedo = mix(albedo, uC2, crack * 0.6);
  h = -crack * 0.5 + base * 0.3 + craters(p * 6.0 + uOffset, uCraters) * 0.3;
  spec = 0.25;
#elif FAMILY == 3
  float warp = fbm(vec3(p.x * 2.0, p.y * 12.0, p.z * 2.0) + uOffset + vec3(0.0 * 0.012, 0.0, 0.0), 5);
  float b = p.y * uBand + warp * 1.3;
  float band = sin(b) * 0.5 + 0.5, band2 = sin(b * 2.3 + 1.7) * 0.5 + 0.5;
  albedo = mix(uC2, uC0, band);
  albedo = mix(albedo, uC1, band2 * 0.6);
  albedo = mix(albedo, uC3, smoothstep(0.7, 1.0, sin(b * 0.5 + 0.3) * 0.5 + 0.5) * 0.55);
  albedo *= 0.88 + 0.24 * (0.5 + 0.5 * fbm(vec3(p.x * 9.0, p.y * 45.0, p.z * 9.0) + uOffset, 4));
  float lon = atan(p.z, p.x);
  float dlon = mod(lon - uStormLon - 0.0 * 0.004 + 3.14159265, 6.2831853) - 3.14159265;
  float dl = (p.y - sin(uStormLat)) / (uStormSize * 0.55), dx = dlon * sqrt(max(1.0 - p.y * p.y, 0.0)) / uStormSize;
  float sd2 = dl * dl + dx * dx;
  float swirl = 0.7 + 0.3 * sin(atan(dl, dx) * 2.0 + sqrt(sd2) * 10.0 - 0.0 * 0.25);
  albedo = mix(albedo, uC4, smoothstep(1.0, 0.25, sd2) * swirl);
  albedo = mix(albedo, uC1 * 1.1, smoothstep(1.4, 1.0, sd2) * smoothstep(0.7, 1.0, sd2) * 0.6);
#elif FAMILY == 4
  float crust = fbm(p * 3.0 + uOffset, 5);
  float vein = 1.0 - smoothstep(0.0, 0.06, abs(gnoise(p * 6.0 + uOffset) + 0.2 * gnoise(p * 24.0)));
  albedo = mix(uC0, uC2, smoothstep(-0.2, 0.4, crust));
  emit = mix(uC3, uC4, vein) * vein * 1.5;
  h = crust * 0.5 - vein * 0.4;
#else
  float mar = smoothstep(0.0, 0.25, fbm(p * 1.5 + uOffset, 4));
  float cr = craters(p * 5.0 + uOffset, uCraters) * lod(5.0) + 0.6 * craters(p * 13.0 + uOffset.zxy, uCraters) * lod(13.0) + 0.35 * craters(p * 31.0 + uOffset.yxz, 0.8) * lod(31.0);
  h = cr * 0.9 + fbm(p * 9.0 + uOffset, 4) * 0.2 * lod(9.0);
  albedo = mix(uC3, uC1, mar) * (0.85 + 0.3 * (0.5 + 0.5 * fbm(p * 26.0, 3) * lod(26.0)));
  albedo *= 1.0 + clamp(cr, -0.3, 0.3) * 0.6;
#endif
#if OUT == 0
  gl_FragColor = vec4(albedo, h);
#else
  gl_FragColor = vec4(emit * 0.5, spec);
#endif
#endif
}`;

const SURFACE_FRAG = /* glsl */ `
uniform samplerCube uSurf, uExtra;
uniform vec3 uAtmo, uSun, uAmbient;
uniform float uTime, uBand, uAtmoK, uRadius, uBumpK;
varying vec3 vObj; varying vec3 vPosW; varying vec3 vNormW;
${BUMP}
void main() {
  vec3 p = normalize(vObj);
#if FAMILY == 3
  // Gas giants: bands drift at different speeds (differential rotation).
  float a = uTime * 0.01 * (1.0 + 0.6 * sin(p.y * uBand * 0.5));
  p = vec3(cos(a) * p.x - sin(a) * p.z, p.y, sin(a) * p.x + cos(a) * p.z);
#endif
  vec4 s = textureCube(uSurf, p);
  vec3 albedo = s.rgb; float h = s.a;
  vec3 Ng = normalize(vNormW), V = normalize(cameraPosition - vPosW), L = normalize(-vPosW);
  float spec = 0.0; vec3 emit = vec3(0.0);
#if EXTRA == 1
  vec4 e = textureCube(uExtra, p);
  emit = e.rgb * 3.0; spec = e.a;
#elif FAMILY == 2
  spec = 0.25;
#endif
  vec3 N = bumpNormal(Ng, h, uRadius * uBumpK);
  float ndlG = dot(Ng, L);
  float diff = max(dot(N, L), 0.0) * smoothstep(-0.06, 0.12, ndlG);
#if FAMILY == 3
  diff = pow(max(ndlG, 0.0), 0.8);
#endif
  vec3 col = albedo * (uSun * diff + uAmbient);
  vec3 H = normalize(L + V);
  float nh = max(dot(Ng, H), 0.0);
  col += uSun * spec * (pow(nh, 220.0) * 4.0 + pow(nh, 24.0) * 0.06) * smoothstep(0.0, 0.1, ndlG);
#if FAMILY == 4
  col += emit * (0.75 + 0.25 * sin(uTime * 0.7 + h * 9.0)) * (0.4 + smoothstep(0.08, -0.15, ndlG));
#else
  col += emit * smoothstep(0.08, -0.15, ndlG);
#endif
  float mu = max(dot(Ng, V), 0.0);
  float rim = pow(clamp(1.0 - mu, 0.0, 1.0), 2.6);
  col += uAtmo * uAtmoK * (rim * 1.4 + 0.05) * smoothstep(-0.25, 0.45, ndlG);
  gl_FragColor = vec4(col, 1.0);
}`;

const CLOUD_FRAG = /* glsl */ `
uniform samplerCube uClouds; uniform vec3 uSun, uAmbient; uniform float uTime;
varying vec3 vObj; varying vec3 vPosW; varying vec3 vNormW;
void main() {
  vec3 p = normalize(vObj);
  float a = uTime * 0.006; p = vec3(cos(a) * p.x - sin(a) * p.z, p.y, sin(a) * p.x + cos(a) * p.z);
  float alpha = textureCube(uClouds, p).r;
  vec3 Ng = normalize(vNormW), L = normalize(-vPosW);
  float diff = smoothstep(-0.12, 0.45, dot(Ng, L));
  gl_FragColor = vec4(vec3(1.0) * (uSun * diff * 0.95 + uAmbient * 0.4), alpha);
}`;

const ATMO_VERT = /* glsl */ `
varying vec3 vPosW; varying vec3 vCenter;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz; vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const ATMO_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uR, uShell, uK;
varying vec3 vPosW; varying vec3 vCenter;
void main() {
  vec3 V = normalize(vPosW - cameraPosition);
  vec3 oc = vCenter - cameraPosition;
  float tca = max(dot(oc, V), 0.0);
  vec3 P = cameraPosition + V * tca;
  float b = length(P - vCenter);
  float x = (b - uR) / (uShell - uR);
  float dens = exp(-max(x, 0.0) * 4.5) * (1.0 - smoothstep(0.75, 1.0, x));
  vec3 n = normalize(P - vCenter), L = normalize(-P);
  float nl = dot(n, L);
  float lit = smoothstep(-0.3, 0.5, nl);
  float fwd = pow(max(dot(V, normalize(-vCenter)), 0.0), 8.0) * smoothstep(-0.7, 0.0, nl);
  gl_FragColor = vec4(uColor * dens * (lit * 1.1 + fwd * 3.0) * uK, 1.0);
}`;

const RING_VERT = /* glsl */ `
varying vec3 vLocal; varying vec3 vPosW; varying vec3 vCenter; varying vec3 vNormalW;
void main() {
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz; vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vNormalW = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const RING_FRAG = /* glsl */ `
uniform vec3 uTint, uSun, uAmbient; uniform float uR, uInner, uOuter, uSeed;
varying vec3 vLocal; varying vec3 vPosW; varying vec3 vCenter; varying vec3 vNormalW;
${NOISE}
void main() {
  float r = length(vLocal.xy) / uR;
  float u = (r - uInner) / (uOuter - uInner);
  if (u < 0.0 || u > 1.0) discard;
  float bands = 0.55 + 0.25 * gnoise(vec3(u * 38.0, uSeed, 0.0)) + 0.12 * gnoise(vec3(u * 110.0, uSeed + 3.0, 0.0)) * (1.0 - smoothstep(0.5, 2.0, fwidth(u) * 110.0));
  float dens = bands;
  dens *= 1.0 - 0.92 * (smoothstep(0.56, 0.585, u) - smoothstep(0.62, 0.645, u));
  dens *= 1.0 - 0.6 * (smoothstep(0.86, 0.87, u) - smoothstep(0.885, 0.895, u));
  dens *= smoothstep(0.0, 0.08, u) * mix(0.35, 1.0, smoothstep(0.0, 0.35, u)) * smoothstep(1.0, 0.94, u);
  dens = clamp(dens, 0.0, 1.0);
  vec3 L = normalize(-vPosW), V = normalize(cameraPosition - vPosW), N = normalize(vNormalW);
  float nl = dot(N, L), nv = dot(N, V);
  float lit = (0.2 + 0.9 * abs(nl)) * (sign(nl) == sign(nv) ? 1.0 : 0.45 * (1.0 - dens) + 0.15);
  float fwd = pow(max(dot(-V, L), 0.0), 10.0) * (1.0 - dens) * 1.5;
  vec3 oc = vPosW - vCenter;
  float bq = dot(oc, L), cq = dot(oc, oc) - uR * uR;
  float shadow = (bq < 0.0 && bq * bq - cq > 0.0) ? 0.04 : 1.0;
  vec3 col = uTint * (0.75 + 0.5 * gnoise(vec3(u * 60.0, uSeed + 9.0, 0.0))) * (uSun * (lit + fwd) * shadow + uAmbient);
  gl_FragColor = vec4(col, dens * 0.9);
}`;

export interface PlanetPart extends Part { params: PlanetParams }

const BUMP_K: Record<string, number> = { rocky: 0.035, ocean: 0.03, ice: 0.02, gas: 0, lava: 0.02, moon: 0.05 };

function bakeUniforms(p: PlanetParams): Record<string, THREE.IUniform> {
  return {
    uC0: { value: lin(p.colors[0]) }, uC1: { value: lin(p.colors[1]) }, uC2: { value: lin(p.colors[2]) }, uC3: { value: lin(p.colors[3]) }, uC4: { value: lin(p.colors[4]) },
    uOffset: { value: new THREE.Vector3(...p.offset) }, uSea: { value: p.seaLevel }, uCraters: { value: p.craterDensity }, uBand: { value: p.bandFreq },
    uStormLat: { value: p.storm.lat }, uStormLon: { value: p.storm.lon }, uStormSize: { value: p.storm.size }, uCover: { value: p.cloudCover },
  };
}
function bake(env: BuildEnv, p: PlanetParams, out: 0 | 1 | 2, size: number, type: THREE.TextureDataType): THREE.Texture {
  const mat = new THREE.ShaderMaterial({ defines: { FAMILY: FAMILY_ID[p.family], OUT: out }, uniforms: bakeUniforms(p), vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, side: THREE.BackSide });
  const tex = env.bakeCube(mat, size, type);
  mat.dispose();
  return tex;
}

export function buildPlanet(body: Body, env: BuildEnv, moon = false): PlanetPart {
  const params = planetParams(moon ? { ...body.look, family: "moon" } : body.look);
  const group = new THREE.Group();          // follows the orbit
  const tilt = new THREE.Group();           // axial tilt
  tilt.rotation.z = params.tilt;
  tilt.rotation.x = params.tilt * 0.3;
  group.add(tilt);
  const segs = moon ? 64 : 128;
  const size = moon ? 192 : 512;
  const extra = params.family === "ocean" || params.family === "lava";
  const surfMat = new THREE.ShaderMaterial({
    defines: { FAMILY: FAMILY_ID[params.family], EXTRA: extra ? 1 : 0 },
    uniforms: {
      uSurf: { value: bake(env, params, 0, size, THREE.HalfFloatType) }, uExtra: { value: extra ? bake(env, params, 1, size, THREE.UnsignedByteType) : null },
      uAtmo: { value: lin(params.atmosphere) }, uAtmoK: { value: params.atmosphereStrength * 0.35 }, uSun: { value: new THREE.Color(1.25, 1.17, 1.05) },
      uTime: { value: 0 }, uBand: { value: params.bandFreq }, uAmbient: { value: new THREE.Color(0.012, 0.014, 0.02) }, uRadius: { value: body.r }, uBumpK: { value: BUMP_K[params.family] },
    },
    vertexShader: SURFACE_VERT, fragmentShader: SURFACE_FRAG,
  });
  const surface = new THREE.Mesh(new THREE.SphereGeometry(body.r, segs, segs / 2), surfMat);
  tilt.add(surface);
  const timed: THREE.ShaderMaterial[] = [surfMat];
  let clouds: THREE.Mesh | null = null;
  if (params.family === "ocean") {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uClouds: { value: bake(env, params, 2, 512, THREE.UnsignedByteType) }, uSun: { value: new THREE.Color(1.25, 1.17, 1.05) }, uTime: { value: 0 }, uAmbient: { value: new THREE.Color(0.01, 0.012, 0.018) } },
      vertexShader: SURFACE_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
    });
    clouds = new THREE.Mesh(new THREE.SphereGeometry(body.r * 1.012, segs, segs / 2), mat);
    clouds.renderOrder = 2;
    tilt.add(clouds);
    timed.push(mat);
  }
  if (params.atmosphereStrength > 0) {
    const shell = body.r * (params.family === "gas" ? 1.1 : 1.13);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: lin(params.atmosphere) }, uR: { value: body.r }, uShell: { value: shell }, uK: { value: params.atmosphereStrength } },
      vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(shell, 96, 48), mat);
    atmo.renderOrder = 3;
    group.add(atmo);
  }
  if (body.look.ring) {
    const inner = body.r * params.ring.inner, outer = body.r * params.ring.outer;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTint: { value: lin(params.ring.tint) }, uSun: { value: new THREE.Color(1.25, 1.17, 1.05) }, uR: { value: body.r }, uInner: { value: params.ring.inner }, uOuter: { value: params.ring.outer }, uSeed: { value: body.look.seed }, uAmbient: { value: new THREE.Color(0.01, 0.01, 0.014) } },
      vertexShader: RING_VERT, fragmentShader: RING_FRAG, side: THREE.DoubleSide, transparent: true, depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 256, 1), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 4;
    tilt.add(ring);
  }
  env.tracker.track(group);
  return {
    object: group, params, anchor: { id: body.id, obj: group, r: body.r },
    update(c: FrameCtx) {
      const p = c.pos.get(body.id);
      if (p) group.position.set(p[0], p[1], p[2]);
      surface.rotation.y = c.t * body.spin * 0.5;
      if (clouds) clouds.rotation.y = c.t * body.spin * 0.5;
      for (const m of timed) m.uniforms.uTime.value = c.t;
    },
  };
}
