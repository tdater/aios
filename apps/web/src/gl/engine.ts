import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { Body, World } from "../core/scene";
import { VFOV, type Camera, type Vec3 } from "../core/space3d";
import { buildBelt } from "./belt";
import { applyCamera, cameraFrame, clipPlanes, MIRROR_X } from "./cameraMath";
import { buildComet } from "./comet";
import { buildAllStop, buildBeacon, buildConsole, buildModule, buildProbe, buildShuttle, buildStation, makeKit } from "./craft";
import { buildNebula, buildWormhole } from "./deepspace";
import { QualityGovernor, settingsFor, type Tier } from "./governor";
import { buildMemories, setPointFocal } from "./memories";
import { positionsAt } from "./motion";
import { buildMarkers, buildOrbitRings, buildSelection } from "./overlays";
import { buildPlanet } from "./planet";
import { ResourceTracker } from "./resources";
import { bakeSky, buildBackgroundStars } from "./sky";
import { buildSun } from "./sun";
import { worldSignature } from "./signature";
import { glowTexture, type BuildEnv, type FrameCtx, type Part } from "./util";

export interface EngineProps {
  world: World; cam: Camera; selected: string | null; hovered: string | null; told: string[];
  time: number | null; reducedMotion: boolean; markers?: Vec3[];
}
export interface EngineCallbacks { onQuality?: (tier: Tier) => void; onFrame?: (ms: number) => void; onReady?: () => void }

// One NaN or Inf pixel would be smeared across the whole frame by bloom; clamp them away first (min/max drop NaN on GPUs).
const SANITIZE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: "uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(min(max(c.rgb, vec3(0.0)), vec3(6.0e4)), 1.0); }",
};

