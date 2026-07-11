export type VideoFramePlan = {
  frameCount: number;
  sourceStepS: number;
  measurementStepS: number;
  sourceSpanS: number;
  physicalSpanS: number;
};

export function buildVideoFramePlan(
  captureFps: number,
  timelineFps: number,
  physicalDurationS: number,
  maxFrames = 480,
): VideoFramePlan {
  const safeCaptureFps = Math.max(1, captureFps);
  const safeTimelineFps = Math.max(1, timelineFps);
  const frameCount = Math.min(
    maxFrames,
    Math.max(8, Math.floor(Math.max(0.01, physicalDurationS) * safeCaptureFps)),
  );
  return {
    frameCount,
    sourceStepS: 1 / safeTimelineFps,
    measurementStepS: 1 / safeCaptureFps,
    sourceSpanS: (frameCount - 1) / safeTimelineFps,
    physicalSpanS: (frameCount - 1) / safeCaptureFps,
  };
}
