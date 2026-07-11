export type RgbColor = {
  r: number;
  g: number;
  b: number;
};

export type BallColorProfile = {
  hueDegrees: number;
  hueToleranceDegrees: number;
  minSaturation: number;
  minBrightness: number;
  maxBrightness: number;
};

export type PixelPoint = {
  x: number;
  y: number;
};

export type BallCandidate = {
  center: PixelPoint;
  radiusPx: number;
  areaPx: number;
  circularity: number;
  colorScore: number;
  motionScore: number;
  temporalScore: number;
  confidence: number;
};

export type TrackedBallPoint = {
  frameIndex: number;
  timeS: number;
  center: PixelPoint;
  radiusPx: number;
  confidence: number;
  predicted: boolean;
  velocityPxPerS: PixelPoint;
};

export type TrackingSummary = {
  points: TrackedBallPoint[];
  detectedPoints: number;
  predictedPoints: number;
  averageConfidence: number;
  impactFrameIndex?: number;
  bounceFrameIndices: number[];
  pixelDirectionDegrees?: number;
  pixelSpeedPerSecond?: number;
};

export type BallDetectionOptions = {
  profile: BallColorProfile;
  previousFrame?: ImageData;
  predictedCenter?: PixelPoint;
  predictedRadiusPx?: number;
  searchRadiusPx?: number;
  minRadiusPx?: number;
  maxRadiusPx?: number;
};

type ComponentAccumulator = {
  area: number;
  sumX: number;
  sumY: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  colorSum: number;
  motionSum: number;
};

export const DEFAULT_YELLOW_BALL_PROFILE: BallColorProfile = {
  hueDegrees: 52,
  hueToleranceDegrees: 24,
  minSaturation: 0.22,
  minBrightness: 0.18,
  maxBrightness: 1,
};

export function profileFromRgb(
  color: RgbColor,
  hueToleranceDegrees = 24,
): BallColorProfile {
  const hsv = rgbToHsv(color.r, color.g, color.b);
  return {
    hueDegrees: hsv.hue,
    hueToleranceDegrees,
    minSaturation: Math.max(0.12, hsv.saturation * 0.42),
    minBrightness: Math.max(0.1, hsv.value * 0.32),
    maxBrightness: 1,
  };
}

export function sampleAverageColor(
  image: ImageData,
  center: PixelPoint,
  radiusPx = 8,
): RgbColor {
  const xStart = Math.max(0, Math.floor(center.x - radiusPx));
  const xEnd = Math.min(image.width - 1, Math.ceil(center.x + radiusPx));
  const yStart = Math.max(0, Math.floor(center.y - radiusPx));
  const yEnd = Math.min(image.height - 1, Math.ceil(center.y + radiusPx));
  let weightSum = 0;
  let r = 0;
  let g = 0;
  let b = 0;

  for (let y = yStart; y <= yEnd; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      const distance = Math.hypot(x - center.x, y - center.y);
      if (distance > radiusPx) continue;
      const weight = 1 - distance / (radiusPx + 1);
      const index = (y * image.width + x) * 4;
      r += image.data[index] * weight;
      g += image.data[index + 1] * weight;
      b += image.data[index + 2] * weight;
      weightSum += weight;
    }
  }

  return {
    r: r / Math.max(weightSum, 1),
    g: g / Math.max(weightSum, 1),
    b: b / Math.max(weightSum, 1),
  };
}

