import { boundaryRadiusAtAngle, fielderCoordinates } from "./virtualGround";
import type { FieldPreset, FieldingPosition, GroundPreset } from "./virtualGround";

export type ShotType = "drive" | "lofted" | "pull" | "cut" | "defensive";
export type ShotResultKind = "six" | "four" | "caught" | "fielded" | "stopped" | "wicketkeeper";

export type ShotInput = {
  angleDegrees: number;
  speedMps: number;
  launchAngleDegrees: number;
  quality: number;
  shotType: ShotType;
};

export type TrajectoryPoint = {
  timeS: number;
  xM: number;
  yM: number;
  zM: number;
  speedMps: number;
  phase: "air" | "bounce" | "roll";
};

export type FielderAttempt = {
  fielderId: string;
  label: string;
  interceptTimeS: number;
  xM: number;
  yM: number;
  distanceFromStrikerM: number;
  ballHeightM: number;
  catchChance: number;
  runoutChance: number;
  kind: "catch" | "ground";
};

export type ShotSimulationResult = {
  kind: ShotResultKind;
  runs: number;
  description: string;
  trajectory: TrajectoryPoint[];
  landingPoint?: TrajectoryPoint;
  boundaryPoint?: TrajectoryPoint;
  bestFielder?: FielderAttempt;
  confidence: number;
};

const GRAVITY = 9.81;
const TIME_STEP_SECONDS = 0.05;
const MAX_TIME_SECONDS = 14;
const BALL_CARRY_DRAG = 0.992;
const ROLL_DECELERATION = 4.2;
const BASE_RUN_SECONDS = 3.35;

export function simulateShot(
  input: ShotInput,
  ground: GroundPreset,
  field: FieldPreset,
): ShotSimulationResult {
  const normalized = normalizeInput(input);
  const trajectory = buildTrajectory(normalized, ground);
  const landingPoint = trajectory.find((point) => point.phase === "bounce" || point.phase === "roll");
  const boundaryPoint = interpolatedBoundaryPoint(trajectory, ground);
  const catchAttempt = bestCatchAttempt(trajectory, field.positions, ground);

  if (catchAttempt && catchAttempt.catchChance >= 0.72 && (!boundaryPoint || catchAttempt.interceptTimeS < boundaryPoint.timeS)) {
    return {
      kind: "caught",
      runs: 0,
      description: `${catchAttempt.label} has a ${percent(catchAttempt.catchChance)} catch chance.`,
      trajectory,
      landingPoint,
      bestFielder: catchAttempt,
      confidence: catchAttempt.catchChance,
    };
  }

  if (boundaryPoint) {
    const isSix = !landingPoint || landingPoint.timeS > boundaryPoint.timeS;
    const visibleTrajectory = truncateTrajectoryAt(trajectory, boundaryPoint);
    return {
      kind: isSix ? "six" : "four",
      runs: isSix ? 6 : 4,
      description: isSix
        ? `Clears the rope at ${Math.round(distanceFromOrigin(boundaryPoint))} m.`
        : `Bounces at ${Math.round(distanceFromOrigin(landingPoint!))} m and reaches the rope at ${Math.round(distanceFromOrigin(boundaryPoint))} m.`,
      trajectory: visibleTrajectory,
      landingPoint,
      boundaryPoint,
      confidence: isSix ? 0.9 : 0.86,
    };
  }

  const groundAttempt = bestGroundInterception(trajectory, field.positions, ground);
  if (groundAttempt) {
    const runs = estimateCompletedRuns(groundAttempt);
    const kind: ShotResultKind = groundAttempt.label === "WK" ? "wicketkeeper" : runs === 0 ? "stopped" : "fielded";
    return {
      kind,
      runs,
      description: `${groundAttempt.label} fields it in ${groundAttempt.interceptTimeS.toFixed(1)}s; likely ${runs} run${runs === 1 ? "" : "s"}.`,
      trajectory,
      landingPoint,
      bestFielder: groundAttempt,
      confidence: Math.max(0.55, 1 - groundAttempt.runoutChance * 0.3),
    };
  }

  const finalPoint = trajectory[trajectory.length - 1];
  const runs = Math.min(3, Math.max(0, Math.floor(distanceFromOrigin(finalPoint) / 20.12)));
  return {
    kind: "fielded",
    runs,
    description: `No clean interception before the ball slows; likely ${runs} run${runs === 1 ? "" : "s"}.`,
    trajectory,
    landingPoint,
    confidence: 0.48,
  };
}

export function defaultShotInput(): ShotInput {
  return {
    angleDegrees: 25,
    speedMps: 34,
    launchAngleDegrees: 18,
    quality: 0.75,
    shotType: "drive",
  };
}

