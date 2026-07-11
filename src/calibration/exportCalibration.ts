import { BAT_LENGTH_INCHES, STUMP_HEIGHT_INCHES, WICKET_WIDTH_INCHES } from "./constants";
import type { TurfPlane } from "./autoDetect";
import type { CalibrationResult, ImageSize, LandmarkMap } from "./types";

export function buildCalibrationExport(
  landmarks: LandmarkMap,
  imageSize: ImageSize | undefined,
  result: CalibrationResult | undefined,
  turfPlane?: TurfPlane,
  assumedFov = 67,
  groundId = "dubai-style",
  fieldId = "odi-balanced",
) {
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    physicalReferences: {
      batLengthInches: BAT_LENGTH_INCHES,
      wicketWidthInches: WICKET_WIDTH_INCHES,
      stumpHeightInches: STUMP_HEIGHT_INCHES,
    },
    imageSize,
    landmarks,
    turfPlane,
    result,
    assumedFov,
    groundId,
    fieldId,
  };
}
