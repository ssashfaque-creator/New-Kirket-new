import {
  BOWLING_CREASE_HALF_WIDTH_INCHES,
  CRICKET_PITCH_LENGTH_INCHES,
  NET_TURF_WIDTH_INCHES,
  PITCH_HALF_WIDTH_INCHES,
  POPPING_CREASE_DISTANCE_INCHES,
  POPPING_CREASE_HALF_WIDTH_INCHES,
  RETURN_CREASE_FORWARD_INCHES,
} from "./constants";
import type { TurfPlane } from "./autoDetect";
import type { LandmarkMap, Point2D, Point3D, PoseResult } from "./types";

export type PitchOverlayLine = {
  id: string;
  label: string;
  points: Point2D[];
  kind: "pitch" | "crease" | "center";
};

type WorldLine = {
  id: string;
  label: string;
  from: Point3D;
  to: Point3D;
  kind: PitchOverlayLine["kind"];
};

export function buildPitchOverlayLines(pose: PoseResult): PitchOverlayLine[] {
  return worldPitchLines()
    .map((line) => {
      const points = sampleWorldLine(line.from, line.to, 18)
        .map((point) => projectWorldPoint(pose, point))
        .filter((point): point is Point2D => Boolean(point));

      return {
        id: line.id,
        label: line.label,
        points,
        kind: line.kind,
      };
    })
    .filter((line) => line.points.length >= 2);
}

export function buildTurfPitchOverlayLines(
  landmarks: LandmarkMap,
  turfPlane: TurfPlane | undefined,
): PitchOverlayLine[] {
  const origin = landmarks.middleStumpBase;
  const batTip = landmarks.batTip;
  if (!origin || !batTip || !turfPlane) return [];
  const adjustedTurfPlane = applyManualBackEdge(turfPlane, landmarks);

  const originUnit = imageToTurfUnit(origin, adjustedTurfPlane);
  const batUnit = imageToTurfUnit(batTip, adjustedTurfPlane);
  const originPlane = {
    x: unitToXInches(originUnit.x),
    y: originUnit.y,
  };
  const batPlane = {
    x: unitToXInches(batUnit.x),
    y: batUnit.y,
  };
  const deltaX = clamp(batPlane.x - originPlane.x, -33.5 * 0.65, 33.5 * 0.65);
  const deltaV = batPlane.y - originPlane.y;
  if (!Number.isFinite(deltaV) || Math.abs(deltaV) < 0.0005) return [];

  const deltaYInches = Math.sqrt(Math.max(33.5 * 33.5 - deltaX * deltaX, 33.5 * 33.5 * 0.35));
  const vScale = (Math.sign(deltaV) || 1) * deltaYInches / deltaV;
  if (!Number.isFinite(vScale) || Math.abs(vScale) < 1e-6) return [];

  const originReal = {
    x: originPlane.x,
    y: originPlane.y * vScale,
  };
  const batForward = unitVector({
    x: deltaX,
    y: deltaV * vScale,
  });
  const basis = turfOverlayBasis(landmarks, adjustedTurfPlane, vScale, batForward);
  const forward = basis.forward;
  const right = basis.right;
  const pointFor = (xInches: number, yInches: number) => {
    const planePoint = {
      x: originReal.x + right.x * xInches + forward.x * yInches,
      y: originReal.y + right.y * xInches + forward.y * yInches,
    };
    return turfPointAt(adjustedTurfPlane, planePoint.y / vScale, planePoint.x);
  };

  return [
    turfImageLine("turf-back-edge", "back turf edge 13 ft", "crease", adjustedTurfPlane.leftEdge.far, adjustedTurfPlane.rightEdge.far),
    turfWorldLine("pitch-left-edge", "pitch edge 66 ft", "pitch", -PITCH_HALF_WIDTH_INCHES, 0, -PITCH_HALF_WIDTH_INCHES, CRICKET_PITCH_LENGTH_INCHES, pointFor),
    turfWorldLine("pitch-right-edge", "pitch edge 66 ft", "pitch", PITCH_HALF_WIDTH_INCHES, 0, PITCH_HALF_WIDTH_INCHES, CRICKET_PITCH_LENGTH_INCHES, pointFor),
    turfWorldLine("pitch-center", "pitch centre 66 ft", "center", 0, 0, 0, CRICKET_PITCH_LENGTH_INCHES, pointFor),
    turfWorldLine("bowling-crease-near", "bowling crease 8 ft 8 in", "crease", -BOWLING_CREASE_HALF_WIDTH_INCHES, 0, BOWLING_CREASE_HALF_WIDTH_INCHES, 0, pointFor),
    turfWorldLine("popping-crease-near", "popping crease 12 ft", "crease", -POPPING_CREASE_HALF_WIDTH_INCHES, POPPING_CREASE_DISTANCE_INCHES, POPPING_CREASE_HALF_WIDTH_INCHES, POPPING_CREASE_DISTANCE_INCHES, pointFor),
    turfWorldLine("return-crease-left", "return crease 8 ft+", "crease", -BOWLING_CREASE_HALF_WIDTH_INCHES, 0, -BOWLING_CREASE_HALF_WIDTH_INCHES, RETURN_CREASE_FORWARD_INCHES, pointFor),
    turfWorldLine("return-crease-right", "return crease 8 ft+", "crease", BOWLING_CREASE_HALF_WIDTH_INCHES, 0, BOWLING_CREASE_HALF_WIDTH_INCHES, RETURN_CREASE_FORWARD_INCHES, pointFor),
    turfWorldLine("bowling-crease-far", "far bowling crease", "crease", -BOWLING_CREASE_HALF_WIDTH_INCHES, CRICKET_PITCH_LENGTH_INCHES, BOWLING_CREASE_HALF_WIDTH_INCHES, CRICKET_PITCH_LENGTH_INCHES, pointFor),
    turfWorldLine("popping-crease-far", "far popping crease", "crease", -POPPING_CREASE_HALF_WIDTH_INCHES, CRICKET_PITCH_LENGTH_INCHES - POPPING_CREASE_DISTANCE_INCHES, POPPING_CREASE_HALF_WIDTH_INCHES, CRICKET_PITCH_LENGTH_INCHES - POPPING_CREASE_DISTANCE_INCHES, pointFor),
  ].filter((line) => line.points.every(isFinitePoint));
}

