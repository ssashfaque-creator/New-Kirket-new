import type { TurfPlane } from "./autoDetect";
import type { CalibrationResult, ImageSize, LandmarkMap } from "./types";

export type SavedKirketSession = {
  version: 2;
  savedAt: string;
  imageSize?: ImageSize;
  landmarks: LandmarkMap;
  turfPlane?: TurfPlane;
  result?: CalibrationResult;
  assumedFov: number;
  groundId: string;
  fieldId: string;
};

const STORAGE_KEY = "kirket.calibration.session.v2";

export function saveSession(session: SavedKirketSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadSession(): SavedKirketSession | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    return parseSession(raw);
  } catch {
    return undefined;
  }
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function parseSession(raw: string): SavedKirketSession | undefined {
  const parsed = JSON.parse(raw) as Partial<SavedKirketSession>;
  if (parsed.version !== 2 || !parsed.landmarks || typeof parsed.assumedFov !== "number") {
    return undefined;
  }
  return parsed as SavedKirketSession;
}
