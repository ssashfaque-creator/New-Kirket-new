import { angleDegrees, distance, midpoint, normalizeAngleDegrees } from "./geometry";
import { canvasFromImage, type OpenCv } from "./opencv";
import type { CandidateLine, ImageSize, LandmarkMap, Point2D } from "./types";

type DetectionComponent = {
  id: number;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  center: Point2D;
};

type StumpCandidate = {
  x: number;
  topY: number;
  baseY: number;
  width: number;
  height: number;
  area: number;
};

type BatCandidate = {
  tip: Point2D;
  toe?: Point2D;
  confidence: "strong" | "weak";
};

export type SetupDetectionResult = {
  landmarks: LandmarkMap;
  candidateLines: CandidateLine[];
  turfPlane?: TurfPlane;
  confidence: number;
  detectedStumpCount: number;
  detectedBat: boolean;
  batConfidence?: "strong" | "weak";
  warnings: string[];
};

export type TurfPlane = {
  polygon: Point2D[];
  leftEdge: { near: Point2D; far: Point2D };
  rightEdge: { near: Point2D; far: Point2D };
  confidence: number;
};

export function defaultLandmarks(size: ImageSize): LandmarkMap {
  const centerX = size.width / 2;
  const baseY = size.height * 0.66;
  const stumpHeight = size.height * 0.22;
  const stumpSpread = size.width * 0.045;

  return {
    middleStumpBase: { x: centerX, y: baseY },
    middleStumpTop: { x: centerX, y: baseY - stumpHeight },
    offStumpBase: { x: centerX - stumpSpread, y: baseY },
    offStumpTop: { x: centerX - stumpSpread, y: baseY - stumpHeight },
    legStumpBase: { x: centerX + stumpSpread, y: baseY },
    legStumpTop: { x: centerX + stumpSpread, y: baseY - stumpHeight },
    batTip: { x: centerX, y: Math.min(size.height * 0.92, baseY + size.height * 0.23) },
    creaseLeft: { x: centerX - size.width * 0.12, y: baseY + size.height * 0.1 },
    creaseRight: { x: centerX + size.width * 0.12, y: baseY + size.height * 0.1 },
  };
}

export function detectCandidateLines(cv: OpenCv, image: HTMLImageElement): CandidateLine[] {
  const canvas = canvasFromImage(image);
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const lines = new cv.Mat();

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
  cv.Canny(blurred, edges, 50, 140);
  cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 55, Math.max(45, canvas.width * 0.05), 14);

  const candidates: CandidateLine[] = [];
  const maxLines = Math.min(lines.rows, 80);

  for (let i = 0; i < maxLines; i += 1) {
    const start: Point2D = { x: lines.data32S[i * 4], y: lines.data32S[i * 4 + 1] };
    const end: Point2D = { x: lines.data32S[i * 4 + 2], y: lines.data32S[i * 4 + 3] };
    const lengthPx = distance(start, end);
    if (lengthPx < 30) continue;

    const angle = normalizeAngleDegrees(angleDegrees(start, end));
    candidates.push({
      id: `line-${i}`,
      start,
      end,
      lengthPx,
      angleDegrees: angle,
      classification: classifyLine(angle, lengthPx, canvas.width, canvas.height),
    });
  }

  src.delete();
  gray.delete();
  blurred.delete();
  edges.delete();
  lines.delete();

  return candidates.sort((a, b) => b.lengthPx - a.lengthPx).slice(0, 40);
}

