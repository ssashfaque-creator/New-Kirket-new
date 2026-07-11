import { describe, expect, it } from "vitest";
import {
  BallTracker,
  createBallAppearanceTemplate,
  detectBallCandidates,
  detectBounceFrames,
  findBallByAppearanceTemplate,
  profileFromRgb,
  type BallCandidate,
  type TrackedBallPoint,
} from "./ballTracking";

describe("yellow practice ball detection", () => {
  it("detects a dusty yellow circular ball against a dark scene", () => {
    const frame = syntheticFrame(100, 80, [
      { x: 62, y: 38, radius: 7, color: [178, 151, 55] },
    ]);
    const previous = syntheticFrame(100, 80, []);
    const profile = profileFromRgb({ r: 178, g: 151, b: 55 }, 30);

    const candidates = detectBallCandidates(frame, {
      profile,
      previousFrame: previous,
      minRadiusPx: 2,
      maxRadiusPx: 15,
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].center.x).toBeCloseTo(62, 0);
    expect(candidates[0].center.y).toBeCloseTo(38, 0);
    expect(candidates[0].confidence).toBeGreaterThan(0.5);
  });

  it("uses predicted position to ignore another yellow object", () => {
    const frame = syntheticFrame(120, 90, [
      { x: 30, y: 30, radius: 7, color: [225, 196, 35] },
      { x: 92, y: 64, radius: 10, color: [230, 200, 40] },
    ]);

    const candidates = detectBallCandidates(frame, {
      profile: profileFromRgb({ r: 225, g: 196, b: 35 }, 28),
      previousFrame: syntheticFrame(120, 90, []),
      predictedCenter: { x: 30, y: 30 },
      predictedRadiusPx: 7,
      searchRadiusPx: 25,
      minRadiusPx: 2,
      maxRadiusPx: 16,
    });

    expect(candidates[0].center.x).toBeCloseTo(30, 0);
  });

  it("predicts short missing gaps and resumes detection", () => {
    const tracker = new BallTracker(3, 0.4);
    tracker.seed({ x: 10, y: 20 }, 6);
    tracker.update(0, 0, [candidate(14, 20)]);
    tracker.update(1, 1 / 120, [candidate(18, 20)]);
    const predicted = tracker.update(2, 2 / 120, []);
    const resumed = tracker.update(3, 3 / 120, [candidate(26, 20)]);

    expect(predicted?.predicted).toBe(true);
    expect(resumed?.predicted).toBe(false);
    expect(tracker.summary().predictedPoints).toBe(1);
  });

  it("prefers temporal and radius continuity over a brighter false positive", () => {
    const tracker = new BallTracker(3, 0.4);
    tracker.seed({ x: 20, y: 20 }, 6);
    const falsePositive = {
      ...candidate(70, 70),
      confidence: 0.96,
      temporalScore: 0.1,
      radiusPx: 18,
    };
    const trueBall = {
      ...candidate(24, 20),
      confidence: 0.8,
      temporalScore: 0.96,
      radiusPx: 6.2,
    };

    const trackedPoint = tracker.update(0, 0, [falsePositive, trueBall]);

    expect(trackedPoint?.center.x).toBeCloseTo(24, 3);
  });

  it("detects a downward-to-upward velocity reversal as a bounce", () => {
    const points = [
      tracked(0, 0, 0, 200),
      tracked(1, 1 / 120, 2, 180),
      tracked(2, 2 / 120, 4, 150),
      tracked(3, 3 / 120, 6, -120),
      tracked(4, 4 / 120, 8, -100),
      tracked(5, 5 / 120, 10, -80),
    ];

    expect(detectBounceFrames(points)).toContain(2);
  });

  it("reacquires a dusty ball by appearance when color thresholding is weak", () => {
    const contact = syntheticFrame(100, 80, [
      { x: 40, y: 35, radius: 6, color: [180, 150, 58] },
    ]);
    const later = syntheticFrame(100, 80, [
      { x: 48, y: 37, radius: 6, color: [145, 128, 72] },
    ]);
    const template = createBallAppearanceTemplate(contact, { x: 40, y: 35 }, 6);

    const candidate = findBallByAppearanceTemplate(
      later,
      template,
      { x: 47, y: 37 },
      18,
    );

    expect(candidate).toBeDefined();
    expect(Math.abs((candidate?.center.x ?? 0) - 48)).toBeLessThanOrEqual(3);
  });
});

function syntheticFrame(
  width: number,
  height: number,
  circles: Array<{ x: number; y: number; radius: number; color: [number, number, number] }>,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 30;
    data[index + 1] = 55;
    data[index + 2] = 35;
    data[index + 3] = 255;
  }
  for (const circle of circles) {
    for (let y = Math.max(0, circle.y - circle.radius); y <= Math.min(height - 1, circle.y + circle.radius); y += 1) {
      for (let x = Math.max(0, circle.x - circle.radius); x <= Math.min(width - 1, circle.x + circle.radius); x += 1) {
        if (Math.hypot(x - circle.x, y - circle.y) > circle.radius) continue;
        const index = (y * width + x) * 4;
        data[index] = circle.color[0];
        data[index + 1] = circle.color[1];
        data[index + 2] = circle.color[2];
      }
    }
  }
  return { width, height, data } as ImageData;
}

function candidate(x: number, y: number): BallCandidate {
  return {
    center: { x, y },
    radiusPx: 6,
    areaPx: 113,
    circularity: 0.9,
    colorScore: 0.9,
    motionScore: 0.8,
    temporalScore: 0.9,
    confidence: 0.88,
  };
}

function tracked(
  frameIndex: number,
  timeS: number,
  x: number,
  velocityY: number,
): TrackedBallPoint {
  return {
    frameIndex,
    timeS,
    center: { x, y: 30 + frameIndex },
    radiusPx: 6,
    confidence: 0.9,
    predicted: false,
    velocityPxPerS: { x: 200, y: velocityY },
  };
}
