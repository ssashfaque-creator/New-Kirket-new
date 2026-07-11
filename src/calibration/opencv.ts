import type { LandmarkId, LandmarkMap, Point2D } from "./types";

export type OpenCv = any;

declare global {
  interface Window {
    cv?: OpenCv;
  }
}

let loadingPromise: Promise<OpenCv> | undefined;

export function loadOpenCv(): Promise<OpenCv> {
  if (window.cv?.Mat) return Promise.resolve(window.cv);
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const imported = (await import("@techstark/opencv-js")) as any;
      const candidate = imported.default ?? imported;
      const cv = typeof candidate?.then === "function" ? await candidate : candidate;
      if (cv?.Mat) {
        window.cv = cv;
        return cv;
      }
      return await waitForOpenCv(cv);
    } catch (error) {
      loadingPromise = undefined;
      throw new Error(
        error instanceof Error
          ? `Local OpenCV failed to load: ${error.message}`
          : "Local OpenCV failed to load.",
      );
    }
  })();

  return loadingPromise;
}

function waitForOpenCv(candidate: OpenCv): Promise<OpenCv> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = window.setInterval(() => {
      const cv = candidate?.Mat ? candidate : window.cv;
      if (cv?.Mat) {
        window.clearInterval(poll);
        window.cv = cv;
        resolve(cv);
      } else if (Date.now() - startedAt > 30_000) {
        window.clearInterval(poll);
        reject(new Error("OpenCV runtime did not initialize within 30 seconds."));
      }
    }, 50);
  });
}

export function canvasFromImage(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create image canvas.");
  context.drawImage(image, 0, 0);
  return canvas;
}

export function refineLandmarksSubPixel(
  cv: OpenCv,
  image: HTMLImageElement,
  landmarks: LandmarkMap,
  searchRadiusPx = 28,
  landmarkIds?: LandmarkId[],
): LandmarkMap {
  const canvas = canvasFromImage(image);
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  const refined: LandmarkMap = {};
  const allowed = landmarkIds ? new Set(landmarkIds) : undefined;

  for (const [id, point] of Object.entries(landmarks)) {
    if (!point) continue;
    const landmarkId = id as LandmarkId;
    refined[landmarkId] = allowed?.has(landmarkId)
      ? refinePoint(cv, gray, point, searchRadiusPx)
      : point;
  }

  gray.delete();
  src.delete();
  return refined;
}

function refinePoint(cv: OpenCv, gray: any, point: Point2D, radius: number): Point2D {
  const x = Math.max(0, Math.round(point.x - radius));
  const y = Math.max(0, Math.round(point.y - radius));
  const width = Math.min(gray.cols - x, radius * 2);
  const height = Math.min(gray.rows - y, radius * 2);

  if (width < 6 || height < 6) return point;

  const rect = new cv.Rect(x, y, width, height);
  const roi = gray.roi(rect);
  const corners = new cv.Mat();
  const qualityLevel = 0.01;
  const minDistance = 4;

  cv.goodFeaturesToTrack(roi, corners, 12, qualityLevel, minDistance);

  if (corners.rows === 0) {
    roi.delete();
    corners.delete();
    return point;
  }

  const criteria = new cv.TermCriteria(cv.TermCriteria_EPS + cv.TermCriteria_MAX_ITER, 30, 0.01);
  const winSize = new cv.Size(5, 5);
  const zeroZone = new cv.Size(-1, -1);
  cv.cornerSubPix(roi, corners, winSize, zeroZone, criteria);

  let best = point;
  let bestDistance = Number.POSITIVE_INFINITY;
  const data = corners.data32F;

  for (let i = 0; i < corners.rows; i += 1) {
    const candidate = {
      x: x + data[i * 2],
      y: y + data[i * 2 + 1],
    };
    const candidateDistance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      best = candidate;
    }
  }

  roi.delete();
  corners.delete();

  return best;
}
