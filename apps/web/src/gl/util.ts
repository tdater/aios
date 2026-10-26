import * as THREE from "three";
import type { Body, World } from "../core/scene";
import type { RGB } from "./procedural";
import { BILLBOARD_VERT } from "./glsl";
import type { ResourceTracker } from "./resources";

/** sRGB triplet to a linear three.js colour, optionally scaled into HDR. */
export const lin = (c: RGB, k = 1): THREE.Color => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).multiplyScalar(k);

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return { canvas, ctx };
}

/** Soft round glow with faint diffraction spikes, drawn on a canvas (used by memory stars and glow sprites). */
export function glowTexture(spikes = false): THREE.Texture {
  const S = 128, { canvas, ctx } = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.07, "rgba(255,255,255,0.9)");
  g.addColorStop(0.2, "rgba(255,255,255,0.32)");
  g.addColorStop(0.45, "rgba(255,255,255,0.07)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  if (spikes) {
    ctx.globalCompositeOperation = "lighter";
    for (const [w, h] of [[S, 2], [2, S]] as const) {
      const lg = w > h ? ctx.createLinearGradient(0, 0, S, 0) : ctx.createLinearGradient(0, 0, 0, S);
      lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(0.5, "rgba(255,255,255,0.35)"); lg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = lg; ctx.fillRect((S - w) / 2, (S - h) / 2, w, h);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** A camera-facing quad with a custom fragment shader. `size` is the half-width in world units. */
export function billboard(frag: string, uniforms: Record<string, THREE.IUniform>, size: number, blending: THREE.Blending = THREE.AdditiveBlending): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: size }, ...uniforms }, vertexShader: BILLBOARD_VERT, fragmentShader: frag,
    transparent: true, depthWrite: false, blending,
    side: THREE.DoubleSide,     // the mirrored root flips winding; the quad is built in view space, so draw both sides
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  return mesh;
}

/** A glow sprite (additive) using a shared glow texture. */
export function glowSprite(tex: THREE.Texture, color: THREE.Color, size: number, opacity = 1): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  s.scale.setScalar(size);
  return s;
}

/** Shared per-frame state passed to every part. Positions are in AIOS world coordinates. */
export interface FrameCtx {
  t: number; dt: number; reduced: boolean;
  world: World; index: Map<string, Body>;      // the current world (orbits can change without a rebuild)
  pos: Map<string, [number, number, number]>;
  cam: THREE.Vector3;               // camera position, AIOS coordinates
  selected: string | null; hovered: string | null; told: Set<string>;
}

export interface Part {
  object: THREE.Object3D;
  /** The engine moves `obj` to the body's current position and scales it by current r / built r each frame. */
  anchor?: { id: string; obj: THREE.Object3D; r: number };
  update?(c: FrameCtx): void;
  setQuality?(level: number): void;
}

export interface BuildEnv {
  tracker: ResourceTracker; glow: THREE.Texture; glowSpikes: THREE.Texture;
  /** Render a full-screen fragment shader (varying vUv in 0..1) once into a size x size texture. */
  bake(fragmentShader: string, size: number): THREE.Texture;
  /** Render a BackSide sphere with this material into a cube map (sample it with the object-space direction). */
  bakeCube(material: THREE.Material, size: number, type: THREE.TextureDataType): THREE.Texture;
}
