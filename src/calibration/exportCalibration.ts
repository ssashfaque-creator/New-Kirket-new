import { BAT_LENGTH_INCHES, STUMP_HEIGHT_INCHES, WICKET_WIDTH_INCHES } from "./constants";
import type { CalibrationResult, ImageSize, LandmarkMap } from "./types";

export function buildCalibrationExport(
  landmarks: LandmarkMap,
  imageSize: ImageSize | undefined,
  result: CalibrationResult | undefined,
) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    physicalReferences: {
      batLengthInches: BAT_LENGTH_INCHES,
      wicketWidthInches: WICKET_WIDTH_INCHES,
      stumpHeightInches: STUMP_HEIGHT_INCHES,
    },
    imageSize,
    landmarks,
    result,
  };
}