export function detectSetupLandmarks(image: HTMLImageElement): SetupDetectionResult {
  const scaled = scaledImageDataFromImage(image, 1280);
  const turfPlane = detectTurfPlane(scaled.data, scaled.width, scaled.height);
  const rawMask = buildWoodMask(scaled.data, scaled.width, scaled.height);
  const mask = closeMask(rawMask, scaled.width, scaled.height);
  const { components, labels } = connectedComponents(mask, scaled.width, scaled.height);

  const stumpCandidates = findStumpCandidates(mask, components, scaled.width, scaled.height);
  const selectedStumps = selectStumpSet(stumpCandidates, scaled.width, scaled.height);
  const fallbackStumps = selectedStumps.length >= 2 ? selectedStumps : selectSingleStump(stumpCandidates);
  const warnings: string[] = [];
  const landmarks: LandmarkMap = {};
  const candidateLines: CandidateLine[] = [];

  if (fallbackStumps.length >= 1) {
    const [left, middle, right] = normalizeThreeStumps(fallbackStumps);
    landmarks.offStumpBase = scalePoint({ x: left.x, y: left.baseY }, scaled.scale);
    landmarks.offStumpTop = scalePoint({ x: left.x, y: left.topY }, scaled.scale);
    landmarks.middleStumpBase = scalePoint({ x: middle.x, y: middle.baseY }, scaled.scale);
    landmarks.middleStumpTop = scalePoint({ x: middle.x, y: middle.topY }, scaled.scale);
    landmarks.legStumpBase = scalePoint({ x: right.x, y: right.baseY }, scaled.scale);
    landmarks.legStumpTop = scalePoint({ x: right.x, y: right.topY }, scaled.scale);

    for (const [index, stump] of [left, middle, right].entries()) {
      candidateLines.push(
        scaleLine(
          {
            id: `wood-stump-${index}`,
            start: { x: stump.x, y: stump.baseY },
            end: { x: stump.x, y: stump.topY },
            lengthPx: stump.height,
            angleDegrees: 90,
            classification: "stump",
          },
          scaled.scale,
        ),
      );
    }

    if (turfPlane) {
      for (const line of turfPlaneLines(turfPlane)) {
        candidateLines.push(scaleLine(line, scaled.scale));
      }
    }

    const bat = findBatTip(mask, labels, components, fallbackStumps, scaled.width, scaled.height, turfPlane);
    if (bat) {
      if (bat.toe && selectedStumps.length < 2) {
        landmarks.middleStumpBase = scalePoint(bat.toe, scaled.scale);
      }
      landmarks.batTip = scalePoint(bat.tip, scaled.scale);
      const middleBase = { x: middle.x, y: middle.baseY };
      candidateLines.push(
        scaleLine(
          {
            id: "wood-bat-reference",
            start: bat.toe ?? middleBase,
            end: bat.tip,
            lengthPx: distance(bat.toe ?? middleBase, bat.tip),
            angleDegrees: normalizeAngleDegrees(angleDegrees(bat.toe ?? middleBase, bat.tip)),
            classification: "bat",
          },
          scaled.scale,
        ),
      );
      if (bat.confidence === "weak") {
        warnings.push("Side-angle bat suggestion is weak; drag batTip and middle stump base carefully.");
      }
    } else {
      warnings.push("Could not confidently find the far end of the bat; drag the batTip handle.");
    }

    addCreaseDefaults(landmarks, image.naturalWidth, image.naturalHeight);
  } else {
    warnings.push("Could not find enough stump-like wooden objects; place the handles manually.");
  }

  if (selectedStumps.length === 2) {
    warnings.push("Only two stump columns were distinct, so the middle stump was inferred between them.");
  }
  if (selectedStumps.length === 0 && fallbackStumps.length === 1) {
    warnings.push("Only one stump column was visible; stump set was estimated from wicket width.");
  }

  const detectedBat = Boolean(landmarks.batTip);
  const confidence = Math.min(
    1,
    fallbackStumps.length / 3 + (detectedBat ? 0.2 : 0) - warnings.length * 0.08,
  );

  return {
    landmarks,
    candidateLines,
    turfPlane: turfPlane ? scaleTurfPlane(turfPlane, scaled.scale) : undefined,
    confidence: Math.max(0, confidence),
    detectedStumpCount: Math.min(3, fallbackStumps.length),
    detectedBat,
    batConfidence: detectedBat ? (warnings.some((warning) => warning.includes("weak")) ? "weak" : "strong") : undefined,
    warnings,
  };
}

function classifyLine(
  normalizedAngle: number,
  lengthPx: number,
  width: number,
  height: number,
): CandidateLine["classification"] {
  const verticalDistance = Math.abs(normalizedAngle - 90);
  const horizontalDistance = Math.min(Math.abs(normalizedAngle), Math.abs(normalizedAngle - 180));

  if (verticalDistance <= 12 && lengthPx < height * 0.55) return "stump";
  if (horizontalDistance <= 13 && lengthPx > width * 0.12) return "crease";
  if (verticalDistance > 20 && horizontalDistance > 20 && lengthPx > height * 0.13) return "bat";
  if (lengthPx > Math.max(width, height) * 0.25) return "net";
  return "other";
}

function scaledImageDataFromImage(image: HTMLImageElement, maxSide: number) {
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not create detection canvas.");
  context.drawImage(image, 0, 0, width, height);
  return {
    width,
    height,
    scale: naturalWidth / width,
    data: context.getImageData(0, 0, width, height).data,
  };
}