export function detectBallCandidates(
  image: ImageData,
  options: BallDetectionOptions,
): BallCandidate[] {
  const { width, height, data } = image;
  const pixelCount = width * height;
  const mask = new Uint8Array(pixelCount);
  const colorScores = new Float32Array(pixelCount);
  const motionScores = new Float32Array(pixelCount);
  const minRadius = options.minRadiusPx ?? 2;
  const maxRadius = options.maxRadiusPx ?? Math.max(20, Math.min(width, height) * 0.08);
  const searchRadius = options.searchRadiusPx;
  const xStart = options.predictedCenter && searchRadius
    ? Math.max(1, Math.floor(options.predictedCenter.x - searchRadius))
    : 1;
  const xEnd = options.predictedCenter && searchRadius
    ? Math.min(width - 2, Math.ceil(options.predictedCenter.x + searchRadius))
    : width - 2;
  const yStart = options.predictedCenter && searchRadius
    ? Math.max(1, Math.floor(options.predictedCenter.y - searchRadius))
    : 1;
  const yEnd = options.predictedCenter && searchRadius
    ? Math.min(height - 2, Math.ceil(options.predictedCenter.y + searchRadius))
    : height - 2;

  for (let y = yStart; y <= yEnd; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      if (
        options.predictedCenter &&
        options.searchRadiusPx &&
        Math.hypot(x - options.predictedCenter.x, y - options.predictedCenter.y) >
          options.searchRadiusPx
      ) {
        continue;
      }

      const pixelIndex = y * width + x;
      const dataIndex = pixelIndex * 4;
      const hsv = rgbToHsv(data[dataIndex], data[dataIndex + 1], data[dataIndex + 2]);
      const colorScore = yellowProfileScore(hsv, options.profile);
      const motionScore = options.previousFrame
        ? pixelMotionScore(data, options.previousFrame.data, dataIndex)
        : 0.5;

      colorScores[pixelIndex] = colorScore;
      motionScores[pixelIndex] = motionScore;

      // Color is primary; motion rescues dusty/desaturated edge pixels.
      if (colorScore >= 0.46 || (colorScore >= 0.28 && motionScore >= 0.38)) {
        mask[pixelIndex] = 1;
      }
    }
  }

  const cleaned = morphologyOpenClose(mask, width, height, {
    xStart: Math.max(1, xStart - 2),
    xEnd: Math.min(width - 2, xEnd + 2),
    yStart: Math.max(1, yStart - 2),
    yEnd: Math.min(height - 2, yEnd + 2),
  });
  const components = connectedComponents(
    cleaned,
    colorScores,
    motionScores,
    width,
    height,
    { xStart, xEnd, yStart, yEnd },
  );
  const candidates: BallCandidate[] = [];

  for (const component of components) {
    if (component.area < Math.PI * minRadius * minRadius * 0.35) continue;
    const boxWidth = component.maxX - component.minX + 1;
    const boxHeight = component.maxY - component.minY + 1;
    const equivalentRadius = Math.sqrt(component.area / Math.PI);
    if (equivalentRadius < minRadius || equivalentRadius > maxRadius) continue;

    const aspect = Math.min(boxWidth, boxHeight) / Math.max(boxWidth, boxHeight);
    if (aspect < 0.38) continue;

    const fillRatio = component.area / (boxWidth * boxHeight);
    const circularity = clamp(aspect * 0.55 + closeness(fillRatio, Math.PI / 4, 0.55) * 0.45, 0, 1);
    const center = {
      x: component.sumX / component.area,
      y: component.sumY / component.area,
    };
    const colorScore = component.colorSum / component.area;
    const motionScore = component.motionSum / component.area;
    const temporalScore = temporalCandidateScore(
      center,
      equivalentRadius,
      options.predictedCenter,
      options.predictedRadiusPx,
      options.searchRadiusPx,
    );
    const confidence = clamp(
      colorScore * 0.42 + circularity * 0.24 + motionScore * 0.16 + temporalScore * 0.18,
      0,
      1,
    );

    candidates.push({
      center,
      radiusPx: equivalentRadius,
      areaPx: component.area,
      circularity,
      colorScore,
      motionScore,
      temporalScore,
      confidence,
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 12);
}

export class BallTracker {
  private points: TrackedBallPoint[] = [];
  private missedFrames = 0;

  constructor(
    private readonly maxMissedFrames = 5,
    private readonly minimumConfidence = 0.43,
  ) {}

  seed(
    center: PixelPoint,
    radiusPx: number,
    frameIndex = -1,
    timeS = -1 / 240,
  ) {
    this.points = [
      {
        frameIndex,
        timeS,
        center,
        radiusPx,
        confidence: 1,
        predicted: false,
        velocityPxPerS: { x: 0, y: 0 },
      },
    ];
    this.missedFrames = 0;
  }

  get prediction(): { center?: PixelPoint; radiusPx?: number; searchRadiusPx?: number } {
    const last = this.points.at(-1);
    if (!last) return {};
    const previous = this.points.at(-2);
    if (!previous) {
      return {
        center: last.center,
        radiusPx: last.radiusPx,
        searchRadiusPx: Math.max(40, last.radiusPx * 8),
      };
    }

    const dt = Math.max(last.timeS - previous.timeS, 1 / 240);
    const nextDt = dt * (this.missedFrames + 1);
    return {
      center: {
        x: last.center.x + last.velocityPxPerS.x * nextDt,
        y: last.center.y + last.velocityPxPerS.y * nextDt,
      },
      radiusPx: last.radiusPx,
      searchRadiusPx: Math.max(28, last.radiusPx * 6, Math.hypot(last.velocityPxPerS.x, last.velocityPxPerS.y) * dt * 2.3),
    };
  }

  update(
    frameIndex: number,
    timeS: number,
    candidates: BallCandidate[],
  ): TrackedBallPoint | undefined {
    const candidate = candidates.find((item) => item.confidence >= this.minimumConfidence);
    const previous = this.points.at(-1);

    if (candidate) {
      const velocity = previous
        ? velocityBetween(previous.center, candidate.center, Math.max(timeS - previous.timeS, 1 / 240))
        : { x: 0, y: 0 };
      const smoothedVelocity = previous
        ? {
            x: previous.velocityPxPerS.x * 0.35 + velocity.x * 0.65,
            y: previous.velocityPxPerS.y * 0.35 + velocity.y * 0.65,
          }
        : velocity;
      const point: TrackedBallPoint = {
        frameIndex,
        timeS,
        center: candidate.center,
        radiusPx: candidate.radiusPx,
        confidence: candidate.confidence,
        predicted: false,
        velocityPxPerS: smoothedVelocity,
      };
      this.points.push(point);
      this.missedFrames = 0;
      return point;
    }

    if (previous && this.missedFrames < this.maxMissedFrames) {
      this.missedFrames += 1;
      const prediction = this.prediction.center;
      if (!prediction) return undefined;
      const point: TrackedBallPoint = {
        frameIndex,
        timeS,
        center: prediction,
        radiusPx: previous.radiusPx,
        confidence: previous.confidence * Math.pow(0.72, this.missedFrames),
        predicted: true,
        velocityPxPerS: previous.velocityPxPerS,
      };
      this.points.push(point);
      return point;
    }

    return undefined;
  }

  summary(): TrackingSummary {
    const visiblePoints = this.points.filter((point) => point.frameIndex >= 0);
    const detected = visiblePoints.filter((point) => !point.predicted);
    const bounceFrameIndices = detectBounceFrames(visiblePoints);
    const movement = shotMovementSummary(visiblePoints);

    return {
      points: visiblePoints,
      detectedPoints: detected.length,
      predictedPoints: visiblePoints.length - detected.length,
      averageConfidence:
        detected.reduce((sum, point) => sum + point.confidence, 0) /
        Math.max(detected.length, 1),
      impactFrameIndex: detectImpactFrame(this.points),
      bounceFrameIndices,
      pixelDirectionDegrees: movement?.directionDegrees,
      pixelSpeedPerSecond: movement?.speedPxPerSecond,
    };
  }

  reset() {
    this.points = [];
    this.missedFrames = 0;
  }
}

export function detectImpactFrame(points: TrackedBallPoint[]): number | undefined {
  if (points.length < 5) return undefined;
  let best: { score: number; frameIndex: number } | undefined;

  for (let i = 2; i < points.length - 2; i += 1) {
    const before = points[i - 1].velocityPxPerS;
    const after = points[i + 1].velocityPxPerS;
    const beforeSpeed = Math.hypot(before.x, before.y);
    const afterSpeed = Math.hypot(after.x, after.y);
    const directionChange = angleBetween(before, after);
    const acceleration = Math.abs(afterSpeed - beforeSpeed);
    const score = directionChange / 90 + acceleration / Math.max(beforeSpeed, 80);
    if (score > 0.75 && (!best || score > best.score)) {
      best = { score, frameIndex: points[i].frameIndex };
    }
  }

  return best?.frameIndex;
}

export function detectBounceFrames(points: TrackedBallPoint[]): number[] {
  const bounces: number[] = [];
  for (let i = 2; i < points.length - 2; i += 1) {
    const beforeY = points[i - 1].velocityPxPerS.y;
    const afterY = points[i + 1].velocityPxPerS.y;
    const speed = Math.hypot(points[i].velocityPxPerS.x, points[i].velocityPxPerS.y);
    if (beforeY > 40 && afterY < -20 && speed > 80) {
      if (!bounces.length || points[i].frameIndex - bounces[bounces.length - 1] > 5) {
        bounces.push(points[i].frameIndex);
      }
    }
  }
  return bounces;
}

function shotMovementSummary(points: TrackedBallPoint[]) {
  const detected = points.filter((point) => !point.predicted);
  if (detected.length < 3) return undefined;
  const impactFrame = detectImpactFrame(detected);
  const startIndex = impactFrame
    ? Math.max(0, detected.findIndex((point) => point.frameIndex === impactFrame))
    : 0;
  const start = detected[startIndex];
  const end = detected[Math.min(detected.length - 1, startIndex + 6)];
  const dt = end.timeS - start.timeS;
  if (dt <= 0) return undefined;
  const dx = end.center.x - start.center.x;
  const dy = end.center.y - start.center.y;
  return {
    directionDegrees: ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360,
    speedPxPerSecond: Math.hypot(dx, dy) / dt,
  };
}

function connectedComponents(
  mask: Uint8Array,
  colorScores: Float32Array,
  motionScores: Float32Array,
  width: number,
  height: number,
  bounds: { xStart: number; xEnd: number; yStart: number; yEnd: number },
): ComponentAccumulator[] {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components: ComponentAccumulator[] = [];

  for (let startY = bounds.yStart; startY <= bounds.yEnd; startY += 1) {
    for (let startX = bounds.xStart; startX <= bounds.xEnd; startX += 1) {
      const start = startY * width + startX;
      if (!mask[start] || visited[start]) continue;
    let queueStart = 0;
    let queueEnd = 1;
    queue[0] = start;
    visited[start] = 1;
    const accumulator: ComponentAccumulator = {
      area: 0,
      sumX: 0,
      sumY: 0,
      minX: width,
      minY: height,
      maxX: 0,
      maxY: 0,
      colorSum: 0,
      motionSum: 0,
    };

    while (queueStart < queueEnd) {
      const index = queue[queueStart];
      queueStart += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      accumulator.area += 1;
      accumulator.sumX += x;
      accumulator.sumY += y;
      accumulator.minX = Math.min(accumulator.minX, x);
      accumulator.minY = Math.min(accumulator.minY, y);
      accumulator.maxX = Math.max(accumulator.maxX, x);
      accumulator.maxY = Math.max(accumulator.maxY, y);
      accumulator.colorSum += colorScores[index];
      accumulator.motionSum += motionScores[index];

      for (const neighbor of fourNeighbors(index, x, y, width, height)) {
        if (mask[neighbor] && !visited[neighbor]) {
          visited[neighbor] = 1;
          queue[queueEnd] = neighbor;
          queueEnd += 1;
        }
      }
    }

      components.push(accumulator);
    }
  }

  return components;
}

function morphologyOpenClose(
  mask: Uint8Array,
  width: number,
  height: number,
  bounds: { xStart: number; xEnd: number; yStart: number; yEnd: number },
): Uint8Array {
  const opened = dilate(erode(mask, width, height, bounds), width, height, bounds);
  return erode(dilate(opened, width, height, bounds), width, height, bounds);
}

function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  bounds: { xStart: number; xEnd: number; yStart: number; yEnd: number },
): Uint8Array {
  const output = new Uint8Array(mask.length);
  for (let y = bounds.yStart; y <= bounds.yEnd; y += 1) {
    for (let x = bounds.xStart; x <= bounds.xEnd; x += 1) {
      const index = y * width + x;
      output[index] =
        mask[index] ||
        mask[index - 1] ||
        mask[index + 1] ||
        mask[index - width] ||
        mask[index + width]
          ? 1
          : 0;
    }
  }
  return output;
}

