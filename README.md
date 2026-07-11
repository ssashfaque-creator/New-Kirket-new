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
  - left/right ends of the 13 ft back turf edge behind the wicket
  - optional crease reference points
- Provides zoom, pan, and upload/camera input so markers can be adjusted
  accurately on phone photos.
- Uses OpenCV.js in the browser to detect candidate lines and refine landmark
  clicks to nearby high-contrast corners.
- Includes a setup-specific auto-detect pass for the supplied net photos:
  - segments pale wood colours from stumps/bat while ignoring most black net
    lines
  - groups fragmented stump pixels vertically when the net cuts through them
  - proposes bat tip only when the wooden component touches the middle-stump
    base
  - can make a low-confidence side-angle bat suggestion from a horizontal
    turf-level blade when the contact point is hidden by the net
  - uses the detected green turf plane to reject bat-like objects outside the
    lane, including side bats lying on the concrete
  - can infer a weak bat suggestion from the middle stump along the turf/pitch
    direction when the bat is barely visible
  - reports low confidence/warnings instead of guessing on unsuitable frames
- Uses the 33.5 inch bat as the physical scale reference.
- Uses stump height/width plus the bat reference in `solvePnP` to estimate phone
  position relative to the middle stump.
- Projects real cricket pitch geometry back onto the camera image. When the turf
  plane is detected, the overlay uses the 13 ft turf/net width plus the bat
  calibration so pitch edges and crease lines follow the turf perspective. It
  falls back to camera pose projection when no turf plane is available.
- The overlay angle can be corrected manually: dragging `creaseLeft` and
  `creaseRight` now defines the crease direction, while the app still uses the
  turf homography and known dimensions for scale/perspective.
- The turf perspective can be corrected manually: dragging `turfBackLeft` and
  `turfBackRight` defines the 13 ft back edge behind the wicket.
- Reports average and maximum reprojection error so inaccurate calibrations are
  visible immediately.
- Exports calibration JSON for future game-simulation steps.

## Accuracy notes

This first slice is intentionally assisted instead of pretending every image can
be solved blindly. The supplied setup has strong net and strap lines that can
overwhelm generic edge detectors, so the app first suggests points from
setup-specific turf/wood/geometry detection, then requires manual confirmation.
A single phone image plus one known bat length can establish scale, but an
accurate phone pose also needs enough known 3D scene points. The app therefore
combines:

1. Known cricket dimensions: 33.5 inch bat, 28 inch stumps, 9 inch wicket width.
2. Known setup dimensions: 13 ft turf/net width.
3. User-confirmed landmark positions.
4. Sub-pixel OpenCV refinement.
5. Reprojection-error checks.

For best results, keep the bat flat on the pitch with one end touching the
middle stump and aligned down the pitch center line. Recalibrate if the phone
moves.

Recommended workflow:

1. Load/capture a setup photo.
2. Tap **Auto-detect setup**.
3. Zoom in and use **Pan on** while positioning markers.
4. Correct stump tops/bases and the bat tip.
5. Correct `turfBackLeft` / `turfBackRight` on the back 13 ft turf edge.
6. Correct `creaseLeft` / `creaseRight` if the overlay angle needs adjustment.
7. Run calibration and inspect the dimension labels.

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