function detectTurfPlane(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): TurfPlane | undefined {
  let mask = buildGreenMask(data, width, height);
  for (let i = 0; i < 6; i += 1) mask = dilate(mask, width, height);
  for (let i = 0; i < 5; i += 1) mask = erode(mask, width, height);

  const { labels, components } = connectedComponents(mask, width, height);
  const largest = components
    .filter((component) => component.area > width * height * 0.05)
    .sort((a, b) => b.area - a.area)[0];

  if (!largest) return undefined;

  const samples = turfBoundarySamples(labels, largest.id, largest, width);
  if (samples.left.length < 8 || samples.right.length < 8) return undefined;

  const leftFit = fitXByY(samples.left);
  const rightFit = fitXByY(samples.right);
  const yFar = Math.max(0, largest.minY);
  const yNear = Math.min(height - 1, largest.maxY);

  const leftFar = { x: leftFit(yFar), y: yFar };
  const leftNear = { x: leftFit(yNear), y: yNear };
  const rightFar = { x: rightFit(yFar), y: yFar };
  const rightNear = { x: rightFit(yNear), y: yNear };

  const polygon = [leftFar, rightFar, rightNear, leftNear].map((point) => ({
    x: Math.min(Math.max(point.x, 0), width - 1),
    y: Math.min(Math.max(point.y, 0), height - 1),
  }));

  const confidence = Math.min(1, largest.area / (width * height * 0.35));

  return {
    polygon,
    leftEdge: { near: polygon[3], far: polygon[0] },
    rightEdge: { near: polygon[2], far: polygon[1] },
    confidence,
  };
}

function buildGreenMask(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = Math.floor(height * 0.22); y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      const r = data[pixel] / 255;
      const g = data[pixel + 1] / 255;
      const b = data[pixel + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const hue = rgbHueDegrees(r, g, b, max, min);
      const excessGreen = 2 * g - r - b;

      if (hue >= 65 && hue <= 185 && saturation > 0.18 && max > 0.14 && excessGreen > 0.08) {
        mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

function rgbHueDegrees(r: number, g: number, b: number, max: number, min: number): number {
  const delta = max - min;
  if (delta === 0) return 0;
  let hue: number;
  if (max === r) {
    hue = 60 * (((g - b) / delta) % 6);
  } else if (max === g) {
    hue = 60 * ((b - r) / delta + 2);
  } else {
    hue = 60 * ((r - g) / delta + 4);
  }
  return hue < 0 ? hue + 360 : hue;
}

function turfBoundarySamples(
  labels: Int32Array,
  label: number,
  component: DetectionComponent,
  width: number,
) {
  const left: Point2D[] = [];
  const right: Point2D[] = [];
  const stride = 4;

  for (let y = component.minY; y <= component.maxY; y += stride) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let count = 0;
    const rowOffset = y * width;

    for (let x = component.minX; x <= component.maxX; x += 1) {
      if (labels[rowOffset + x] !== label) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      count += 1;
    }

    if (count > width * 0.03) {
      left.push({ x: minX, y });
      right.push({ x: maxX, y });
    }
  }

  return { left, right };
}

function fitXByY(points: Point2D[]) {
  const n = points.length;
  const sumY = points.reduce((sum, point) => sum + point.y, 0);
  const sumX = points.reduce((sum, point) => sum + point.x, 0);
  const sumYY = points.reduce((sum, point) => sum + point.y * point.y, 0);
  const sumYX = points.reduce((sum, point) => sum + point.y * point.x, 0);
  const denominator = n * sumYY - sumY * sumY;
  if (Math.abs(denominator) < 1e-6) {
    const x = sumX / n;
    return () => x;
  }

  const a = (n * sumYX - sumY * sumX) / denominator;
  const b = (sumX - a * sumY) / n;
  return (y: number) => a * y + b;
}

function turfPlaneLines(turfPlane: TurfPlane): CandidateLine[] {
  return [
    turfLine("turf-left-edge", turfPlane.leftEdge.near, turfPlane.leftEdge.far),
    turfLine("turf-right-edge", turfPlane.rightEdge.near, turfPlane.rightEdge.far),
    turfLine("turf-back-width", turfPlane.leftEdge.far, turfPlane.rightEdge.far),
    turfLine("turf-front-width", turfPlane.leftEdge.near, turfPlane.rightEdge.near),
  ];
}

function turfLine(id: string, start: Point2D, end: Point2D): CandidateLine {
  return {
    id,
    start,
    end,
    lengthPx: distance(start, end),
    angleDegrees: normalizeAngleDegrees(angleDegrees(start, end)),
    classification: "crease",
  };
}

function scaleTurfPlane(turfPlane: TurfPlane, scale: number): TurfPlane {
  return {
    polygon: turfPlane.polygon.map((point) => scalePoint(point, scale)),
    leftEdge: {
      near: scalePoint(turfPlane.leftEdge.near, scale),
      far: scalePoint(turfPlane.leftEdge.far, scale),
    },
    rightEdge: {
      near: scalePoint(turfPlane.rightEdge.near, scale),
      far: scalePoint(turfPlane.rightEdge.far, scale),
    },
    confidence: turfPlane.confidence,
  };
}

function buildWoodMask(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = Math.floor(height * 0.12); y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      const r = data[pixel];
      const g = data[pixel + 1];
      const b = data[pixel + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);

      // Tuned to the user's setup: pale wooden stumps/bat under net shadows.
      if (
        r > 105 &&
        g > 80 &&
        b > 42 &&
        r >= g - 8 &&
        g > b + 10 &&
        max - min > 28 &&
        r < 245 &&
        g < 238
      ) {
        mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

function closeMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  return erode(dilate(mask, width, height), width, height);
}

function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (
        mask[index] ||
        mask[index - 1] ||
        mask[index + 1] ||
        mask[index - width] ||
        mask[index + width] ||
        mask[index - width - 1] ||
        mask[index - width + 1] ||
        mask[index + width - 1] ||
        mask[index + width + 1]
      ) {
        output[index] = 1;
      }
    }
  }
  return output;
}

