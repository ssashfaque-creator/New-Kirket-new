import { describe, expect, it } from "vitest";
import type { TurfPlane } from "./autoDetect";
import type { LandmarkMap } from "./types";
import { validateCalibrationReadiness } from "./validation";

const goodLandmarks: LandmarkMap = {
  offStumpTop: { x: 90, y: 100 },
  offStumpBase: { x: 90, y: 300 },
  middleStumpTop: { x: 120, y: 98 },
  middleStumpBase: { x: 120, y: 300 },
  legStumpTop: { x: 150, y: 102 },
  legStumpBase: { x: 150, y: 300 },
  batTip: { x: 120, y: 500 },
  turfBackLeft: { x: 20, y: 320 },
  turfBackRight: { x: 620, y: 320 },
  creaseLeft: { x: 80, y: 460 },
  creaseRight: { x: 400, y: 460 },
};

const turfPlane: TurfPlane = {
  confidence: 0.8,
  polygon: [
    { x: 20, y: 320 },
    { x: 620, y: 320 },
    { x: 700, y: 700 },
    { x: 0, y: 700 },
  ],
  leftEdge: { far: { x: 20, y: 320 }, near: { x: 0, y: 700 } },
  rightEdge: { far: { x: 620, y: 320 }, near: { x: 700, y: 700 } },
};

describe("calibration readiness", () => {
  it("accepts consistent core geometry for turf-based detection", () => {
    const readiness = validateCalibrationReadiness(
      goodLandmarks,
      { width: 720, height: 800 },
      turfPlane,
      undefined,
    );

    expect(readiness.readyForShotDetection).toBe(true);
    expect(readiness.score).toBeGreaterThan(70);
  });

  it("rejects swapped middle stump and missing back edge", () => {
    const readiness = validateCalibrationReadiness(
      {
        ...goodLandmarks,
        middleStumpBase: { x: 200, y: 300 },
        turfBackLeft: undefined,
      },
      { width: 720, height: 800 },
      turfPlane,
      undefined,
    );

    expect(readiness.readyForShotDetection).toBe(false);
    expect(readiness.issues.some((item) => item.id === "stump-order")).toBe(true);
    expect(readiness.issues.some((item) => item.id === "back-edge")).toBe(true);
  });
});
