// Shared GLSL (WebGL2 / GLSL ES 3.00 via three.js). Integer hashing (PCG) and gradient noise written for this project.
export const NOISE = /* glsl */ `
uint pcgHash(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
uint hash3u(ivec3 p) { return pcgHash(uint(p.x) + pcgHash(uint(p.y) + pcgHash(uint(p.z)))); }
float hash31(ivec3 p) { return float(hash3u(p) & 0xffffffu) / 16777215.0; }
vec3 hash33(ivec3 p) {
  uint h = hash3u(p), h2 = pcgHash(h), h3 = pcgHash(h2);
  return vec3(float(h & 0xffffffu), float(h2 & 0xffffffu), float(h3 & 0xffffffu)) / 16777215.0;
}
float gcorner(ivec3 i, ivec3 o, vec3 f) { return dot(hash33(i + o) * 2.0 - 1.0, f - vec3(o)); }
float gnoise(vec3 p) {
  vec3 fl = floor(p); ivec3 i = ivec3(fl); vec3 f = p - fl;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = gcorner(i, ivec3(0,0,0), f), b = gcorner(i, ivec3(1,0,0), f), c = gcorner(i, ivec3(0,1,0), f), d = gcorner(i, ivec3(1,1,0), f);
  float e = gcorner(i, ivec3(0,0,1), f), g = gcorner(i, ivec3(1,0,1), f), h = gcorner(i, ivec3(0,1,1), f), k = gcorner(i, ivec3(1,1,1), f);
  return 1.4 * mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < oct; i++) { s += a * gnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
float ridged(vec3 p, int oct) {
  float s = 0.0, a = 0.5, prev = 1.0;
  for (int i = 0; i < oct; i++) { float n = 1.0 - abs(gnoise(p)); n *= n; s += a * n * prev; prev = n; p = p * 2.07 + vec3(4.1, 1.3, 7.7); a *= 0.5; }
  return s;
}
// Bowl-and-rim crater field: returns a height offset (negative in bowls, slightly positive on rims).
float craters(vec3 p, float density) {
  vec3 fl = floor(p); ivec3 i = ivec3(fl); vec3 f = p - fl; float h = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec3 o = ivec3(x, y, z); vec3 r = hash33(i + o);
    if (r.z > density) continue;
    vec3 c = vec3(o) + 0.5 + (r - 0.5) * 0.7;
    float rad = 0.16 + 0.3 * r.x;
    float d = length(f - c) / rad;
    float prof = d < 1.0 ? (d * d - 1.0) * 0.9 + 0.3 * smoothstep(0.55, 1.0, d) : 0.3 * exp(-(d - 1.0) * (d - 1.0) * 22.0);
    h += prof * rad;
  }
  return h;
}
`;

/** Derivative-based bump mapping (no tangents needed). Needs varying vPosW. */
export const BUMP = /* glsl */ `
vec3 bumpNormal(vec3 N, float h, float k) {
  vec3 dpx = dFdx(vPosW), dpy = dFdy(vPosW);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * N - k * g);
}
`;

/** Camera-facing quad: PlaneGeometry(2, 2) expanded in view space by uSize (world units, half-width). */
export const BILLBOARD_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = position.xy;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;