function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (
        mask[index] &&
        mask[index - 1] &&
        mask[index + 1] &&
        mask[index - width] &&
        mask[index + width]
      ) {
        output[index] = 1;
      }
    }
  }
  return output;
}

function connectedComponents(mask: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(mask.length);
  const stack = new Int32Array(mask.length);
  const components: DetectionComponent[] = [];
  let nextLabel = 1;

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) continue;

    let stackLength = 0;
    stack[stackLength] = start;
    stackLength += 1;
    labels[start] = nextLabel;

    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (stackLength) {
      stackLength -= 1;
      const index = stack[stackLength];
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (const neighbor of neighbors(index, x, y, width, height)) {
        if (mask[neighbor] && !labels[neighbor]) {
          labels[neighbor] = nextLabel;
          stack[stackLength] = neighbor;
          stackLength += 1;
        }
      }
    }

    if (area > 35) {
      components.push({
        id: nextLabel,
        area,
        minX,
        minY,
        maxX,
        maxY,
        center: { x: sumX / area, y: sumY / area },
      });
    }

    nextLabel += 1;
  }

  return { labels, components };
}

function neighbors(index: number, x: number, y: number, width: number, height: number) {
  const result: number[] = [];
  if (x > 0) result.push(index - 1);
  if (x < width - 1) result.push(index + 1);
  if (y > 0) result.push(index - width);
  if (y < height - 1) result.push(index + width);
  if (x > 0 && y > 0) result.push(index - width - 1);
  if (x < width - 1 && y > 0) result.push(index - width + 1);
  if (x > 0 && y < height - 1) result.push(index + width - 1);
  if (x < width - 1 && y < height - 1) result.push(index + width + 1);
  return result;
}

function findStumpCandidates(
  mask: Uint8Array,
  components: DetectionComponent[],
  width: number,
  height: number,
): StumpCandidate[] {
  const componentCandidates = components
    .map((component) => {
      const boxWidth = component.maxX - component.minX + 1;
      const boxHeight = component.maxY - component.minY + 1;
      return {
        x: component.center.x,
        topY: component.minY,
        baseY: component.maxY,
        width: boxWidth,
        height: boxHeight,
        area: component.area,
      };
    })
    .filter((candidate) => {
      const ratio = candidate.height / Math.max(candidate.width, 1);
      return (
        candidate.area > 90 &&
        candidate.topY > height * 0.25 &&
        candidate.baseY < height * 0.92 &&
        candidate.height > height * 0.08 &&
        candidate.width < width * 0.13 &&
        ratio > 1.8
      );
    })
    .sort((a, b) => b.height - a.height);

  return dedupeStumpCandidates(
    [...componentCandidates, ...findColumnStumpCandidates(mask, width, height)],
    width,
  );
}

