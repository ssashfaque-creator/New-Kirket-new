#!/usr/bin/env python3
"""Extract original frames around manually identified bat-contact timestamps."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import cv2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clips", type=Path, required=True)
    parser.add_argument(
        "--contacts",
        type=Path,
        required=True,
        help="CSV with columns: video,contact_seconds,session",
    )
    parser.add_argument("--output", type=Path, default=Path("dataset/raw_frames"))
    parser.add_argument("--before", type=float, default=0.35)
    parser.add_argument("--after", type=float, default=1.20)
    return parser.parse_args()


def extract(
    video_path: Path,
    contact_seconds: float,
    session: str,
    output: Path,
    before: float,
    after: float,
) -> int:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open {video_path}")
    fps = capture.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        raise RuntimeError(f"Invalid FPS for {video_path}")
    start_frame = max(0, round((contact_seconds - before) * fps))
    end_frame = round((contact_seconds + after) * fps)
    capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    session_dir = output / session
    session_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    frame_index = start_frame
    while frame_index <= end_frame:
        ok, frame = capture.read()
        if not ok:
            break
        filename = f"{video_path.stem}_f{frame_index:06d}.jpg"
        cv2.imwrite(str(session_dir / filename), frame, [cv2.IMWRITE_JPEG_QUALITY, 96])
        written += 1
        frame_index += 1
    capture.release()
    return written


def main() -> None:
    args = parse_args()
    total = 0
    with args.contacts.open(newline="") as source:
        for row in csv.DictReader(source):
            total += extract(
                args.clips / row["video"],
                float(row["contact_seconds"]),
                row.get("session") or Path(row["video"]).stem,
                args.output,
                args.before,
                args.after,
            )
    print(f"Extracted {total} original frames to {args.output}")


if __name__ == "__main__":
    main()
