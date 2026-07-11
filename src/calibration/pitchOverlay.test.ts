import { describe, expect, it } from "vitest";
import { buildPitchOverlayLines, projectWorldPoint } from "./pitchOverlay";
import type { PoseResult } from "./types";

const pose: PoseResult = {
  ok: true,
  usedPoints: [],
  intrinsics: {
    fx: 1000,
    fy: 1000,
    cx: 500,
    cy: 400,
    assumedFovDegrees: 67,
  },
  rvec: [0, 0, 0],
  tvec: [0, 0, 1000],
  cameraPositionWorldInches: { x: 0, y: 0, z: -1000 },
  distanceToMiddleStumpInches: 0,
  cameraHeightInches: 1000,
  reprojectionErrorPx: 0,
  maxReprojectionErrorPx: 0,
};

describe("pitch overlay projection", () => {
  it("projects world points through the solved camera pose", () => {
    expect(projectWorldPoint(pose, { x: 10, y: 20, z: 0 })).toEqual({
      x: 510,
      y: 420,
    });
  });

  it("builds crease and pitch overlay lines", () => {
    const lines = buildPitchOverlayLines(pose);

    expect(lines.some((line) => line.id === "popping-crease-near")).toBe(true);
    expect(lines.some((line) => line.id === "pitch-center")).toBe(true);
    expect(lines.every((line) => line.points.length >= 2)).toBe(true);
  });
});
