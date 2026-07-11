import { MIN_POSE_POINTS } from "./constants";
import {
  buildObjectImagePairs,
  calculateBatScale,
  estimateIntrinsics,
  scoreCalibration,
} from "./geometry";
import type { OpenCv } from "./opencv";
import type {
  CalibrationResult,
  ImageSize,
  LandmarkMap,
  Point3D,
  PoseResult,
} from "./types";

export function solveCalibration(
  cv: OpenCv,
  landmarks: LandmarkMap,
  imageSize: ImageSize,
  assumedFovDegrees: number,
): CalibrationResult {
  const scale = calculateBatScale(landmarks);
  const warnings: string[] = [];

  if (!scale) {
    warnings.push("Mark the middle stump base and far end of the 33.5 inch bat.");
  }

  let pose: PoseResult | undefined;
  const pairs = buildObjectImagePairs(landmarks);
  if (pairs.length < MIN_POSE_POINTS) {
    warnings.push(`Mark at least ${MIN_POSE_POINTS} calibrated points for phone pose.`);
  } else {
    try {
      pose = solvePhonePose(cv, landmarks, imageSize, assumedFovDegrees);
      if (pose.maxReprojectionErrorPx > 8) {
        warnings.push("High reprojection error: re-check point placement and camera FOV.");
      }
      if (pose.warning) {
        warnings.push(pose.warning);
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Pose solve failed.");
    }
  }

  return {
    quality: scoreCalibration(scale, pose?.reprojectionErrorPx),
    scale,
    pose,
    warnings,
  };
}

export function solvePhonePose(
  cv: OpenCv,
  landmarks: LandmarkMap,
  imageSize: ImageSize,
  assumedFovDegrees: number,
): PoseResult {
  const pairs = buildObjectImagePairs(landmarks);
  if (pairs.length < MIN_POSE_POINTS) {
    throw new Error(`Need ${MIN_POSE_POINTS} or more known world points to solve phone pose.`);
  }

  const intrinsics = estimateIntrinsics(imageSize, assumedFovDegrees);
  const objectData = pairs.flatMap(({ world }) => [world.x, world.y, world.z]);
  const imageData = pairs.flatMap(({ image }) => [image.x, image.y]);

  const objectPoints = cv.matFromArray(pairs.length, 1, cv.CV_64FC3, objectData);
  const imagePoints = cv.matFromArray(pairs.length, 1, cv.CV_64FC2, imageData);
  const cameraMatrix = cv.matFromArray(3, 3, cv.CV_64F, [
    intrinsics.fx,
    0,
    intrinsics.cx,
    0,
    intrinsics.fy,
    intrinsics.cy,
    0,
    0,
    1,
  ]);
  const distCoeffs = cv.Mat.zeros(4, 1, cv.CV_64F);
  const pose = solveBestPnP(cv, objectPoints, imagePoints, cameraMatrix, distCoeffs, pairs);

  if (!pose) {
    cleanup(objectPoints, imagePoints, cameraMatrix, distCoeffs);
    throw new Error("OpenCV could not solve a stable phone pose.");
  }

  const rotationMatrix = new cv.Mat();
  cv.Rodrigues(pose.rvec, rotationMatrix);

  const cameraPosition = invertPose(rotationMatrix.data64F, [
    pose.tvec.data64F[0],
    pose.tvec.data64F[1],
    pose.tvec.data64F[2],
  ]);

  const result: PoseResult = {
    ok: true,
    usedPoints: pairs.map(({ id }) => id),
    intrinsics,
    rvec: [pose.rvec.data64F[0], pose.rvec.data64F[1], pose.rvec.data64F[2]],
    tvec: [pose.tvec.data64F[0], pose.tvec.data64F[1], pose.tvec.data64F[2]],
    cameraPositionWorldInches: cameraPosition,
    distanceToMiddleStumpInches: Math.hypot(cameraPosition.x, cameraPosition.y),
    cameraHeightInches: Math.abs(cameraPosition.z),
    reprojectionErrorPx: mean(pose.errors),
    maxReprojectionErrorPx: Math.max(...pose.errors),
    warning:
      cameraPosition.z < 0
        ? "PnP returned a mirrored vertical axis; camera height is shown as a magnitude."
        : undefined,
  };

  cleanup(objectPoints, imagePoints, cameraMatrix, distCoeffs, pose.rvec, pose.tvec, pose.projected, rotationMatrix);
  return result;
}

function solveBestPnP(
  cv: OpenCv,
  objectPoints: any,
  imagePoints: any,
  cameraMatrix: any,
  distCoeffs: any,
  pairs: ReturnType<typeof buildObjectImagePairs>,
):
  | {
      rvec: any;
      tvec: any;
      projected: any;
      errors: number[];
    }
  | undefined {
  const flags = [cv.SOLVEPNP_SQPNP, cv.SOLVEPNP_EPNP, cv.SOLVEPNP_ITERATIVE].filter(
    (flag, index, all) => Number.isFinite(flag) && all.indexOf(flag) === index,
  );

  let best:
    | {
        rvec: any;
        tvec: any;
        projected: any;
        errors: number[];
      }
    | undefined;

  for (const flag of flags) {
    const rvec = new cv.Mat();
    const tvec = new cv.Mat();
    const projected = new cv.Mat();

    try {
      const ok = cv.solvePnP(
        objectPoints,
        imagePoints,
        cameraMatrix,
        distCoeffs,
        rvec,
        tvec,
        false,
        flag,
      );
      if (!ok) {
        cleanup(rvec, tvec, projected);
        continue;
      }

      cv.projectPoints(objectPoints, rvec, tvec, cameraMatrix, distCoeffs, projected);
      const errors = projectionErrors(projected, pairs);

      if (!best || mean(errors) < mean(best.errors)) {
        cleanup(best?.rvec, best?.tvec, best?.projected);
        best = { rvec, tvec, projected, errors };
      } else {
        cleanup(rvec, tvec, projected);
      }
    } catch {
      cleanup(rvec, tvec, projected);
    }
  }

  return best;
}

function projectionErrors(projected: any, pairs: ReturnType<typeof buildObjectImagePairs>): number[] {
  const errors: number[] = [];
  for (let i = 0; i < pairs.length; i += 1) {
    const dx = projected.data64F[i * 2] - pairs[i].image.x;
    const dy = projected.data64F[i * 2 + 1] - pairs[i].image.y;
    errors.push(Math.hypot(dx, dy));
  }
  return errors;
}

function invertPose(rotationData: Float64Array, tvec: [number, number, number]): Point3D {
  const r = [
    [rotationData[0], rotationData[1], rotationData[2]],
    [rotationData[3], rotationData[4], rotationData[5]],
    [rotationData[6], rotationData[7], rotationData[8]],
  ];

  return {
    x: -(r[0][0] * tvec[0] + r[1][0] * tvec[1] + r[2][0] * tvec[2]),
    y: -(r[0][1] * tvec[0] + r[1][1] * tvec[1] + r[2][1] * tvec[2]),
    z: -(r[0][2] * tvec[0] + r[1][2] * tvec[1] + r[2][2] * tvec[2]),
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function cleanup(...mats: Array<{ delete: () => void } | undefined>) {
  for (const mat of mats) mat?.delete();
}
