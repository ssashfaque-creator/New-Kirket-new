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
- Provides an expanded 0–75% off-frame calibration workspace so inferred turf
  corners and perspective lines can be placed outside the captured image.
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
- Provides a virtual cricket ground environment:
  - 10 selectable boundary-size presets from compact practice grounds to large
    oval-style grounds
  - field presets for pace, spin, T20 defensive, ODI balanced, Test ring, and
    leg-side trap setups
  - visual boundary, pitch, range rings, and fielder map
  - visible ground metrics for straight/square boundary and approximate area
- Provides shot simulation logic before video shot detection exists:
  - manual shot controls for type, direction, ball speed, launch angle, and
    contact quality
  - airborne flight, bounce, roll, and slowdown model
  - fielder reaction, movement, catching, ground interception, and run estimate
  - boundary result decisions for four/six and fielded/caught outcomes
  - trajectory, landing, boundary, and interception markers on the virtual
    ground
- Provides an initial high-frame-rate shot detector for the yellow dimpled
  practice ball:
  - upload iPhone 16 Pro 4K/120 or 1080p/240 slow-motion video
  - sample the actual dusty/worn ball color from a frame
  - adaptive color + motion + circularity + temporal prediction tracking
  - short-occlusion recovery, impact detection, and bounce detection
  - calibrated direction/speed/launch estimates sent directly to the simulator
  - 3D ball-size estimation when camera pose is reliable, with turf-homography
    fallback and explicit confidence warnings
  - manual frame-by-frame ball keyframes when automatic tracking is unreliable
  - actionable failure diagnostics for missing frames, occlusion, impact, and
    calibration problems
  - optional lazy-loaded TensorFlow COCO-SSD assistance for locating a generic
    sports ball on the selected contact frame
  - automatic bidirectional frame pulling before/after contact
  - appearance-template reacquisition when dust, blur, or lighting defeats the
    yellow color mask
- Adds reliability and continuity features:
  - automatic on-device calibration session persistence
  - JSON calibration import/export and recovery
  - geometry readiness score that blocks shot detection on invalid markers
  - tracker association that combines confidence, predicted position, and
    radius continuity
  - long-occlusion penalties in measurement confidence
- Adds simulation uncertainty and environmental controls:
  - dry/standard/damp surfaces, outfield speed, wind, and fielder skill
  - 160-run Monte Carlo distribution with expected runs and outcome
    probabilities instead of one deterministic result

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
8. Select a virtual ground and field preset to define the match environment.
9. Use the shot simulator controls to test how a future detected shot would
   travel, interact with fielders, and produce a result.
10. Upload a slow-motion video, sample the yellow ball, process the shot, and
    send the measured parameters into the simulator.

See [`docs/SHOT_DETECTION.md`](docs/SHOT_DETECTION.md) for the recommended
iPhone 16 Pro capture protocol and detector limitations.

See [`docs/CUSTOM_BALL_MODEL.md`](docs/CUSTOM_BALL_MODEL.md) for the labeled
dataset and custom YOLO/ONNX path needed to move beyond generic sports-ball AI.

See [`docs/INSTALL_IPHONE.md`](docs/INSTALL_IPHONE.md) for HTTPS deployment,
Add-to-Home-Screen installation, privacy, and the first field-test checklist.

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