export function imagePointToPitchInches(
  point: Point2D,
  landmarks: LandmarkMap,
  turfPlane: TurfPlane | undefined,
): Point2D | undefined {
  const calibration = turfCalibrationBasis(landmarks, turfPlane);
  if (!calibration || !turfPlane) return undefined;
  const adjustedTurfPlane = applyManualBackEdge(turfPlane, landmarks);
  const unit = imageToTurfUnit(point, adjustedTurfPlane);
  const real = {
    x: unitToXInches(unit.x),
    y: unit.y * calibration.vScale,
  };
  const relative = {
    x: real.x - calibration.originReal.x,
    y: real.y - calibration.originReal.y,
  };
  return {
    x: relative.x * calibration.right.x + relative.y * calibration.right.y,
    y: relative.x * calibration.forward.x + relative.y * calibration.forward.y,
  };
}

function turfImageLine(
  id: string,
  label: string,
  kind: PitchOverlayLine["kind"],
  from: Point2D,
  to: Point2D,
): PitchOverlayLine {
  return { id, label, kind, points: [from, to] };
}

function applyManualBackEdge(turfPlane: TurfPlane, landmarks: LandmarkMap): TurfPlane {
  const backLeft = landmarks.turfBackLeft;
  const backRight = landmarks.turfBackRight;
  if (!backLeft || !backRight) return turfPlane;

  const [leftFar, rightFar] = backLeft.x <= backRight.x ? [backLeft, backRight] : [backRight, backLeft];
  return {
    ...turfPlane,
    polygon: [leftFar, rightFar, turfPlane.rightEdge.near, turfPlane.leftEdge.near],
    leftEdge: {
      ...turfPlane.leftEdge,
      far: leftFar,
    },
    rightEdge: {
      ...turfPlane.rightEdge,
      far: rightFar,
    },
  };
}

