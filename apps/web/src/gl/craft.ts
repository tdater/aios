import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Body } from "../core/scene";
import type { Vec3 } from "../core/space3d";
import { Ribbon } from "./comet";
import { posExact } from "./motion";
import { hsl, mulberry32, toneColor } from "./procedural";
import { glowSprite, lin, makeCanvas, type BuildEnv, type FrameCtx, type Part } from "./util";

// Built objects: stations (and the larger Home Base), Home Base modules, probes, shuttles, the console slab, the
// All Stop beacon and plain beacons. Static parts of each craft are merged into one geometry per material.

export interface Kit {
  hull: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; gold: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial; panel: THREE.MeshStandardMaterial; window: THREE.MeshBasicMaterial;
  panelMap: THREE.Texture; glyphs: THREE.Texture[];
}

function solarTexture(): THREE.Texture {
  const { canvas, ctx } = makeCanvas(128, 256);
  const g = ctx.createLinearGradient(0, 0, 128, 256);
  g.addColorStop(0, "#1a2d55"); g.addColorStop(1, "#0b1530");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 256);
  ctx.strokeStyle = "#5a6f96"; ctx.lineWidth = 1;
  for (let x = 0; x <= 128; x += 16) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, 256); ctx.stroke(); }
  for (let y = 0; y <= 256; y += 16) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(128, y + 0.5); ctx.stroke(); }
  ctx.strokeStyle = "#c8ccd6"; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, 125, 253);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Six small glyphs (probes carry widgets; the glyph and panel colour vary by look). */
export const GLYPHS = ["circle", "square", "triangle", "plus", "diamond", "ring"] as const;
function glyphTexture(kind: (typeof GLYPHS)[number]): THREE.Texture {
  const { canvas, ctx } = makeCanvas(64, 64);
  ctx.fillStyle = "#fff"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 9;
  ctx.beginPath();
  if (kind === "circle") ctx.arc(32, 32, 20, 0, Math.PI * 2);
  else if (kind === "square") ctx.rect(13, 13, 38, 38);
  else if (kind === "triangle") { ctx.moveTo(32, 9); ctx.lineTo(55, 52); ctx.lineTo(9, 52); ctx.closePath(); }
  else if (kind === "plus") { ctx.rect(26, 8, 12, 48); ctx.rect(8, 26, 48, 12); }
  else if (kind === "diamond") { ctx.moveTo(32, 6); ctx.lineTo(56, 32); ctx.lineTo(32, 58); ctx.lineTo(8, 32); ctx.closePath(); }
  if (kind === "ring") { ctx.arc(32, 32, 19, 0, Math.PI * 2); ctx.stroke(); } else ctx.fill();
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
export const glyphFor = (seed: number) => GLYPHS[((Math.round(seed) % GLYPHS.length) + GLYPHS.length) % GLYPHS.length];

export function makeKit(env: BuildEnv): Kit {
  const panelMap = solarTexture();
  const kit: Kit = {
    hull: new THREE.MeshStandardMaterial({ color: 0xa9aeb8, metalness: 0.6, roughness: 0.42 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.7, roughness: 0.45 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.9, roughness: 0.3, emissive: 0x1a0f00 }),
    white: new THREE.MeshStandardMaterial({ color: 0xc9c9c4, metalness: 0.1, roughness: 0.6 }),
    panel: new THREE.MeshStandardMaterial({ map: panelMap, metalness: 0.45, roughness: 0.28, color: 0xffffff }),
    window: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.1, 0.62) }),
    panelMap, glyphs: GLYPHS.map(glyphTexture),
  };
  for (const v of Object.values(kit)) if (Array.isArray(v)) v.forEach((t) => env.tracker.track(t)); else env.tracker.track(v);
  return kit;
}

