// WebGL2 feature detection. `make` lets tests supply a fake canvas.
type GLLike = { getExtension?(n: string): unknown; getParameter?(p: number): unknown };
type CanvasLike = { getContext(kind: string, opts?: unknown): unknown };

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

export function isWebGL2Available(make: () => CanvasLike = () => document.createElement("canvas")): boolean {
  try {
    return !!make().getContext("webgl2");
  } catch {
    return false;
  }
}

/** The name of the graphics chip the browser reports, or "" when it will not say. */
export function rendererName(gl: GLLike | null): string {
  try {
    const ext = gl?.getExtension?.("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number } | null | undefined;
    return ext && gl?.getParameter ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "") : "";
  } catch {
    return "";
  }
}

const forced = () => { try { return localStorage.getItem("aios.gl.force") === "1"; } catch { return false; } };

/** Why the 3D universe should not be used, in plain words, or null when it can. A phone emulator or a machine with no graphics chip
 *  draws WebGL in software, which freezes the screen, so those get the flat universe unless the person forces 3D on. */
export function unsupportedReason(make: () => CanvasLike = () => document.createElement("canvas")): string | null {
  let gl: unknown = null;
  try { gl = make().getContext("webgl2"); } catch { gl = null; }
  if (!gl) return "This browser or device does not support WebGL2, so the 3D universe cannot be drawn.";
  if (!forced() && SOFTWARE.test(rendererName(gl as GLLike))) return "This device draws 3D in software, which is too slow, so AIOS shows the flat universe instead.";
  return null;
}
