import { useEffect, useRef } from "react";
import type { World } from "../core/scene";
import type { Camera, Vec3 } from "../core/space3d";
import { unsupportedReason } from "../gl/capabilities";
import { Engine, type EngineProps } from "../gl/engine";

// The photorealistic universe renderer. Renders only a canvas; the parent draws labels and handles clicks with
// project(), which this camera matches exactly. Load it lazily so three.js stays out of the main bundle:
//   const UniverseGL = lazy(() => import("./ui/UniverseGL"));
export interface UniverseGLProps {
  world: World; cam: Camera; selected: string | null; hovered: string | null;
  told: string[]; time: number | null;
  reducedMotion: boolean; className?: string;
  onUnsupported?: (reason: string) => void; onReady?: () => void; onQuality?: (tier: "high" | "medium" | "low") => void;
  onFrame?: (ms: number) => void;
  /** Development and tests only: bright marker points at these world positions. */
  debugMarkers?: Vec3[];
  /** Development and tests only: receives the running engine (or null when it goes away). */
  onEngine?: (engine: Engine | null) => void;
}

const STYLE = { position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", touchAction: "none" } as const;

export function UniverseGL(props: UniverseGLProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const engineProps = (p: UniverseGLProps): EngineProps => ({
    world: p.world, cam: p.cam, selected: p.selected, hovered: p.hovered, told: p.told, time: p.time, reducedMotion: p.reducedMotion, markers: p.debugMarkers,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reason = unsupportedReason();
    if (reason) { propsRef.current.onUnsupported?.(reason); return; }
    const callbacks = {
      onReady: () => propsRef.current.onReady?.(),
      onQuality: (t: "high" | "medium" | "low") => propsRef.current.onQuality?.(t),
      onFrame: (ms: number) => propsRef.current.onFrame?.(ms),
    };
    const create = () => {
      try {
        engineRef.current = new Engine(canvas, engineProps(propsRef.current), callbacks);
        propsRef.current.onEngine?.(engineRef.current);
      } catch (e) {
        engineRef.current = null;
        propsRef.current.onUnsupported?.(`The 3D universe could not start: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    const destroy = () => { engineRef.current?.dispose(); engineRef.current = null; propsRef.current.onEngine?.(null); };
    const lost = (e: Event) => { e.preventDefault(); engineRef.current?.stop(); };
    const restored = () => { destroy(); create(); };
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    create();
    return () => {
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      destroy();
    };
  }, []);

  const { world, cam, selected, hovered, told, time, reducedMotion, debugMarkers } = props;
  useEffect(() => {
    engineRef.current?.setProps(engineProps(propsRef.current));
  }, [world, cam, selected, hovered, told, time, reducedMotion, debugMarkers]);

  return <canvas ref={canvasRef} className={props.className} style={STYLE} aria-hidden="true" data-testid="universe-gl" />;
}

export default UniverseGL;
