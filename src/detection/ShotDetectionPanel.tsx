import { useEffect, useRef, useState } from "react";
import type { TurfPlane } from "../calibration/autoDetect";
import type { ImageSize, LandmarkMap, PoseResult } from "../calibration/types";
import type { ShotInput } from "../ground/shotSimulation";
import {
  BallTracker,
  DEFAULT_YELLOW_BALL_PROFILE,
  createBallAppearanceTemplate,
  detectBallCandidates,
  profileFromRgb,
  findBallByAppearanceTemplate,
  sampleAverageColor,
  detectBounceFrames,
  type BallColorProfile,
  type PixelPoint,
  type TrackedBallPoint,
  type TrackingSummary,
} from "./ballTracking";
import { estimateShotMeasurement, type ShotMeasurement } from "./shotEstimation";
import { buildVideoFramePlan } from "./videoTiming";
import { detectSportsBallWithAi } from "./aiObjectDetection";

type ShotDetectionPanelProps = {
  landmarks: LandmarkMap;
  calibrationImageSize?: ImageSize;
  turfPlane?: TurfPlane;
  pose?: PoseResult;
  onShotDetected: (shot: ShotInput) => void;
};

const MAX_PROCESSING_SIDE = 960;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

type ManualKeyframe = {
  sourceTimeS: number;
  center: PixelPoint;
  radiusPx: number;
};

