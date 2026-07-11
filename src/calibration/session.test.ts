import { describe, expect, it } from "vitest";
import { parseSession } from "./session";

describe("calibration session parsing", () => {
  it("accepts current version sessions", () => {
    const session = parseSession(
      JSON.stringify({
        version: 2,
        savedAt: "2026-07-11T00:00:00.000Z",
        landmarks: { middleStumpBase: { x: 1, y: 2 } },
        assumedFov: 67,
        groundId: "dubai-style",
        fieldId: "odi-balanced",
      }),
    );

    expect(session?.version).toBe(2);
    expect(session?.landmarks.middleStumpBase).toEqual({ x: 1, y: 2 });
  });

  it("rejects incompatible data", () => {
    expect(parseSession(JSON.stringify({ version: 1, landmarks: {} }))).toBeUndefined();
  });
});
