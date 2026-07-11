import {
  BAT_LENGTH_INCHES,
  DEFAULT_CAMERA_FOV_DEGREES,
  POPPING_CREASE_DISTANCE_INCHES,
  STUMP_HEIGHT_INCHES,
  WICKET_WIDTH_INCHES,
} from "./constants";
import type {
  BatScaleResult,
  CameraIntrinsics,
  ImageSize,
  LandmarkId,
  LandmarkMap,
  Point2D,
  Point3D,
} from "./types";

export const WORLD_POINTS: Partial<Record<LandmarkId, Point3D>> = {
  middleStumpBase: { x: 0, y: 0, z: 0 },
  middleStumpTop: { x: 0, y: 0, z: STUMP_HEIGHT_INCHES },
  offStumpBase: { x: -WICKET_WIDTH_INCHES / 2, y: 0, z: 0 },
  offStumpTop: { x: -WICKET_WIDTH_INCHES / 2, y: 0, z: STUMP_HEIGHT_INCHES },
  legStumpBase: { x: WICKET_WIDTH_INCHES / 2, y: 0, z: 0 },
  legStumpTop: { x: WICKET_WIDTH_INCHES / 2, y: 0, z: STUMP_HEIGHT_INCHES },
  batTip: { x: 0, y: BAT_LENGTH_INCHES, z: 0 },
  creaseLeft: { x: -WICKET_WIDTH_INCHES, y: POPPING_CREASE_DISTANCE_INCHES, z: 0 },
  creaseRight: { x: WICKET_WIDTH_INCHES, y: POPPING_CREASE_DISTANCE_INCHES, z: 0 },
};

export function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point2D, b: Point2D): Point2D {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

export function clampPoint(point: Point2D, size: ImageSize): Point2D {
  return {
    x: Math.min(Math.max(point.x, 0), size.width),
    y: Math.min(Math.max(point.y, 0), size.height),
  };
}

export function angleDegrees(a: Point2D, b: Point2D): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

export function normalizeAngleDegrees(angle: number): number {
  let normalized = angle % 180;
  if (normalized < 0) normalized += 180;
  return normalized;
}

export function calculateBatScale(landmarks: LandmarkMap): BatScaleResult | undefined {
  const toe = landmarks.middleStumpBase;
  const tip = landmarks.batTip;
  if (!toe || !tip) return undefined;

  const batLengthPx = distance(toe, tip);
  if (batLengthPx < 1) return undefined;

  return {
    batLengthPx,
    pixelsPerInch: batLengthPx / BAT_LENGTH_INCHES,
    inchesPerPixel: BAT_LENGTH_INCHES / batLengthPx,
  };
}

export function estimateIntrinsics(
  size: ImageSize,
  assumedFovDegrees = DEFAULT_CAMERA_FOV_DEGREES,
): CameraIntrinsics {
  const fovRadians = (assumedFovDegrees * Math.PI) / 180;
  const focalPx = (Math.max(size.width, size.height) / 2) / Math.tan(fovRadians / 2);

  return {
    fx: focalPx,
    fy: focalPx,
    cx: size.width / 2,
    cy: size.height / 2,
    assumedFovDegrees,
  };
}

export function availablePoseLandmarks(landmarks: LandmarkMap): LandmarkId[] {
  return (Object.keys(WORLD_POINTS) as LandmarkId[]).filter((id) => Boolean(landmarks[id] && WORLD_POINTS[id]));
}

export function buildObjectImagePairs(landmarks: LandmarkMap): Array<{
  id: LandmarkId;
  image: Point2D;
  world: Point3D;
}> {
  return availablePoseLandmarks(landmarks).map((id) => ({
    id,
    image: landmarks[id]!,
    world: WORLD_POINTS[id]!,
  }));
}

export function scoreCalibration(scale: BatScaleResult | undefined, reprojectionErrorPx?: number) {
  if (!scale) return "not-ready" as const;
  if (reprojectionErrorPx === undefined) return "needs-work" as const;
  if (reprojectionErrorPx <= 2) return "excellent" as const;
  if (reprojectionErrorPx <= 5) return "good" as const;
  return "needs-work" as const;
}

export function formatNumber(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "n/a";
  return value.toFixed(decimals);
}
