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
import { clearSession, loadSession, parseSession, saveSession } from "./calibration/session";
import { validateCalibrationReadiness } from "./calibration/validation";
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
  const restoredSession = useRef(loadSession()).current;
  const imageRef = useRef<HTMLImageElement | null>(null);
  const calibrationSvgRef = useRef<SVGSVGElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string>();
  const [imageSize, setImageSize] = useState<ImageSize | undefined>(restoredSession?.imageSize);
  const [landmarks, setLandmarks] = useState<LandmarkMap>(restoredSession?.landmarks ?? {});
  const [selectedLandmark, setSelectedLandmark] = useState<LandmarkId>("middleStumpBase");
  const [draggingLandmark, setDraggingLandmark] = useState<LandmarkId | undefined>();
  const [candidateLines, setCandidateLines] = useState<CandidateLine[]>([]);
  const [detection, setDetection] = useState<SetupDetectionResult | undefined>(
    restoredSession?.turfPlane
      ? {
          landmarks: restoredSession.landmarks,
          candidateLines: [],
          turfPlane: restoredSession.turfPlane,
          confidence: restoredSession.turfPlane.confidence,
          detectedStumpCount: availablePoseLandmarks(restoredSession.landmarks).length >= 6 ? 3 : 0,
          detectedBat: Boolean(restoredSession.landmarks.batTip),
          warnings: [],
        }
      : undefined,
  );
  const [result, setResult] = useState<CalibrationResult | undefined>(restoredSession?.result);
  const [status, setStatus] = useState(
    restoredSession ? "Saved calibration restored. Upload the matching image only if you want to adjust markers." : "Load a camera photo to begin.",
  );
  const [assumedFov, setAssumedFov] = useState(restoredSession?.assumedFov ?? DEFAULT_CAMERA_FOV_DEGREES);
  const [showCandidates, setShowCandidates] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [isPanMode, setIsPanMode] = useState(false);
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 });
  const [panningFrom, setPanningFrom] = useState<Point2D | undefined>();
  const [selectedGroundId, setSelectedGroundId] = useState(restoredSession?.groundId ?? GROUND_PRESETS[3].id);
  const [selectedFieldId, setSelectedFieldId] = useState(restoredSession?.fieldId ?? FIELD_PRESETS[3].id);
  const [detectedShot, setDetectedShot] = useState<ShotInput>();
  const [activeStage, setActiveStage] = useState<"calibrate" | "detect" | "simulate">("calibrate");
  const [busyAction, setBusyAction] = useState<string>();
  const [dragMode, setDragMode] = useState(false);
  const [workspaceMargin, setWorkspaceMargin] = useState(0.3);

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
  const readiness = useMemo(
    () => validateCalibrationReadiness(landmarks, imageSize, detection?.turfPlane, result),
    [detection?.turfPlane, imageSize, landmarks, result],
  );
  const calibrationViewport = useMemo(() => {
    if (!imageSize) return undefined;
    const marginX = imageSize.width * workspaceMargin;
    const marginY = imageSize.height * workspaceMargin;
    const baseWidth = imageSize.width + marginX * 2;
    const baseHeight = imageSize.height + marginY * 2;
    const width = baseWidth / zoom;
    const height = baseHeight / zoom;
    return {
      bounds: {
        minX: -marginX,
        minY: -marginY,
        maxX: imageSize.width + marginX,
        maxY: imageSize.height + marginY,
      },
      x: -marginX + (baseWidth - width) / 2 + pan.x,
      y: -marginY + (baseHeight - height) / 2 + pan.y,
      width,
      height,
    };
  }, [imageSize, pan.x, pan.y, workspaceMargin, zoom]);

  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  useEffect(() => {
    if (Object.keys(landmarks).length === 0) return;
    const timeout = window.setTimeout(() => {
      saveSession({
        version: 2,
        savedAt: new Date().toISOString(),
        imageSize,
        landmarks,
        turfPlane: detection?.turfPlane,
        result,
        assumedFov,
        groundId: selectedGroundId,
        fieldId: selectedFieldId,
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [assumedFov, detection?.turfPlane, imageSize, landmarks, result, selectedFieldId, selectedGroundId]);

  function handleFile(file: File | undefined) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImageUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return url;
    });
    setCandidateLines([]);
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
    const matchesSavedImage =
      imageSize?.width === nextSize.width &&
      imageSize?.height === nextSize.height &&
      Object.keys(landmarks).length > 0;
    if (!matchesSavedImage) {
      setLandmarks(defaultLandmarks(nextSize));
      setDetection(undefined);
      setResult(undefined);
    }
  }

  function updateLandmark(id: LandmarkId, point: Point2D) {
    setLandmarks((current) => ({
      ...current,
      [id]: point,
    }));
    setResult(undefined);
  }

  function imagePointFromClient(clientX: number, clientY: number): Point2D | undefined {
    const svg = calibrationSvgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return undefined;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  function handleOverlayPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (panningFrom) {
      const svg = calibrationSvgRef.current;
      if (!svg || !calibrationViewport) return;
      const rect = svg.getBoundingClientRect();
      const dx = ((event.clientX - panningFrom.x) / rect.width) * calibrationViewport.width;
      const dy = ((event.clientY - panningFrom.y) / rect.height) * calibrationViewport.height;
      setPan((current) => ({
        x: current.x - dx,
        y: current.y - dy,
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
    if (!dragMode) return;
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
    const payload = buildCalibrationExport(
      landmarks,
      imageSize,
      result,
      detection?.turfPlane,
      assumedFov,
      selectedGroundId,
      selectedFieldId,
    );
    const json = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setStatus("Calibration JSON copied to clipboard.");
    } catch {
      downloadJson(json, "kirket-calibration.json");
      setStatus("Clipboard unavailable; calibration JSON downloaded instead.");
    }
  }

  async function importCalibration(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = parseSession(await file.text());
      if (!parsed) throw new Error("This is not a compatible Kirket calibration file.");
      setImageSize(parsed.imageSize);
      setLandmarks(parsed.landmarks);
      setDetection(
        parsed.turfPlane
          ? {
              landmarks: parsed.landmarks,
              candidateLines: [],
              turfPlane: parsed.turfPlane,
              confidence: parsed.turfPlane.confidence,
              detectedStumpCount: availablePoseLandmarks(parsed.landmarks).length >= 6 ? 3 : 0,
              detectedBat: Boolean(parsed.landmarks.batTip),
              warnings: [],
            }
          : undefined,
      );
      setResult(parsed.result);
      setAssumedFov(parsed.assumedFov);
      setSelectedGroundId(parsed.groundId);
      setSelectedFieldId(parsed.fieldId);
      setStatus("Calibration imported and saved on this device.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Calibration import failed.");
    }
  }

  function resetSavedCalibration() {
    clearSession();
    setImageSize(undefined);
    setLandmarks({});
    setDetection(undefined);
    setResult(undefined);
    setImageUrl(undefined);
    setStatus("Saved calibration cleared. Load a setup image to begin again.");
  }

  function nudgeSelectedLandmark(deltaX: number, deltaY: number) {
    const point = landmarks[selectedLandmark];
    if (!point || !calibrationViewport) return;
    updateLandmark(selectedLandmark, {
      x: Math.min(Math.max(point.x + deltaX, calibrationViewport.bounds.minX), calibrationViewport.bounds.maxX),
      y: Math.min(Math.max(point.y + deltaY, calibrationViewport.bounds.minY), calibrationViewport.bounds.maxY),
    });
  }

  return (
    <main className="app-shell">
      <nav className="stage-nav" aria-label="Application steps">
        <button className={activeStage === "calibrate" ? "active" : ""} onClick={() => setActiveStage("calibrate")}>
          1. Calibrate
        </button>
        <button
          className={activeStage === "detect" ? "active" : ""}
          disabled={!readiness.readyForShotDetection}
          title={readiness.readyForShotDetection ? "Open shot detection" : "Resolve calibration errors first"}
          onClick={() => setActiveStage("detect")}
        >
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
        <div className="hero-actions">
          <input
            ref={cameraInputRef}
            accept="image/*"
            capture="environment"
            type="file"
            className="visually-hidden-input"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
          <input
            ref={uploadInputRef}
            accept="image/*"
            type="file"
            className="visually-hidden-input"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
          <button className="hero-action primary-hero-action" onClick={() => cameraInputRef.current?.click()}>
            Take setup photo
          </button>
          <button className="hero-action secondary-hero-action" onClick={() => uploadInputRef.current?.click()}>
            Upload image
          </button>
        </div>
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
              className={dragMode ? "active-toggle" : ""}
              onClick={() => setDragMode((value) => !value)}
            >
              {dragMode ? "Drag on" : "Tap mode"}
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
            <label className="workspace-margin-control">
              Off-frame space
              <select
                value={workspaceMargin}
                onChange={(event) => {
                  setWorkspaceMargin(Number(event.target.value));
                  setPan({ x: 0, y: 0 });
                }}
              >
                <option value="0">None</option>
                <option value="0.15">15%</option>
                <option value="0.3">30%</option>
                <option value="0.5">50%</option>
                <option value="0.75">75%</option>
              </select>
            </label>
          </div>

          <div className="image-stage">
            {imageUrl ? (
              <>
                <img
                  ref={imageRef}
                  src={imageUrl}
                  alt="Cricket setup"
                  onLoad={handleImageLoaded}
                  className="processing-source-image"
                />
                {imageSize && calibrationViewport && (
                  <svg
                    ref={calibrationSvgRef}
                    className="overlay"
                    viewBox={`${calibrationViewport.x} ${calibrationViewport.y} ${calibrationViewport.width} ${calibrationViewport.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    onPointerDown={handleOverlayPointerDown}
                    onPointerMove={handleOverlayPointerMove}
                    onPointerUp={stopDragging}
                    onPointerCancel={stopDragging}
                  >
                    <rect
                      x={calibrationViewport.bounds.minX}
                      y={calibrationViewport.bounds.minY}
                      width={calibrationViewport.bounds.maxX - calibrationViewport.bounds.minX}
                      height={calibrationViewport.bounds.maxY - calibrationViewport.bounds.minY}
                      className="calibration-workspace-background"
                    />
                    <image
                      href={imageUrl}
                      x="0"
                      y="0"
                      width={imageSize.width}
                      height={imageSize.height}
                      preserveAspectRatio="none"
                    />
                    <rect
                      x="0"
                      y="0"
                      width={imageSize.width}
                      height={imageSize.height}
                      className="image-frame-outline"
                    />
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
                      const markerRadius = (imageExtent * (active ? 0.008 : 0.006)) / zoom;
                      const hitRadius = (imageExtent * 0.016) / zoom;
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
                            fontSize={(imageExtent * 0.015) / zoom}
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
              <li>Use <strong>Tap mode</strong>: select a marker, tap the image to place it, then use nudge arrows for exact adjustment.</li>
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
            <div className="nudge-pad" aria-label="Selected marker fine adjustment">
              <button onClick={() => nudgeSelectedLandmark(0, -5)}>Up 5</button>
              <button onClick={() => nudgeSelectedLandmark(-5, 0)}>Left 5</button>
              <button onClick={() => nudgeSelectedLandmark(5, 0)}>Right 5</button>
              <button onClick={() => nudgeSelectedLandmark(0, 5)}>Down 5</button>
              <button onClick={() => nudgeSelectedLandmark(0, -1)}>Up 1</button>
              <button onClick={() => nudgeSelectedLandmark(-1, 0)}>Left 1</button>
              <button onClick={() => nudgeSelectedLandmark(1, 0)}>Right 1</button>
              <button onClick={() => nudgeSelectedLandmark(0, 1)}>Down 1</button>
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

          <section className="card readiness-card">
            <div className="section-heading">
              <h2>Calibration readiness</h2>
              <span className={`readiness-score ${readiness.readyForShotDetection ? "ready" : ""}`}>
                {readiness.score}/100
              </span>
            </div>
            <p className="hint">
              {readiness.readyForShotDetection
                ? "Ready for controlled shot detection."
                : "Resolve the errors below before measuring shots."}
            </p>
            {readiness.issues.length ? (
              <ul className="readiness-issues">
                {readiness.issues.map((item) => (
                  <li key={item.id} className={item.severity}>{item.message}</li>
                ))}
              </ul>
            ) : (
              <p className="readiness-ok">All geometry checks passed.</p>
            )}
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

            <div className="calibration-file-actions">
              <button disabled={!imageSize} onClick={copyExport}>Export calibration</button>
              <label className="file-button compact">
                <input accept="application/json,.json" type="file" onChange={(event) => importCalibration(event.target.files?.[0])} />
                Import calibration
              </label>
              <button onClick={resetSavedCalibration}>Clear saved calibration</button>
            </div>
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
        onShotDetected={setDetectedShot}
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