function findColumnStumpCandidates(mask: Uint8Array, width: number, height: number): StumpCandidate[] {
  const yStart = Math.floor(height * 0.25);
  const yEnd = Math.floor(height * 0.92);
  const counts = new Float64Array(width);

  for (let y = yStart; y < yEnd; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      counts[x] += mask[rowOffset + x];
    }
  }

  const smoothRadius = Math.max(3, Math.round(width * 0.006));
  const smooth = new Float64Array(width);
  let maxCount = 0;
  for (let x = 0; x < width; x += 1) {
    let total = 0;
    let samples = 0;
    for (let sampleX = Math.max(0, x - smoothRadius); sampleX <= Math.min(width - 1, x + smoothRadius); sampleX += 1) {
      total += counts[sampleX];
      samples += 1;
    }
    smooth[x] = total / samples;
    maxCount = Math.max(maxCount, smooth[x]);
  }

  const threshold = Math.max(10, maxCount * 0.25);
  const minSeparation = Math.max(14, Math.round(width * 0.035));
  const peaks: Array<{ x: number; score: number }> = [];

  for (let x = smoothRadius; x < width - smoothRadius; x += 1) {
    if (smooth[x] < threshold) continue;
    const left = Math.max(0, x - minSeparation);
    const right = Math.min(width - 1, x + minSeparation);
    let localMax = smooth[x];
    for (let probe = left; probe <= right; probe += 1) {
      localMax = Math.max(localMax, smooth[probe]);
    }
    if (smooth[x] < localMax) continue;

    const previous = peaks[peaks.length - 1];
    if (previous && x - previous.x < minSeparation) {
      if (smooth[x] > previous.score) {
        previous.x = x;
        previous.score = smooth[x];
      }
    } else {
      peaks.push({ x, score: smooth[x] });
    }
  }

  const halfWindow = Math.max(6, Math.round(width * 0.012));
  const candidates: StumpCandidate[] = [];

  for (const peak of peaks) {
    const ys: number[] = [];
    let sumX = 0;
    let area = 0;
    const xMin = Math.max(0, peak.x - halfWindow);
    const xMax = Math.min(width - 1, peak.x + halfWindow);

    for (let y = yStart; y < yEnd; y += 1) {
      const rowOffset = y * width;
      for (let x = xMin; x <= xMax; x += 1) {
        if (!mask[rowOffset + x]) continue;
        ys.push(y);
        sumX += x;
        area += 1;
      }
    }

    if (!ys.length) continue;
    ys.sort((a, b) => a - b);
    const topY = percentile(ys, 0.04);
    const baseY = percentile(ys, 0.96);
    const candidateHeight = baseY - topY + 1;

    if (candidateHeight > height * 0.08 && area > 90) {
      candidates.push({
        x: sumX / area,
        topY,
        baseY,
        width: halfWindow * 2 + 1,
        height: candidateHeight,
        area,
      });
    }
  }

  return candidates;
}

function dedupeStumpCandidates(candidates: StumpCandidate[], width: number): StumpCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.height * Math.log(b.area + 1) - a.height * Math.log(a.area + 1));
  const merged: StumpCandidate[] = [];
  const closeX = Math.max(10, width * 0.025);

  for (const candidate of sorted) {
    if (merged.some((existing) => Math.abs(existing.x - candidate.x) < closeX)) continue;
    merged.push(candidate);
  }

  return merged.sort((a, b) => b.height - a.height);
}

function selectStumpSet(
  candidates: StumpCandidate[],
  width: number,
  height: number,
): StumpCandidate[] {
  const usable = candidates.slice(0, 12).sort((a, b) => a.x - b.x);
  let best: { score: number; stumps: StumpCandidate[] } | undefined;

  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      for (let k = j + 1; k < usable.length; k += 1) {
        const stumps = [usable[i], usable[j], usable[k]];
        const spread = stumps[2].x - stumps[0].x;
        if (spread < width * 0.035 || spread > width * 0.22) continue;
        const spacingError = Math.abs(stumps[1].x - stumps[0].x - (stumps[2].x - stumps[1].x));
        const topError = range(stumps.map((stump) => stump.topY));
        const baseError = range(stumps.map((stump) => stump.baseY));
        if (topError > height * 0.08 || baseError > height * 0.08) continue;
        const heightScore = mean(stumps.map((stump) => stump.height)) / height;
        const score = spacingError / spread + topError / height + baseError / height - heightScore;
        if (!best || score < best.score) best = { score, stumps };
      }
    }
  }

  if (best) return best.stumps;

  const pair = selectOuterStumpPair(usable, width, height);
  return pair ?? [];
}

