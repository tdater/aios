import { Group, Mesh, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { clampCamera, project, viewFor, type Camera, type Vec3 } from "../core/space3d";
import { applyCamera, cameraFrame, clipPlanes, MIRROR_X, toThree } from "../gl/cameraMath";
import { mulberry32 } from "../gl/procedural";

// The WebGL camera must agree with project() exactly, or the page's DOM labels drift off the bodies.
function screenOf(cam: PerspectiveCamera, p: Vec3, w: number, h: number) {
  const v = toThree(p).project(cam);
  return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
}

describe("WebGL camera matches project()", () => {
  const rnd = mulberry32(2024);
  const cams: Camera[] = Array.from({ length: 40 }, () => clampCamera({
    yaw: (rnd() - 0.5) * 2 * Math.PI, pitch: (rnd() - 0.5) * 2.8, dist: 70 + rnd() * 1400,
    target: [(rnd() - 0.5) * 1200, (rnd() - 0.5) * 200, (rnd() - 0.5) * 1200],
  }));
  const sizes = [[1280, 720], [390, 844], [1920, 1080], [800, 800]] as const;

  it("projects random points to the same pixel for random cameras and canvas sizes", () => {
    let checked = 0;
    cams.forEach((c, i) => {
      const [w, h] = sizes[i % sizes.length];
      const three = new PerspectiveCamera();
      const planes = clipPlanes(c.dist);
      three.near = planes.near; three.far = planes.far;
      applyCamera(three, c, w, h);
      for (let k = 0; k < 25; k++) {
        const p: Vec3 = [c.target[0] + (rnd() - 0.5) * 900, c.target[1] + (rnd() - 0.5) * 400, c.target[2] + (rnd() - 0.5) * 900];
        const want = project(c, p, viewFor(w, h));
        if (!want) continue;
        const got = screenOf(three, p, w, h);
        expect(Math.abs(got.x - want.x)).toBeLessThan(0.02);
        expect(Math.abs(got.y - want.y)).toBeLessThan(0.02);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(400);
  });

  it("places the camera dist away from the target, looking at it", () => {
    const c: Camera = { yaw: 0.7, pitch: 0.3, dist: 500, target: [10, 20, 30] };
    const f = cameraFrame(c);
    expect(Math.hypot(f.pos[0] - 10, f.pos[1] - 20, f.pos[2] - 30)).toBeCloseTo(500, 6);
    const three = new PerspectiveCamera();
    applyCamera(three, c, 100, 100);
    const look = new Vector3(0, 0, -1).applyQuaternion(three.quaternion);
    const toTarget = toThree(c.target).sub(three.position).normalize();
    expect(look.dot(toTarget)).toBeCloseTo(1, 9);
  });

  it("the mirrored root group maps world points the same way as toThree()", () => {
    const root = new Group();
    root.scale.set(MIRROR_X, 1, 1);
    const m = new Mesh();
    m.position.set(12, -4, 7);
    root.add(m);
    root.updateMatrixWorld(true);
    expect(new Vector3().setFromMatrixPosition(m.matrixWorld).toArray()).toEqual(toThree([12, -4, 7]).toArray());
  });
});
