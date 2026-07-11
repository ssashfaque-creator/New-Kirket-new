# Kirket custom vision model

Generic COCO “sports ball” detection is not sufficient for a tiny, blurred,
dusty yellow practice ball. This directory contains the reproducible custom
YOLO → CoreML/ONNX path.

## 1. Collect clips

Record at least 10–20 sessions and preferably hundreds of deliveries:

- front/left/right fixed camera positions;
- 4K/120 and 1080p/240;
- clean/dusty/worn balls;
- bright/overcast/artificial lighting;
- fast/slow/lofted/defensive/missed shots;
- hard negatives including the spare bat, net highlights, yellow objects, feet,
  and people.

Never send the footage through messaging-app compression.

## 2. Extract frames

Create `contacts.csv`:

```csv
video,contact_seconds,session
delivery001.mov,1.483,session01
delivery002.mov,1.226,session01
```

Then:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r ml/requirements.txt
python ml/tools/extract_contact_frames.py \
  --clips /path/to/clips \
  --contacts contacts.csv \
  --output dataset/raw_frames
```

## 3. Annotate

Use CVAT or Roboflow and label:

- `ball`
- `bat`
- `middle_stump`
- `outer_stump`

Include partial and motion-blurred balls. Label only visible extent.

Split by entire **recording session**, never by random neighboring frames:

```text
dataset/
  images/train
  images/val
  images/test
  labels/train
  labels/val
  labels/test
```

Random frame splitting leaks nearly identical images and produces false
validation accuracy.

## 4. Train/export

```bash
python ml/train.py
```

Copy the resulting NMS-enabled CoreML model into the Xcode target and name it:

```text
KirketBallDetector.mlmodel
```

Xcode compiles it to `KirketBallDetector.mlmodelc`; the native app loads it
automatically.

## Acceptance metrics

Do not release based only on mAP. Measure on unseen sessions:

- contact-frame ball recall;
- false positives per delivery;
- center-point pixel error;
- track continuity;
- speed/direction error against an independent reference;
- performance by camera angle, lighting, and ball wear.

The model initializes/reacquires tracking. Vision temporal tracking handles
intermediate 120/240 fps frames to reduce compute and battery load.
