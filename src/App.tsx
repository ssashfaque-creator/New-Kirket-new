import { useEffect, useMemo, useRef, useState } from "react";
import {
  BAT_LENGTH_INCHES,
  DEFAULT_CAMERA_FOV_DEGREES,
  LANDMARK_LABELS,
  LANDMARK_ORDER,
  MIN_POSE_POINTS,
} from "./calibration/constants";
import { defaultLandmarks, detectSetupLandmarks, type SetupDetectionResult } from "./calibration/autoDetect";
import { buildCalibrationExport } from "./calibration/exportCalibration";
import { availablePoseLandmarks, calculateBatScale, formatNumber } from "./calibration/geometry";
import { loadOpenCv, refineLandmarksSubPixel } from "./calibration/opencv";
import { buildPitchOverlayLines, buildTurfPitchOverlayLines } from "./calibration/pitchOverlay";
import { solveCalibration } from "./calibration/pose";
import { ShotDetectionPanel } from "./detection/ShotDetectionPanel";
import { VirtualGround } from "./ground/VirtualGround";
import { FIELD_PRESETS, GROUND_PRESETS } from "./ground/virtualGround";
import type { ShotInput } from "./ground/shotSimulation";
import type {
  CalibrationResult,
  CandidateLine,
  ImageSize,
  LandmarkId,
  LandmarkMap,
  Point2D,
} from "./calibration/types";

const LINE_COLORS: Record<CandidateLine["classification"], string> = {
  stump: "#43e97b",
  crease: "#38bdf8",
  bat: "#fbbf24",
  net: "#a78bfa",
  other: "#94a3b8",
};

const SUBPIXEL_REFINABLE_LANDMARKS: LandmarkId[] = [
  "middleStumpBase",
  "middleStumpTop",
  "offStumpBase",
  "offStumpTop",
  "legStumpBase",
  "legStumpTop",
  "batTip",
];

