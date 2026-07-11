# Custom cricket-ball model roadmap

Generic COCO models only know the broad class `sports ball`. They are useful for
contact-frame initialization, but a professional detector for this yellow
dimpled ball and net requires a custom labeled dataset.

## Dataset target

Collect original iPhone 16 Pro clips from the fixed camera positions:

- 4K/120 and 1080p/240;
- front, left-side, and right-side calibrated views;
- daylight, overcast, shadows, and artificial light;
- clean, dusty, and worn balls;
- fast, slow, lofted, defensive, and missed shots;
- hard negatives: spare bat, yellow straps/objects, shoes, net highlights.

Extract frames around each delivery and label:

- `ball`
- `bat`
- `middle_stump`
- `outer_stump`
- optional `batter`

Include frames where the ball is partly hidden or motion-blurred. Label the
visible box rather than guessing the hidden extent.

## Recommended tools

- CVAT or Roboflow for frame annotation and review.
- Ultralytics YOLO11/YOLOv8 small model for training experiments.
- ONNX export for browser/native inference.

## Train/evaluate correctly

Split by **video session**, not random frames. Random-frame splits leak nearly
identical adjacent frames into validation and produce misleading accuracy.

Track:

- ball recall at impact;
- false positives per delivery;
- center-point pixel error;
- detection continuity across frames;
- speed/direction error after calibration;
- performance separately for each camera angle and lighting condition.

A release model should be tested on entire unseen recording sessions and should
not replace manual verification when confidence is low.

## Deployment path

1. Train a small model at high input resolution because the ball is tiny.
2. Quantize only after checking small-object recall.
3. Export ONNX.
4. Run AI detection on the selected contact frame and periodically for tracker
   reacquisition—not on every 120/240 fps frame.
5. Continue using temporal tracking, motion, color, and appearance-template
   matching between AI detections.

This hybrid approach is faster and more reliable on iPhone than running a large
YOLO model on every frame.
