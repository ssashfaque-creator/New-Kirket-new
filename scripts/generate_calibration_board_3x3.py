#!/usr/bin/env python3
"""Generate Kirket 3×3 A4 calibration board SVGs with overlap attach marks."""

from __future__ import annotations

from pathlib import Path

import qrcode

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "calibration-board-3x3"

PAYLOAD = "KIRKET_METRIC_TARGET_V1_SIZE_160MM_STUMP_EDGE_BOTTOM"
QR_MM = 160.0
OVERLAP = 15.0
A4_W, A4_H = 210.0, 297.0

IDS = [
    ["A1", "A2", "A3"],
    ["B1", "B2", "B3"],
    ["C1", "C2", "C3"],
]
NAMES = {
    "A1": "BACK-LEFT",
    "A2": "BACK-CENTER",
    "A3": "BACK-RIGHT",
    "B1": "MID-LEFT",
    "B2": "MID-CENTER",
    "B3": "MID-RIGHT",
    "C1": "FRONT-LEFT",
    "C2": "FRONT-CENTER (QR)",
    "C3": "FRONT-RIGHT",
}
FILES = {
    "A1": "A1_BACK-LEFT.svg",
    "A2": "A2_BACK-CENTER.svg",
    "A3": "A3_BACK-RIGHT.svg",
    "B1": "B1_MID-LEFT.svg",
    "B2": "B2_MID-CENTER.svg",
    "B3": "B3_MID-RIGHT.svg",
    "C1": "C1_FRONT-LEFT.svg",
    "C2": "C2_FRONT-CENTER_QR.svg",
    "C3": "C3_FRONT-RIGHT.svg",
}


def covers(over_id: str, under_id: str) -> bool:
    rows = {"A": 0, "B": 1, "C": 2}
    cols = {"1": 0, "2": 1, "3": 2}
    or_, oc = rows[over_id[0]], cols[over_id[1]]
    ur, uc = rows[under_id[0]], cols[under_id[1]]
    if oc == uc and abs(or_ - ur) == 1:
        return or_ > ur
    if or_ == ur and abs(oc - uc) == 1:
        if oc == 1:
            return True
        if uc == 1:
            return False
        return oc > uc
    return False


def neighbors(sid: str) -> dict[str, str]:
    r = {"A": 0, "B": 1, "C": 2}[sid[0]]
    c = int(sid[1]) - 1
    out: dict[str, str] = {}
    if c > 0:
        out["left"] = IDS[r][c - 1]
    if c < 2:
        out["right"] = IDS[r][c + 1]
    if r > 0:
        out["top"] = IDS[r - 1][c]
    if r < 2:
        out["bottom"] = IDS[r + 1][c]
    return out


def qr_modules():
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=1,
        border=4,
    )
    qr.add_data(PAYLOAD)
    qr.make(fit=True)
    return qr.get_matrix()


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def cross(x: float, y: float, arm: float = 4, sw: float = 0.35) -> str:
    return (
        f'<line x1="{x-arm}" y1="{y}" x2="{x+arm}" y2="{y}" stroke="#111" stroke-width="{sw}"/>'
        f'<line x1="{x}" y1="{y-arm}" x2="{x}" y2="{y+arm}" stroke="#111" stroke-width="{sw}"/>'
    )


