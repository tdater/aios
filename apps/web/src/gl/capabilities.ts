// WebGL2 feature detection. `make` lets tests supply a fake canvas.
type CanvasLike = { getContext(kind: string, opts?: unknown): unknown };

export function isWebGL2Available(make: () => CanvasLike = () => document.createElement("canvas")): boolean {
  try {
    return !!make().getContext("webgl2");
  } catch {
    return false;
  }
}

/** Why WebGL2 cannot be used, in plain words, or null when it can. */
export function unsupportedReason(make?: () => CanvasLike): string | null {
  return isWebGL2Available(make) ? null : "This browser or device does not support WebGL2, so the 3D universe cannot be drawn.";
}
