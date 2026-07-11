import { useEffect, useRef, useState } from "react";
import type { TurfPlane } from "../calibration/autoDetect";
import type { ImageSize, LandmarkMap, PoseResult } from "../calibration/types";
import type { ShotInput } from "../ground/shotSimulation";
import {
  BallTracker,
  DEFAULT_YELLOW_BALL_PROFILE,
  detectBallCandidates,
  profileFromRgb,
  sampleAverageColor,
  type BallColorProfile,
  type PixelPoint,
  type TrackingSummary,
} from "./ballTracking";
import { estimateShotMeasurement, type ShotMeasurement } from "./shotEstimation";
import { buildVideoFramePlan } from "./videoTiming";

type ShotDetectionPanelProps = {
  landmarks: LandmarkMap;
  calibrationImageSize?: ImageSize;
  turfPlane?: TurfPlane;
  pose?: PoseResult;
  onShotDetected: (shot: ShotInput) => void;
};

const MAX_PROCESSING_SIDE = 960;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

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
  const displayedFramePlan = buildVideoFramePlan(captureFps, timelineFps, clipDurationS);

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
    setStatus("Move the video to just before bat contact, then tap Grab frame.");
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
    drawSampleMarker(canvas, point, seedRadiusPx);
    setStatus("Ball sampled. Start processing; increase tolerance if the worn ball is lost.");
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

    const tracker = new BallTracker(7, 0.38);
    tracker.seed(seedPoint, seedRadiusPx);
    let previousFrame: ImageData | undefined;
    const framePlan = buildVideoFramePlan(captureFps, timelineFps, clipDurationS);
    const { frameCount, sourceStepS, measurementStepS } = framePlan;

    try {
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        if (abortRef.current) throw new Error("Processing cancelled.");
        const sourceTime = Math.min(
          Math.max(0, clipStartS + frameIndex * sourceStepS),
          Math.max(0, video.duration - 0.001),
        );
        await seekVideo(video, sourceTime);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        const prediction = tracker.prediction;
        const candidates = detectBallCandidates(frame, {
          profile,
          previousFrame,
          predictedCenter: prediction.center,
          predictedRadiusPx: prediction.radiusPx,
          searchRadiusPx: prediction.searchRadiusPx,
          minRadiusPx: 1.8,
          maxRadiusPx: Math.max(26, canvas.width * 0.055),
        });
        tracker.update(frameIndex, frameIndex * measurementStepS, candidates);
        previousFrame = frame;

        if (frameIndex % 6 === 0 || frameIndex === frameCount - 1) {
          setProgress((frameIndex + 1) / frameCount);
          await yieldToBrowser();
        }
      }

      const summary = tracker.summary();
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
        setStatus("Track found, but calibration/track quality was insufficient for shot measurement.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Video processing failed.");
    } finally {
      setProcessing(false);
      abortRef.current = false;
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
            strong light, and a clip beginning just before contact.
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
          Clip start
          <input min="0" step="0.01" type="number" value={clipStartS} onChange={(event) => setClipStartS(Number(event.target.value))} />
        </label>
        <label>
          Clip duration
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

      <button className="primary-action" disabled={!seedPoint || processing} onClick={processClip}>
        {processing ? `Processing ${Math.round(progress * 100)}%` : "Process shot and send to simulator"}
      </button>
      {processing ? (
        <button onClick={() => { abortRef.current = true; }}>Cancel processing</button>
      ) : null}
      <progress aria-label="Video processing progress" max="1" value={progress} />
      <p className="status" role="status" aria-live="polite">{status}</p>
      <p className="hint">
        Processing window: {displayedFramePlan.physicalSpanS.toFixed(2)}s of real capture time, reading approximately{" "}
        {displayedFramePlan.sourceSpanS.toFixed(2)}s from this video timeline ({displayedFramePlan.frameCount} frames).
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