def attach_marks(sid: str) -> str:
    parts: list[str] = []
    nbs = neighbors(sid)
    o = OVERLAP
    if "right" in nbs and covers(nbs["right"], sid):
        x = A4_W - o
        parts.append(
            f'<line x1="{x}" y1="{o}" x2="{x}" y2="{A4_H-o}" stroke="#111" '
            f'stroke-width="0.45" stroke-dasharray="3 2"/>'
        )
        parts.extend([cross(x, o + 8), cross(x, A4_H / 2), cross(x, A4_H - o - 8)])
        label = nbs["right"]
        parts.append(
            f'<text x="{x-2}" y="{A4_H/2}" text-anchor="end" font-family="Arial" font-size="3.2" '
            f'transform="rotate(-90 {x-2} {A4_H/2})">ALIGN LEFT EDGE OF {label} ON THIS LINE '
            f"(tape {label} ON TOP)</text>"
        )
        parts.append(f'<rect x="{x}" y="0" width="{o}" height="{A4_H}" fill="#000" fill-opacity="0.04"/>')
    if "left" in nbs and covers(nbs["left"], sid):
        x = o
        parts.append(
            f'<line x1="{x}" y1="{o}" x2="{x}" y2="{A4_H-o}" stroke="#111" '
            f'stroke-width="0.45" stroke-dasharray="3 2"/>'
        )
        parts.extend([cross(x, o + 8), cross(x, A4_H / 2), cross(x, A4_H - o - 8)])
        label = nbs["left"]
        parts.append(
            f'<text x="{x+2}" y="{A4_H/2}" text-anchor="start" font-family="Arial" font-size="3.2" '
            f'transform="rotate(90 {x+2} {A4_H/2})">ALIGN RIGHT EDGE OF {label} ON THIS LINE '
            f"(tape {label} ON TOP)</text>"
        )
        parts.append(f'<rect x="0" y="0" width="{o}" height="{A4_H}" fill="#000" fill-opacity="0.04"/>')
    if "bottom" in nbs and covers(nbs["bottom"], sid):
        y = A4_H - o
        parts.append(
            f'<line x1="{o}" y1="{y}" x2="{A4_W-o}" y2="{y}" stroke="#111" '
            f'stroke-width="0.45" stroke-dasharray="3 2"/>'
        )
        parts.extend([cross(o + 8, y), cross(A4_W / 2, y), cross(A4_W - o - 8, y)])
        label = nbs["bottom"]
        parts.append(
            f'<text x="{A4_W/2}" y="{y-3}" text-anchor="middle" font-family="Arial" font-size="3.2">'
            f"ALIGN TOP EDGE OF {label} ON THIS LINE (tape {label} ON TOP)</text>"
        )
        parts.append(f'<rect x="0" y="{y}" width="{A4_W}" height="{o}" fill="#000" fill-opacity="0.04"/>')
    if "top" in nbs and covers(nbs["top"], sid):
        y = o
        parts.append(
            f'<line x1="{o}" y1="{y}" x2="{A4_W-o}" y2="{y}" stroke="#111" '
            f'stroke-width="0.45" stroke-dasharray="3 2"/>'
        )
        parts.extend([cross(o + 8, y), cross(A4_W / 2, y), cross(A4_W - o - 8, y)])
        label = nbs["top"]
        parts.append(
            f'<text x="{A4_W/2}" y="{y+6}" text-anchor="middle" font-family="Arial" font-size="3.2">'
            f"ALIGN BOTTOM EDGE OF {label} ON THIS LINE (tape {label} ON TOP)</text>"
        )
        parts.append(f'<rect x="0" y="0" width="{A4_W}" height="{o}" fill="#000" fill-opacity="0.04"/>')

    for direction, nid in nbs.items():
        if not covers(sid, nid):
            continue
        if direction == "left":
            parts.append(
                f'<line x1="0.4" y1="{o}" x2="0.4" y2="{A4_H-o}" stroke="#e11d48" stroke-width="0.8"/>'
            )
            parts.extend(
                [
                    cross(2.5, o + 8, arm=3, sw=0.4),
                    cross(2.5, A4_H / 2, arm=3, sw=0.4),
                    cross(2.5, A4_H - o - 8, arm=3, sw=0.4),
                ]
            )
            parts.append(
                f'<text x="5" y="{A4_H/2}" font-family="Arial" font-size="3" fill="#e11d48" '
                f'transform="rotate(90 5 {A4_H/2})">PLACE THIS EDGE ON {nid} ATTACH LINE</text>'
            )
        elif direction == "right":
            parts.append(
                f'<line x1="{A4_W-0.4}" y1="{o}" x2="{A4_W-0.4}" y2="{A4_H-o}" '
                f'stroke="#e11d48" stroke-width="0.8"/>'
            )
            parts.extend(
                [
                    cross(A4_W - 2.5, o + 8, arm=3, sw=0.4),
                    cross(A4_W - 2.5, A4_H / 2, arm=3, sw=0.4),
                    cross(A4_W - 2.5, A4_H - o - 8, arm=3, sw=0.4),
                ]
            )
            parts.append(
                f'<text x="{A4_W-5}" y="{A4_H/2}" font-family="Arial" font-size="3" fill="#e11d48" '
                f'transform="rotate(-90 {A4_W-5} {A4_H/2})">PLACE THIS EDGE ON {nid} ATTACH LINE</text>'
            )
        elif direction == "top":
            parts.append(
                f'<line x1="{o}" y1="0.4" x2="{A4_W-o}" y2="0.4" stroke="#e11d48" stroke-width="0.8"/>'
            )
            parts.extend(
                [
                    cross(o + 8, 2.5, arm=3, sw=0.4),
                    cross(A4_W / 2, 2.5, arm=3, sw=0.4),
                    cross(A4_W - o - 8, 2.5, arm=3, sw=0.4),
                ]
            )
            parts.append(
                f'<text x="{A4_W/2}" y="8" text-anchor="middle" font-family="Arial" font-size="3" '
                f'fill="#e11d48">PLACE THIS EDGE ON {nid} ATTACH LINE</text>'
            )
        elif direction == "bottom":
            parts.append(
                f'<line x1="{o}" y1="{A4_H-0.4}" x2="{A4_W-o}" y2="{A4_H-0.4}" '
                f'stroke="#e11d48" stroke-width="0.8"/>'
            )
            parts.extend(
                [
                    cross(o + 8, A4_H - 2.5, arm=3, sw=0.4),
                    cross(A4_W / 2, A4_H - 2.5, arm=3, sw=0.4),
                    cross(A4_W - o - 8, A4_H - 2.5, arm=3, sw=0.4),
                ]
            )
            parts.append(
                f'<text x="{A4_W/2}" y="{A4_H-4}" text-anchor="middle" font-family="Arial" '
                f'font-size="3" fill="#e11d48">PLACE THIS EDGE ON {nid} ATTACH LINE</text>'
            )
    return "\n".join(parts)


