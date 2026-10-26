import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { Camera, VFOV, Vec3 } from "../core/space3d";

// project() in space3d.ts uses a mirrored (left-handed) convention compared with three.js. The renderer puts every
// object under a root group scaled (-1, 1, 1), so world coordinates go in unchanged, and places a normal
// right-handed three.js camera in that mirrored space. The two then agree pixel for pixel (see gl.camera.test.ts).
export const MIRROR_X = -1;

/** The camera's frame in AIOS world coordinates (the space project() works in). */
export function cameraFrame(c: Camera): { pos: Vec3; right: Vec3; up: Vec3; forward: Vec3 } {
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const right: Vec3 = [cy, 0, -sy];
  const up: Vec3 = [-sy * sp, cp, -cy * sp];
  const forward: Vec3 = [sy * cp, sp, cy * cp];
  const pos: Vec3 = [c.target[0] - c.dist * forward[0], c.target[1] - c.dist * forward[1], c.target[2] - c.dist * forward[2]];
  return { pos, right, up, forward };
}

const m = new Matrix4(), q = new Quaternion();
const mirror = (v: Vec3) => new Vector3(MIRROR_X * v[0], v[1], v[2]);

/** Point a three.js camera so it matches project() for a canvas of w x h CSS pixels. */
export function applyCamera(three: PerspectiveCamera, c: Camera, w: number, h: number): void {
  const f = cameraFrame(c);
  const r = mirror(f.right), u = mirror(f.up), back = mirror(f.forward).multiplyScalar(-1);
  m.makeBasis(r, u, back);
  q.setFromRotationMatrix(m);
  three.position.copy(mirror(f.pos));
  three.quaternion.copy(q);
  const fov = (VFOV * 180) / Math.PI, aspect = w / Math.max(1, h);
  if (three.fov !== fov || three.aspect !== aspect) { three.fov = fov; three.aspect = aspect; three.updateProjectionMatrix(); }
  three.updateMatrixWorld(true);
}

/** Near/far planes that keep depth precision good at every zoom the parent allows. */
export function clipPlanes(dist: number): { near: number; far: number } {
  return { near: Math.max(0.5, Math.min(8, dist * 0.01)), far: 40000 };
}

/** AIOS world point to three.js world point (the mirror the root group applies). */
export const toThree = (p: Vec3): Vector3 => mirror(p);