function selectOuterStumpPair(
  candidates: StumpCandidate[],
  width: number,
  height: number,
): StumpCandidate[] | undefined {
  let best: { score: number; stumps: StumpCandidate[] } | undefined;
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = candidates[i];
      const right = candidates[j];
      const spread = right.x - left.x;
      if (spread < width * 0.035 || spread > width * 0.18) continue;
      const score =
        Math.abs(left.topY - right.topY) / height +
        Math.abs(left.baseY - right.baseY) / height -
        (left.height + right.height) / (2 * height);
      if (!best || score < best.score) best = { score, stumps: [left, right] };
    }
  }
  return best?.stumps;
}

function selectSingleStump(candidates: StumpCandidate[]): StumpCandidate[] {
  return candidates.length ? [candidates[0]] : [];
}

function normalizeThreeStumps(stumps: StumpCandidate[]): [StumpCandidate, StumpCandidate, StumpCandidate] {
  const sorted = [...stumps].sort((a, b) => a.x - b.x);
  if (sorted.length >= 3) return [sorted[0], sorted[1], sorted[2]];
  if (sorted.length === 1) {
    const [middle] = sorted;
    const spread = Math.max(middle.width * 2.2, middle.height * 0.16);
    return [
      { ...middle, x: middle.x - spread },
      middle,
      { ...middle, x: middle.x + spread },
    ];
  }

  const [left, right] = sorted;
  const inferred: StumpCandidate = {
    x: (left.x + right.x) / 2,
    topY: (left.topY + right.topY) / 2,
    baseY: (left.baseY + right.baseY) / 2,
    width: (left.width + right.width) / 2,
    height: (left.height + right.height) / 2,
    area: (left.area + right.area) / 2,
  };
  return [left, inferred, right];
}

function findBatTip(
  mask: Uint8Array,
  labels: Int32Array,
  components: DetectionComponent[],
  stumps: StumpCandidate[],
  width: number,
  height: number,
  turfPlane?: TurfPlane,
): BatCandidate | undefined {
  const [left, middle, right] = normalizeThreeStumps(stumps);
  const base = { x: middle.x, y: middle.baseY };
  const stumpHeight = mean([left.height, middle.height, right.height]);
  const allowedDistanceToBase = Math.max(width * 0.1, right.x - left.x + middle.width * 3);
  const stumpXs = [left.x, middle.x, right.x];
  let best: { point: Point2D; distance: number } | undefined;

  for (const component of components) {
    if (component.area < 90) continue;
    if (distanceToBox(base, component) > allowedDistanceToBase) continue;
    if (countPixelsNearPoint(mask, labels, component, base, stumpHeight * 0.25, width) < 12) continue;

    const label = component.id;
    for (let y = Math.max(0, Math.floor(base.y - stumpHeight * 0.2)); y <= component.maxY; y += 1) {
      if (y < component.minY || y >= height) continue;
      for (let x = component.minX; x <= component.maxX; x += 1) {
        const index = y * width + x;
        if (!mask[index] || labels[index] !== label) continue;
        const nearStumpColumn = stumpXs.some((stumpX) => Math.abs(stumpX - x) < middle.width * 1.8);
        if (nearStumpColumn && y < base.y + stumpHeight * 0.18) continue;

        const point = { x, y };
        const candidateDistance = distance(base, point);
        if (!best || candidateDistance > best.distance) {
          best = { point, distance: candidateDistance };
        }
      }
    }
  }

  if (best && best.distance >= stumpHeight * 0.45) {
    return {
      tip: best.point,
      confidence: "strong",
    };
  }

  const weakBat = findWeakBatTip(mask, labels, components, stumps, width, height, turfPlane);
  if (weakBat) return weakBat;

  return inferBatFromTurfPlane(stumps, turfPlane);
}

function inferBatFromTurfPlane(
  stumps: StumpCandidate[],
  turfPlane: TurfPlane | undefined,
): BatCandidate | undefined {
  if (!turfPlane || !stumps.length) return undefined;

  const [left, middle, right] = normalizeThreeStumps(stumps);
  const base = { x: middle.x, y: middle.baseY };
  const nearCenter = midpoint(turfPlane.leftEdge.near, turfPlane.rightEdge.near);
  const farCenter = midpoint(turfPlane.leftEdge.far, turfPlane.rightEdge.far);
  const towardNear = unitVector({
    x: nearCenter.x - farCenter.x,
    y: nearCenter.y - farCenter.y,
  });
  const stumpHeight = mean([left.height, middle.height, right.height]);
  const inferredLength = Math.max(stumpHeight * 1.05, middle.width * 5);

  return {
    toe: base,
    tip: {
      x: base.x + towardNear.x * inferredLength,
      y: base.y + towardNear.y * inferredLength,
    },
    confidence: "weak",
  };
}