export function shotTypeDefaults(shotType: ShotType): Partial<ShotInput> {
  switch (shotType) {
    case "lofted":
      return { speedMps: 38, launchAngleDegrees: 32, quality: 0.78 };
    case "pull":
      return { angleDegrees: 75, speedMps: 36, launchAngleDegrees: 14, quality: 0.74 };
    case "cut":
      return { angleDegrees: 285, speedMps: 32, launchAngleDegrees: 8, quality: 0.72 };
    case "defensive":
      return { speedMps: 14, launchAngleDegrees: 3, quality: 0.7 };
    case "drive":
    default:
      return { angleDegrees: 25, speedMps: 34, launchAngleDegrees: 18, quality: 0.75 };
  }
}

function normalizeInput(input: ShotInput): ShotInput {
  return {
    angleDegrees: ((input.angleDegrees % 360) + 360) % 360,
    speedMps: clamp(input.speedMps, 4, 65),
    launchAngleDegrees: clamp(input.launchAngleDegrees, -5, 55),
    quality: clamp(input.quality, 0, 1),
    shotType: input.shotType,
  };
}

function buildTrajectory(input: ShotInput, ground: GroundPreset): TrajectoryPoint[] {
  const angleRadians = (input.angleDegrees * Math.PI) / 180;
  const launchRadians = (input.launchAngleDegrees * Math.PI) / 180;
  let horizontalSpeed = input.speedMps * Math.cos(launchRadians);
  let verticalSpeed = input.speedMps * Math.sin(launchRadians);
  let x = 0;
  let y = 0;
  let z = 0.7;
  let phase: TrajectoryPoint["phase"] = "air";
  const points: TrajectoryPoint[] = [];
  const boundaryLimit = Math.max(ground.squareBoundaryM, ground.straightBoundaryM) + 18;

  for (let time = 0; time <= MAX_TIME_SECONDS; time += TIME_STEP_SECONDS) {
    const speed = phase === "air" ? Math.hypot(horizontalSpeed, verticalSpeed) : horizontalSpeed;
    points.push({ timeS: time, xM: x, yM: y, zM: z, speedMps: speed, phase });

    if (distanceXY(x, y) > boundaryLimit || (phase === "roll" && horizontalSpeed <= 0.35)) break;

    if (phase === "air") {
      x += Math.sin(angleRadians) * horizontalSpeed * TIME_STEP_SECONDS;
      y += Math.cos(angleRadians) * horizontalSpeed * TIME_STEP_SECONDS;
      z += verticalSpeed * TIME_STEP_SECONDS;
      verticalSpeed -= GRAVITY * TIME_STEP_SECONDS;
      horizontalSpeed *= BALL_CARRY_DRAG;

      if (z <= 0) {
        z = 0;
        phase = "bounce";
        verticalSpeed = Math.abs(verticalSpeed) * bounceRestitution(input);
        horizontalSpeed *= bounceSpeedRetention(input);
        if (verticalSpeed < 2.2 || input.launchAngleDegrees < 8) phase = "roll";
      }
    } else if (phase === "bounce") {
      phase = "air";
      z = 0.08;
    } else {
      x += Math.sin(angleRadians) * horizontalSpeed * TIME_STEP_SECONDS;
      y += Math.cos(angleRadians) * horizontalSpeed * TIME_STEP_SECONDS;
      horizontalSpeed = Math.max(0, horizontalSpeed - ROLL_DECELERATION * TIME_STEP_SECONDS);
    }
  }

  return points;
}

function bounceRestitution(input: ShotInput): number {
  if (input.shotType === "defensive") return 0.18;
  if (input.shotType === "lofted") return 0.32;
  return 0.26;
}

function bounceSpeedRetention(input: ShotInput): number {
  if (input.shotType === "defensive") return 0.42;
  if (input.shotType === "cut" || input.shotType === "pull") return 0.67;
  return 0.58;
}

function interpolatedBoundaryPoint(
  trajectory: TrajectoryPoint[],
  ground: GroundPreset,
): TrajectoryPoint | undefined {
  for (let index = 1; index < trajectory.length; index += 1) {
    const previous = trajectory[index - 1];
    const current = trajectory[index];
    if (distanceFromOrigin(current) < boundaryRadiusAtPoint(current, ground)) continue;
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const mid = (low + high) / 2;
      const point = interpolateTrajectory(previous, current, mid);
      if (distanceFromOrigin(point) >= boundaryRadiusAtPoint(point, ground)) high = mid;
      else low = mid;
    }
    return interpolateTrajectory(previous, current, high);
  }
  return undefined;
}

function interpolateTrajectory(
  from: TrajectoryPoint,
  to: TrajectoryPoint,
  fraction: number,
): TrajectoryPoint {
  return {
    timeS: from.timeS + (to.timeS - from.timeS) * fraction,
    xM: from.xM + (to.xM - from.xM) * fraction,
    yM: from.yM + (to.yM - from.yM) * fraction,
    zM: from.zM + (to.zM - from.zM) * fraction,
    speedMps: from.speedMps + (to.speedMps - from.speedMps) * fraction,
    phase: from.phase,
  };
}