function erode(
  mask: Uint8Array,
  width: number,
  height: number,
  bounds: { xStart: number; xEnd: number; yStart: number; yEnd: number },
): Uint8Array {
  const output = new Uint8Array(mask.length);
  for (let y = bounds.yStart; y <= bounds.yEnd; y += 1) {
    for (let x = bounds.xStart; x <= bounds.xEnd; x += 1) {
      const index = y * width + x;
      output[index] =
        mask[index] &&
        mask[index - 1] &&
        mask[index + 1] &&
        mask[index - width] &&
        mask[index + width]
          ? 1
          : 0;
    }
  }
  return output;
}

function fourNeighbors(index: number, x: number, y: number, width: number, height: number) {
  const neighbors: number[] = [];
  if (x > 0) neighbors.push(index - 1);
  if (x < width - 1) neighbors.push(index + 1);
  if (y > 0) neighbors.push(index - width);
  if (y < height - 1) neighbors.push(index + width);
  return neighbors;
}

function yellowProfileScore(
  hsv: { hue: number; saturation: number; value: number },
  profile: BallColorProfile,
): number {
  const hueDistance = circularHueDistance(hsv.hue, profile.hueDegrees);
  const hueScore = clamp(1 - hueDistance / profile.hueToleranceDegrees, 0, 1);
  const saturationScore = smoothThreshold(hsv.saturation, profile.minSaturation, 0.24);
  const brightnessFloor = smoothThreshold(hsv.value, profile.minBrightness, 0.22);
  const brightnessCeiling = clamp(
    1 - Math.max(0, hsv.value - profile.maxBrightness) / 0.2,
    0,
    1,
  );
  return hueScore * 0.58 + saturationScore * 0.22 + brightnessFloor * brightnessCeiling * 0.2;
}