function App() {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string>();
  const [imageSize, setImageSize] = useState<ImageSize>();
  const [landmarks, setLandmarks] = useState<LandmarkMap>({});
  const [selectedLandmark, setSelectedLandmark] = useState<LandmarkId>("middleStumpBase");
  const [draggingLandmark, setDraggingLandmark] = useState<LandmarkId | undefined>();
  const [candidateLines, setCandidateLines] = useState<CandidateLine[]>([]);
  const [detection, setDetection] = useState<SetupDetectionResult>();
  const [result, setResult] = useState<CalibrationResult>();
  const [status, setStatus] = useState("Load a camera photo to begin.");
  const [assumedFov, setAssumedFov] = useState(DEFAULT_CAMERA_FOV_DEGREES);
  const [showCandidates, setShowCandidates] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [isPanMode, setIsPanMode] = useState(false);
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 });
  const [panningFrom, setPanningFrom] = useState<Point2D | undefined>();
  const [selectedGroundId, setSelectedGroundId] = useState(GROUND_PRESETS[3].id);
  const [selectedFieldId, setSelectedFieldId] = useState(FIELD_PRESETS[3].id);
  const [detectedShot, setDetectedShot] = useState<ShotInput>();
  const [activeStage, setActiveStage] = useState<"calibrate" | "detect" | "simulate">("calibrate");
  const [busyAction, setBusyAction] = useState<string>();

  const scale = useMemo(() => calculateBatScale(landmarks), [landmarks]);
  const markedPosePoints = availablePoseLandmarks(landmarks).length;
  const pitchOverlayLines = useMemo(
    () => {
      const turfLines = buildTurfPitchOverlayLines(landmarks, detection?.turfPlane);
      if (turfLines.length) return turfLines;
      return result?.pose ? buildPitchOverlayLines(result.pose) : [];
    },
    [detection?.turfPlane, landmarks, result?.pose],
  );
  const selectedGround = GROUND_PRESETS.find((ground) => ground.id === selectedGroundId) ?? GROUND_PRESETS[0];
  const selectedField = FIELD_PRESETS.find((field) => field.id === selectedFieldId) ?? FIELD_PRESETS[0];

  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  function handleFile(file: File | undefined) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImageUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return url;
    });
    setCandidateLines([]);
    setDetection(undefined);
    setResult(undefined);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setStatus("Image loaded. Confirm the landmark handles before solving.");
  }

  function handleImageLoaded() {
    const image = imageRef.current;
    if (!image) return;
    const nextSize = {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    setImageSize(nextSize);
    setLandmarks(defaultLandmarks(nextSize));
  }

  function updateLandmark(id: LandmarkId, point: Point2D) {
    setLandmarks((current) => ({
      ...current,
      [id]: point,
    }));
    setResult(undefined);
  }

  function imagePointFromClient(clientX: number, clientY: number): Point2D | undefined {
    const image = imageRef.current;
    if (!image || !imageSize) return undefined;
    const rect = image.getBoundingClientRect();
    const normalizedX = ((clientX - rect.left) / rect.width - 0.5 - pan.x) / zoom + 0.5;
    const normalizedY = ((clientY - rect.top) / rect.height - 0.5 - pan.y) / zoom + 0.5;
    return {
      x: normalizedX * imageSize.width,
      y: normalizedY * imageSize.height,
    };
  }

  function handleOverlayPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (panningFrom) {
      const image = imageRef.current;
      if (!image) return;
      const rect = image.getBoundingClientRect();
      const dx = (event.clientX - panningFrom.x) / rect.width;
      const dy = (event.clientY - panningFrom.y) / rect.height;
      setPan((current) => ({
        x: current.x + dx,
        y: current.y + dy,
      }));
      setPanningFrom({ x: event.clientX, y: event.clientY });
      return;
    }

    if (!draggingLandmark) return;
    const point = imagePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    updateLandmark(draggingLandmark, point);
  }

  function handleOverlayPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (isPanMode) {
      setPanningFrom({ x: event.clientX, y: event.clientY });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const point = imagePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    updateLandmark(selectedLandmark, point);
    setDraggingLandmark(selectedLandmark);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleHandlePointerDown(
    event: React.PointerEvent<SVGCircleElement>,
    id: LandmarkId,
  ) {
    event.stopPropagation();
    setSelectedLandmark(id);
    setDraggingLandmark(id);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function stopDragging() {
    setDraggingLandmark(undefined);
    setPanningFrom(undefined);
  }

  async function runDetectSetup() {
    const image = imageRef.current;
    if (!image) return;
    setBusyAction("Detecting setup");
    setStatus("Detecting wooden stumps, bat, and turf plane...");
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const nextDetection = detectSetupLandmarks(image);
      setDetection(nextDetection);
      setCandidateLines(nextDetection.candidateLines);
      setLandmarks((current) => ({ ...current, ...nextDetection.landmarks }));
      setShowCandidates(true);
      setStatus(
        nextDetection.detectedStumpCount >= 2
          ? `Auto-detected ${nextDetection.detectedStumpCount} stump columns${
              nextDetection.detectedBat ? " and the bat tip" : ""
            }. Correct every handle before calibration.`
          : "Auto-detection could not lock onto the wicket; use the manual handles.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Setup detection failed.");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function runRefine() {
    const image = imageRef.current;
    if (!image) return;
    setBusyAction("Refining points");
    setStatus("Refining marked point landmarks...");
    try {
      const cv = await loadOpenCv();
      setLandmarks((current) =>
        refineLandmarksSubPixel(cv, image, current, 28, SUBPIXEL_REFINABLE_LANDMARKS),
      );
      setResult(undefined);
      setStatus("Sub-pixel refinement complete. Check every handle before solving.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Point refinement failed.");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function runCalibrationSolve() {
    if (!imageSize) return;
    setBusyAction("Solving calibration");
    setStatus("Solving scale and phone pose...");
    try {
      const cv = await loadOpenCv();
      const nextResult = solveCalibration(cv, landmarks, imageSize, assumedFov);
      setResult(nextResult);
      setStatus(
        nextResult.pose
          ? `Solved with ${nextResult.pose.usedPoints.length} points and ${formatNumber(
              nextResult.pose.reprojectionErrorPx,
              2,
            )} px average error.`
          : "Scale solved, but phone pose needs more calibrated points.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Calibration solve failed.");
    } finally {
      setBusyAction(undefined);
    }
  }

  async function copyExport() {
    const payload = buildCalibrationExport(landmarks, imageSize, result, detection?.turfPlane);
    const json = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setStatus("Calibration JSON copied to clipboard.");
    } catch {
      downloadJson(json, "kirket-calibration.json");
      setStatus("Clipboard unavailable; calibration JSON downloaded instead.");
    }
  }

  return (
    <main className="app-shell">
      <nav className="stage-nav" aria-label="Application steps">
        <button className={activeStage === "calibrate" ? "active" : ""} onClick={() => setActiveStage("calibrate")}>
          1. Calibrate
        </button>
        <button className={activeStage === "detect" ? "active" : ""} onClick={() => setActiveStage("detect")}>
          2. Detect shot
        </button>
        <button className={activeStage === "simulate" ? "active" : ""} onClick={() => setActiveStage("simulate")}>
          3. Simulate
        </button>
      </nav>

      <details className="install-guide">
        <summary>Install on iPhone / privacy</summary>
        <p>
          Open the deployed HTTPS address in Safari, tap Share, then <strong>Add to Home Screen</strong>.
          Photos and videos are processed locally in your browser and are not uploaded by this app.
        </p>
      </details>

      {activeStage === "calibrate" ? (
        <>
      <section className="hero">
        <div>
          <p className="eyebrow">Kirket calibration step 1</p>
          <h1>Build a measured cricket-net coordinate system from your phone image.</h1>
          <p className="hero-copy">
            Place the 33.5 inch bat flat with one end touching the middle stump, aligned down
            the pitch center line. Mark the stump bases/tops and bat end; the app estimates scale,
            phone position, and calibration quality.
          </p>
        </div>
        <label className="file-button">
          <input
            accept="image/*"
            capture="environment"
            type="file"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
          Open camera / choose setup photo
        </label>
      </section>

      <section className="workspace-grid">
        <div className="image-panel">
          <div className="toolbar">
            <button
              disabled={!imageUrl}
              onClick={() => {
                if (!imageSize) return;
                setLandmarks(defaultLandmarks(imageSize));
                setDetection(undefined);
                setCandidateLines([]);
              }}
            >
              Reset handles
            </button>
            <button disabled={!imageUrl || Boolean(busyAction)} onClick={runDetectSetup}>
              {busyAction === "Detecting setup" ? "Detecting..." : "Auto-detect setup"}
            </button>
            <button disabled={!imageUrl || Boolean(busyAction)} onClick={runRefine}>
              {busyAction === "Refining points" ? "Refining..." : "Refine points"}
            </button>
            <button disabled={!imageUrl || Boolean(busyAction)} className="primary" onClick={runCalibrationSolve}>
              {busyAction === "Solving calibration" ? "Solving..." : "Run calibration"}
            </button>
            <button disabled={!imageUrl} onClick={() => setZoom((value) => Math.min(6, value * 1.35))}>
              Zoom in
            </button>
            <button disabled={!imageUrl} onClick={() => setZoom((value) => Math.max(1, value / 1.35))}>
              Zoom out
            </button>
            <button
              disabled={!imageUrl}
              className={isPanMode ? "active-toggle" : ""}
              onClick={() => setIsPanMode((value) => !value)}
            >
              {isPanMode ? "Pan on" : "Pan off"}
            </button>
            <button
              disabled={!imageUrl}
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              Reset view
            </button>
          </div>

          <div className="image-stage">
            {imageUrl ? (
              <>
                <img
                  ref={imageRef}
                  src={imageUrl}
                  alt="Cricket setup"
                  onLoad={handleImageLoaded}
                  style={{
                    transform: `translate(${pan.x * 100}%, ${pan.y * 100}%) scale(${zoom})`,
                  }}
                />
                {imageSize && (
                  <svg
                    className="overlay"
                    viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                    style={{
                      transform: `translate(${pan.x * 100}%, ${pan.y * 100}%) scale(${zoom})`,
                    }}
                    onPointerDown={handleOverlayPointerDown}
                    onPointerMove={handleOverlayPointerMove}
                    onPointerUp={stopDragging}
                    onPointerCancel={stopDragging}
                  >
                    {showCandidates &&
                      candidateLines.map((line) => (
                        <line
                          key={line.id}
                          x1={line.start.x}
                          y1={line.start.y}
                          x2={line.end.x}
                          y2={line.end.y}
                          stroke={LINE_COLORS[line.classification]}
                          strokeOpacity="0.58"
                          strokeWidth={Math.max(imageSize.width, imageSize.height) * 0.002}
                        />
                      ))}

                    {pitchOverlayLines.map((line) => (
                      <polyline
                        key={line.id}
                        className={`pitch-overlay-line ${line.kind}`}
                        points={line.points.map((point) => `${point.x},${point.y}`).join(" ")}
                      />
                    ))}

                    {pitchOverlayLines.map((line) => {
                      const point = line.points[Math.floor(line.points.length / 2)];
                      if (!point) return null;
                      return (
                        <text key={`${line.id}-label`} x={point.x + 8} y={point.y - 8} className="pitch-label">
                          {line.label}
                        </text>
                      );
                    })}

                    {landmarks.middleStumpBase && landmarks.batTip && (
                      <>
                        <line
                          className="measurement-line"
                          x1={landmarks.middleStumpBase.x}
                          y1={landmarks.middleStumpBase.y}
                          x2={landmarks.batTip.x}
                          y2={landmarks.batTip.y}
                        />
                        <text
                          className="measurement-label"
                          x={(landmarks.middleStumpBase.x + landmarks.batTip.x) / 2 + 10}
                          y={(landmarks.middleStumpBase.y + landmarks.batTip.y) / 2 - 10}
                        >
                          bat 33.5 in
                        </text>
                      </>
                    )}

                    {LANDMARK_ORDER.map((id) => {
                      const point = landmarks[id];
                      if (!point) return null;
                      const active = id === selectedLandmark;
                      const imageExtent = Math.max(imageSize.width, imageSize.height);
                      const markerRadius = imageExtent * (active ? 0.018 : 0.014);
                      const hitRadius = imageExtent * (active ? 0.055 : 0.026);
                      return (
                        <g key={id}>
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r={hitRadius}
                            fill="transparent"
                            className="landmark-hit-area"
                            onPointerDown={(event) => handleHandlePointerDown(event, id)}
                          />
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r={markerRadius}
                            className={active ? "landmark active" : "landmark"}
                            onPointerDown={(event) => handleHandlePointerDown(event, id)}
                          />
                          <text
                            x={point.x + markerRadius * 1.35}
                            y={point.y - markerRadius * 1.1}
                            className="landmark-label"
                            fontSize={imageExtent * 0.025}
                          >
                            {LANDMARK_LABELS[id]}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                )}
              </>
            ) : (
              <div className="empty-state">
                <p>Load one of your net setup photos or capture a fresh calibration frame.</p>
                <p>The first solve works best when all three stumps and the full bat are visible.</p>
              </div>
            )}
          </div>
          <p className="status" role="status" aria-live="polite">{status}</p>
        </div>

        <aside className="control-panel">
          <section className="card">
            <h2>Calibration checklist</h2>
            <ol className="steps">
              <li>Tap <strong>Auto-detect setup</strong> to get stump/bat suggestions.</li>
              <li>Turn on <strong>Pan</strong> and use zoom controls for precise placement.</li>
              <li>Correct all stump bases/tops, especially the middle stump base.</li>
              <li>Bat end touches the middle stump base.</li>
              <li>Correct <strong>turfBackLeft</strong>/<strong>turfBackRight</strong> on the back 13 ft turf edge behind the wicket.</li>
              <li>Bat lies flat and points along the pitch center line.</li>
              <li>Drag creaseLeft/creaseRight onto the crease direction if overlay angle looks off.</li>
              <li>Mark bases and tops of visible stumps as precisely as possible.</li>
              <li>Use refine, then solve. Keep average reprojection error under 2 px.</li>
            </ol>
          </section>

          <section className="card">
            <div className="section-heading">
              <h2>Landmarks</h2>
              <span>{markedPosePoints}/{LANDMARK_ORDER.length}</span>
            </div>
            <div className="landmark-list">
              {LANDMARK_ORDER.map((id) => {
                const point = landmarks[id];
                return (
                  <button
                    key={id}
                    className={id === selectedLandmark ? "landmark-row selected" : "landmark-row"}
                    onClick={() => setSelectedLandmark(id)}
                  >
                    <span>{LANDMARK_LABELS[id]}</span>
                    <small>
                      {point ? `${formatNumber(point.x, 0)}, ${formatNumber(point.y, 0)}` : "not set"}
                    </small>
                  </button>
                );
              })}
            </div>
          </section>

          {detection ? (
            <section className="card">
              <div className="section-heading">
                <h2>Auto-detection</h2>
                <span>{Math.round(detection.confidence * 100)}% confidence</span>
              </div>
              <dl className="detection-stats">
                <div>
                  <dt>Stump columns</dt>
                  <dd>{detection.detectedStumpCount} detected</dd>
                </div>
                <div>
                  <dt>Bat tip</dt>
                  <dd>
                    {detection.detectedBat
                      ? detection.batConfidence === "weak"
                        ? "weak suggestion"
                        : "suggested"
                      : "manual correction needed"}
                  </dd>
                </div>
                <div>
                  <dt>Turf plane</dt>
                  <dd>{detection.turfPlane ? `${Math.round(detection.turfPlane.confidence * 100)}%` : "not found"}</dd>
                </div>
              </dl>
              {detection.warnings.length ? (
                <ul className="warnings">
                  {detection.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : (
                <p className="hint">Suggestions are ready. Drag handles to the exact points before solving.</p>
              )}
            </section>
          ) : null}

          <section className="card">
            <h2>Accuracy controls</h2>
            <label className="range-row">
              Assumed camera FOV
              <strong>{assumedFov} deg</strong>
              <input
                min="55"
                max="85"
                step="1"
                type="range"
                value={assumedFov}
                onChange={(event) => setAssumedFov(Number(event.target.value))}
              />
            </label>
            <label className="toggle-row">
              <input
                checked={showCandidates}
                type="checkbox"
                onChange={(event) => setShowCandidates(event.target.checked)}
              />
              Show detected candidate lines
            </label>
          </section>

          <section className="card results-card">
            <div className="section-heading">
              <h2>Results</h2>
              <span className={`quality ${result?.quality ?? "not-ready"}`}>
                {result?.quality ?? "not-ready"}
              </span>
            </div>

            <dl>
              <div>
                <dt>Bat reference</dt>
                <dd>
                  {scale
                    ? `${formatNumber(scale.batLengthPx, 1)} px = ${BAT_LENGTH_INCHES} in`
                    : "mark middle stump base and bat tip"}
                </dd>
              </div>
              <div>
                <dt>Scale</dt>
                <dd>{scale ? `${formatNumber(scale.pixelsPerInch, 2)} px / in` : "not ready"}</dd>
              </div>
              <div>
                <dt>Pose points</dt>
                <dd>
                  {markedPosePoints} marked, {MIN_POSE_POINTS}+ needed
                </dd>
              </div>
              <div>
                <dt>Phone position</dt>
                <dd>
                  {result?.pose
                    ? `x ${formatNumber(result.pose.cameraPositionWorldInches.x)} in, y ${formatNumber(
                        result.pose.cameraPositionWorldInches.y,
                      )} in, height ${formatNumber(result.pose.cameraHeightInches)} in`
                    : "not solved"}
                </dd>
              </div>
              <div>
                <dt>Reprojection error</dt>
                <dd>
                  {result?.pose
                    ? `${formatNumber(result.pose.reprojectionErrorPx, 2)} px avg / ${formatNumber(
                        result.pose.maxReprojectionErrorPx,
                        2,
                      )} px max`
                    : "not solved"}
                </dd>
              </div>
            </dl>

            {result?.warnings.length ? (
              <ul className="warnings">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}

            <button disabled={!imageSize} onClick={copyExport}>
              Copy calibration JSON
            </button>
          </section>
        </aside>
      </section>

        </>
      ) : null}

      {activeStage === "detect" ? (
      <ShotDetectionPanel
        landmarks={landmarks}
        calibrationImageSize={imageSize}
        turfPlane={detection?.turfPlane}
        pose={result?.pose}
        onShotDetected={(shot) => {
          setDetectedShot(shot);
          setActiveStage("simulate");
        }}
      />
      ) : null}

      {activeStage === "simulate" ? (
      <VirtualGround
        ground={selectedGround}
        field={selectedField}
        detectedShot={detectedShot}
        onGroundChange={setSelectedGroundId}
        onFieldChange={setSelectedFieldId}
      />
      ) : null}
    </main>
  );
}

export default App;

function downloadJson(json: string, filename: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
