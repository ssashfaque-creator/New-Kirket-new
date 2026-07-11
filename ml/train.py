#!/usr/bin/env python3
"""Train and export the Kirket small-object detector."""

from pathlib import Path

from ultralytics import YOLO


ROOT = Path(__file__).resolve().parent


def main() -> None:
    # Start with a small pretrained detector, but train at high resolution
    # because the ball occupies very few pixels.
    model = YOLO("yolo11s.pt")
    model.train(
        data=str(ROOT / "config" / "kirket.yaml"),
        imgsz=1280,
        epochs=180,
        batch=8,
        patience=30,
        close_mosaic=20,
        degrees=4,
        translate=0.08,
        scale=0.35,
        perspective=0.0005,
        hsv_h=0.03,
        hsv_s=0.45,
        hsv_v=0.35,
        fliplr=0.5,
        project=str(ROOT / "runs"),
        name="kirket-ball",
    )
    best = YOLO(str(ROOT / "runs" / "kirket-ball" / "weights" / "best.pt"))
    best.val(data=str(ROOT / "config" / "kirket.yaml"), imgsz=1280)
    best.export(
        format="coreml",
        imgsz=1280,
        nms=True,
        half=True,
    )
    best.export(
        format="onnx",
        imgsz=1280,
        nms=True,
        half=True,
        simplify=True,
    )


if __name__ == "__main__":
    main()
