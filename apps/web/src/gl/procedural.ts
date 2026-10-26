import type { Look } from "../core/scene";

// Deterministic look parameters for procedural bodies. Pure (no three.js), so the same seed always gives the same planet
// and the values can be unit-tested. Colours are sRGB triplets in 0..1; the renderer converts them to linear.
export type RGB = [number, number, number];

/** A small seeded PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** HSL (hue in degrees, s and l in 0..1) to sRGB. */
export function hsl(h: number, s: number, l: number): RGB {
  const hh = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)];
}

/** Approximate colour of a black body at `k` kelvin (sRGB, normalised so the brightest channel is 1). */
export function temperatureColor(k: number): RGB {
  const t = Math.max(1000, Math.min(40000, k)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.max(0, Math.min(255, v)) / 255;
  const out: RGB = [c(r), c(g), c(b)];
  const m = Math.max(...out) || 1;
  return [out[0] / m, out[1] / m, out[2] / m];
}

export const FAMILY_ID = { rocky: 0, ocean: 1, ice: 2, gas: 3, lava: 4, moon: 5 } as const;
export type SurfaceFamily = keyof typeof FAMILY_ID;
export const surfaceFamily = (f: string): SurfaceFamily => (f in FAMILY_ID ? (f as SurfaceFamily) : "rocky");

export interface PlanetParams {
  family: SurfaceFamily;
  tilt: number;                  // axial tilt, radians
  offset: [number, number, number];   // noise-space offset so two planets of one family differ
  seaLevel: number; craterDensity: number; bandFreq: number;
  storm: { lat: number; lon: number; size: number };
  cloudCover: number;
  colors: [RGB, RGB, RGB, RGB, RGB];
  atmosphere: RGB; atmosphereStrength: number;
  ring: { inner: number; outer: number; tint: RGB; tilt: number };
}

export function planetParams(look: Look): PlanetParams {
  const rnd = mulberry32(look.seed * 7919 + Math.round(look.hue) * 31 + 17);
  const family = surfaceFamily(look.family);
  const h = look.hue + (rnd() - 0.5) * 12;
  const colors: Record<SurfaceFamily, [RGB, RGB, RGB, RGB, RGB]> = {
    rocky: [hsl(h, 0.42, 0.17), hsl(h + 8, 0.48, 0.31), hsl(h + 18, 0.34, 0.47), hsl(h - 6, 0.14, 0.6), hsl(h + 25, 0.22, 0.8)],
    ocean: [hsl(h, 0.8, 0.09), hsl(h - 14, 0.7, 0.3), hsl(98 + (rnd() - 0.5) * 20, 0.34, 0.24), hsl(34, 0.3, 0.42), hsl(h, 0.12, 0.93)],
    ice: [hsl(h + 18, 0.28, 0.86), hsl(h + 8, 0.36, 0.68), hsl(h + 28, 0.45, 0.36), hsl(28, 0.28, 0.46), hsl(h, 0.2, 0.97)],
    gas: [hsl(h, 0.34, 0.55), hsl(h + 26, 0.38, 0.74), hsl(h - 28, 0.3, 0.36), hsl(h + 48, 0.22, 0.84), hsl(h - 70, 0.55, 0.52)],
    lava: [hsl(h, 0.12, 0.07), hsl(h + 10, 0.1, 0.16), hsl(h, 0.08, 0.26), hsl(24, 0.95, 0.55), hsl(42, 1, 0.6)],
    moon: [hsl(h, 0.06, 0.2), hsl(h, 0.05, 0.36), hsl(h, 0.04, 0.55), hsl(h, 0.03, 0.66), hsl(h, 0.02, 0.8)],
  };
  const atmo: Record<SurfaceFamily, RGB> = {
    rocky: hsl(h + 12, 0.55, 0.62), ocean: hsl(212, 0.85, 0.62), ice: hsl(h, 0.55, 0.74),
    gas: hsl(h + 10, 0.45, 0.7), lava: hsl(20, 0.8, 0.55), moon: [0, 0, 0],
  };
  const tilt = family === "gas" ? 0.38 + rnd() * 0.12 : 0.05 + rnd() * 0.38;
  return {
    family, tilt,
    offset: [rnd() * 100, rnd() * 100, rnd() * 100],
    seaLevel: family === "ocean" ? 0.02 + rnd() * 0.06 : 0,
    craterDensity: family === "moon" ? 0.55 + rnd() * 0.25 : family === "rocky" ? 0.25 + rnd() * 0.2 : 0.15,
    bandFreq: 9 + rnd() * 9,
    storm: { lat: -0.25 - rnd() * 0.2, lon: rnd() * Math.PI * 2, size: 0.16 + rnd() * 0.08 },
    cloudCover: 0.45 + rnd() * 0.25,
    colors: colors[family],
    atmosphere: atmo[family],
    atmosphereStrength: look.atmosphere === false || family === "moon" ? 0 : family === "gas" ? 0.7 : family === "ocean" ? 1.15 : 0.85,
    ring: { inner: 1.3 + rnd() * 0.12, outer: 2.15 + rnd() * 0.3, tint: hsl(h + 30, 0.18, 0.72), tilt: 0 },
  };
}

/** Colour of a memory star by memory type. */
export function memoryColor(type: string): RGB {
  switch (type) {
    case "preference": return [1.0, 0.82, 0.48];
    case "fact": return [0.78, 0.88, 1.0];
    case "decision": return [0.8, 0.66, 1.0];
    case "lesson": return [0.56, 0.95, 0.8];
    case "procedure": return [1.0, 0.66, 0.46];
    default: return [0.9, 0.92, 1.0];
  }
}

/** Colour for a body's status tone (station beacons, probe lights). */
export function toneColor(tone: string): RGB {
  switch (tone) {
    case "ok": return [0.35, 1.0, 0.55];
    case "info": return [0.4, 0.75, 1.0];
    case "warn": return [1.0, 0.72, 0.25];
    case "bad": return [1.0, 0.25, 0.2];
    default: return [0.7, 0.74, 0.8];
  }
}

/** Comet tail model: tails grow and brighten as the comet nears the sun (activity falls off with distance). */
export function cometActivity(distance: number): { length: number; brightness: number } {
  const d = Math.max(60, distance);
  return { length: Math.min(420, 230 * (220 / d)), brightness: Math.min(2.2, 0.3 + Math.pow(220 / d, 1.6)) };
}