const FINISH = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - dot(d, d) * 0.6;
      float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (n - 0.5) / 255.0;
      gl_FragColor = c;
    }`,
};

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private root = new THREE.Group();
  private worldGroup = new THREE.Group();
  private camera = new THREE.PerspectiveCamera(50, 1, 1, 40000);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private tracker = new ResourceTracker();
  private worldTracker = new ResourceTracker();
  private env: BuildEnv;
  private parts: Part[] = [];
  private staticParts: Part[] = [];
  private memories: ReturnType<typeof buildMemories> | null = null;
  private markers: Part | null = null;
  private skyTarget: THREE.WebGLCubeRenderTarget;
  private envTarget: THREE.WebGLRenderTarget;
  private bgStars: ReturnType<typeof buildBackgroundStars>;
  private governor = new QualityGovernor();
  private props: EngineProps;
  private signature = "";
  private raf = 0;
  private last = 0;
  private clock = 0;
  private frozenT: number | null = null;
  private dirty = true;
  private w = 1; private h = 1;
  private ro: ResizeObserver | null = null;
  private readyFired = false;
  private warmUntil = 0;              // no quality decisions while shaders compile after a (re)build or resume
  private disposed = false;
  lastDrawCalls = 0;

  constructor(private canvas: HTMLCanvasElement, props: EngineProps, private cb: EngineCallbacks = {}) {
    this.props = props;
    if (props.reducedMotion) this.frozenT = props.time ?? 0;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.root.scale.set(MIRROR_X, 1, 1);
    this.scene.add(this.root);
    this.root.add(this.worldGroup);

    this.skyTarget = bakeSky(this.renderer);
    this.scene.background = this.skyTarget.texture;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const es = envScene();
    this.envTarget = pmrem.fromScene(es, 0.02);
    pmrem.dispose();
    new ResourceTracker().track(es).dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.4;

    const sun = new THREE.PointLight(0xfff0dc, 2.3, 0, 0);
    this.root.add(sun, new THREE.AmbientLight(0x8090c0, 0.035));
    this.env = { tracker: this.worldTracker, glow: this.tracker.track(glowTexture(false)), glowSpikes: this.tracker.track(glowTexture(true)), bake: (frag, size) => this.bake(frag, size), bakeCube: (m, size, type) => this.bakeCube(m, size, type) };
    this.bgStars = buildBackgroundStars({ ...this.env, tracker: this.tracker });
    this.scene.add(this.bgStars.object);

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new ShaderPass(SANITIZE));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.32, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(FINISH));

    this.resize();
    if (typeof ResizeObserver !== "undefined") { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas); }
    document.addEventListener("visibilitychange", this.onVisibility);
    this.rebuild();
    this.applyQuality();
    this.start();
  }

  setProps(p: EngineProps) {
    const prev = this.props;
    this.props = p;
    if (p.world !== prev.world && worldSignature(p.world) !== this.signature) this.rebuild();
    if (p.markers !== prev.markers) this.rebuildMarkers();
    if (p.reducedMotion && !prev.reducedMotion) this.frozenT = this.currentT();
    if (!p.reducedMotion) this.frozenT = null;
    this.memories?.boostFor(p.selected, p.hovered, new Set(p.told));
    const onlyTime = p.world === prev.world && p.cam === prev.cam && p.selected === prev.selected && p.hovered === prev.hovered && p.told === prev.told && p.reducedMotion === prev.reducedMotion && p.markers === prev.markers;
    if (!(p.reducedMotion && onlyTime)) this.dirty = true;
  }

  get tier(): Tier { return settingsFor(this.governor.level, 1).tier; }
  get qualityLevel(): number { return this.governor.level; }
  /** Force a quality level (dev harness and tests). */
  setQualityLevel(level: number) { this.governor.level = Math.max(0, Math.min(3, level)); this.applyQuality(); }

  private currentT(): number { return this.frozenT ?? this.props.time ?? this.clock; }

  private rebuild() {
    for (const p of this.parts) this.worldGroup.remove(p.object);
    this.parts = []; this.memories = null;
    this.worldTracker.dispose();
    const world = this.props.world;
    this.signature = worldSignature(world);
    const env = this.env;
    const kit = makeKit(env);
    const findings: Body[] = [];
    for (const b of world.bodies) {
      let part: Part | null = null;
      switch (b.type) {
        case "sun": part = buildSun(b, env); break;
        case "planet": part = buildPlanet(b, env); break;
        case "moon": part = buildPlanet(b, env, true); break;
        case "nebula": part = buildNebula(b, env); break;
        case "wormhole": part = buildWormhole(b, env); break;
        case "beacon": part = buildBeacon(b, env, kit); break;
        case "station": part = buildStation(b, env, kit); break;
        case "home": part = buildStation(b, env, kit, true); break;
        case "module": part = buildModule(b, env, kit); break;
        case "probe": part = buildProbe(b, env, kit); break;
        case "shuttle": part = buildShuttle(b, env, kit); break;
        case "comet": part = buildComet(b, env); break;
        case "log": part = buildConsole(b, env, kit); break;
        case "allstop": part = buildAllStop(b, env, kit); break;
        case "rock": findings.push(b); break;
      }
      if (part) this.parts.push(part);
    }
    const belt = buildBelt(world, findings, env);
    if (belt) this.parts.push(belt);
    this.memories = buildMemories(world, env);
    this.parts.push(this.memories, buildOrbitRings(world, env), buildSelection(world, env));
    for (const p of this.parts) this.worldGroup.add(p.object);
    this.memories.boostFor(this.props.selected, this.props.hovered, new Set(this.props.told));
    this.rebuildMarkers();
    this.staticParts = [this.bgStars];
    this.updateFocal();
    this.dirty = true;
    this.warmUntil = performance.now() + 2000;
  }

  private bake(fragmentShader: string, size: number): THREE.Texture {
    const rt = new THREE.WebGLRenderTarget(size, size, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    const mat = new THREE.ShaderMaterial({ vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }", fragmentShader, depthTest: false, depthWrite: false });
    const geo = new THREE.PlaneGeometry(2, 2), scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geo, mat));
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt);
    this.renderer.render(scene, new THREE.Camera());
    this.renderer.setRenderTarget(prev);
    geo.dispose(); mat.dispose();
    this.worldTracker.track(rt);
    return rt.texture;
  }

  private bakeCube(material: THREE.Material, size: number, type: THREE.TextureDataType): THREE.Texture {
    const rt = new THREE.WebGLCubeRenderTarget(size, { type, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    const geo = new THREE.SphereGeometry(1, 96, 48), scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geo, material));
    new THREE.CubeCamera(0.1, 10, rt).update(this.renderer, scene);
    geo.dispose();
    this.worldTracker.track(rt);
    return rt.texture;
  }

  private rebuildMarkers() {
    if (this.markers) { this.root.remove(this.markers.object); this.markers.object.traverse((o) => { const m = o as THREE.Points; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); }); this.markers = null; }
    if (this.props.markers?.length) { this.markers = buildMarkers(this.props.markers, { ...this.env, tracker: new ResourceTracker() }); this.root.add(this.markers.object); }
  }

  private resize = () => {
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.updateFocal();
    this.dirty = true;
  };

  private updateFocal() {
    const focal = (this.h * this.renderer.getPixelRatio()) / 2 / Math.tan(VFOV / 2);
    setPointFocal(this.root, focal);
    this.bgStars.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
  }

  private applyQuality() {
    const s = settingsFor(this.governor.level, typeof window !== "undefined" ? window.devicePixelRatio : 1);
    this.renderer.setPixelRatio(s.pixelRatio);
    this.composer.setPixelRatio(s.pixelRatio);
    this.composer.setSize(this.w, this.h);
    this.bloom.enabled = s.bloom;
    this.bgStars.setQuality?.(s.level);
    this.updateFocal();
    this.cb.onQuality?.(s.tier);
    this.dirty = true;
  }

  private onVisibility = () => {
    if (document.hidden) this.stop(); else { this.dirty = true; this.start(); }
  };

  start() {
    if (this.raf || this.disposed) return;
    this.last = 0;
    this.warmUntil = performance.now() + 2000;
    this.raf = requestAnimationFrame(this.frame);
  }
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) return;
    const dtMs = this.last ? now - this.last : 0;
    this.last = now;
    const p = this.props;
    if (!p.reducedMotion && p.time === null) this.clock += Math.min(dtMs, 100) / 1000;
    if (p.reducedMotion && !this.dirty) return;
    this.render(dtMs / 1000);
    if (dtMs > 0) {
      this.cb.onFrame?.(dtMs);
      if (now < this.warmUntil) return;
      if (!p.reducedMotion && this.governor.sample(dtMs, now)) this.applyQuality();
    }
  };

  /** Render one frame now (also used by tests and still frames). */
  render(dt = 0) {
    const p = this.props;
    const t = this.currentT();
    applyCamera(this.camera, p.cam, this.w, this.h);
    const planes = clipPlanes(p.cam.dist);
    if (this.camera.near !== planes.near) { this.camera.near = planes.near; this.camera.far = planes.far; this.camera.updateProjectionMatrix(); }
    const camPos = cameraFrame(p.cam).pos;
    const index = new Map(p.world.bodies.map((b) => [b.id, b] as const));
    const ctx: FrameCtx = {
      t, dt, reduced: p.reducedMotion, pos: positionsAt(p.world, t), world: p.world, index,
      cam: new THREE.Vector3(...camPos), selected: p.selected, hovered: p.hovered, told: new Set(p.told),
    };
    for (const part of this.parts) {
      part.update?.(ctx);
      const a = part.anchor;
      if (!a) continue;
      const at = ctx.pos.get(a.id), body = index.get(a.id);
      if (at) a.obj.position.set(at[0], at[1], at[2]);
      a.obj.scale.setScalar(body && a.r > 0 ? body.r / a.r : 1);
    }
    for (const part of this.staticParts) part.update?.(ctx);
    this.bgStars.object.position.copy(this.camera.position);
    this.renderer.info.reset();
    this.composer.render(dt);
    this.lastDrawCalls = this.renderer.info.render.calls;
    this.dirty = false;
    if (!this.readyFired) { this.readyFired = true; this.cb.onReady?.(); }
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.ro?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.rebuildMarkersOff();
    const n = this.worldTracker.dispose() + this.tracker.dispose();
    this.skyTarget.dispose(); this.envTarget.dispose();
    for (const pass of this.composer.passes) (pass as { dispose?: () => void }).dispose?.();
    this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose();
    this.renderer.dispose();
    return n;
  }
  private rebuildMarkersOff() { this.props = { ...this.props, markers: undefined }; this.rebuildMarkers(); }
}

/** A dim procedural environment so metal surfaces have something to reflect (no image assets). */
function envScene(): THREE.Scene {
  const s = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: "varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `varying vec3 vD; void main() {
      vec3 d = normalize(vD);
      float bk = d.y * 3.0 + d.x * 0.8; float band = exp(-bk * bk);
      vec3 c = vec3(0.02, 0.025, 0.04) + vec3(0.12, 0.11, 0.1) * band + vec3(0.5, 0.42, 0.32) * pow(max(dot(d, normalize(vec3(0.4, 0.5, 0.75))), 0.0), 6.0);
      c += vec3(0.05, 0.07, 0.1) * max(d.y, 0.0);
      gl_FragColor = vec4(c, 1.0);
    }`,
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  return s;
}
