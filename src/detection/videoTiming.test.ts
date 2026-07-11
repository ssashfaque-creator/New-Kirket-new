import { describe, expect, it } from "vitest";
import { buildVideoFramePlan } from "./videoTiming";

describe("slow-motion video timing", () => {
  it("keeps physical timing at capture FPS for a 30 fps slow-motion timeline", () => {
    const plan = buildVideoFramePlan(120, 30, 1);

    expect(plan.frameCount).toBe(120);
    expect(plan.measurementStepS).toBeCloseTo(1 / 120, 8);
    expect(plan.sourceStepS).toBeCloseTo(1 / 30, 8);
    expect(plan.physicalSpanS).toBeCloseTo(119 / 120, 8);
    expect(plan.sourceSpanS).toBeCloseTo(119 / 30, 8);
  });

  it("caps pathological clips at the processing limit", () => {
    expect(buildVideoFramePlan(240, 240, 5).frameCount).toBe(480);
  });
});
