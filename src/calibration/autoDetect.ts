import { angleDegrees, distance, normalizeAngleDegrees } from "./geometry";
import { canvasFromImage, type OpenCv } from "./opencv";
import type { CandidateLine, ImageSize, LandmarkMap, Point2D } from "./types";

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
