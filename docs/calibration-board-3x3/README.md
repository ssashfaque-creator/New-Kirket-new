# Kirket 3×3 A4 calibration board

Temporary large calibration board made from **9× A4** sheets. Place → calibrate → remove.

The app measures **only sheet C2’s 160 mm QR modules** (same payload as the single-sheet target). Quiet zone is printed **outside** that square so Apple Vision’s corners match the 0.160 m side used by the solver. The other eight sheets improve visibility from behind the stumps; they are not part of the pose model.

## Print

1. Print every SVG in this folder at **100% / Actual Size** (not Fit to Page).
2. Start with [`00_ASSEMBLY.svg`](00_ASSEMBLY.svg) if you want a one-page map.
3. On **C2**, check the control ruler measures exactly **160 mm**.

## Layout (camera behind the stumps)

```
A1  A2  A3     ← back (farther / toward bowler)
B1  B2  B3     ← middle
C1  C2  C3     ← front (closest to camera)
         ↑
   160 mm QR on C2
```

Put **C2** on the front-middle so the QR stays readable and is not blocked by the stumps.

## Overlap attach marks (not edge-to-edge)

Sheets overlap by **15 mm**. The upper sheet is taped **on top** of the lower one.

- **Dashed black line + crosses** on the under sheet = exact place to put the neighbor’s edge.
- **Red edge marks** on the over sheet = the edge that must sit on that dashed line.

## Assembly order

1. Tape back row **A1–A3** (center on top of sides).
2. Tape mid row **B1–B3** onto the A row (front-of-pair on top).
3. Tape front row **C1–C3** onto the B row; **C2** ends on top in front-center.

## On the pitch (must match the app)

1. Place the assembled board so **C2** faces the camera.
2. **Middle stump touches the red bottom edge of the 160 mm QR on C2** — that edge is the app origin (`STUMP_EDGE_BOTTOM`).
3. Arrow points down the pitch.
4. Calibrate in the native app (≥15 stable frames, RMS ≤ 2.5 px).
5. **Remove all nine sheets** before recording (do not move the phone).

## Regenerate

```bash
python3 scripts/generate_calibration_board_3x3.py
```