function pixelMotionScore(
  current: Uint8ClampedArray,
  previous: Uint8ClampedArray,
  index: number,
): number {
  const difference =
    Math.abs(current[index] - previous[index]) +
    Math.abs(current[index + 1] - previous[index + 1]) +
    Math.abs(current[index + 2] - previous[index + 2]);
  return clamp(difference / 180, 0, 1);
}

function temporalCandidateScore(
  center: PixelPoint,
  radius: number,
  predictedCenter?: PixelPoint,
  predictedRadius?: number,
  searchRadius?: number,
): number {
  if (!predictedCenter) return 0.55;
  const distance = Math.hypot(center.x - predictedCenter.x, center.y - predictedCenter.y);
  const distanceScore = clamp(1 - distance / Math.max(searchRadius ?? 80, 1), 0, 1);
  const radiusScore = predictedRadius
    ? clamp(1 - Math.abs(radius - predictedRadius) / Math.max(predictedRadius * 1.4, 2), 0, 1)
    : 0.6;
  return distanceScore * 0.72 + radiusScore * 0.28;
}

function rgbToHsv(rValue: number, gValue: number, bValue: number) {
  const r = rValue / 255;
  const g = gValue / 255;
  const b = bValue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;

  return {
    hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

function velocityBetween(a: PixelPoint, b: PixelPoint, dt: number): PixelPoint {
  return {
    x: (b.x - a.x) / dt,
    y: (b.y - a.y) / dt,
  };
}

function angleBetween(a: PixelPoint, b: PixelPoint): number {
  const aLength = Math.hypot(a.x, a.y);
  const bLength = Math.hypot(b.x, b.y);
  if (aLength < 1e-6 || bLength < 1e-6) return 0;
  const cosine = clamp((a.x * b.x + a.y * b.y) / (aLength * bLength), -1, 1);
  return (Math.acos(cosine) * 180) / Math.PI;
}

function circularHueDistance(a: number, b: number): number {
  const difference = Math.abs(a - b) % 360;
  return Math.min(difference, 360 - difference);
}

function smoothThreshold(value: number, threshold: number, width: number): number {
  return clamp((value - threshold + width) / width, 0, 1);
}

function closeness(value: number, target: number, tolerance: number): number {
  return clamp(1 - Math.abs(value - target) / tolerance, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
