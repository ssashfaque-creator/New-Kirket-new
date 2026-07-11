import { describe, expect, it } from "vitest";
import { boundaryRadiusAtAngle, FIELD_PRESETS, GROUND_PRESETS } from "./virtualGround";

describe("virtual ground model", () => {
  it("includes ten selectable ground presets", () => {
    expect(GROUND_PRESETS).toHaveLength(10);
  });

  it("uses straight and square boundary radii by angle", () => {
    const ground = {
      id: "test",
      name: "Test",
      description: "Test ground",
      straightBoundaryM: 80,
      squareBoundaryM: 60,
    };

    expect(boundaryRadiusAtAngle(ground, 0)).toBeCloseTo(80, 6);
    expect(boundaryRadiusAtAngle(ground, 90)).toBeCloseTo(60, 6);
  });

  it("provides complete eleven-player field presets", () => {
    expect(FIELD_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(FIELD_PRESETS.every((preset) => preset.positions.length === 11)).toBe(true);
  });
});
