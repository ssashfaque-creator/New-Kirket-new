import { useEffect, useMemo, useState } from "react";
import {
  defaultShotInput,
  shotTypeDefaults,
  simulateShot,
  type ShotInput,
  type ShotType,
  type TrajectoryPoint,
} from "./shotSimulation";
import {
  FIELD_PRESETS,
  GROUND_PRESETS,
  PITCH_LENGTH_M,
  STRIKER_TO_GROUND_CENTER_M,
  fielderCoordinates,
} from "./virtualGround";
import type { FieldPreset, FieldingPosition, GroundPreset } from "./virtualGround";

type VirtualGroundProps = {
  ground: GroundPreset;
  field: FieldPreset;
  detectedShot?: ShotInput;
  onGroundChange: (groundId: string) => void;
  onFieldChange: (fieldId: string) => void;
};

const VIEW_SIZE = 720;
const CENTER = VIEW_SIZE / 2;
const METERS_TO_PIXELS = 3.6;
const PITCH_WIDTH_M = 3.05;
const BOWLING_CREASE_HALF_WIDTH_M = 1.32;
const POPPING_CREASE_DISTANCE_M = 1.22;
const STRIKER_Y = CENTER + STRIKER_TO_GROUND_CENTER_M * METERS_TO_PIXELS;