function turfOverlayBasis(
  landmarks: LandmarkMap,
  turfPlane: TurfPlane,
  vScale: number,
  batForward: Point2D,
): { forward: Point2D; right: Point2D } {
  const creaseLeft = landmarks.creaseLeft;
  const creaseRight = landmarks.creaseRight;
  if (creaseLeft && creaseRight) {
    const leftUnit = imageToTurfUnit(creaseLeft, turfPlane);
    const rightUnit = imageToTurfUnit(creaseRight, turfPlane);
    const leftReal = { x: unitToXInches(leftUnit.x), y: leftUnit.y * vScale };
    const rightReal = { x: unitToXInches(rightUnit.x), y: rightUnit.y * vScale };
    const creaseRightVector = unitVector({
      x: rightReal.x - leftReal.x,
      y: rightReal.y - leftReal.y,
    });
    let forward = {
      x: -creaseRightVector.y,
      y: creaseRightVector.x,
    };

    if (forward.x * batForward.x + forward.y * batForward.y < 0) {
      forward = { x: -forward.x, y: -forward.y };
    }

    return {
      forward,
      right: creaseRightVector,
    };
  }

  return {
    forward: batForward,
    right: {
      x: batForward.y,
      y: -batForward.x,
    },
  };
}

function turfCalibrationBasis(
  landmarks: LandmarkMap,
  turfPlane: TurfPlane | undefined,
):
  | {
      originReal: Point2D;
      forward: Point2D;
      right: Point2D;
      vScale: number;
    }
  | undefined {
  const origin = landmarks.middleStumpBase;
  const batTip = landmarks.batTip;
  if (!origin || !batTip || !turfPlane) return undefined;
  const adjustedTurfPlane = applyManualBackEdge(turfPlane, landmarks);
  const originUnit = imageToTurfUnit(origin, adjustedTurfPlane);
  const batUnit = imageToTurfUnit(batTip, adjustedTurfPlane);
  const originPlane = { x: unitToXInches(originUnit.x), y: originUnit.y };
  const batPlane = { x: unitToXInches(batUnit.x), y: batUnit.y };
  const deltaX = clamp(batPlane.x - originPlane.x, -33.5 * 0.65, 33.5 * 0.65);
  const deltaV = batPlane.y - originPlane.y;
  if (!Number.isFinite(deltaV) || Math.abs(deltaV) < 0.0005) return undefined;
  const deltaYInches = Math.sqrt(Math.max(33.5 * 33.5 - deltaX * deltaX, 33.5 * 33.5 * 0.35));
  const vScale = (Math.sign(deltaV) || 1) * deltaYInches / deltaV;
  if (!Number.isFinite(vScale) || Math.abs(vScale) < 1e-6) return undefined;
  const originReal = { x: originPlane.x, y: originPlane.y * vScale };
  const batForward = unitVector({ x: deltaX, y: deltaV * vScale });
  const basis = turfOverlayBasis(landmarks, adjustedTurfPlane, vScale, batForward);
  return { originReal, forward: basis.forward, right: basis.right, vScale };
}