function findWeakBatTip(
  mask: Uint8Array,
  labels: Int32Array,
  components: DetectionComponent[],
  stumps: StumpCandidate[],
  width: number,
  height: number,
  turfPlane?: TurfPlane,
): BatCandidate | undefined {
  const [left, middle, right] = normalizeThreeStumps(stumps);
  const base = { x: middle.x, y: middle.baseY };
  const stumpHeight = mean([left.height, middle.height, right.height]);
  const stumpXs = [left.x, middle.x, right.x];
  let best:
    | {
        score: number;
        tip: Point2D;
        toe: Point2D;
      }
    | undefined;

  for (const component of components) {
    const boxWidth = component.maxX - component.minX + 1;
    const boxHeight = component.maxY - component.minY + 1;
    const aspect = boxWidth / Math.max(boxHeight, 1);
    const centerY = component.center.y;
    if (component.area < 90) continue;
    if (turfPlane && !pointInPolygon(component.center, turfPlane.polygon)) continue;
    if (centerY < height * 0.38 || centerY > height * 0.94) continue;
    if (boxWidth < width * 0.045 && boxHeight < height * 0.045) continue;
    if (aspect < 1.7 && boxHeight / Math.max(boxWidth, 1) < 1.7) continue;

    const endpoints = componentExtremePair(mask, labels, component, width);
    if (!endpoints) continue;

    const [a, b] = endpoints;
    const distanceA = distance(base, a);
    const distanceB = distance(base, b);
    const toe = distanceA <= distanceB ? a : b;
    const tip = distanceA > distanceB ? a : b;
    const batLength = distance(toe, tip);
    if (batLength < Math.max(stumpHeight * 0.35, width * 0.045)) continue;

    const toeDistance = distance(base, toe);
    const centerDistance = distance(base, component.center);
    const nearStumpColumn = stumpXs.some((stumpX) => Math.abs(stumpX - toe.x) < middle.width * 5);
    const baseScore = Math.max(0, 1 - toeDistance / Math.max(width * 0.22, stumpHeight));
    const lengthScore = Math.min(1, batLength / Math.max(width * 0.16, stumpHeight * 0.9));
    const sideViewScore = Math.max(0, 1 - centerDistance / Math.max(width * 0.45, stumpHeight * 2.2));
    const columnBonus = nearStumpColumn ? 0.15 : 0;
    const score = baseScore * 0.5 + lengthScore * 0.3 + sideViewScore * 0.2 + columnBonus;

    if (score > 0.28 && (!best || score > best.score)) {
      best = { score, tip, toe };
    }
  }

  if (!best) {
    best = findGlobalBatBlade(mask, labels, components, base, width, height, turfPlane);
  }

  if (!best) return undefined;

  return {
    tip: best.tip,
    toe: best.toe,
    confidence: "weak",
  };
}

function findGlobalBatBlade(
  mask: Uint8Array,
  labels: Int32Array,
  components: DetectionComponent[],
  base: Point2D,
  width: number,
  height: number,
  turfPlane?: TurfPlane,
):
  | {
      score: number;
      tip: Point2D;
      toe: Point2D;
    }
  | undefined {
  let best:
    | {
        score: number;
        tip: Point2D;
        toe: Point2D;
      }
    | undefined;

  for (const component of components) {
    const boxWidth = component.maxX - component.minX + 1;
    const boxHeight = component.maxY - component.minY + 1;
    const aspect = boxWidth / Math.max(boxHeight, 1);
    if (component.area < 120) continue;
    if (turfPlane && componentTurfCoverage(component, turfPlane.polygon) < 0.45) continue;
    if (component.center.y < height * 0.42 || component.center.y > height * 0.94) continue;
    if (aspect < 1.45 || boxWidth < width * 0.055 || boxHeight > height * 0.22) continue;

    const endpoints = componentExtremePair(mask, labels, component, width);
    if (!endpoints) continue;

    const [a, b] = endpoints;
    const distanceA = distance(base, a);
    const distanceB = distance(base, b);
    const toe = distanceA <= distanceB ? a : b;
    const tip = distanceA > distanceB ? a : b;
    const batLength = distance(toe, tip);
    if (batLength < width * 0.08) continue;

    const horizontalness = Math.min(1, aspect / 4);
    const lengthScore = Math.min(1, batLength / (width * 0.2));
    const turfScore = Math.max(0, 1 - Math.abs(component.center.y - height * 0.68) / (height * 0.26));
    const score = horizontalness * 0.35 + lengthScore * 0.45 + turfScore * 0.2;

    if (score > 0.34 && (!best || score > best.score)) {
      best = { score, tip, toe };
    }
  }

  return best;
}

