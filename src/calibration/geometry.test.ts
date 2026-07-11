import { describe, expect, it } from "vitest";
import { BAT_LENGTH_INCHES, DEFAULT_CAMERA_FOV_DEGREES } from "./constants";
import {
  WORLD_POINTS,
  calculateBatScale,
  estimateIntrinsics,
  scoreCalibration,
} from "./geometry";

describe("calibration geometry", () => {
  it("uses the bat length to convert pixels into inches", () => {
    const scale = calculateBatScale({
      middleStumpBase: { x: 100, y: 200 },
      batTip: { x: 100, y: 535 },
    });

    expect(scale?.batLengthPx).toBe(335);
    expect(scale?.pixelsPerInch).toBeCloseTo(335 / BAT_LENGTH_INCHES, 6);
    expect(scale?.inchesPerPixel).toBeCloseTo(BAT_LENGTH_INCHES / 335, 6);
  });

  it("centers the world coordinate system on the middle stump base", () => {
    expect(WORLD_POINTS.middleStumpBase).toEqual({ x: 0, y: 0, z: 0 });
    expect(WORLD_POINTS.batTip).toEqual({ x: 0, y: BAT_LENGTH_INCHES, z: 0 });
    expect(WORLD_POINTS.offStumpBase.x).toBeLessThan(0);
    expect(WORLD_POINTS.legStumpBase.x).toBeGreaterThan(0);
  });

  it("estimates a symmetric phone camera matrix from image dimensions and FOV", () => {
    const intrinsics = estimateIntrinsics(
      { width: 1920, height: 1080 },
      DEFAULT_CAMERA_FOV_DEGREES,
    );

    expect(intrinsics.cx).toBe(960);
    expect(intrinsics.cy).toBe(540);
    expect(intrinsics.fx).toBeCloseTo(intrinsics.fy, 6);
    expect(intrinsics.fx).toBeGreaterThan(1000);
  });

  it("grades low reprojection error as high quality", () => {
    expect(
      scoreCalibration(
        {
          batLengthPx: 335,
          pixelsPerInch: 10,
          inchesPerPixel: 0.1,
        },
        1.5,
      ),
    ).toBe("excellent");
  });
});
