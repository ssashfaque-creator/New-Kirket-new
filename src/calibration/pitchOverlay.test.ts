import { describe, expect, it } from "vitest";
import { buildPitchOverlayLines, buildTurfPitchOverlayLines, projectWorldPoint } from "./pitchOverlay";
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

  it("builds pitch lines from the detected 13 ft turf plane", () => {
    const lines = buildTurfPitchOverlayLines(
      {
        middleStumpBase: { x: 100, y: 500 },
        batTip: { x: 100, y: 400 },
      },
      {
        confidence: 0.9,
        polygon: [
          { x: 20, y: 550 },
          { x: 180, y: 550 },
          { x: 180, y: 50 },
          { x: 20, y: 50 },
        ],
        leftEdge: {
          near: { x: 20, y: 550 },
          far: { x: 20, y: 50 },
        },
        rightEdge: {
          near: { x: 180, y: 550 },
          far: { x: 180, y: 50 },
        },
      },
    );

    const bowlingCrease = lines.find((line) => line.id === "bowling-crease-near");
    const center = lines.find((line) => line.id === "pitch-center");

    expect(bowlingCrease?.points[0].y).toBeCloseTo(bowlingCrease?.points.at(-1)?.y ?? 0, 6);
    expect(center?.points[0].x).toBeCloseTo(100, 6);
  });
});
