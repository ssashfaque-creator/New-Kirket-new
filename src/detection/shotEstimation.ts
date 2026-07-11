import type { TurfPlane } from "../calibration/autoDetect";
import { imagePointToPitchInches } from "../calibration/pitchOverlay";
import type { ImageSize, LandmarkMap, Point3D, PoseResult } from "../calibration/types";
import type { ShotInput } from "../ground/shotSimulation";
import type { TrackedBallPoint, TrackingSummary } from "./ballTracking";

export type ShotMeasurement = {
  shotInput: ShotInput;
  method: "3d-ball-size" | "turf-homography";
  speedMps: number;
  directionDegrees: number;
  launchAngleDegrees: number;
  confidence: number;
  trackedFrames: number;
  warnings: string[];
};

export type ShotEstimationOptions = {
  ballDiameterMm: number;
  captureFps: number;
  pose?: PoseResult;
  turfPlane?: TurfPlane;
  landmarks: LandmarkMap;
  trackedFrameSize?: ImageSize;
  calibrationImageSize?: ImageSize;
};

export function estimateShotMeasurement(
  tracking: TrackingSummary,
  options: ShotEstimationOptions,
): ShotMeasurement | undefined {
  if (calibrationAspectWarning(options)) return undefined;
  const normalizedPoints = normalizeTrackedCoordinates(tracking.points, options);
  const detected = normalizedPoints.filter(
    (point) => point.frameIndex >= 0 && !point.predicted && point.confidence >= 0.42,
  );
  if (detected.length < 4) return undefined;

  if (options.pose && !options.pose.warning && options.pose.reprojectionErrorPx <= 5 && options.pose.maxReprojectionErrorPx <= 10) {
    const measurement = estimateFromBallSize3d(detected, tracking, options);
    if (measurement) return measurement;
  }

  return estimateFromTurf(detected, tracking, options);
}

function normalizeTrackedCoordinates(
  points: TrackedBallPoint[],
  options: ShotEstimationOptions,
): TrackedBallPoint[] {
  const source = options.trackedFrameSize;
  const destination = options.calibrationImageSize;
  if (!source || !destination) return points;
  const scaleX = destination.width / source.width;
  const scaleY = destination.height / source.height;
  const radiusScale = (scaleX + scaleY) / 2;
  return points.map((point) => ({
    ...point,
    center: {
      x: point.center.x * scaleX,
      y: point.center.y * scaleY,
    },
    radiusPx: point.radiusPx * radiusScale,
    velocityPxPerS: {
      x: point.velocityPxPerS.x * scaleX,
      y: point.velocityPxPerS.y * scaleY,
    },
  }));
}

function estimateFromBallSize3d(
  points: TrackedBallPoint[],
  tracking: TrackingSummary,
  options: ShotEstimationOptions,
): ShotMeasurement | undefined {
  const pose = options.pose!;
  const worldPoints = points
    .map((point) => ({
      timeS: point.timeS,
      point: reconstructBallWorld(point, pose, options.ballDiameterMm),
      confidence: point.confidence,
    }))
    .filter((sample): sample is { timeS: number; point: Point3D; confidence: number } => Boolean(sample.point));

  if (worldPoints.length < 4) return undefined;
  const segment = postImpactSegment(worldPoints, tracking.impactFrameIndex, points).slice(0, 10);
  if (segment.length < 4) return undefined;
  const velocity = weightedLinearVelocity(segment);
  const horizontalSpeedInches = Math.hypot(velocity.x, velocity.y);
  const speedMps = inchesToMeters(Math.hypot(horizontalSpeedInches, velocity.z));
  if (!Number.isFinite(speedMps) || speedMps < 2 || speedMps > 75) return undefined;

  const directionDegrees = normalizeDegrees((Math.atan2(velocity.x, velocity.y) * 180) / Math.PI);
  const launchAngleDegrees = clamp(
    (Math.atan2(Math.max(0, velocity.z), Math.max(horizontalSpeedInches, 1e-6)) * 180) / Math.PI,
    0,
    55,
  );
  const trackConfidence = average(segment.map((sample) => sample.confidence));
  const radiusConsistency = radiusConsistencyScore(points.slice(0, 10));
  const poseConfidence = clamp(1 - pose.reprojectionErrorPx / 10, 0, 1);
  const confidence = clamp(trackConfidence * 0.45 + radiusConsistency * 0.25 + poseConfidence * 0.3, 0, 0.96);
  const warnings: string[] = [];
  if (radiusConsistency < 0.55) warnings.push("Ball radius varied strongly; motion blur may affect depth/speed.");
  if (pose.reprojectionErrorPx > 4) warnings.push("Camera pose error reduces 3D speed accuracy.");
  const aspectWarning = calibrationAspectWarning(options);
  if (aspectWarning) warnings.push(aspectWarning);

  return {
    shotInput: toShotInput(directionDegrees, speedMps, launchAngleDegrees, confidence),
    method: "3d-ball-size",
    speedMps,
    directionDegrees,
    launchAngleDegrees,
    confidence,
    trackedFrames: segment.length,
    warnings,
  };
}