// ---------------------------------------------------------------- geometry helpers
const e = new THREE.Euler(), q = new THREE.Quaternion(), mtx = new THREE.Matrix4();
function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  g.applyMatrix4(mtx.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  return g;
}
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!["position", "normal", "uv"].includes(k)) n.deleteAttribute(k); return n; });
  const out = mergeGeometries(clean, false);
  parts.forEach((g) => g.dispose()); clean.forEach((g) => g.dispose());
  if (!out) throw new Error("geometry merge failed");
  return out;
}
const cyl = (r: number, h: number, seg = 24) => new THREE.CylinderGeometry(r, r, h, seg);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

function blinker(env: BuildEnv, color: THREE.Color, size: number): { mesh: THREE.Mesh; sprite: THREE.Sprite; mat: THREE.MeshBasicMaterial; base: THREE.Color } {
  const mat = new THREE.MeshBasicMaterial({ color: color.clone() });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(size * 0.18, 12, 8), mat);
  const sprite = glowSprite(env.glow, color.clone(), size * 2.2);
  return { mesh, sprite, mat, base: color.clone() };
}
function blink(b: { sprite: THREE.Sprite; mat: THREE.MeshBasicMaterial; base: THREE.Color }, t: number, phase: number, reduced: boolean, period = 1.6) {
  const on = reduced ? 0.7 : Math.pow(Math.max(0, Math.sin((t / period) * Math.PI * 2 + phase)), 12);
  b.mat.color.copy(b.base).multiplyScalar(0.25 + 3 * on);
  (b.sprite.material as THREE.SpriteMaterial).opacity = 0.15 + 0.85 * on;
}

/** Tilt a panel group about its local x axis so its +y face points at the sun (at the origin). */
const sunDir = new THREE.Vector3(), invQ = new THREE.Quaternion();
function faceSun(panels: THREE.Object3D, frame: THREE.Object3D, at: Vec3) {
  sunDir.set(-at[0], -at[1], -at[2]).applyQuaternion(invQ.copy(frame.quaternion).invert());
  panels.rotation.x = Math.atan2(sunDir.z, sunDir.y);
}

