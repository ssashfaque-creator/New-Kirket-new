import { describe, expect, it } from "vitest";
import {
  boundaryRadiusAtAngle,
  FIELD_PRESETS,
  GROUND_PRESETS,
  safeFielderDistance,
  STRIKER_TO_GROUND_CENTER_M,
} from "./virtualGround";

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

    expect(boundaryRadiusAtAngle(ground, 0)).toBeCloseTo(80 + STRIKER_TO_GROUND_CENTER_M, 6);
    expect(boundaryRadiusAtAngle(ground, 180)).toBeCloseTo(80 - STRIKER_TO_GROUND_CENTER_M, 6);
    expect(boundaryRadiusAtAngle(ground, 90)).toBeLessThan(60);
  });

  it("provides complete eleven-player field presets", () => {
    expect(FIELD_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(FIELD_PRESETS.every((preset) => preset.positions.length === 11)).toBe(true);
  });

  it("clamps deep fielders inside compact boundaries", () => {
    const compact = GROUND_PRESETS[0];
    const deepFielder = FIELD_PRESETS[1].positions.find((position) => position.id === "long-on")!;
    const boundary = boundaryRadiusAtAngle(compact, deepFielder.angleDegrees);

    expect(safeFielderDistance(deepFielder, compact)).toBeLessThanOrEqual(boundary - 3);
  });
});
