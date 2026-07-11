import { useMemo, useRef, useState } from "react";
import {
  BAT_LENGTH_INCHES,
  DEFAULT_CAMERA_FOV_DEGREES,
  LANDMARK_LABELS,
  LANDMARK_ORDER,
  MIN_POSE_POINTS,
} from "./calibration/constants";
import { defaultLandmarks, detectSetupLandmarks, type SetupDetectionResult } from "./calibration/autoDetect";
import { buildCalibrationExport } from "./calibration/exportCalibration";
import { calculateBatScale, formatNumber } from "./calibration/geometry";
import { loadOpenCv, refineLandmarksSubPixel } from "./calibration/opencv";
import { solveCalibration } from "./calibration/pose";
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

  const scale = useMemo(() => calculateBatScale(landmarks), [landmarks]);
  const markedPosePoints = LANDMARK_ORDER.filter((id) => landmarks[id]).length;

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
    setDetection(undefined);
    setResult(undefined);
  }

  function imagePointFromClient(clientX: number, clientY: number): Point2D | undefined {
    const image = imageRef.current;
    if (!image || !imageSize) return undefined;
    const rect = image.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * imageSize.width,
      y: ((clientY - rect.top) / rect.height) * imageSize.height,
    };
  }

  function handleOverlayPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!draggingLandmark) return;
    const point = imagePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    updateLandmark(draggingLandmark, point);
  }

  function handleOverlayPointerDown(event: React.PointerEvent<SVGSVGElement>) {
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
  }

  async function runDetectSetup() {
    const image = imageRef.current;
    if (!image) return;
    setStatus("Detecting wooden stumps and bat from this net setup...");
    const nextDetection = detectSetupLandmarks(image);
    setDetection(nextDetection);
    setCandidateLines(nextDetection.candidateLines);
    setLandmarks((current) => ({
      ...current,
      ...nextDetection.landmarks,
    }));
    setShowCandidates(true);
    setStatus(
      nextDetection.detectedStumpCount >= 2
        ? `Auto-detected ${nextDetection.detectedStumpCount} stump columns${
            nextDetection.detectedBat ? " and the bat tip" : ""
          }. Correct every handle before calibration.`
        : "Auto-detection could not lock onto the wicket; use the manual handles.",
    );
  }

  async function runRefine() {
    const image = imageRef.current;
    if (!image) return;
    setStatus("Refining marked points to nearby high-contrast corners...");
    const cv = await loadOpenCv();
    setLandmarks((current) => refineLandmarksSubPixel(cv, image, current));
    setResult(undefined);
    setStatus("Sub-pixel refinement complete. Check every handle before solving.");
  }

  async function runCalibrationSolve() {
    if (!imageSize) return;
    setStatus("Solving scale and phone pose...");
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
  }

  async function copyExport() {
    const payload = buildCalibrationExport(landmarks, imageSize, result);
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setStatus("Calibration JSON copied to clipboard.");
  }

  return (
    <main className="app-shell">
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
            <button disabled={!imageUrl} onClick={runDetectSetup}>
              Auto-detect setup
            </button>
            <button disabled={!imageUrl} onClick={runRefine}>
              Refine points
            </button>
            <button disabled={!imageUrl} className="primary" onClick={runCalibrationSolve}>
              Run calibration
            </button>
          </div>

          <div className="image-stage">
            {imageUrl ? (
              <>
                <img ref={imageRef} src={imageUrl} alt="Cricket setup" onLoad={handleImageLoaded} />
                {imageSize && (
                  <svg
                    className="overlay"
                    viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
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

                    {landmarks.middleStumpBase && landmarks.batTip && (
                      <line
                        className="measurement-line"
                        x1={landmarks.middleStumpBase.x}
                        y1={landmarks.middleStumpBase.y}
                        x2={landmarks.batTip.x}
                        y2={landmarks.batTip.y}
                      />
                    )}

                    {LANDMARK_ORDER.map((id) => {
                      const point = landmarks[id];
                      if (!point) return null;
                      const active = id === selectedLandmark;
                      return (
                        <g key={id}>
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r={active ? 14 : 10}
                            className={active ? "landmark active" : "landmark"}
                            onPointerDown={(event) => handleHandlePointerDown(event, id)}
                          />
                          <text x={point.x + 16} y={point.y - 12} className="landmark-label">
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
          <p className="status">{status}</p>
        </div>

        <aside className="control-panel">
          <section className="card">
            <h2>Calibration checklist</h2>
            <ol className="steps">
              <li>Tap <strong>Auto-detect setup</strong> to get stump/bat suggestions.</li>
              <li>Manually drag every handle onto the exact visible point.</li>
              <li>Bat end touches the middle stump base.</li>
              <li>Bat lies flat and points along the pitch center line.</li>
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
                  <dd>{detection.detectedBat ? "suggested" : "manual correction needed"}</dd>
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
    </main>
  );
}

export default App;