// ---------------------------------------------------------------- stations
export function buildStation(body: Body, env: BuildEnv, kit: Kit, home = false): Part {
  const r = body.r, rnd = mulberry32(body.look.seed * 13 + 1);
  const group = new THREE.Group(), frame = new THREE.Group();
  frame.rotation.set((rnd() - 0.5) * 0.3, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.3);
  group.add(frame);
  const hullParts: THREE.BufferGeometry[] = [], darkParts: THREE.BufferGeometry[] = [];
  const hubR = r * (home ? 0.2 : 0.15);
  hullParts.push(cyl(hubR, r * (home ? 1.3 : 1.1)));
  hullParts.push(place(new THREE.SphereGeometry(hubR * 1.25, 24, 16), 0, r * (home ? 0.66 : 0.56), 0));
  darkParts.push(place(new THREE.ConeGeometry(hubR * 0.9, r * 0.25, 20), 0, -r * (home ? 0.75 : 0.65), 0, Math.PI));
  darkParts.push(place(cyl(r * 0.012, r * 0.5, 6), 0, r * 0.95, 0));
  for (const s of [-1, 1]) darkParts.push(place(box(r * 1.55, r * 0.035, r * 0.035), s * (hubR + r * 0.75), r * 0.42, 0));
  if (home) {
    hullParts.push(place(new THREE.SphereGeometry(r * 0.26, 32, 20), 0, 0, 0));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      hullParts.push(place(cyl(r * 0.05, r * 0.42, 12), Math.cos(a) * r * 0.36, -r * 0.38, Math.sin(a) * r * 0.36, 0, -a, Math.PI / 2));
      darkParts.push(place(new THREE.TorusGeometry(r * 0.07, r * 0.015, 8, 20), Math.cos(a) * r * 0.58, -r * 0.38, Math.sin(a) * r * 0.58, 0, -a + Math.PI / 2, 0));
    }
  }
  frame.add(new THREE.Mesh(merged(hullParts), kit.hull), new THREE.Mesh(merged(darkParts), kit.dark));

  const ring = new THREE.Group();
  frame.add(ring);
  const ringDefs = home ? [{ R: r * 0.72, y: r * 0.16, tube: r * 0.06 }, { R: r * 0.5, y: -r * 0.12, tube: r * 0.05 }] : [{ R: r * 0.64, y: 0, tube: r * 0.07 }];
  const ringParts: THREE.BufferGeometry[] = [];
  const windowsPer = home ? 56 : 44;
  const win = new THREE.InstancedMesh(box(r * 0.03, r * 0.025, r * 0.012), kit.window, windowsPer * ringDefs.length * 2);
  let wi = 0;
  for (const d of ringDefs) {
    ringParts.push(place(new THREE.TorusGeometry(d.R, d.tube, 16, 120), 0, d.y, 0, Math.PI / 2));
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; ringParts.push(place(cyl(r * 0.018, d.R - hubR, 8), Math.cos(a) * (d.R + hubR) / 2, d.y, Math.sin(a) * (d.R + hubR) / 2, 0, -a, Math.PI / 2)); }
    for (let i = 0; i < windowsPer; i++) for (const row of [-1, 1]) {
      const a = (i / windowsPer) * Math.PI * 2, R = d.R + d.tube * 0.96;
      mtx.compose(new THREE.Vector3(Math.cos(a) * R, d.y + row * d.tube * 0.32, Math.sin(a) * R), q.setFromEuler(e.set(0, -a + Math.PI / 2, 0)), new THREE.Vector3(1, 1, 1));
      win.setMatrixAt(wi++, mtx);
    }
  }
  ring.add(new THREE.Mesh(merged(ringParts), kit.hull), win);

  const panels = new THREE.Group();
  panels.position.y = r * 0.42;
  const pParts: THREE.BufferGeometry[] = [];
  const per = home ? 3 : 2, pw = r * (home ? 0.42 : 0.5), pd = r * (home ? 0.42 : 0.34);
  for (const s of [-1, 1]) for (let k = 0; k < per; k++) pParts.push(place(box(pw, r * 0.012, pd), s * (hubR + r * 0.45 + k * (pw + r * 0.04)), 0, 0));
  panels.add(new THREE.Mesh(merged(pParts), kit.panel));
  frame.add(panels);

  const light = blinker(env, lin(toneColor(body.state.tone), 1), r * 0.35);
  light.mesh.position.y = light.sprite.position.y = r * 1.2;
  frame.add(light.mesh, light.sprite);
  env.tracker.track(group);
  const phase = rnd() * 6;
  return {
    object: group, anchor: { id: body.id, obj: group, r: body.r },
    update(c: FrameCtx) {
      const p = c.pos.get(body.id) ?? body.pos;
      group.position.set(p[0], p[1], p[2]);
      ring.rotation.y = c.t * (home ? 0.12 : 0.18);
      faceSun(panels, frame, p);
      blink(light, c.t, phase, c.reduced);
    },
  };
}

// ---------------------------------------------------------------- Home Base modules
const MODULE_KINDS = ["engine", "cargo", "launch", "rover", "port"] as const;
export function moduleKind(body: Body): (typeof MODULE_KINDS)[number] {
  const named = MODULE_KINDS.find((k) => body.id.endsWith(`:${k}`));
  return named ?? MODULE_KINDS[Math.abs(body.look.seed) % MODULE_KINDS.length];
}