def high_contrast_panel(x: float, y: float, w: float, h: float, clip_id: str) -> str:
    parts = [
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="white" stroke="#111" stroke-width="0.5"/>',
        f'<rect x="{x+3}" y="{y+3}" width="{w-6}" height="{h-6}" fill="none" stroke="#111" stroke-width="2"/>',
        f'<defs><clipPath id="{clip_id}"><rect x="{x+6}" y="{y+6}" width="{w-12}" height="{h-12}"/></clipPath></defs>',
        f'<g clip-path="url(#{clip_id})">',
    ]
    step = 12
    for i in range(int(-h), int(w + h), step):
        parts.append(
            f'<line x1="{x+i}" y1="{y+6}" x2="{x+i+h}" y2="{y+h-6}" stroke="#111" stroke-width="4"/>'
        )
    parts.append("</g>")
    return "\n".join(parts)


def sheet_header(sid: str) -> str:
    return f"""
<text x="105" y="12" text-anchor="middle" font-family="Arial" font-size="6" font-weight="bold">KIRKET 3×3 A4 — SHEET {sid} — {esc(NAMES[sid])}</text>
<text x="105" y="18" text-anchor="middle" font-family="Arial" font-size="3.2">Print at 100% / Actual Size · Temporary board: place → calibrate → remove</text>
<text x="105" y="23" text-anchor="middle" font-family="Arial" font-size="3">Overlap {OVERLAP:.0f} mm · Stick sheets ON TOP at dashed attach lines · Crosses = exact corners</text>
"""


def mini_map(sid: str) -> str:
    parts: list[str] = []
    ox, oy, s, g = 172, 26, 10, 1.5
    for r in range(3):
        for c in range(3):
            cell = IDS[r][c]
            fill = "#e11d48" if cell == sid else "#f3f4f6"
            ink = "#fff" if cell == sid else "#111"
            parts.append(
                f'<rect x="{ox+c*(s+g)}" y="{oy+r*(s+g)}" width="{s}" height="{s}" '
                f'fill="{fill}" stroke="#111" stroke-width="0.3"/>'
            )
            parts.append(
                f'<text x="{ox+c*(s+g)+s/2}" y="{oy+r*(s+g)+s/2+1.2}" text-anchor="middle" '
                f'font-family="Arial" font-size="2.4" fill="{ink}">{cell}</text>'
            )
    parts.append(
        f'<text x="{ox+1.5*(s+g)}" y="{oy+3*(s+g)+4}" text-anchor="middle" '
        f'font-family="Arial" font-size="2.2">camera ↓</text>'
    )
    return "\n".join(parts)


def qr_block(origin_x: float, origin_y: float) -> str:
    matrix = qr_modules()
    n = len(matrix)
    module = QR_MM / n
    parts = [
        f'<rect x="{origin_x}" y="{origin_y}" width="{QR_MM}" height="{QR_MM}" '
        f'fill="white" stroke="black" stroke-width="0.4"/>'
    ]
    for r, row in enumerate(matrix):
        for c, bit in enumerate(row):
            if bit:
                parts.append(
                    f'<rect x="{origin_x + c * module:.5f}" y="{origin_y + r * module:.5f}" '
                    f'width="{module:.5f}" height="{module:.5f}" fill="black"/>'
                )
    return "\n".join(parts)


