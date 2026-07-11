import { describe, expect, it } from "vitest";
import type { TurfPlane } from "../calibration/autoDetect";
import type { LandmarkMap } from "../calibration/types";
import type { TrackingSummary } from "./ballTracking";
import { estimateShotMeasurement } from "./shotEstimation";

const turfPlane: TurfPlane = {
  confidence: 0.9,
  polygon: [
    { x: 100, y: 100 },
    { x: 500, y: 100 },
    { x: 560, y: 700 },
    { x: 40, y: 700 },
  ],
  leftEdge: {
    near: { x: 40, y: 700 },
    far: { x: 100, y: 100 },
  },
  rightEdge: {
    near: { x: 560, y: 700 },
    far: { x: 500, y: 100 },
  },
};

const landmarks: LandmarkMap = {
  middleStumpBase: { x: 300, y: 600 },
  batTip: { x: 300, y: 500 },
  turfBackLeft: { x: 100, y: 100 },
  turfBackRight: { x: 500, y: 100 },
  creaseLeft: { x: 180, y: 430 },
  creaseRight: { x: 420, y: 430 },
};

describe("shot measurement", () => {
  it("estimates direction and speed using calibrated turf fallback", () => {
    const tracking: TrackingSummary = {
      points: Array.from({ length: 8 }, (_, index) => ({
        frameIndex: index,
        timeS: index / 120,
        center: { x: 300 + index * 3, y: 600 - index * 10 },
        radiusPx: 7,
        confidence: 0.9,
        predicted: false,
        velocityPxPerS: { x: 360, y: -1200 },
      })),
      detectedPoints: 8,
      predictedPoints: 0,
      averageConfidence: 0.9,
      bounceFrameIndices: [],
      longestPredictedGap: 0,
      pixelDirectionDegrees: 16,
      pixelSpeedPerSecond: 1250,
    };

    const measurement = estimateShotMeasurement(tracking, {
      ballDiameterMm: 72,
      captureFps: 120,
      landmarks,
      turfPlane,
      trackedFrameSize: { width: 600, height: 800 },
      calibrationImageSize: { width: 600, height: 800 },
    });

    expect(measurement).toBeDefined();
    expect(measurement?.method).toBe("turf-homography");
    expect(measurement?.speedMps).toBeGreaterThan(2);
    expect(measurement?.confidence).toBeGreaterThan(0.4);
  });
});