export function buildModule(body: Body, env: BuildEnv, kit: Kit): Part {
  const r = body.r, kind = moduleKind(body);
  const group = new THREE.Group(), frame = new THREE.Group();
  group.add(frame);
  const hull: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [], gold: THREE.BufferGeometry[] = [], white: THREE.BufferGeometry[] = [];
  let glow: THREE.Sprite | null = null;
  if (kind === "engine") {
    hull.push(place(cyl(r * 0.28, r * 1.1), 0, 0, 0, Math.PI / 2));
    dark.push(place(new THREE.CylinderGeometry(r * 0.18, r * 0.36, r * 0.4, 24, 1, true), 0, 0, -r * 0.72, -Math.PI / 2));
    for (const s of [-1, 1]) dark.push(place(box(r * 0.9, r * 0.02, r * 0.4), s * r * 0.6, 0, r * 0.1));
    glow = glowSprite(env.glow, new THREE.Color(0.6, 0.85, 2.5), r * 1.6);
    glow.position.z = -r * 0.95;
  } else if (kind === "cargo") {
    dark.push(box(r * 0.12, r * 0.12, r * 1.5));
    for (let i = 0; i < 4; i++) (i % 2 ? gold : white).push(place(box(r * 0.42, r * 0.42, r * 0.3), (i % 2 ? 1 : -1) * r * 0.28, 0, (i - 1.5) * r * 0.36));
  } else if (kind === "launch") {
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) dark.push(place(box(r * 0.05, r * 1.4, r * 0.05), x * r * 0.35, 0, z * r * 0.35));
    for (const y of [-0.6, 0, 0.6]) dark.push(place(new THREE.TorusGeometry(r * 0.5, r * 0.025, 6, 4), 0, y * r, 0, Math.PI / 2, 0, Math.PI / 4));
    white.push(cyl(r * 0.13, r * 0.9, 16), place(new THREE.ConeGeometry(r * 0.13, r * 0.3, 16), 0, r * 0.6, 0));
  } else if (kind === "rover") {
    hull.push(cyl(r * 0.45, r * 0.22, 28));
    dark.push(place(new THREE.SphereGeometry(r * 0.34, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0, r * 0.11, 0));
    gold.push(place(box(r * 0.08, r * 0.6, r * 0.08), r * 0.42, r * 0.35, 0, 0, 0, -0.5), place(box(r * 0.07, r * 0.45, r * 0.07), r * 0.72, r * 0.72, 0, 0, 0, 0.7));
  } else {
    hull.push(place(new THREE.TorusGeometry(r * 0.45, r * 0.1, 14, 40), 0, 0, 0));
    hull.push(place(cyl(r * 0.24, r * 0.7, 24), 0, 0, -r * 0.35, Math.PI / 2));
    dark.push(place(new THREE.TorusGeometry(r * 0.45, r * 0.04, 8, 40), 0, 0, r * 0.08));
  }
  const add = (parts: THREE.BufferGeometry[], m: THREE.Material) => { if (parts.length) frame.add(new THREE.Mesh(merged(parts), m)); };
  add(hull, kit.hull); add(dark, kit.dark); add(gold, kit.gold); add(white, kit.white);
  if (glow) frame.add(glow);
  const light = blinker(env, lin(toneColor(body.state.tone), 1), r * 0.35);
  light.mesh.position.y = light.sprite.position.y = r * 0.75;
  frame.add(light.mesh, light.sprite);
  env.tracker.track(group);
  const phase = body.look.seed * 0.7;
  return {
    object: group, anchor: { id: body.id, obj: group, r: body.r },
    update(c: FrameCtx) {
      const p = c.pos.get(body.id) ?? body.pos;
      group.position.set(p[0], p[1], p[2]);
      frame.rotation.y = c.t * body.spin * 0.6;
      blink(light, c.t, phase, c.reduced, 2.1);
    },
  };
}