def make_c2() -> str:
    """C2 QR sheet.

    App geometry (CalibrationBoardDetector): the BOTTOM EDGE of the 160 mm QR
    square is the stump line (y=0). Artwork must mark that QR bottom edge — not
    a separate line further down the page — so printed instructions match the
    solver.
    """
    qx = (A4_W - QR_MM) / 2
    qy = 30.0
    qr_bottom = qy + QR_MM
    return "\n".join(
        [
            '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">',
            '<rect width="210" height="297" fill="white"/>',
            sheet_header("C2"),
            mini_map("C2"),
            attach_marks("C2"),
            qr_block(qx, qy),
            # Stump edge = QR bottom (matches STUMP_EDGE_BOTTOM / app ground frame)
            f'<line x1="{qx}" y1="{qr_bottom}" x2="{qx+QR_MM}" y2="{qr_bottom}" '
            f'stroke="#e11d48" stroke-width="1.6"/>',
            f'<line x1="{qx}" y1="{qr_bottom-3}" x2="{qx}" y2="{qr_bottom+3}" '
            f'stroke="#e11d48" stroke-width="1.2"/>',
            f'<line x1="{qx+QR_MM}" y1="{qr_bottom-3}" x2="{qx+QR_MM}" y2="{qr_bottom+3}" '
            f'stroke="#e11d48" stroke-width="1.2"/>',
            f'<path d="M105 {qr_bottom+28} L92 {qr_bottom+10} L100 {qr_bottom+10} '
            f'L100 {qr_bottom+2} L110 {qr_bottom+2} L110 {qr_bottom+10} L118 {qr_bottom+10} Z" '
            f'fill="#e11d48"/>',
            f'<text x="105" y="{qr_bottom+38}" text-anchor="middle" font-family="Arial" '
            f'font-size="6.5" font-weight="bold">MIDDLE STUMP TOUCHES THE RED QR BOTTOM EDGE</text>',
            f'<text x="105" y="{qr_bottom+46}" text-anchor="middle" font-family="Arial" font-size="4">'
            "Arrow points DOWN THE PITCH · App origin = this QR bottom edge at middle stump</text>",
            f'<text x="105" y="{qr_bottom+54}" text-anchor="middle" font-family="Arial" font-size="3.2">'
            f"Payload: {PAYLOAD}</text>",
            f'<text x="105" y="{qr_bottom+60}" text-anchor="middle" font-family="Arial" font-size="3.2">'
            f"Outer QR square = exactly {QR_MM:.0f} mm · Keep readable; not blocked by stumps</text>",
            # Duplicate control ruler near page bottom for tape-measure check
            f'<line x1="{qx}" y1="278" x2="{qx+QR_MM}" y2="278" stroke="black" stroke-width="1"/>',
            f'<line x1="{qx}" y1="274" x2="{qx}" y2="282" stroke="black" stroke-width="1"/>',
            f'<line x1="{qx+QR_MM}" y1="274" x2="{qx+QR_MM}" y2="282" stroke="black" stroke-width="1"/>',
            '<text x="105" y="289" text-anchor="middle" font-family="Arial" font-size="4.5">'
            "CONTROL RULER: THIS LINE MUST MEASURE EXACTLY 160 mm</text>",
            '<text x="105" y="295" text-anchor="middle" font-family="Arial" font-size="3">'
            "After calibration, remove all 9 sheets</text>",
            "</svg>",
        ]
    )


def make_support(sid: str) -> str:
    o = OVERLAP
    covered = {"left": False, "right": False, "top": False, "bottom": False}
    for d, nid in neighbors(sid).items():
        if covers(nid, sid):
            covered[d] = True
    x0 = o if covered["left"] else 8
    x1 = A4_W - (o if covered["right"] else 8)
    y0 = max(o + 8 if covered["top"] else 28, 42)
    y1 = A4_H - (o if covered["bottom"] else 12)
    w = x1 - x0
    h = y1 - y0
    return "\n".join(
        [
            '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">',
            '<rect width="210" height="297" fill="white"/>',
            sheet_header(sid),
            mini_map(sid),
            attach_marks(sid),
            high_contrast_panel(x0, y0, w, h, f"clip_{sid}"),
            f'<text x="105" y="{y0 + h/2}" text-anchor="middle" font-family="Arial" '
            f'font-size="14" font-weight="bold" fill="#111">{sid}</text>',
            f'<text x="105" y="{y0 + h/2 + 10}" text-anchor="middle" font-family="Arial" '
            f'font-size="5" fill="#111">{esc(NAMES[sid])}</text>',
            f'<text x="105" y="{y0 + h/2 + 20}" text-anchor="middle" font-family="Arial" '
            f'font-size="3.5" fill="#333">Visibility panel · temporary 3×3 board</text>',
            "</svg>",
        ]
    )


