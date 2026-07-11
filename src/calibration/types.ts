import type { LANDMARK_ORDER } from "./constants";

export type LandmarkId = (typeof LANDMARK_ORDER)[number];

export type Point2D = {
  x: number;
  y: number;
};

export type Point3D = {
  x: number;
  y: number;
  z: number;
};

export type ImageSize = {
  width: number;
  height: number;
};

export type LandmarkMap = Partial<Record<LandmarkId, Point2D>>;

export type CandidateLine = {
  id: string;
  start: Point2D;
  end: Point2D;
  lengthPx: number;
  angleDegrees: number;
  classification: "stump" | "crease" | "bat" | "net" | "other";
};

export type CalibrationQuality = "not-ready" | "needs-work" | "good" | "excellent";

export type CameraIntrinsics = {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  assumedFovDegrees: number;
};

export type PoseResult = {
  ok: boolean;
  usedPoints: LandmarkId[];
  intrinsics: CameraIntrinsics;
  rvec: [number, number, number];
  tvec: [number, number, number];
  cameraPositionWorldInches: Point3D;
  distanceToMiddleStumpInches: number;
  cameraHeightInches: number;
  reprojectionErrorPx: number;
  maxReprojectionErrorPx: number;
  warning?: string;
};

export type BatScaleResult = {
  batLengthPx: number;
  pixelsPerInch: number;
  inchesPerPixel: number;
};

export type CalibrationResult = {
  quality: CalibrationQuality;
  scale?: BatScaleResult;
  pose?: PoseResult;
  warnings: string[];
};