// ---------------------------------------------------------------- probes (they carry widgets: glyph + panel colour by look)
export function buildProbe(body: Body, env: BuildEnv, kit: Kit): Part {
  const r = body.r;
  const group = new THREE.Group(), frame = new THREE.Group();
  group.add(frame);
  frame.add(new THREE.Mesh(box(r * 0.36, r * 0.36, r * 0.36), kit.gold));
  const dishParts = [place(new THREE.SphereGeometry(r * 0.38, 24, 8, 0, Math.PI * 2, 0, 0.75), 0, r * 0.05, r * 0.5, -Math.PI / 2), place(cyl(r * 0.02, r * 0.4, 6), 0, 0, r * 0.4, Math.PI / 2)];
  frame.add(new THREE.Mesh(merged(dishParts), kit.white));
  frame.add(new THREE.Mesh(merged([place(cyl(r * 0.01, r * 0.7, 5), 0, r * 0.45, 0)]), kit.dark));
  const panelMat = kit.panel.clone();
  panelMat.color = lin(hsl(body.look.hue, 0.55, 0.62));
  const panels = new THREE.Mesh(merged([-1, 1].map((s) => place(box(r * 0.95, r * 0.4, r * 0.012), s * r * 0.7, 0, 0))), panelMat);
  frame.add(panels);
  const glyph = new THREE.Sprite(new THREE.SpriteMaterial({ map: kit.glyphs[GLYPHS.indexOf(glyphFor(body.look.seed))], color: lin(hsl(body.look.hue, 0.85, 0.62), 3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  glyph.scale.setScalar(r * 0.32);
  glyph.position.set(0, 0, -r * 0.26);
  frame.add(glyph);
  const light = blinker(env, lin(toneColor(body.state.tone), 1), r * 0.3);
  light.mesh.position.y = light.sprite.position.y = r * 0.82;
  frame.add(light.mesh, light.sprite);
  env.tracker.track(group);
  return {
    object: group, anchor: { id: body.id, obj: group, r: body.r },
    update(c: FrameCtx) {
      const p = c.pos.get(body.id) ?? body.pos;
      group.position.set(p[0], p[1], p[2]);
      frame.rotation.y = Math.atan2(-p[0], -p[2]);
      blink(light, c.t, body.look.seed, c.reduced, 1.3);
    },
  };
}

// ---------------------------------------------------------------- shuttles: small craft with an engine trail
export function buildShuttle(body: Body, env: BuildEnv, kit: Kit): Part {
  const r = body.r;
  const group = new THREE.Group(), craft = new THREE.Group();
  group.add(craft);
  craft.add(new THREE.Mesh(merged([place(cyl(r * 0.2, r * 0.9, 12), 0, 0, 0, Math.PI / 2), place(new THREE.ConeGeometry(r * 0.2, r * 0.45, 12), 0, 0, r * 0.67, Math.PI / 2)]), kit.white));
  craft.add(new THREE.Mesh(merged([place(box(r * 1.2, r * 0.04, r * 0.35), 0, -r * 0.05, -r * 0.15), place(box(r * 0.04, r * 0.35, r * 0.25), 0, r * 0.2, -r * 0.33)]), kit.dark));
  const engine = glowSprite(env.glow, new THREE.Color(2.4, 1.3, 0.6), r * 1.4);
  engine.position.z = -r * 0.55;
  craft.add(engine);
  const trail = new Ribbon(24, new THREE.Color(1.6, 0.8, 0.35), { w0: r * 0.18, w1: r * 0.05, falloff: 1.4 });
  trail.uniforms.uBright.value = 0.9;
  env.tracker.track(group); env.tracker.track(trail.mesh);
  const pts: Vec3[] = Array.from({ length: 24 }, () => [0, 0, 0]);
  const fwd = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
  return {
    object: new THREE.Group().add(group, trail.mesh), anchor: { id: body.id, obj: group, r: body.r },
    update(c: FrameCtx) {
      const p = c.pos.get(body.id) ?? body.pos;
      group.position.set(p[0], p[1], p[2]);
      const cur = c.index.get(body.id) ?? body;
      for (let i = 0; i < pts.length; i++) pts[i] = i === 0 ? p : posExact(c.world, cur, c.t - i * 0.07, c.index);
      const a = pts[1];
      fwd.set(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
      if (fwd.lengthSq() > 1e-8) craft.quaternion.setFromUnitVectors(z, fwd.normalize());
      trail.set(pts);
      trail.uniforms.uTime.value = c.t;
      (engine.material as THREE.SpriteMaterial).opacity = c.reduced ? 0.8 : 0.75 + 0.25 * Math.sin(c.t * 23);
    },
  };
}

// ---------------------------------------------------------------- Mission Control: console slab, All Stop, beacons
function screenTexture(hue: number): THREE.Texture {
  const { canvas, ctx } = makeCanvas(256, 160);
  ctx.fillStyle = "#03070f"; ctx.fillRect(0, 0, 256, 160);
  const rnd = mulberry32(42);
  const [r, g, b] = hsl(hue, 0.8, 0.62).map((v) => Math.round(v * 255));
  for (let y = 14; y < 150; y += 11) {
    let x = 12;
    while (x < 236) { const w = 6 + rnd() * 34; ctx.fillStyle = `rgba(${r},${g},${b},${0.35 + rnd() * 0.65})`; ctx.fillRect(x, y, Math.min(w, 244 - x), 5); x += w + 5; if (rnd() < 0.15) break; }
  }
  ctx.strokeStyle = `rgba(${r},${g},${b},0.8)`; ctx.strokeRect(4.5, 4.5, 247, 151);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildConsole(body: Body, env: BuildEnv, kit: Kit): Part {
  const r = body.r;
  const group = new THREE.Group();
  group.position.set(...body.pos);
  group.rotation.y = Math.atan2(-body.pos[0], -body.pos[2]);
  group.add(new THREE.Mesh(box(r * 1.7, r * 1.08, r * 0.14), kit.dark));
  const scr = screenTexture(body.look.hue);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.56, r * 0.95), new THREE.MeshBasicMaterial({ map: scr, color: new THREE.Color(2.2, 2.2, 2.2) }));
  screen.position.z = r * 0.075;
  group.add(screen);
  group.add(new THREE.Mesh(merged([place(cyl(r * 0.04, r * 0.6, 8), 0, -r * 0.8, 0), place(box(r * 0.6, r * 0.05, r * 0.3), 0, -r * 1.1, 0)]), kit.hull));
  env.tracker.track(group);
  return { object: group, anchor: { id: body.id, obj: group, r: body.r } };
}

export function buildAllStop(body: Body, env: BuildEnv, kit: Kit): Part {
  const r = body.r;
  const group = new THREE.Group();
  group.position.set(...body.pos);
  group.add(new THREE.Mesh(merged([cyl(r * 0.06, r * 1.0, 10), place(new THREE.CylinderGeometry(r * 0.35, r * 0.45, r * 0.18, 24), 0, -r * 0.55, 0)]), kit.dark));
  const red = new THREE.Color(1, 0.06, 0.04);
  const coreMat = new THREE.MeshBasicMaterial({ color: red.clone() });
  const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.26, 24, 16), coreMat);
  core.position.y = r * 0.62;
  const halo = glowSprite(env.glow, red.clone(), r * 4.5);
  halo.position.y = r * 0.62;
  const ringMat = new THREE.MeshBasicMaterial({ color: red.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.45, r * 0.025, 8, 48), ringMat);
  ring.position.y = r * 0.62; ring.rotation.x = Math.PI / 2;
  group.add(core, halo, ring);
  env.tracker.track(group);
  return {
    object: group, anchor: { id: body.id, obj: group, r: body.r },
    update(c: FrameCtx) {
      const k = c.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(c.t * 3.2);
      coreMat.color.copy(red).multiplyScalar(2 + 5 * k);
      (halo.material as THREE.SpriteMaterial).opacity = 0.35 + 0.65 * k;
      ringMat.color.copy(red).multiplyScalar(0.6 + 1.6 * k);
      ring.scale.setScalar(1 + (c.reduced ? 0 : 0.15 * k));
    },
  };
}

export function buildBeacon(body: Body, env: BuildEnv, kit: Kit): Part {
  const r = body.r;
  const group = new THREE.Group();
  group.position.set(...body.pos);
  group.add(new THREE.Mesh(merged([cyl(r * 0.05, r * 1.2, 8), place(new THREE.OctahedronGeometry(r * 0.22), 0, -r * 0.65, 0)]), kit.hull));
  const color = lin(hsl(body.look.hue, 0.8, 0.6), 1);
  const dim = body.state.tone === "muted" ? 0.45 : 1;
  const light = blinker(env, color, r * 0.9);
  light.mesh.position.y = light.sprite.position.y = r * 0.7;
  group.add(light.mesh, light.sprite);
  env.tracker.track(group);
  return { object: group, anchor: { id: body.id, obj: group, r: body.r }, update(c: FrameCtx) { blink(light, c.t, body.look.seed, c.reduced, 3.2); light.mat.color.multiplyScalar(dim); } };
}