def make_assembly() -> str:
    cell_w, cell_h = 50, 70
    gap = 4
    ox, oy = 28, 50
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">',
        '<rect width="210" height="297" fill="white"/>',
        '<text x="105" y="18" text-anchor="middle" font-family="Arial" font-size="8" font-weight="bold">'
        "KIRKET CALIBRATION BOARD — 3×3 A4 ASSEMBLY</text>",
        '<text x="105" y="28" text-anchor="middle" font-family="Arial" font-size="4">'
        "Print all 9 sheets at 100% · Assemble with overlap · Calibrate · Remove</text>",
        '<text x="105" y="36" text-anchor="middle" font-family="Arial" font-size="3.5">'
        "View from camera behind the stumps (front row = closest to camera)</text>",
    ]
    for r in range(3):
        for c in range(3):
            sid = IDS[r][c]
            x = ox + c * (cell_w + gap)
            y = oy + r * (cell_h + gap)
            fill = "#fee2e2" if sid == "C2" else "#f9fafb"
            parts.append(
                f'<rect x="{x}" y="{y}" width="{cell_w}" height="{cell_h}" fill="{fill}" '
                f'stroke="#111" stroke-width="0.6"/>'
            )
            parts.append(
                f'<text x="{x+cell_w/2}" y="{y+28}" text-anchor="middle" font-family="Arial" '
                f'font-size="10" font-weight="bold">{sid}</text>'
            )
            parts.append(
                f'<text x="{x+cell_w/2}" y="{y+40}" text-anchor="middle" font-family="Arial" '
                f'font-size="3">{esc(NAMES[sid])}</text>'
            )
            if sid == "C2":
                parts.append(
                    f'<text x="{x+cell_w/2}" y="{y+52}" text-anchor="middle" font-family="Arial" '
                    f'font-size="3.5" fill="#e11d48" font-weight="bold">160 mm QR HERE</text>'
                )
    parts.append(
        f'<text x="{ox+1.5*(cell_w+gap)}" y="{oy+3*(cell_h+gap)+8}" text-anchor="middle" '
        f'font-family="Arial" font-size="4">↑ toward bowler / back of board</text>'
    )
    parts.append(
        f'<text x="{ox+1.5*(cell_w+gap)}" y="{oy+3*(cell_h+gap)+16}" text-anchor="middle" '
        f'font-family="Arial" font-size="4" font-weight="bold">'
        "↓ camera / behind stumps / FRONT</text>"
    )
    yy = oy + 3 * (cell_h + gap) + 28
    instructions = [
        "1. Print sheets A1–C3 (plus this page) at 100% / Actual Size. Verify C2 ruler = 160 mm.",
        f"2. Overlap is {OVERLAP:.0f} mm — NOT edge-to-edge. Place the ON-TOP sheet so its red edge "
        "sits on the dashed attach line.",
        "3. Assemble back row A1–A3 first, then mid B1–B3 on top of A, then front C1–C3 on top of B. "
        "Center sheets on top of sides.",
        "4. Place board so C2 (QR) is front-middle, readable by the camera, and not blocked by the stumps.",
        "5. Middle stump touches the RED BOTTOM EDGE of the 160 mm QR on C2 (app origin). Arrow down pitch.",
        "6. Calibrate in the app until accepted, then remove all nine sheets without moving the phone.",
    ]
    for line in instructions:
        parts.append(f'<text x="12" y="{yy}" font-family="Arial" font-size="3.3">{esc(line)}</text>')
        yy += 6
    parts.append("</svg>")
    return "\n".join(parts)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for path in OUT.glob("*.svg"):
        path.unlink()
    (OUT / "00_ASSEMBLY.svg").write_text(make_assembly(), encoding="utf-8")
    for sid, fname in FILES.items():
        svg = make_c2() if sid == "C2" else make_support(sid)
        (OUT / fname).write_text(svg, encoding="utf-8")
    matrix = qr_modules()
    print(f"Wrote {len(list(OUT.glob('*.svg')))} SVGs to {OUT}")
    print(f"QR matrix {len(matrix)}×{len(matrix[0])} (incl. quiet zone), module={QR_MM/len(matrix):.4f} mm")


if __name__ == "__main__":
    main()
