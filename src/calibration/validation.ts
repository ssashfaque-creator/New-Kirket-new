import { availablePoseLandmarks, calculateBatScale, distance } from "./geometry";
import type { TurfPlane } from "./autoDetect";
import type { CalibrationResult, ImageSize, LandmarkId, LandmarkMap, Point2D } from "./types";

export type CalibrationIssue = {
  id: string;
  severity: "error" | "warning";
  message: string;
};

export type CalibrationReadiness = {
  score: number;
  readyForOverlay: boolean;
  readyForShotDetection: boolean;
  issues: CalibrationIssue[];
};

const STUMP_PAIRS: Array<[LandmarkId, LandmarkId]> = [
  ["offStumpTop", "offStumpBase"],
  ["middleStumpTop", "middleStumpBase"],
  ["legStumpTop", "legStumpBase"],
];

export function validateCalibrationReadiness(
  landmarks: LandmarkMap,
  imageSize: ImageSize | undefined,
  turfPlane: TurfPlane | undefined,
  result: CalibrationResult | undefined,
): CalibrationReadiness {
  const issues: CalibrationIssue[] = [];
  const poseCount = availablePoseLandmarks(landmarks).length;
  if (poseCount < 6) {
    issues.push(issue("pose-points", "error", `Only ${poseCount}/6 required stump/bat pose points are set.`));
  }

  const scale = calculateBatScale(landmarks);
  if (!scale || !imageSize) {
    issues.push(issue("bat-scale", "error", "Middle stump base and the 33.5 in bat tip must be marked."));
  } else {
    const imageDiagonal = Math.hypot(imageSize.width, imageSize.height);
    const fraction = scale.batLengthPx / imageDiagonal;
    if (fraction < 0.025) {
      issues.push(issue("bat-small", "error", "The bat is too small in the image for reliable scale."));
    } else if (fraction > 0.65) {
      issues.push(issue("bat-large", "warning", "The bat reference spans most of the image; verify both endpoints."));
    }
  }

  const stumpSegments = STUMP_PAIRS
    .map(([topId, baseId]) => {
      const top = landmarks[topId];
      const base = landmarks[baseId];
      return top && base ? { topId, baseId, top, base, length: distance(top, base) } : undefined;
    })
    .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment));

  for (const stump of stumpSegments) {
    if (stump.top.y >= stump.base.y) {
      issues.push(issue(`${stump.topId}-orientation`, "error", `${label(stump.topId)} must be above its base.`));
    }
  }

  if (stumpSegments.length >= 2) {
    const lengths = stumpSegments.map((segment) => segment.length);
    const mean = average(lengths);
    const coefficientOfVariation = standardDeviation(lengths) / Math.max(mean, 1);
    if (coefficientOfVariation > 0.35) {
      issues.push(issue("stump-height-consistency", "warning", "Stump heights differ strongly; check top/base placement."));
    }
    const bases = stumpSegments.map((segment) => segment.base.y);
    if (Math.max(...bases) - Math.min(...bases) > mean * 0.4) {
      issues.push(issue("stump-base-line", "warning", "Stump bases do not share a plausible ground line."));
    }
  }

  validateStumpOrdering(landmarks, issues);
  validateBackEdge(landmarks, imageSize, issues);
  validateCreaseDirection(landmarks, issues);

  if (!turfPlane) {
    issues.push(issue("turf-plane", "error", "The green turf plane is missing; auto-detect or restore calibration."));
  } else if (turfPlane.confidence < 0.25) {
    issues.push(issue("turf-confidence", "warning", "Turf-plane confidence is low; verify both 13 ft back-edge markers."));
  }

  if (!result?.pose) {
    issues.push(issue("pose", "warning", "3D phone pose is not solved; shot speed will use the lower-confidence turf fallback."));
  } else {
    if (result.pose.reprojectionErrorPx > 5 || result.pose.maxReprojectionErrorPx > 10) {
      issues.push(issue("pose-error", "error", "3D pose reprojection error is too high for ball-depth measurement."));
    }
    if (result.pose.warning) {
      issues.push(issue("pose-warning", "error", result.pose.warning));
    }
  }

  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.length - errorCount;
  const score = Math.max(0, Math.round(100 - errorCount * 18 - warningCount * 7));
  const hasCoreGeometryErrors = issues.some(
    (item) =>
      item.severity === "error" &&
      ["pose-points", "bat-scale", "bat-small", "turf-plane", "stump-order", "back-edge"].includes(item.id),
  );

  return {
    score,
    readyForOverlay: !hasCoreGeometryErrors,
    readyForShotDetection: !hasCoreGeometryErrors && Boolean(scale && turfPlane),
    issues,
  };
}

function validateStumpOrdering(landmarks: LandmarkMap, issues: CalibrationIssue[]) {
  const off = landmarks.offStumpBase;
  const middle = landmarks.middleStumpBase;
  const leg = landmarks.legStumpBase;
  if (!off || !middle || !leg) return;
  const sorted = [off.x, middle.x, leg.x].sort((a, b) => a - b);
  if (middle.x !== sorted[1]) {
    issues.push(issue("stump-order", "error", "Middle stump base must lie between the two outer stump bases."));
  }
}

function validateBackEdge(
  landmarks: LandmarkMap,
  imageSize: ImageSize | undefined,
  issues: CalibrationIssue[],
) {
  const left = landmarks.turfBackLeft;
  const right = landmarks.turfBackRight;
  if (!left || !right || !imageSize) {
    issues.push(issue("back-edge", "error", "Both ends of the 13 ft back turf edge must be marked."));
    return;
  }
  if (distance(left, right) < imageSize.width * 0.12) {
    issues.push(issue("back-edge", "error", "The marked 13 ft back turf edge is implausibly short."));
  }
}

function validateCreaseDirection(landmarks: LandmarkMap, issues: CalibrationIssue[]) {
  const left = landmarks.creaseLeft;
  const right = landmarks.creaseRight;
  if (!left || !right) {
    issues.push(issue("crease", "warning", "Set both crease-direction handles for the most stable overlay angle."));
    return;
  }
  if (distance(left, right) < 10) {
    issues.push(issue("crease", "warning", "Crease-direction handles are too close together."));
  }
}

function issue(id: string, severity: CalibrationIssue["severity"], message: string): CalibrationIssue {
  return { id, severity, message };
}

function label(id: LandmarkId): string {
  return id.replace(/([A-Z])/g, " $1").toLowerCase();
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function standardDeviation(values: number[]): number {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}
