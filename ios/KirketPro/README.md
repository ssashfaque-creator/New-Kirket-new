# Kirket Pro native iOS measurement engine

This native target replaces browser-based calibration/capture for measurements.
The existing web PWA remains useful for reviewing results and simulation.

## Why native

- AVFoundation can select the iPhone 16 Pro's real 120/240 fps camera formats.
- Camera intrinsics are delivered with native sample buffers.
- Focus/exposure and the 1× lens can be locked.
- Vision tracks a user/CoreML-seeded ball backward and forward.
- A 160 mm metric QR target replaces natural-feature and off-frame turf guesses.

## Requirements

- macOS with Xcode 16 or newer
- XcodeGen (`brew install xcodegen`)
- Apple Developer account for TestFlight/device distribution
- iPhone 16 Pro

## Generate and run

```bash
cd ios/KirketPro
xcodegen generate
open KirketPro.xcodeproj
```

In Xcode:

1. Select the `KirketPro` target.
2. Choose your Apple Development Team.
3. Connect the iPhone.
4. Build/run on device.

The code cannot be compiled or signed in the Linux Cloud Agent environment;
Xcode/device validation is still required.

## Metric target

Print:

`docs/KIRKET_METRIC_TARGET_A4.svg`

Rules:

1. Print at **100% / Actual Size**, not “Fit to page”.
2. Verify the printed control line is exactly 160 mm.
3. Place the sheet flat.
4. The labeled stump edge touches the middle stump.
5. The arrow points down the pitch.
6. Keep the whole QR target visible for at least 15 stable calibration frames.
7. Remove the target only after calibration; do not move the phone.

Calibration is accepted only when temporal corner RMS is at most 2.5 pixels.

## Capture/review

1. Choose 4K/120 or 1080p/240.
2. Configure the exact AVFoundation format.
3. Lock focus/exposure and record one short delivery.
4. In Review, select the exact contact frame.
5. Tap the ball or use the custom CoreML model.
6. Vision tracks before and after contact.
7. The fitter reconstructs ball depth from known diameter, rejects outliers,
   fits gravity-constrained motion, and reports residual/confidence.

Measurements are rejected unless there are at least six post-contact samples,
residual is at most 18 cm, and confidence is at least 70%.

## Custom model

The app looks for:

`KirketBallDetector.mlmodelc`

in the app bundle. Until a trained model is added, the user taps the ball on
the contact frame and Vision tracking continues without CoreML.

See `ml/README.md` for the training/export workflow.