export function projectWorldPoint(pose: PoseResult, point: Point3D): Point2D | undefined {
  const rotation = rodrigues(pose.rvec);
  const cameraX =
    rotation[0][0] * point.x + rotation[0][1] * point.y + rotation[0][2] * point.z + pose.tvec[0];
  const cameraY =
    rotation[1][0] * point.x + rotation[1][1] * point.y + rotation[1][2] * point.z + pose.tvec[1];
  const cameraZ =
    rotation[2][0] * point.x + rotation[2][1] * point.y + rotation[2][2] * point.z + pose.tvec[2];

  if (Math.abs(cameraZ) < 1e-6) return undefined;

  return {
    x: pose.intrinsics.fx * (cameraX / cameraZ) + pose.intrinsics.cx,
    y: pose.intrinsics.fy * (cameraY / cameraZ) + pose.intrinsics.cy,
  };
}

function worldPitchLines(): WorldLine[] {
  const otherWicketY = CRICKET_PITCH_LENGTH_INCHES;
  return [
    {
      id: "pitch-left-edge",
      label: "pitch edge",
      from: { x: -PITCH_HALF_WIDTH_INCHES, y: 0, z: 0 },
      to: { x: -PITCH_HALF_WIDTH_INCHES, y: otherWicketY, z: 0 },
      kind: "pitch",
    },
    {
      id: "pitch-right-edge",
      label: "pitch edge",
      from: { x: PITCH_HALF_WIDTH_INCHES, y: 0, z: 0 },
      to: { x: PITCH_HALF_WIDTH_INCHES, y: otherWicketY, z: 0 },
      kind: "pitch",
    },
    {
      id: "pitch-center",
      label: "pitch centre",
      from: { x: 0, y: 0, z: 0 },
      to: { x: 0, y: otherWicketY, z: 0 },
      kind: "center",
    },
    {
      id: "bowling-crease-near",
      label: "bowling crease",
      from: { x: -BOWLING_CREASE_HALF_WIDTH_INCHES, y: 0, z: 0 },
      to: { x: BOWLING_CREASE_HALF_WIDTH_INCHES, y: 0, z: 0 },
      kind: "crease",
    },
    {
      id: "popping-crease-near",
      label: "popping crease",
      from: { x: -POPPING_CREASE_HALF_WIDTH_INCHES, y: POPPING_CREASE_DISTANCE_INCHES, z: 0 },
      to: { x: POPPING_CREASE_HALF_WIDTH_INCHES, y: POPPING_CREASE_DISTANCE_INCHES, z: 0 },
      kind: "crease",
    },
    {
      id: "return-crease-left",
      label: "return crease",
      from: { x: -BOWLING_CREASE_HALF_WIDTH_INCHES, y: 0, z: 0 },
      to: { x: -BOWLING_CREASE_HALF_WIDTH_INCHES, y: RETURN_CREASE_FORWARD_INCHES, z: 0 },
      kind: "crease",
    },
    {
      id: "return-crease-right",
      label: "return crease",
      from: { x: BOWLING_CREASE_HALF_WIDTH_INCHES, y: 0, z: 0 },
      to: { x: BOWLING_CREASE_HALF_WIDTH_INCHES, y: RETURN_CREASE_FORWARD_INCHES, z: 0 },
      kind: "crease",
    },
    {
      id: "popping-crease-far",
      label: "far popping crease",
      from: {
        x: -POPPING_CREASE_HALF_WIDTH_INCHES,
        y: otherWicketY - POPPING_CREASE_DISTANCE_INCHES,
        z: 0,
      },
      to: {
        x: POPPING_CREASE_HALF_WIDTH_INCHES,
        y: otherWicketY - POPPING_CREASE_DISTANCE_INCHES,
        z: 0,
      },
      kind: "crease",
    },
    {
      id: "bowling-crease-far",
      label: "far bowling crease",
      from: { x: -BOWLING_CREASE_HALF_WIDTH_INCHES, y: otherWicketY, z: 0 },
      to: { x: BOWLING_CREASE_HALF_WIDTH_INCHES, y: otherWicketY, z: 0 },
      kind: "crease",
    },
  ];
}

function sampleWorldLine(from: Point3D, to: Point3D, segments: number): Point3D[] {
  const points: Point3D[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    points.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      z: from.z + (to.z - from.z) * t,
    });
  }
  return points;
}