function truncateTrajectoryAt(
  trajectory: TrajectoryPoint[],
  boundaryPoint: TrajectoryPoint,
): TrajectoryPoint[] {
  return [
    ...trajectory.filter((point) => point.timeS < boundaryPoint.timeS),
    boundaryPoint,
  ];
}

function bestCatchAttempt(
  trajectory: TrajectoryPoint[],
  fielders: FieldingPosition[],
  ground: GroundPreset,
): FielderAttempt | undefined {
  return bestAttempt(
    trajectory.filter((point) => point.zM >= 0.8 && point.phase === "air"),
    fielders,
    "catch",
    ground,
  );
}

function bestGroundInterception(
  trajectory: TrajectoryPoint[],
  fielders: FieldingPosition[],
  ground: GroundPreset,
): FielderAttempt | undefined {
  return bestAttempt(
    trajectory.filter((point) => point.phase !== "air" || point.zM <= 0.3),
    fielders,
    "ground",
    ground,
  );
}

function bestAttempt(
  points: TrajectoryPoint[],
  fielders: FieldingPosition[],
  kind: FielderAttempt["kind"],
  ground: GroundPreset,
): FielderAttempt | undefined {
  let best: FielderAttempt | undefined;

  for (const fielder of fielders) {
    const fielderPoint = fielderCoordinates(fielder, ground);
    const reaction = fielder.catching ? 0.35 : 0.62;
    const speed = fielder.catching ? 5.8 : 6.8;
    const pickupRadius = kind === "catch" ? 1.9 : 2.6;

    for (const point of points) {
      if (point.timeS < reaction) continue;
      const reachable = (point.timeS - reaction) * speed + pickupRadius;
      const distanceToBall = distanceXY(point.xM - fielderPoint.xM, point.yM - fielderPoint.yM);
      if (distanceToBall > reachable) continue;

      const catchChance = kind === "catch" ? estimateCatchChance(point, fielder, distanceToBall, reachable) : 0;
      const runoutChance = kind === "ground" ? estimateRunoutChance(point, fielderPoint) : 0;
      const attempt: FielderAttempt = {
        fielderId: fielder.id,
        label: fielder.label,
        interceptTimeS: point.timeS,
        xM: point.xM,
        yM: point.yM,
        distanceFromStrikerM: distanceFromOrigin(point),
        ballHeightM: point.zM,
        catchChance,
        runoutChance,
        kind,
      };

      if (!best || attemptScore(attempt) > attemptScore(best)) best = attempt;
    }
  }

  return best;
}

function estimateCatchChance(
  point: TrajectoryPoint,
  fielder: FieldingPosition,
  distanceToBall: number,
  reachable: number,
): number {
  const heightScore = point.zM <= 2.6 ? 0.9 : point.zM <= 5 ? 0.68 : 0.38;
  const marginScore = clamp((reachable - distanceToBall) / 4, 0, 1);
  const skill = fielder.catching ? 0.82 : 0.58;
  return clamp(heightScore * 0.45 + marginScore * 0.35 + skill * 0.2, 0, 0.96);
}

function estimateRunoutChance(point: TrajectoryPoint, fielderPoint: { xM: number; yM: number }): number {
  const throwDistance = distanceXY(fielderPoint.xM, fielderPoint.yM);
  const throwTime = 0.8 + throwDistance / 28;
  const completedRunTime = BASE_RUN_SECONDS;
  const pressure = point.timeS + throwTime < completedRunTime ? 0.7 : 0.18;
  return clamp(pressure, 0, 0.85);
}

function estimateCompletedRuns(attempt: FielderAttempt): number {
  const throwTime = 0.85 + attempt.distanceFromStrikerM / 30;
  const available = attempt.interceptTimeS + throwTime;
  if (attempt.runoutChance > 0.55) return 0;
  if (available < BASE_RUN_SECONDS * 1.15) return 1;
  if (available < BASE_RUN_SECONDS * 2.15) return 2;
  return 3;
}

function attemptScore(attempt: FielderAttempt): number {
  if (attempt.kind === "catch") return 100 + attempt.catchChance * 10 - attempt.interceptTimeS;
  return 50 - attempt.interceptTimeS + attempt.runoutChance * 4;
}

function boundaryRadiusAtPoint(point: TrajectoryPoint, ground: GroundPreset): number {
  const angle = (Math.atan2(point.xM, point.yM) * 180) / Math.PI;
  return boundaryRadiusAtAngle(ground, angle);
}

function distanceFromOrigin(point: Pick<TrajectoryPoint, "xM" | "yM">): number {
  return distanceXY(point.xM, point.yM);
}

function distanceXY(x: number, y: number): number {
  return Math.hypot(x, y);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
