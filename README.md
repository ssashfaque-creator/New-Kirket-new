# Kirket calibration prototype

This repository now contains the first step of a phone-first cricket-net app: a
calibration workflow that turns one setup image into a measured coordinate
system.

## What it does

- Opens a phone camera frame or existing setup photo.
- Seeds draggable landmarks for:
  - middle stump base / bat toe
  - middle stump top
  - off and leg stump bases/tops
  - far end of the 33.5 inch calibration bat
  - optional crease reference points
- Uses OpenCV.js in the browser to detect candidate lines and refine landmark
  clicks to nearby high-contrast corners.
- Uses the 33.5 inch bat as the physical scale reference.
- Uses stump height/width plus the bat reference in `solvePnP` to estimate phone
  position relative to the middle stump.
- Reports average and maximum reprojection error so inaccurate calibrations are
  visible immediately.
- Exports calibration JSON for future game-simulation steps.

## Accuracy notes

This first slice is intentionally assisted instead of fully automatic. A single
phone image plus one known bat length can establish scale, but an accurate phone
pose also needs enough known 3D scene points. The app therefore combines:

1. Known cricket dimensions: 33.5 inch bat, 28 inch stumps, 9 inch wicket width.
2. User-confirmed landmark positions.
3. Sub-pixel OpenCV refinement.
4. Reprojection-error checks.

For best results, keep the bat flat on the pitch with one end touching the
middle stump and aligned down the pitch center line. Recalibrate if the phone
moves.

## Run locally

```bash
npm install
npm run dev
```

## Validate

```bash
npm test
npm run build
```