function turfWorldLine(
  id: string,
  label: string,
  kind: PitchOverlayLine["kind"],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pointFor: (xInches: number, yInches: number) => Point2D,
): PitchOverlayLine {
  const points: Point2D[] = [];
  const segments = 18;
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    points.push(pointFor(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t));
  }
  return { id, label, kind, points };
}

function turfPointAt(turfPlane: TurfPlane, t: number, xInches: number): Point2D {
  const homography = turfHomography(turfPlane);
  return applyHomography(homography, {
    x: xInchesToUnit(xInches),
    y: t,
  });
}

function turfParameterForPoint(point: Point2D, turfPlane: TurfPlane): number {
  return imageToTurfUnit(point, turfPlane).y;
}

function interpolate(a: Point2D, b: Point2D, t: number): Point2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function midpoint(a: Point2D, b: Point2D): Point2D {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function isFinitePoint(point: Point2D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function unitVector(vector: Point2D): Point2D {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 1e-9) return { x: 0, y: 1 };
  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function imageToTurfUnit(point: Point2D, turfPlane: TurfPlane): Point2D {
  return applyHomography(invertHomography(turfHomography(turfPlane)), point);
}

function xInchesToUnit(xInches: number): number {
  return (xInches + NET_TURF_WIDTH_INCHES / 2) / NET_TURF_WIDTH_INCHES;
}

function unitToXInches(unitX: number): number {
  return (unitX - 0.5) * NET_TURF_WIDTH_INCHES;
}

function turfHomography(turfPlane: TurfPlane): number[] {
  return computeHomography(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    [
      turfPlane.leftEdge.near,
      turfPlane.rightEdge.near,
      turfPlane.rightEdge.far,
      turfPlane.leftEdge.far,
    ],
  );
}

function applyHomography(h: number[], point: Point2D): Point2D {
  const denominator = h[6] * point.x + h[7] * point.y + h[8];
  return {
    x: (h[0] * point.x + h[1] * point.y + h[2]) / denominator,
    y: (h[3] * point.x + h[4] * point.y + h[5]) / denominator,
  };
}

function computeHomography(source: Point2D[], destination: Point2D[]): number[] {
  const matrix: number[][] = [];
  const rhs: number[] = [];

  for (let i = 0; i < 4; i += 1) {
    const src = source[i];
    const dst = destination[i];
    matrix.push([src.x, src.y, 1, 0, 0, 0, -dst.x * src.x, -dst.x * src.y]);
    rhs.push(dst.x);
    matrix.push([0, 0, 0, src.x, src.y, 1, -dst.y * src.x, -dst.y * src.y]);
    rhs.push(dst.y);
  }

  const solved = solveLinearSystem(matrix, rhs);
  return [...solved, 1];
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row;
      }
    }

    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const pivotValue = augmented[column][column] || 1e-12;
    for (let col = column; col <= size; col += 1) {
      augmented[column][col] /= pivotValue;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let col = column; col <= size; col += 1) {
        augmented[row][col] -= factor * augmented[column][col];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function invertHomography(h: number[]): number[] {
  const [a, b, c, d, e, f, g, i, j] = h;
  const determinant =
    a * (e * j - f * i) -
    b * (d * j - f * g) +
    c * (d * i - e * g);
  const invDet = 1 / (determinant || 1e-12);

  return [
    (e * j - f * i) * invDet,
    (c * i - b * j) * invDet,
    (b * f - c * e) * invDet,
    (f * g - d * j) * invDet,
    (a * j - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * i - e * g) * invDet,
    (b * g - a * i) * invDet,
    (a * e - b * d) * invDet,
  ];
}

function rodrigues(rvec: [number, number, number]) {
  const [rx, ry, rz] = rvec;
  const theta = Math.hypot(rx, ry, rz);
  if (theta < 1e-12) {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }

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
