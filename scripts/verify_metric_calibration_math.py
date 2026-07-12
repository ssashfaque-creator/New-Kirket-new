#!/usr/bin/env python3
"""Linux-side verification of metric calibration geometry (mirrors iOS solver)."""

from __future__ import annotations

import math
import sys

import numpy as np

TARGET_SIDE = 0.160


def ground_corners():
    half = TARGET_SIDE / 2
    return np.array(
        [
            [-half, 0.0],
            [half, 0.0],
            [half, TARGET_SIDE],
            [-half, TARGET_SIDE],
        ],
        dtype=float,
    )


def solve_homography(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    assert src.shape == (4, 2) and dst.shape == (4, 2)
    a = np.zeros((8, 9), dtype=float)
    for i in range(4):
        x, y = src[i]
        u, v = dst[i]
        a[2 * i] = [x, y, 1, 0, 0, 0, -u * x, -u * y, -u]
        a[2 * i + 1] = [0, 0, 0, x, y, 1, -v * x, -v * y, -v]
    # Match Swift DLT with h22 normalized to 1 via Gaussian elimination on 8x9.
    m = a.copy()
    for col in range(8):
        pivot = col + int(np.argmax(np.abs(m[col:, col])))
        m[[col, pivot]] = m[[pivot, col]]
        piv = m[col, col]
        if abs(piv) < 1e-12:
            raise RuntimeError("degenerate")
        m[col] /= piv
        for row in range(8):
            if row == col:
                continue
            m[row] -= m[row, col] * m[col]
    h = np.append(m[:, 8], 1.0)
    # Swift stores column-major simd from row-major h0..h8 with last=1.
    # Our a used -u in last column like classic DLT; Swift uses +u with H*[x,y,1]=w*[u,v,1]
    # Re-solve using the same equations as Homography.swift.
    return solve_homography_swift(src, dst)


def solve_homography_swift(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    matrix = np.zeros((8, 9), dtype=float)
    for index in range(4):
        x, y = src[index]
        u, v = dst[index]
        matrix[index * 2] = [x, y, 1, 0, 0, 0, -u * x, -u * y, u]
        matrix[index * 2 + 1] = [0, 0, 0, x, y, 1, -v * x, -v * y, v]
    for column in range(8):
        pivot = column + int(np.argmax(np.abs(matrix[column:, column])))
        matrix[[column, pivot]] = matrix[[pivot, column]]
        pivot_value = matrix[column, column]
        if abs(pivot_value) < 1e-12:
            raise RuntimeError("degenerate")
        matrix[column] /= pivot_value
        for row in range(8):
            if row == column:
                continue
            matrix[row] -= matrix[row, column] * matrix[column]
    h = np.append(matrix[:, 8], 1.0)
    # Column-major 3x3 like simd_double3x3 in Homography.swift
    return np.array(
        [
            [h[0], h[1], h[2]],
            [h[3], h[4], h[5]],
            [h[6], h[7], h[8]],
        ],
        dtype=float,
    )


def project(point, h):
    x, y = point
    r = h @ np.array([x, y, 1.0])
    return r[:2] / r[2]


def quiet_zone_scale_bug_demo():
    # Old print put quiet zone inside 160 mm → Vision saw ~33/41 of side.
    wrong = TARGET_SIDE * 33 / 41
    err = TARGET_SIDE - wrong
    assert err > 0.03, err
    return wrong, err


def main() -> int:
    ground = ground_corners()
    # Synthetic image corners for a fronto-parallel-ish board.
    image = np.array(
        [
            [340.0, 1200.0],
            [740.0, 1200.0],
            [700.0, 800.0],
            [380.0, 800.0],
        ]
    )
    h = solve_homography_swift(image, ground)
    for src, dst in zip(image, ground):
        got = project(src, h)
        if abs(got[0] - dst[0]) > 1e-6 or abs(got[1] - dst[1]) > 1e-6:
            print("FAIL projection", src, got, dst)
            return 1

    bl, br = project(image[0], h), project(image[1], h)
    side = math.hypot(br[0] - bl[0], br[1] - bl[1])
    if abs(side - TARGET_SIDE) > 1e-9 or abs(bl[1]) > 1e-9:
        print("FAIL stump edge / scale", side, bl)
        return 1

    wrong, err = quiet_zone_scale_bug_demo()
    print("OK homography round-trip")
    print(f"OK stump edge y=0, side={side:.6f} m")
    print(f"OK quiet-zone-inside would bias scale by {err*1000:.1f} mm (Vision side {wrong:.4f} m)")
    print("Metric contract: modules fill 160 mm; quiet zone outside.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
