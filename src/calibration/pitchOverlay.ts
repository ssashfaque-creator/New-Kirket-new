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

  const originT = turfParameterForPoint(origin, turfPlane);
  const batT = turfParameterForPoint(batTip, turfPlane);
  const tPerInch = (batT - originT) / 33.5;
  if (!Number.isFinite(tPerInch) || Math.abs(tPerInch) < 0.0005) return [];

  const pointFor = (xInches: number, yInches: number) =>
    turfPointAt(turfPlane, originT + yInches * tPerInch, xInches);

  return [
    turfWorldLine("pitch-left-edge", "pitch edge", "pitch", -PITCH_HALF_WIDTH_INCHES, 0, -PITCH_HALF_WIDTH_INCHES, CRICKET_PITCH_LENGTH_INCHES, pointFor),
    turfWorldLine("pitch-right-edge", "pitch edge", "pitch", PITCH_HALF_WIDTH_INCHES, 0, PITCH_HALF_WIDTH_INCHES, CRICKET_PITCH_LENGTH_INCHES, pointFor),
    turfWorldLine("pitch-center", "pitch centre", "center", 0, 0, 0, CRICKET_PITCH_LENGTH_INCHES, pointFor),
    turfWorldLine("bowling-crease-near", "bowling crease", "crease", -BOWLING_CREASE_HALF_WIDTH_INCHES, 0, BOWLING_CREASE_HALF_WIDTH_INCHES, 0, pointFor),
    turfWorldLine("popping-crease-near", "popping crease", "crease", -POPPING_CREASE_HALF_WIDTH_INCHES, POPPING_CREASE_DISTANCE_INCHES, POPPING_CREASE_HALF_WIDTH_INCHES, POPPING_CREASE_DISTANCE_INCHES, pointFor),
    turfWorldLine("return-crease-left", "return crease", "crease", -BOWLING_CREASE_HALF_WIDTH_INCHES, 0, -BOWLING_CREASE_HALF_WIDTH_INCHES, RETURN_CREASE_FORWARD_INCHES, pointFor),
    turfWorldLine("return-crease-right", "return crease", "crease", BOWLING_CREASE_HALF_WIDTH_INCHES, 0, BOWLING_CREASE_HALF_WIDTH_INCHES, RETURN_CREASE_FORWARD_INCHES, pointFor),
    turfWorldLine("bowling-crease-far", "far bowling crease", "crease", -BOWLING_CREASE_HALF_WIDTH_INCHES, CRICKET_PITCH_LENGTH_INCHES, BOWLING_CREASE_HALF_WIDTH_INCHES, CRICKET_PITCH_LENGTH_INCHES, pointFor),
    turfWorldLine("popping-crease-far", "far popping crease", "crease", -POPPING_CREASE_HALF_WIDTH_INCHES, CRICKET_PITCH_LENGTH_INCHES - POPPING_CREASE_DISTANCE_INCHES, POPPING_CREASE_HALF_WIDTH_INCHES, CRICKET_PITCH_LENGTH_INCHES - POPPING_CREASE_DISTANCE_INCHES, pointFor),
  ].filter((line) => line.points.every(isFinitePoint));
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
  const left = interpolate(turfPlane.leftEdge.near, turfPlane.leftEdge.far, t);
  const right = interpolate(turfPlane.rightEdge.near, turfPlane.rightEdge.far, t);
  const xFraction = (xInches + NET_TURF_WIDTH_INCHES / 2) / NET_TURF_WIDTH_INCHES;
  return interpolate(left, right, xFraction);
}

function turfParameterForPoint(point: Point2D, turfPlane: TurfPlane): number {
  const nearCenter = midpoint(turfPlane.leftEdge.near, turfPlane.rightEdge.near);
  const farCenter = midpoint(turfPlane.leftEdge.far, turfPlane.rightEdge.far);
  const axis = { x: farCenter.x - nearCenter.x, y: farCenter.y - nearCenter.y };
  const lengthSquared = axis.x * axis.x + axis.y * axis.y;
  if (lengthSquared < 1e-6) return 0;
  return ((point.x - nearCenter.x) * axis.x + (point.y - nearCenter.y) * axis.y) / lengthSquared;
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
