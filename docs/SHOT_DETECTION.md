# iPhone 16 Pro shot-capture protocol

The iPhone 16 Pro hardware is suitable for this project. Apple specifies:

- 4K Dolby Vision recording up to 120 fps on the main Fusion camera.
- 1080p slow-motion recording up to 240 fps.

The web app should process an uploaded high-frame-rate recording. Safari
`getUserMedia` does not reliably expose the phone's 120/240 fps capture modes,
so browser live capture is a lower-accuracy fallback.

## Recommended recording setup

1. Keep the phone in the exact calibrated mount. Do not move it after
   calibration.
2. Use the rear main **1× Fusion camera**. Do not use digital zoom, lens
   switching, Action mode, or Cinematic mode.
3. Prefer **4K/120 fps** for the extra pixels around the ball. Use **1080p/240
   fps** when lighting is very strong and temporal resolution matters more.
4. Record in strong daylight or bright flicker-free lighting. High frame rates
   use short exposure times and need substantially more light.
5. Long-press the ball/pitch area in Apple's Camera app to use AE/AF Lock where
   possible. Avoid focus/exposure changes during a delivery.
6. Keep the full expected ball path visible. The ball should be at least 5–8
   pixels wide in the processed frame near impact.
7. Upload the original video file. Messaging-app compression can remove frames,
   introduce block artifacts, and alter the yellow color.
8. Measure the actual worn ball diameter with calipers and enter it. The default
   is 72 mm; depth and 3D speed scale directly with this value.

## In-app workflow

1. Complete image calibration first.
2. Upload the slow-motion video.
3. Seek to roughly 0.1–0.3 seconds before bat contact.
4. Tap **Grab current frame**.
5. Tap the visible ball. This learns the current dusty/worn yellow color.
6. Set capture FPS:
   - 120 for 4K/120.
   - 240 for 1080p/240.
7. Set the stored timeline:
   - same as capture FPS for an original-speed high-frame-rate file;
   - 30 if Photos exported the clip as a 30 fps slow-motion timeline.
8. Process a short 0.8–1.5 second window.
9. Inspect detected frames, predicted gaps, track confidence, impact, bounces,
   and measurement warnings.

### Manual keyframe fallback

If automatic tracking is wrong:

1. Seek to the exact bat-contact frame.
2. Tap **Grab current frame**, then tap the ball.
3. Seek forward several source frames and repeat.
4. Add at least four points, beginning at contact.
5. Tap **Measure manual track**.

Manual points bypass color/occlusion association but still use the calibrated
camera pose or turf homography. They are the preferred fallback for difficult
clips until enough real footage exists to retrain/tune automatic detection.

## Detection pipeline

The detector combines:

- user-sampled adaptive HSV color;
- broad hue tolerance for dust and wear;
- frame-to-frame RGB motion;
- connected-component size and circularity;
- predicted position and radius gating;
- velocity-smoothed multi-frame tracking;
- short occlusion recovery;
- impact detection from velocity change;
- bounce detection from vertical velocity reversal.

When a reliable camera pose exists, the known ball diameter and observed image
radius estimate 3D depth. The detector then fits a velocity through multiple
world-space points. If pose quality is insufficient, it falls back to the turf
homography; airborne speed is explicitly marked approximate in that mode.

## Accuracy limitations

A single camera cannot recover perfect 3D motion when the ball is heavily
blurred, hidden for many frames, or too small to measure. Reliable measurement
requires:

- unchanged camera position/lens/crop;
- accurate calibration;
- known ball diameter;
- enough light;
- multiple unoccluded ball frames around impact.

The app reports confidence and warnings rather than silently presenting a weak
track as precise.
