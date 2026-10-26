import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { layoutWorld } from "../core/scene";
import { sampleObjects, sampleUniverse } from "../core/scene.fixtures";
import { defaultCamera } from "../core/space3d";
import { UniverseGL } from "../ui/UniverseGL";

describe("UniverseGL without WebGL2", () => {
  it("renders a canvas and reports unsupported instead of throwing", () => {
    const onUnsupported = vi.fn(), onReady = vi.fn();
    const world = layoutWorld(sampleUniverse(), sampleObjects());
    const { getByTestId, unmount } = render(
      <UniverseGL world={world} cam={defaultCamera()} selected={null} hovered={null} told={[]} time={0} reducedMotion={false} onUnsupported={onUnsupported} onReady={onReady} />,
    );
    expect(getByTestId("universe-gl").tagName).toBe("CANVAS");
    expect(onUnsupported).toHaveBeenCalledTimes(1);
    expect(onUnsupported.mock.calls[0][0]).toMatch(/WebGL2/);
    expect(onReady).not.toHaveBeenCalled();
    unmount();
  });
});