function componentExtremePair(
  mask: Uint8Array,
  labels: Int32Array,
  component: DetectionComponent,
  width: number,
): [Point2D, Point2D] | undefined {
  const points: Point2D[] = [];
  for (let y = component.minY; y <= component.maxY; y += 1) {
    const rowOffset = y * width;
    for (let x = component.minX; x <= component.maxX; x += 1) {
      const index = rowOffset + x;
      if (mask[index] && labels[index] === component.id) {
        points.push({ x, y });
      }
    }
  }

  if (points.length < 2) return undefined;

  let first = points[0];
  let second = points[1];
  let bestDistance = 0;
  const stride = Math.max(1, Math.floor(points.length / 120));

  for (let i = 0; i < points.length; i += stride) {
    for (let j = i + stride; j < points.length; j += stride) {
      const candidateDistance = distance(points[i], points[j]);
      if (candidateDistance > bestDistance) {
        bestDistance = candidateDistance;
        first = points[i];
        second = points[j];
      }
    }
  }

  return [first, second];
}

function countPixelsNearPoint(
  mask: Uint8Array,
  labels: Int32Array,
  component: DetectionComponent,
  point: Point2D,
  radius: number,
  width: number,
): number {
  let count = 0;
  const radiusSquared = radius * radius;
  const minY = Math.max(component.minY, Math.floor(point.y - radius));
  const maxY = Math.min(component.maxY, Math.ceil(point.y + radius));
  const minX = Math.max(component.minX, Math.floor(point.x - radius));
  const maxX = Math.min(component.maxX, Math.ceil(point.x + radius));

  for (let y = minY; y <= maxY; y += 1) {
    const rowOffset = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      const index = rowOffset + x;
      if (!mask[index] || labels[index] !== component.id) continue;
      const dx = x - point.x;
      const dy = y - point.y;
      if (dx * dx + dy * dy <= radiusSquared) count += 1;
    }
  }

  return count;
}

function addCreaseDefaults(landmarks: LandmarkMap, width: number, height: number) {
  const base = landmarks.middleStumpBase;
  const batTip = landmarks.batTip;
  if (!base) return;

  const forward = batTip
    ? unitVector({ x: batTip.x - base.x, y: batTip.y - base.y })
    : { x: 0, y: 1 };
  const perpendicular = { x: -forward.y, y: forward.x };
  const center = {
    x: base.x + forward.x * height * 0.12,
    y: base.y + forward.y * height * 0.12,
  };
  const halfWidth = width * 0.12;
  landmarks.creaseLeft = {
    x: center.x + perpendicular.x * halfWidth,
    y: center.y + perpendicular.y * halfWidth,
  };
  landmarks.creaseRight = {
    x: center.x - perpendicular.x * halfWidth,
    y: center.y - perpendicular.y * halfWidth,
  };
}

function scalePoint(point: Point2D, scale: number): Point2D {
  return {
    x: point.x * scale,
    y: point.y * scale,
  };
}

function scaleLine(line: CandidateLine, scale: number): CandidateLine {
  return {
    ...line,
    start: scalePoint(line.start, scale),
    end: scalePoint(line.end, scale),
    lengthPx: line.lengthPx * scale,
  };
}

function unitVector(vector: Point2D): Point2D {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 1) return { x: 0, y: 1 };
  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function distanceToBox(point: Point2D, component: DetectionComponent): number {
  const dx = Math.max(component.minX - point.x, 0, point.x - component.maxX);
  const dy = Math.max(component.minY - point.y, 0, point.y - component.maxY);
  return Math.hypot(dx, dy);
}

function componentTurfCoverage(component: DetectionComponent, polygon: Point2D[]): number {
  const xStep = Math.max(1, Math.floor((component.maxX - component.minX + 1) / 8));
  const yStep = Math.max(1, Math.floor((component.maxY - component.minY + 1) / 8));
  let total = 0;
  let inside = 0;

  for (let y = component.minY; y <= component.maxY; y += yStep) {
    for (let x = component.minX; x <= component.maxX; x += xStep) {
      total += 1;
      if (pointInPolygon({ x, y }, polygon)) inside += 1;
    }
  }

  return total ? inside / total : 0;
}

function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1e-9) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function range(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function percentile(sortedValues: number[], fraction: number): number {
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor(sortedValues.length * fraction)),
  );
  return sortedValues[index];
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