export function VirtualGround({
  ground,
  field,
  detectedShot,
  onGroundChange,
  onFieldChange,
}: VirtualGroundProps) {
  const [shot, setShot] = useState<ShotInput>(defaultShotInput());
  const boundaryPoints = buildBoundaryPoints(ground);
  const maxBoundary = Math.max(ground.squareBoundaryM, ground.straightBoundaryM);
  const areaM2 = Math.PI * ground.squareBoundaryM * ground.straightBoundaryM;
  const simulation = useMemo(() => simulateShot(shot, ground, field), [field, ground, shot]);
  const trajectoryPoints = simulation.trajectory.map(trajectoryPointToSvg).join(" ");

  useEffect(() => {
    if (detectedShot) setShot(detectedShot);
  }, [detectedShot]);

  return (
    <section className="virtual-ground card">
      <div className="section-heading">
        <div>
          <h2>Virtual cricket ground</h2>
          <p className="panel-subtitle">Pick ground size and field. This becomes the match environment for future shot simulation.</p>
        </div>
      </div>

      <div className="ground-controls">
        <label>
          Ground size
          <select value={ground.id} onChange={(event) => onGroundChange(event.target.value)}>
            {GROUND_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Field preset
          <select value={field.id} onChange={(event) => onFieldChange(event.target.value)}>
            {FIELD_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="shot-controls">
        <label>
          Shot type
          <select
            value={shot.shotType}
            onChange={(event) => {
              const shotType = event.target.value as ShotType;
              setShot((current) => ({ ...current, shotType, ...shotTypeDefaults(shotType) }));
            }}
          >
            <option value="drive">Drive</option>
            <option value="lofted">Lofted</option>
            <option value="pull">Pull</option>
            <option value="cut">Cut</option>
            <option value="defensive">Defensive</option>
          </select>
        </label>

        <label>
          Direction
          <strong>{Math.round(shot.angleDegrees)} deg</strong>
          <input
            min="0"
            max="359"
            type="range"
            value={shot.angleDegrees}
            onChange={(event) => setShot((current) => ({ ...current, angleDegrees: Number(event.target.value) }))}
          />
        </label>

        <label>
          Ball speed
          <strong>{Math.round(shot.speedMps * 3.6)} km/h</strong>
          <input
            min="5"
            max="60"
            step="1"
            type="range"
            value={shot.speedMps}
            onChange={(event) => setShot((current) => ({ ...current, speedMps: Number(event.target.value) }))}
          />
        </label>

        <label>
          Launch
          <strong>{Math.round(shot.launchAngleDegrees)} deg</strong>
          <input
            min="-2"
            max="50"
            step="1"
            type="range"
            value={shot.launchAngleDegrees}
            onChange={(event) => setShot((current) => ({ ...current, launchAngleDegrees: Number(event.target.value) }))}
          />
        </label>

        <label>
          Contact quality
          <strong>{Math.round(shot.quality * 100)}%</strong>
          <input
            min="0.1"
            max="1"
            step="0.05"
            type="range"
            value={shot.quality}
            onChange={(event) => setShot((current) => ({ ...current, quality: Number(event.target.value) }))}
          />
        </label>
      </div>

      <div className="ground-stage">
        <svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} role="img" aria-label="Virtual cricket ground">
          <defs>
            <radialGradient id="groundGrass" cx="50%" cy="48%" r="62%">
              <stop offset="0%" stopColor="#3fba5b" />
              <stop offset="72%" stopColor="#16803d" />
              <stop offset="100%" stopColor="#0f5f31" />
            </radialGradient>
          </defs>

          <polygon points={boundaryPoints} className="ground-boundary-fill" />
          <polygon points={boundaryPoints} className="ground-boundary-line" />

          {rangeRings(maxBoundary).map((radius) => (
            <ellipse
              key={radius}
              cx={CENTER}
              cy={STRIKER_Y}
              rx={radius * METERS_TO_PIXELS}
              ry={radius * METERS_TO_PIXELS}
              className="ground-range-ring"
            />
          ))}

          <g className="ground-pitch" transform={`translate(${CENTER}, ${CENTER})`}>
            <rect
              x={-(PITCH_WIDTH_M * METERS_TO_PIXELS) / 2}
              y={-(PITCH_LENGTH_M * METERS_TO_PIXELS) / 2}
              width={PITCH_WIDTH_M * METERS_TO_PIXELS}
              height={PITCH_LENGTH_M * METERS_TO_PIXELS}
              rx="3"
            />
            <line
              x1={-BOWLING_CREASE_HALF_WIDTH_M * METERS_TO_PIXELS}
              x2={BOWLING_CREASE_HALF_WIDTH_M * METERS_TO_PIXELS}
              y1={(PITCH_LENGTH_M * METERS_TO_PIXELS) / 2 - POPPING_CREASE_DISTANCE_M * METERS_TO_PIXELS}
              y2={(PITCH_LENGTH_M * METERS_TO_PIXELS) / 2 - POPPING_CREASE_DISTANCE_M * METERS_TO_PIXELS}
              className="ground-crease"
            />
            <line
              x1={-BOWLING_CREASE_HALF_WIDTH_M * METERS_TO_PIXELS}
              x2={BOWLING_CREASE_HALF_WIDTH_M * METERS_TO_PIXELS}
              y1={-(PITCH_LENGTH_M * METERS_TO_PIXELS) / 2 + POPPING_CREASE_DISTANCE_M * METERS_TO_PIXELS}
              y2={-(PITCH_LENGTH_M * METERS_TO_PIXELS) / 2 + POPPING_CREASE_DISTANCE_M * METERS_TO_PIXELS}
              className="ground-crease"
            />
            <circle cx="0" cy={(PITCH_LENGTH_M * METERS_TO_PIXELS) / 2} r="4" className="striker-dot" />
          </g>

          {field.positions.map((position) => (
            <Fielder key={position.id} position={position} ground={ground} />
          ))}

          <polyline points={trajectoryPoints} className={`shot-trajectory ${simulation.kind}`} />

          {simulation.landingPoint ? (
            <circle
              cx={trajectoryPointToSvgPoint(simulation.landingPoint).x}
              cy={trajectoryPointToSvgPoint(simulation.landingPoint).y}
              r="7"
              className="shot-landing"
            />
          ) : null}

          {simulation.boundaryPoint ? (
            <circle
              cx={trajectoryPointToSvgPoint(simulation.boundaryPoint).x}
              cy={trajectoryPointToSvgPoint(simulation.boundaryPoint).y}
              r="9"
              className="shot-boundary"
            />
          ) : null}

          {simulation.bestFielder ? (
            <circle
              cx={metersToSvgPoint(simulation.bestFielder.xM, simulation.bestFielder.yM).x}
              cy={metersToSvgPoint(simulation.bestFielder.xM, simulation.bestFielder.yM).y}
              r="11"
              className="shot-intercept"
            />
          ) : null}
        </svg>
      </div>

      <div className={`simulation-result ${simulation.kind}`}>
        <strong>{simulation.runs} run{simulation.runs === 1 ? "" : "s"} - {simulation.kind.toUpperCase()}</strong>
        <span>{simulation.description}</span>
      </div>

      <dl className="ground-stats">
        <div>
          <dt>Straight boundary</dt>
          <dd>{ground.straightBoundaryM} m</dd>
        </div>
        <div>
          <dt>Square boundary</dt>
          <dd>{ground.squareBoundaryM} m</dd>
        </div>
        <div>
          <dt>Approx. area</dt>
          <dd>{Math.round(areaM2).toLocaleString()} m²</dd>
        </div>
        <div>
          <dt>Field mode</dt>
          <dd>{field.aggression} / {field.bowlingStyle}</dd>
        </div>
        <div>
          <dt>Best fielder</dt>
          <dd>{simulation.bestFielder ? simulation.bestFielder.label : "none"}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{Math.round(simulation.confidence * 100)}%</dd>
        </div>
      </dl>

      <p className="hint">{ground.description} {field.description}</p>
    </section>
  );
}

function Fielder({ position, ground }: { position: FieldingPosition; ground: GroundPreset }) {
  const coordinates = fielderCoordinates(position, ground);
  const point = metersToSvgPoint(coordinates.xM, coordinates.yM);

  return (
    <g className={position.catching ? "fielder catching" : "fielder"}>
      <circle cx={point.x} cy={point.y} r="9" />
      <text x={point.x + 12} y={point.y + 4}>
        {position.label}
      </text>
    </g>
  );
}

function buildBoundaryPoints(ground: GroundPreset): string {
  const points: string[] = [];
  for (let angle = 0; angle < 360; angle += 4) {
    const radians = (angle * Math.PI) / 180;
    const x = CENTER + Math.sin(radians) * ground.squareBoundaryM * METERS_TO_PIXELS;
    const y = CENTER - Math.cos(radians) * ground.straightBoundaryM * METERS_TO_PIXELS;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}

function trajectoryPointToSvg(point: TrajectoryPoint): string {
  const svgPoint = trajectoryPointToSvgPoint(point);
  return `${svgPoint.x.toFixed(1)},${svgPoint.y.toFixed(1)}`;
}

function trajectoryPointToSvgPoint(point: TrajectoryPoint) {
  return metersToSvgPoint(point.xM, point.yM);
}

function metersToSvgPoint(xM: number, yM: number) {
  return {
    x: CENTER + xM * METERS_TO_PIXELS,
    y: STRIKER_Y - yM * METERS_TO_PIXELS,
  };
}

function rangeRings(maxBoundary: number) {
  return [30, 50, 70].filter((radius) => radius < maxBoundary);
}