function estimateFromTurf(
  points: TrackedBallPoint[],
  tracking: TrackingSummary,
  options: ShotEstimationOptions,
): ShotMeasurement | undefined {
  if (!options.turfPlane) return undefined;
  const groundSamples = points
    .map((point) => ({
      frameIndex: point.frameIndex,
      timeS: point.timeS,
      ground: imagePointToPitchInches(point.center, options.landmarks, options.turfPlane),
      confidence: point.confidence,
    }))
    .filter((sample): sample is { frameIndex: number; timeS: number; ground: { x: number; y: number }; confidence: number } => Boolean(sample.ground));

  if (groundSamples.length < 4) return undefined;
  const impactFrameIndex = tracking.impactFrameIndex;
  const postImpact = impactFrameIndex === undefined
    ? groundSamples
    : groundSamples.filter((sample) => sample.frameIndex >= impactFrameIndex);
  const segment = postImpact.slice(0, 8);
  if (segment.length < 4) return undefined;
  const velocity = weightedLinearVelocity(
    segment.map((sample) => ({
      timeS: sample.timeS,
      point: { x: sample.ground.x, y: sample.ground.y, z: 0 },
      confidence: sample.confidence,
    })),
  );
  const speedMps = inchesToMeters(Math.hypot(velocity.x, velocity.y));
  const directionDegrees = normalizeDegrees((Math.atan2(velocity.x, velocity.y) * 180) / Math.PI);
  const confidence = clamp(average(segment.map((sample) => sample.confidence)) * 0.62, 0, 0.72);
  const launchAngleDegrees = estimateLaunchFromPixelArc(points);

  if (!Number.isFinite(speedMps) || speedMps < 1 || speedMps > 80) return undefined;

  return {
    shotInput: toShotInput(directionDegrees, speedMps, launchAngleDegrees, confidence),
    method: "turf-homography",
    speedMps,
    directionDegrees,
    launchAngleDegrees,
    confidence,
    trackedFrames: segment.length,
    warnings: [
      "Single-plane fallback used: speed is approximate while the ball is airborne.",
      ...(tracking.predictedPoints > 0 ? ["Some missing frames were predicted by the tracker."] : []),
      ...(calibrationAspectWarning(options) ? [calibrationAspectWarning(options)!] : []),
    ],
  };
}

function calibrationAspectWarning(options: ShotEstimationOptions): string | undefined {
  const tracked = options.trackedFrameSize;
  const calibration = options.calibrationImageSize;
  if (!tracked || !calibration) return undefined;
  const trackedAspect = tracked.width / tracked.height;
  const calibrationAspect = calibration.width / calibration.height;
  if (Math.abs(trackedAspect - calibrationAspect) / calibrationAspect > 0.025) {
    return "Video and calibration aspect ratios differ; use the same lens/orientation/crop.";
  }
  return undefined;
}

function reconstructBallWorld(
  point: TrackedBallPoint,
  pose: PoseResult,
  ballDiameterMm: number,
): Point3D | undefined {
  if (point.radiusPx < 1) return undefined;
  const radiusInches = (ballDiameterMm / 25.4) / 2;
  const cameraZ = (pose.intrinsics.fx * radiusInches) / point.radiusPx;
  const cameraPoint = {
    x: ((point.center.x - pose.intrinsics.cx) * cameraZ) / pose.intrinsics.fx,
    y: ((point.center.y - pose.intrinsics.cy) * cameraZ) / pose.intrinsics.fy,
    z: cameraZ,
  };
  const rotation = rodrigues(pose.rvec);
  const translated = {
    x: cameraPoint.x - pose.tvec[0],
    y: cameraPoint.y - pose.tvec[1],
    z: cameraPoint.z - pose.tvec[2],
  };
  return {
    x: rotation[0][0] * translated.x + rotation[1][0] * translated.y + rotation[2][0] * translated.z,
    y: rotation[0][1] * translated.x + rotation[1][1] * translated.y + rotation[2][1] * translated.z,
    z: rotation[0][2] * translated.x + rotation[1][2] * translated.y + rotation[2][2] * translated.z,
  };
}