export function ShotDetectionPanel({
  landmarks,
  calibrationImageSize,
  turfPlane,
  pose,
  onShotDetected,
}: ShotDetectionPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const abortRef = useRef(false);
  const [videoUrl, setVideoUrl] = useState<string>();
  const [captureFps, setCaptureFps] = useState(120);
  const [timelineFps, setTimelineFps] = useState(120);
  const [clipStartS, setClipStartS] = useState(0);
  const [beforeContactS, setBeforeContactS] = useState(0.2);
  const [clipDurationS, setClipDurationS] = useState(1.25);
  const [ballDiameterMm, setBallDiameterMm] = useState(72);
  const [profile, setProfile] = useState<BallColorProfile>(DEFAULT_YELLOW_BALL_PROFILE);
  const [seedPoint, setSeedPoint] = useState<PixelPoint>();
  const [seedRadiusPx, setSeedRadiusPx] = useState(9);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Upload a 120/240 fps clip, then sample the ball.");
  const [tracking, setTracking] = useState<TrackingSummary>();
  const [measurement, setMeasurement] = useState<ShotMeasurement>();
  const [capturedSourceTimeS, setCapturedSourceTimeS] = useState(0);
  const [manualKeyframes, setManualKeyframes] = useState<ManualKeyframe[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const displayedBeforePlan = buildVideoFramePlan(captureFps, timelineFps, beforeContactS);
  const displayedAfterPlan = buildVideoFramePlan(captureFps, timelineFps, clipDurationS);

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  useEffect(() => {
    if (!processing) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [processing]);

  function handleVideoFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setStatus("Please choose a video file.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setStatus("Video is over 500 MB. Trim it around the shot in Photos, then upload the shorter original-quality clip.");
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setVideoUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return nextUrl;
    });
    setSeedPoint(undefined);
    setTracking(undefined);
    setMeasurement(undefined);
    setManualKeyframes([]);
    setStatus("Move the video to the frame closest to bat-ball contact, then tap Grab current frame.");
  }

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) {
      setStatus("This video could not be decoded. Use an original H.264/HEVC MOV or MP4 clip.");
      return;
    }
    if (video.duration > 30) {
      setStatus("This clip is long. For reliable iPhone processing, trim it to a few seconds around the shot.");
    }
    setClipStartS(Math.max(0, video.currentTime));
  }

  function captureCurrentFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    resizeCanvasForVideo(canvas, video);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    setClipStartS(video.currentTime);
    setCapturedSourceTimeS(video.currentTime);
    setSeedPoint(undefined);
    setStatus("Tap the yellow ball in the captured frame to learn its current color.");
  }

  function sampleBallAtCanvas(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const point = {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
    const context = canvas.getContext("2d");
    if (!context) return;
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const color = sampleAverageColor(frame, point, seedRadiusPx);
    setProfile(profileFromRgb(color, profile.hueToleranceDegrees));
    setSeedPoint(point);
    setManualKeyframes((current) => [
      ...current.filter((item) => Math.abs(item.sourceTimeS - capturedSourceTimeS) > 0.0005),
      { sourceTimeS: capturedSourceTimeS, center: point, radiusPx: seedRadiusPx },
    ].sort((a, b) => a.sourceTimeS - b.sourceTimeS));
    drawSampleMarker(canvas, point, seedRadiusPx);
    setStatus("Ball sampled and manual keyframe saved. Seek/grab/tap more frames or run automatic processing.");
  }

  async function locateBallWithAi() {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width || aiLoading) {
      setStatus("Grab the contact frame before running AI assist.");
      return;
    }
    setAiLoading(true);
    setStatus("Loading AI model and searching the contact frame for a sports ball...");
    try {
      const detection = await detectSportsBallWithAi(canvas);
      if (!detection) {
        setStatus("AI did not recognize the practice ball. Tap it manually; tracking still uses its sampled appearance.");
        return;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      const color = sampleAverageColor(frame, detection.center, detection.radiusPx);
      setProfile(profileFromRgb(color, Math.max(profile.hueToleranceDegrees, 28)));
      setSeedPoint(detection.center);
      setSeedRadiusPx(Math.round(detection.radiusPx));
      setManualKeyframes((current) => [
        ...current.filter((item) => Math.abs(item.sourceTimeS - capturedSourceTimeS) > 0.0005),
        {
          sourceTimeS: capturedSourceTimeS,
          center: detection.center,
          radiusPx: detection.radiusPx,
        },
      ].sort((a, b) => a.sourceTimeS - b.sourceTimeS));
      drawAiDetection(canvas, detection.box);
      setStatus(`AI located a sports ball at ${Math.round(detection.confidence * 100)}% confidence. Verify the box before processing.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI ball detection failed. Tap the ball manually.");
    } finally {
      setAiLoading(false);
    }
  }

  async function processClip() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !seedPoint || processing) {
      setStatus("Grab a frame and tap the ball before processing.");
      return;
    }

    setProcessing(true);
    abortRef.current = false;
    setProgress(0);
    setTracking(undefined);
    setMeasurement(undefined);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      setProcessing(false);
      return;
    }

    try {
      await seekVideo(video, clipStartS);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const contactFrame = context.getImageData(0, 0, canvas.width, canvas.height);
      const appearanceTemplate = createBallAppearanceTemplate(
        contactFrame,
        seedPoint,
        seedRadiusPx,
      );
      const beforePlan = buildVideoFramePlan(captureFps, timelineFps, beforeContactS);
      const afterPlan = buildVideoFramePlan(captureFps, timelineFps, clipDurationS);
      const totalFrames = beforePlan.frameCount + afterPlan.frameCount;
      let processedFrames = 0;

      const trackDirection = async (
        direction: -1 | 1,
        plan: ReturnType<typeof buildVideoFramePlan>,
      ) => {
        const tracker = new BallTracker(9, 0.34);
        tracker.seed(seedPoint, seedRadiusPx);
        let previousFrame = contactFrame;
        for (let step = 1; step <= plan.frameCount; step += 1) {
          if (abortRef.current) throw new Error("Processing cancelled.");
          const sourceTime = Math.min(
            Math.max(0, clipStartS + direction * step * plan.sourceStepS),
            Math.max(0, video.duration - 0.001),
          );
          await seekVideo(video, sourceTime);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          const prediction = tracker.prediction;
          let candidates = detectBallCandidates(frame, {
            profile,
            previousFrame,
            predictedCenter: prediction.center,
            predictedRadiusPx: prediction.radiusPx,
            searchRadiusPx: prediction.searchRadiusPx,
            minRadiusPx: 1.8,
            maxRadiusPx: Math.max(26, canvas.width * 0.055),
          });
          if ((!candidates[0] || candidates[0].confidence < 0.48) && prediction.center) {
            const templateCandidate = findBallByAppearanceTemplate(
              frame,
              appearanceTemplate,
              prediction.center,
              Math.min(prediction.searchRadiusPx ?? 80, canvas.width * 0.18),
            );
            if (templateCandidate) {
              candidates = [templateCandidate, ...candidates];
            }
          }
          tracker.update(step, step * plan.measurementStepS, candidates);
          previousFrame = frame;
          processedFrames += 1;
          if (processedFrames % 6 === 0 || processedFrames === totalFrames) {
            setProgress(processedFrames / totalFrames);
            await yieldToBrowser();
          }
        }
        return tracker.summary();
      };

      const backward = await trackDirection(-1, beforePlan);
      const forward = await trackDirection(1, afterPlan);
      const backwardPoints = backward.points
        .map((point) => ({
          ...point,
          frameIndex: -point.frameIndex,
          timeS: -point.timeS,
          velocityPxPerS: {
            x: -point.velocityPxPerS.x,
            y: -point.velocityPxPerS.y,
          },
        }))
        .reverse();
      const contactPoint: TrackedBallPoint = {
        frameIndex: 0,
        timeS: 0,
        center: seedPoint,
        radiusPx: seedRadiusPx,
        confidence: 1,
        predicted: false,
        velocityPxPerS: forward.points[0]?.velocityPxPerS ?? { x: 0, y: 0 },
      };
      const combinedPoints = [...backwardPoints, contactPoint, ...forward.points];
      const summary: TrackingSummary = {
        points: combinedPoints,
        detectedPoints: combinedPoints.filter((point) => !point.predicted).length,
        predictedPoints: combinedPoints.filter((point) => point.predicted).length,
        averageConfidence:
          combinedPoints.reduce((sum, point) => sum + point.confidence, 0) /
          Math.max(combinedPoints.length, 1),
        impactFrameIndex: 0,
        bounceFrameIndices: detectBounceFrames(forward.points),
        pixelDirectionDegrees: forward.pixelDirectionDegrees,
        pixelSpeedPerSecond: forward.pixelSpeedPerSecond,
        longestPredictedGap: Math.max(backward.longestPredictedGap, forward.longestPredictedGap),
      };
      setTracking(summary);
      drawTrackingOverlay(canvas, summary);
      const nextMeasurement = estimateShotMeasurement(summary, {
        ballDiameterMm,
        captureFps,
        pose,
        turfPlane,
        landmarks,
        trackedFrameSize: { width: canvas.width, height: canvas.height },
        calibrationImageSize,
      });
      setMeasurement(nextMeasurement);
      if (nextMeasurement) {
        onShotDetected(nextMeasurement.shotInput);
        setStatus(
          `Detected ${summary.detectedPoints} frames. ${Math.round(
            nextMeasurement.speedMps * 3.6,
          )} km/h, ${Math.round(nextMeasurement.directionDegrees)} deg direction.`,
        );
      } else {
        setStatus(trackFailureMessage(summary, Boolean(turfPlane), Boolean(pose)));
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Video processing failed.");
    } finally {
      setProcessing(false);
      abortRef.current = false;
    }
  }

  function measureManualKeyframes() {
    if (manualKeyframes.length < 4 || !canvasRef.current) {
      setStatus("Add at least four manual keyframes starting at bat contact.");
      return;
    }
    const firstSourceTime = manualKeyframes[0].sourceTimeS;
    const points: TrackedBallPoint[] = manualKeyframes.map((keyframe, index) => {
      const physicalTimeS =
        ((keyframe.sourceTimeS - firstSourceTime) * timelineFps) / Math.max(captureFps, 1);
      const previous = manualKeyframes[Math.max(0, index - 1)];
      const previousPhysicalTimeS =
        ((previous.sourceTimeS - firstSourceTime) * timelineFps) / Math.max(captureFps, 1);
      const dt = Math.max(physicalTimeS - previousPhysicalTimeS, 1 / captureFps);
      return {
        frameIndex: Math.round(physicalTimeS * captureFps),
        timeS: physicalTimeS,
        center: keyframe.center,
        radiusPx: keyframe.radiusPx,
        confidence: 0.98,
        predicted: false,
        velocityPxPerS:
          index === 0
            ? { x: 0, y: 0 }
            : {
                x: (keyframe.center.x - previous.center.x) / dt,
                y: (keyframe.center.y - previous.center.y) / dt,
              },
      };
    });
    if (points.length >= 2) points[0].velocityPxPerS = points[1].velocityPxPerS;
    const summary: TrackingSummary = {
      points,
      detectedPoints: points.length,
      predictedPoints: 0,
      averageConfidence: 0.98,
      impactFrameIndex: points[0].frameIndex,
      bounceFrameIndices: detectBounceFrames(points),
      pixelDirectionDegrees: undefined,
      pixelSpeedPerSecond: undefined,
      longestPredictedGap: 0,
    };
    const nextMeasurement = estimateShotMeasurement(summary, {
      ballDiameterMm,
      captureFps,
      pose,
      turfPlane,
      landmarks,
      trackedFrameSize: {
        width: canvasRef.current.width,
        height: canvasRef.current.height,
      },
      calibrationImageSize,
    });
    setTracking(summary);
    setMeasurement(nextMeasurement);
    if (nextMeasurement) {
      onShotDetected(nextMeasurement.shotInput);
      setStatus(`Manual track measured at ${Math.round(nextMeasurement.speedMps * 3.6)} km/h.`);
    } else {
      setStatus("Manual keyframes were saved, but calibration geometry is insufficient for measurement.");
    }
  }

  return (
    <section className="shot-detection card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Shot detection</p>
          <h2>Track the yellow practice ball from slow-motion video</h2>
          <p className="panel-subtitle">
            Best accuracy: iPhone 16 Pro main 1× camera, fixed position, 4K/120 fps or 1080p/240 fps,
            strong light, then select the frame closest to bat-ball contact.
          </p>
        </div>
      </div>

      <div className="video-detection-grid">
        <div className="video-column">
          <label className="file-button compact">
            <input type="file" accept="video/quicktime,video/mp4,video/*" onChange={(event) => handleVideoFile(event.target.files?.[0])} />
            Upload slow-motion video
          </label>
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={handleLoadedMetadata}
            />
          ) : (
            <div className="video-placeholder">Upload a short slow-motion clip.</div>
          )}
          <button disabled={!videoUrl} onClick={captureCurrentFrame}>Grab current frame</button>
          <button disabled={!videoUrl || aiLoading} onClick={locateBallWithAi}>
            {aiLoading ? "Loading AI..." : "AI locate ball"}
          </button>
        </div>

        <div className="detection-canvas-wrap">
          <canvas ref={canvasRef} onPointerDown={sampleBallAtCanvas} />
          {!seedPoint ? <span>Grab a frame, then tap the ball</span> : null}
        </div>
      </div>

      <div className="detection-controls">
        <label>
          Capture FPS
          <select value={captureFps} onChange={(event) => setCaptureFps(Number(event.target.value))}>
            <option value="120">120 fps (4K recommended)</option>
            <option value="240">240 fps (1080p)</option>
            <option value="60">60 fps fallback</option>
          </select>
        </label>
        <label>
          Frames stored per video second
          <select value={timelineFps} onChange={(event) => setTimelineFps(Number(event.target.value))}>
            <option value={captureFps}>Original speed ({captureFps})</option>
            <option value="30">Apple slow-motion timeline (30)</option>
            <option value="60">60 fps timeline</option>
          </select>
        </label>
        <label>
          Contact frame time
          <input min="0" step="0.01" type="number" value={clipStartS} onChange={(event) => setClipStartS(Number(event.target.value))} />
        </label>
        <label>
          Seconds before contact
          <input min="0.05" max="0.75" step="0.05" type="number" value={beforeContactS} onChange={(event) => setBeforeContactS(Number(event.target.value))} />
        </label>
        <label>
          Seconds after contact
          <input min="0.25" max="3" step="0.05" type="number" value={clipDurationS} onChange={(event) => setClipDurationS(Number(event.target.value))} />
        </label>
        <label>
          Ball diameter
          <span>{ballDiameterMm} mm</span>
          <input min="65" max="78" step="0.5" type="range" value={ballDiameterMm} onChange={(event) => setBallDiameterMm(Number(event.target.value))} />
        </label>
        <label>
          Wear/dust color tolerance
          <span>{profile.hueToleranceDegrees} deg</span>
          <input
            min="12"
            max="55"
            step="1"
            type="range"
            value={profile.hueToleranceDegrees}
            onChange={(event) => setProfile((current) => ({ ...current, hueToleranceDegrees: Number(event.target.value) }))}
          />
        </label>
        <label>
          Sample radius
          <span>{seedRadiusPx}px</span>
          <input min="4" max="24" step="1" type="range" value={seedRadiusPx} onChange={(event) => setSeedRadiusPx(Number(event.target.value))} />
        </label>
      </div>

      <div className="manual-track-panel">
        <div>
          <strong>Manual keyframe fallback: {manualKeyframes.length} points</strong>
          <p>
            If auto-tracking is wrong, seek to bat contact, Grab frame, tap the ball, then repeat
            for at least three later frames. Start with the contact frame.
          </p>
        </div>
        <div className="manual-track-actions">
          <button disabled={manualKeyframes.length < 4 || processing} onClick={measureManualKeyframes}>
            Measure manual track
          </button>
          <button
            disabled={!manualKeyframes.length || processing}
            onClick={() => {
              setManualKeyframes([]);
              setStatus("Manual keyframes cleared.");
            }}
          >
            Clear keyframes
          </button>
        </div>
      </div>

      <button className="primary-action" disabled={!seedPoint || processing} onClick={processClip}>
        {processing ? `Processing ${Math.round(progress * 100)}%` : "Process shot and send to simulator"}
      </button>
      {processing ? (
        <button onClick={() => { abortRef.current = true; }}>Cancel processing</button>
      ) : null}
      <progress aria-label="Video processing progress" max="1" value={progress} />
      <p className="status" role="status" aria-live="polite">{status}</p>
      <p className="hint">
        Contact-first processing automatically reads {displayedBeforePlan.frameCount} frames before and{" "}
        {displayedAfterPlan.frameCount} frames after contact. Timeline span: approximately{" "}
        {(displayedBeforePlan.sourceSpanS + displayedAfterPlan.sourceSpanS).toFixed(2)}s.
      </p>

      {tracking ? (
        <dl className="detection-result-grid">
          <div><dt>Detected frames</dt><dd>{tracking.detectedPoints}</dd></div>
          <div><dt>Predicted gaps</dt><dd>{tracking.predictedPoints}</dd></div>
          <div><dt>Longest gap</dt><dd>{tracking.longestPredictedGap} frames</dd></div>
          <div><dt>Track confidence</dt><dd>{Math.round(tracking.averageConfidence * 100)}%</dd></div>
          <div><dt>Bounces</dt><dd>{tracking.bounceFrameIndices.length}</dd></div>
          <div><dt>Impact frame</dt><dd>{tracking.impactFrameIndex ?? "not resolved"}</dd></div>
        </dl>
      ) : null}

      {measurement ? (
        <div className="measurement-result">
          <strong>{Math.round(measurement.speedMps * 3.6)} km/h</strong>
          <span>{Math.round(measurement.directionDegrees)} deg direction</span>
          <span>{Math.round(measurement.launchAngleDegrees)} deg launch</span>
          <span>{measurement.method} / {Math.round(measurement.confidence * 100)}% confidence</span>
          {measurement.warnings.map((warning) => <small key={warning}>{warning}</small>)}
        </div>
      ) : null}
    </section>
  );
}

function resizeCanvasForVideo(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
  const scale = Math.min(1, MAX_PROCESSING_SIDE / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
}

function drawSampleMarker(canvas: HTMLCanvasElement, point: PixelPoint, radius: number) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.strokeStyle = "#f97316";
  context.lineWidth = 3;
  context.stroke();
}

function drawAiDetection(
  canvas: HTMLCanvasElement,
  box: [number, number, number, number],
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.strokeStyle = "#38bdf8";
  context.lineWidth = 4;
  context.strokeRect(box[0], box[1], box[2], box[3]);
  context.fillStyle = "rgba(2, 6, 23, 0.82)";
  context.fillRect(box[0], Math.max(0, box[1] - 26), 150, 24);
  context.fillStyle = "#e0f2fe";
  context.font = "bold 16px system-ui";
  context.fillText("AI sports ball", box[0] + 6, Math.max(17, box[1] - 8));
}

function drawTrackingOverlay(canvas: HTMLCanvasElement, summary: TrackingSummary) {
  const context = canvas.getContext("2d");
  if (!context || summary.points.length < 2) return;
  context.beginPath();
  summary.points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.center.x, point.center.y);
    else context.lineTo(point.center.x, point.center.y);
  });
  context.strokeStyle = "#fbbf24";
  context.lineWidth = 4;
  context.stroke();
  for (const point of summary.points.filter((item) => !item.predicted)) {
    context.beginPath();
    context.arc(point.center.x, point.center.y, Math.max(3, point.radiusPx), 0, Math.PI * 2);
    context.strokeStyle = `rgba(34, 197, 94, ${Math.max(0.35, point.confidence)})`;
    context.lineWidth = 2;
    context.stroke();
  }
}

function seekVideo(video: HTMLVideoElement, timeS: number): Promise<void> {
  if (Math.abs(video.currentTime - timeS) < 0.0005) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out decoding a video frame."));
    }, 4000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not decode the uploaded video."));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = timeS;
  });
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function trackFailureMessage(
  summary: TrackingSummary,
  hasTurfPlane: boolean,
  hasPose: boolean,
): string {
  if (summary.detectedPoints < 4) {
    return `Only ${summary.detectedPoints} ball frames were detected. Increase light/tolerance or use manual keyframes.`;
  }
  if (summary.longestPredictedGap > 4) {
    return `The ball disappeared for ${summary.longestPredictedGap} frames. Use manual keyframes across the occlusion.`;
  }
  if (!hasTurfPlane && !hasPose) {
    return "The ball track exists, but calibration has neither a valid turf plane nor 3D pose.";
  }
  if (summary.impactFrameIndex === undefined) {
    return "Bat impact was not resolved. Shorten the clip around contact or start manual keyframes at impact.";
  }
  return "Track quality or calibration scale was insufficient. Review warnings and use manual keyframes.";
}
