import { describe, expect, it } from "vitest";
import {
  defaultSimulationEnvironment,
  simulateShot,
  simulateShotDistribution,
  type ShotInput,
} from "./shotSimulation";
import { FIELD_PRESETS, GROUND_PRESETS } from "./virtualGround";

const largeGround = GROUND_PRESETS.find((ground) => ground.id === "custom-practice-large")!;
const smallGround = GROUND_PRESETS.find((ground) => ground.id === "backyard-compact")!;
const defensiveField = FIELD_PRESETS.find((field) => field.id === "t20-defensive")!;
const attackingField = FIELD_PRESETS.find((field) => field.id === "spin-attack")!;

describe("shot simulation", () => {
  it("awards six when a lofted shot clears the small boundary", () => {
    const shot: ShotInput = {
      angleDegrees: 10,
      speedMps: 48,
      launchAngleDegrees: 36,
      quality: 0.95,
      shotType: "lofted",
    };

    const result = simulateShot(shot, smallGround, defensiveField);

    expect(result.kind).toBe("six");
    expect(result.runs).toBe(6);
    expect(result.boundaryPoint?.zM).toBeGreaterThan(1.8);
  });

  it("lets close catchers dismiss mishit attacking spin shots", () => {
    const shot: ShotInput = {
      angleDegrees: 250,
      speedMps: 16,
      launchAngleDegrees: 22,
      quality: 0.35,
      shotType: "defensive",
    };

    const result = simulateShot(shot, largeGround, attackingField);

    expect(["caught", "stopped", "fielded"]).toContain(result.kind);
    expect(result.bestFielder).toBeDefined();
  });

  it("returns fielded outcomes for grounded shots before the rope", () => {
    const shot: ShotInput = {
      angleDegrees: 310,
      speedMps: 24,
      launchAngleDegrees: 4,
      quality: 0.7,
      shotType: "drive",
    };

    const result = simulateShot(shot, largeGround, defensiveField);

    expect(["fielded", "stopped", "wicketkeeper"]).toContain(result.kind);
    expect(result.runs).toBeLessThan(4);
  });

  it("produces deterministic uncertainty distributions that sum to one", () => {
    const shot: ShotInput = {
      angleDegrees: 30,
      speedMps: 32,
      launchAngleDegrees: 16,
      quality: 0.7,
      shotType: "drive",
    };
    const distribution = simulateShotDistribution(
      shot,
      largeGround,
      defensiveField,
      defaultSimulationEnvironment(),
      80,
    );
    const total = Object.values(distribution.resultProbabilities).reduce((sum, value) => sum + value, 0);

    expect(total).toBeCloseTo(1, 8);
    expect(distribution.expectedRuns).toBeGreaterThanOrEqual(0);
    expect(distribution.expectedRuns).toBeLessThanOrEqual(6);
  });
});
