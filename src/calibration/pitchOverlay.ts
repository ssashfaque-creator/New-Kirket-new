import {
  BOWLING_CREASE_HALF_WIDTH_INCHES,
  CRICKET_PITCH_LENGTH_INCHES,
  PITCH_HALF_WIDTH_INCHES,
  POPPING_CREASE_DISTANCE_INCHES,
  POPPING_CREASE_HALF_WIDTH_INCHES,
  RETURN_CREASE_FORWARD_INCHES,
} from "./constants";
import type { Point2D, Point3D, PoseResult } from "./types";

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