function postImpactSegment<T extends { timeS: number }>(
  samples: T[],
  impactFrameIndex: number | undefined,
  tracked: TrackedBallPoint[],
): T[] {
  if (impactFrameIndex === undefined) return samples;
  const impactPoint = tracked.find((point) => point.frameIndex === impactFrameIndex);
  if (!impactPoint) return samples;
  return samples.filter((sample) => sample.timeS >= impactPoint.timeS);
}

function weightedLinearVelocity(
  samples: Array<{ timeS: number; point: Point3D; confidence: number }>,
): Point3D {
  const timeOrigin = samples[0].timeS;
  return {
    x: weightedSlope(samples.map((sample) => [sample.timeS - timeOrigin, sample.point.x, sample.confidence])),
    y: weightedSlope(samples.map((sample) => [sample.timeS - timeOrigin, sample.point.y, sample.confidence])),
    z: weightedSlope(samples.map((sample) => [sample.timeS - timeOrigin, sample.point.z, sample.confidence])),
  };
}

function weightedSlope(samples: Array<[number, number, number]>): number {
  const weightSum = samples.reduce((sum, sample) => sum + sample[2], 0);
  const meanT = samples.reduce((sum, sample) => sum + sample[0] * sample[2], 0) / weightSum;
  const meanV = samples.reduce((sum, sample) => sum + sample[1] * sample[2], 0) / weightSum;
  let numerator = 0;
  let denominator = 0;
  for (const [time, value, weight] of samples) {
    numerator += weight * (time - meanT) * (value - meanV);
    denominator += weight * (time - meanT) ** 2;
  }
  return numerator / Math.max(denominator, 1e-9);
}

function estimateLaunchFromPixelArc(points: TrackedBallPoint[]): number {
  if (points.length < 5) return 8;
  const velocities = points.slice(1).map((point, index) => ({
    x: point.center.x - points[index].center.x,
    y: point.center.y - points[index].center.y,
  }));
  const verticalChange = velocities[0].y - velocities[Math.min(velocities.length - 1, 4)].y;
  return clamp(8 + verticalChange * 0.8, 0, 38);
}

function radiusConsistencyScore(points: TrackedBallPoint[]): number {
  const radii = points.filter((point) => !point.predicted).map((point) => point.radiusPx);
  if (radii.length < 2) return 0;
  const mean = average(radii);
  const deviation = Math.sqrt(average(radii.map((radius) => (radius - mean) ** 2)));
  return clamp(1 - deviation / Math.max(mean, 1), 0, 1);
}

function toShotInput(
  directionDegrees: number,
  speedMps: number,
  launchAngleDegrees: number,
  confidence: number,
): ShotInput {
  return {
    angleDegrees: directionDegrees,
    speedMps: clamp(speedMps, 4, 60),
    launchAngleDegrees: clamp(launchAngleDegrees, 0, 50),
    quality: clamp(0.45 + confidence * 0.5, 0.45, 0.98),
    shotType: launchAngleDegrees > 24 ? "lofted" : launchAngleDegrees < 6 ? "defensive" : "drive",
  };
}

function rodrigues(rvec: [number, number, number]) {
  const [rx, ry, rz] = rvec;
  const theta = Math.hypot(rx, ry, rz);
  if (theta < 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const kx = rx / theta;
  const ky = ry / theta;
  const kz = rz / theta;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const v = 1 - cos;
  return [
    [kx * kx * v + cos, kx * ky * v - kz * sin, kx * kz * v + ky * sin],
    [ky * kx * v + kz * sin, ky * ky * v + cos, ky * kz * v - kx * sin],
    [kz * kx * v - ky * sin, kz * ky * v + kx * sin, kz * kz * v + cos],
  ];
}

function inchesToMeters(inches: number): number {
  return inches * 0.0254;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
