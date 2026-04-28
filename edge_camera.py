# -*- coding: utf-8 -*-
import os, sys, platform

os.environ.setdefault("PYTHONUTF8", "1")
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

"""
edge_camera.py — KTP CAL WIZARD + DOMINANT-COLOR SEGMENTATION + CATALOG
========================================================================
Automated Dimensional Inspection · Capstone A3 Kelompok 2

Workflow:
  PHASE 1 — Kalibrasi KTP (sekali, mandatory di run pertama)
    • Tampilkan KTP Indonesia (85.6×53.98mm) ke kamera
    • Sistem deteksi ketat (aspect 1.585 ±6%, solidity ≥0.9, 4 sudut)
    • Validasi Y/N: "Apakah ini KTP yang akan dikalibrasi?"
    • Skala (px/mm) disimpan ke calibration.json

  PHASE 2 — Inspeksi Objek
    • Segmentasi per-frame: K-means K=2 di HSV → cluster dominan = background
    • Safeguard: cluster yang lebih dekat ke median warna pinggir frame =
      background (objek nggak akan ada di pinggir)
    • Pixel yang jauh dari warna bg di HSV (Otsu adaptive threshold) = objek
    • Skala pengukuran tetap pakai KTP dari Phase 1
    • Catalog: register/match objek → GOOD/NOT GOOD

Files yang dihasilkan:
  calibration.json   — px/mm dari KTP
  objects.json       — katalog benda (nama, L_mm, W_mm, toleransi)

Mode optional:
  [L] Live-Cal       — re-detect KTP per frame (handheld; KTP harus di view)

Usage:
  python edge_camera.py
  python edge_camera.py --camera 0

Kontrol:
  SPASI    = Inspeksi paksa (kirim ke API)
  A        = Toggle auto-send
  C        = Re-run wizard (KTP)
  V        = Toggle mask preview (debug)
  L        = Toggle Live-Cal mode
  R        = Register objek terukur ke katalog
  U        = Toggle auto-register
  [ / ]    = Cycle / lock profil aktif
  X        = Clear lock
  D        = Hapus profil aktif
  Q/ESC    = Keluar
"""

import cv2
import numpy as np
import requests
import time
import datetime
import threading
import json
import select
from collections import deque

# Optional: rembg for high-quality ML segmentation. Falls back to dominant-color
# K-means if not installed. Install: pip install rembg onnxruntime
REMBG_AVAILABLE = False
_rembg_session = None
try:
    from rembg import new_session as _rembg_new_session, remove as _rembg_remove
    REMBG_AVAILABLE = True
except ImportError:
    _rembg_new_session = None
    _rembg_remove = None

IS_MACOS = platform.system() == "Darwin"
IS_WINDOWS = platform.system() == "Windows"

print(
    f"[SYS] {platform.system()} {platform.machine()} | Python {sys.version.split()[0]} | OpenCV {cv2.__version__}"
)


# ══════════════════════════════════════════════════════════════════════
#  KONFIGURASI
# ══════════════════════════════════════════════════════════════════════


class Config:
    CAMERA_INDEX = 0
    FRAME_WIDTH = 1920
    FRAME_HEIGHT = 1080
    FPS = 30

    PIXELS_PER_MM = 10.0       # average (legacy + display)
    PIXELS_PER_MM_L = 10.0     # scale for object's longer side
    PIXELS_PER_MM_W = 10.0     # scale for object's shorter side
    CALIBRATED = False
    CALIBRATION_FILE = "calibration.json"
    REF_WIDTH_MM = 85.6  # KTP standar Indonesia (ISO/IEC 7810 ID-1)
    REF_HEIGHT_MM = 53.98

    # Strict KTP detection thresholds (used in calibration wizard)
    KTP_RATIO_TOLERANCE = 0.06       # ±6% of 1.585
    KTP_MIN_SOLIDITY = 0.90          # rectangularity check
    KTP_MIN_AREA_FRAC = 0.02         # ≥2% of frame area

    # Dominant-color segmentation: floor for HSV-distance threshold
    BG_DIFF_THRESHOLD = 25

    CATALOG_FILE = "objects.json"
    MATCH_WINDOW_MM = 8.0
    DEFAULT_TOL_MM = 2.0
    AUTO_REGISTER_SECS = 2.0

    # Live-cal toggle (handheld): re-detect KTP each frame to update scale
    LIVE_CAL_MODE = False            # default OFF — wizard does static cal
    LIVE_CAL_MIN_CONSISTENCY = 0.85

    SMOOTH_SAMPLES = 15        # rolling median window (more = tighter, more lag)
    CAL_AVG_FRAMES = 50        # frames averaged during cross-cal for robust ppmm
    CAL_OUTLIER_SIGMA = 1.5    # reject samples > Nσ from median during cross-cal
    CAL_MAX_TILT_DEG = 2.0     # max KTP rotation deviation from axis-aligned
    MIN_SEND_INTERVAL = 2.0
    CHANGE_THRESHOLD = 0.05
    MIN_CONTOUR_AREA = 2000
    CONFIDENCE_MIN = 0.7

    API_URL = "http://localhost:3000/inspection"
    API_TIMEOUT = 3
    PENDING_URL = "http://localhost:3000/api/pending"

    C_OK = (50, 210, 50)
    C_NG = (50, 50, 220)
    C_CYAN = (220, 200, 0)
    C_WHITE = (255, 255, 255)
    C_GRAY = (140, 140, 140)
    C_YELLOW = (0, 215, 255)
    C_DARK = (15, 20, 38)
    C_BLUE = (200, 150, 30)
    C_UNKNOWN = (180, 180, 0)


# ══════════════════════════════════════════════════════════════════════
#  KALIBRASI px↔mm (kartu referensi)
# ══════════════════════════════════════════════════════════════════════


def save_calibration(px_per_mm_L, px_per_mm_W=None):
    """Save both L (long-side) and W (short-side) scales. Pass single value for
    isotropic calibration (legacy)."""
    if px_per_mm_W is None:
        px_per_mm_W = px_per_mm_L
    avg = (px_per_mm_L + px_per_mm_W) / 2.0
    data = {
        "pixels_per_mm": avg,
        "pixels_per_mm_L": px_per_mm_L,
        "pixels_per_mm_W": px_per_mm_W,
        "timestamp": datetime.datetime.now().isoformat(),
        "ref_object": f"{Config.REF_WIDTH_MM}x{Config.REF_HEIGHT_MM}mm",
    }
    try:
        with open(Config.CALIBRATION_FILE, "w") as f:
            json.dump(data, f, indent=2)
        print(f"  [CAL] Saved: L={px_per_mm_L:.4f}  W={px_per_mm_W:.4f} px/mm  (avg {avg:.4f})")
    except Exception as e:
        print(f"  [!] Save failed: {e}")


def load_calibration():
    try:
        if os.path.exists(Config.CALIBRATION_FILE):
            with open(Config.CALIBRATION_FILE, "r") as f:
                data = json.load(f)
            px = data.get("pixels_per_mm")
            px_L = data.get("pixels_per_mm_L", px)
            px_W = data.get("pixels_per_mm_W", px)
            if px and px > 0:
                Config.PIXELS_PER_MM = px
                Config.PIXELS_PER_MM_L = px_L if px_L and px_L > 0 else px
                Config.PIXELS_PER_MM_W = px_W if px_W and px_W > 0 else px
                Config.CALIBRATED = True
                print(
                    f"  [CAL] Loaded: L={Config.PIXELS_PER_MM_L:.4f}  W={Config.PIXELS_PER_MM_W:.4f} px/mm "
                    f"(avg {px:.4f}) from {data.get('timestamp','?')}"
                )
                return True
    except Exception as e:
        print(f"  [!] Load failed: {e}")
    return False


def detect_reference_object(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    thresh = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=15,
        C=5,
    )
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    target_ratio = Config.REF_WIDTH_MM / Config.REF_HEIGHT_MM
    best = None
    best_score = 0
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 5000:
            continue
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if len(approx) < 4 or len(approx) > 6:
            continue
        rect = cv2.minAreaRect(cnt)
        (cx, cy), (rw, rh), angle = rect
        if rw < 50 or rh < 50:
            continue
        w_px = max(rw, rh)
        h_px = min(rw, rh)
        ratio = w_px / h_px
        ratio_diff = abs(ratio - target_ratio)
        if ratio_diff > 0.3:
            continue
        score = area * (1 - ratio_diff)
        if score > best_score:
            best_score = score
            best = (w_px, h_px, cnt, rect)
    if best:
        return best
    return None, None, None, None


def calibrate_from_reference(frame):
    w_px, h_px, cnt, rect = detect_reference_object(frame)
    if w_px is None:
        return None
    ppmm_w = w_px / Config.REF_WIDTH_MM
    ppmm_h = h_px / Config.REF_HEIGHT_MM
    ppmm_avg = (ppmm_w + ppmm_h) / 2.0
    consistency = 1.0 - abs(ppmm_w - ppmm_h) / max(ppmm_w, ppmm_h)
    if consistency < 0.85:
        print(f"  [CAL] Low consistency ({consistency:.2f}) — reposition card")
        return None
    print(f"  [CAL] W: {w_px:.1f}px/{Config.REF_WIDTH_MM}mm = {ppmm_w:.4f}")
    print(f"  [CAL] H: {h_px:.1f}px/{Config.REF_HEIGHT_MM}mm = {ppmm_h:.4f}")
    print(f"  [CAL] Avg: {ppmm_avg:.4f} px/mm | Consistency: {consistency:.3f}")
    return ppmm_avg


def detect_ktp_strict(frame):
    """Stricter KTP detection for calibration wizard.
    Returns (w_px, h_px, cnt, rect, score) or None.
    """
    cfg = Config
    h_frame, w_frame = frame.shape[:2]
    min_area = max(15000, int(h_frame * w_frame * cfg.KTP_MIN_AREA_FRAC))
    target_ratio = cfg.REF_WIDTH_MM / cfg.REF_HEIGHT_MM  # 1.585

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # Try multiple thresholding methods for robustness
    candidates = []
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    candidates.append(otsu)
    candidates.append(cv2.bitwise_not(otsu))
    candidates.append(
        cv2.adaptiveThreshold(
            blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV, 19, 7,
        )
    )

    best = None
    best_score = 0.0
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))

    for thr in candidates:
        closed = cv2.morphologyEx(thr, cv2.MORPH_CLOSE, kernel, iterations=2)
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < min_area:
                continue
            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
            if len(approx) != 4:
                continue
            if not cv2.isContourConvex(approx):
                continue
            rect = cv2.minAreaRect(cnt)
            (_cx, _cy), (rw, rh), _ = rect
            if rw < 80 or rh < 50:
                continue
            w_px = max(rw, rh)
            h_px = min(rw, rh)
            ratio = w_px / h_px
            ratio_diff = abs(ratio - target_ratio) / target_ratio
            if ratio_diff > cfg.KTP_RATIO_TOLERANCE:
                continue
            hull = cv2.convexHull(cnt)
            hull_area = cv2.contourArea(hull)
            solidity = area / hull_area if hull_area > 0 else 0
            if solidity < cfg.KTP_MIN_SOLIDITY:
                continue
            score = area * (1 - ratio_diff) * solidity
            if score > best_score:
                best_score = score
                best = (w_px, h_px, cnt, rect, score)
    return best


def _draw_wizard_banner(frame, title, subtitle1, subtitle2):
    cfg = Config
    w_f = frame.shape[1]
    cv2.rectangle(frame, (0, 0), (w_f, 90), cfg.C_DARK, -1)
    cv2.putText(frame, title, (12, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, cfg.C_YELLOW, 2, cv2.LINE_AA)
    cv2.putText(frame, subtitle1, (12, 58),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, cfg.C_GRAY, 1, cv2.LINE_AA)
    cv2.putText(frame, subtitle2, (12, 78),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, cfg.C_GRAY, 1, cv2.LINE_AA)


def _wizard_phase_ktp(cap, win):
    """Phase 1: detect KTP, ask Y/N to confirm. Returns ppmm or None if cancelled."""
    cfg = Config
    while True:
        ret, frame = cap.read()
        if not ret or frame is None:
            time.sleep(0.03)
            continue

        result = detect_ktp_strict(frame)
        ann = frame.copy()
        h_f, w_f = ann.shape[:2]
        fcx, fcy = w_f // 2, h_f // 2

        _draw_wizard_banner(
            ann,
            "WIZARD 1/2 — TAMPILKAN KTP KE KAMERA",
            f"KTP standar Indonesia: {cfg.REF_WIDTH_MM}x{cfg.REF_HEIGHT_MM}mm",
            "[SPACE] cek deteksi   [ESC] cancel",
        )

        is_inside_box = False
        is_perfectly_centered = False
        is_axis_aligned = False
        dist_px = 0.0
        tight_thr = 0.0
        tilt_deg = 0.0

        if result is not None:
            w_px, h_px, _cnt, rect, _score = result
            box = cv2.boxPoints(rect).astype(int)

            # Stage 1: reticle inside KTP bbox?
            inside = cv2.pointPolygonTest(
                box.astype(np.float32), (float(fcx), float(fcy)), False
            )
            is_inside_box = inside >= 0

            # Stage 2: STRICTLY centered? Distance from KTP geometric center.
            ktp_cx, ktp_cy = rect[0]
            dist_px = ((fcx - ktp_cx) ** 2 + (fcy - ktp_cy) ** 2) ** 0.5
            tight_thr = min(rect[1]) * 0.04
            is_perfectly_centered = dist_px <= tight_thr

            # Stage 3: ROTATION — compute SIGNED tilt so we can tell user
            # which way to rotate (kiri/kanan) in real time.
            box_f = box.astype(np.float32)
            edges_len_pairs = []
            for i in range(4):
                p1, p2 = box_f[i], box_f[(i + 1) % 4]
                edges_len_pairs.append((float(np.linalg.norm(p2 - p1)), p1, p2))
            edges_len_pairs.sort(key=lambda t: t[0], reverse=True)
            _, lp1, lp2 = edges_len_pairs[0]
            long_dx = lp2[0] - lp1[0]
            long_dy = lp2[1] - lp1[1]
            raw_angle = float(np.degrees(np.arctan2(long_dy, long_dx)))
            # Normalize to [0, 180) — direction of edge vector irrelevant
            norm_angle = raw_angle % 180
            # Signed tilt from nearest axis (0° or 90°):
            #   tilt > 0 → KTP rotated visual-CW → user must "putar kiri" (CCW)
            #   tilt < 0 → KTP rotated visual-CCW → user must "putar kanan" (CW)
            if norm_angle <= 45:
                tilt_signed = norm_angle           # near horizontal axis
            elif norm_angle <= 135:
                tilt_signed = norm_angle - 90      # near vertical axis
            else:
                tilt_signed = norm_angle - 180     # near horizontal (wraparound)
            tilt_deg = abs(tilt_signed)
            is_axis_aligned = tilt_deg <= cfg.CAL_MAX_TILT_DEG

            # Real-time rotation guidance text + color
            if tilt_deg <= 0.5:
                rot_msg = "LURUS PRESISI"
                rot_clr = cfg.C_OK
            elif is_axis_aligned:
                rot_msg = f"Lurus ({tilt_deg:.1f} deg)"
                rot_clr = cfg.C_OK
            elif tilt_deg <= 5:
                arah = "kanan" if tilt_signed < 0 else "kiri"
                rot_msg = f"Putar {arah} sedikit lagi ({tilt_deg:.1f} deg)"
                rot_clr = cfg.C_YELLOW
            elif tilt_deg <= 15:
                arah = "kanan" if tilt_signed < 0 else "kiri"
                rot_msg = f"Putar {arah} ({tilt_deg:.1f} deg)"
                rot_clr = (50, 130, 230)
            else:
                arah = "kanan" if tilt_signed < 0 else "kiri"
                rot_msg = f"PUTAR {arah.upper()} BANYAK ({tilt_deg:.1f} deg)"
                rot_clr = cfg.C_NG

            # 4-state color: red(out) → orange(in,off) → yellow(centered,tilted) → green(all)
            all_ok = is_perfectly_centered and is_axis_aligned
            if all_ok:
                box_color = cfg.C_OK
            elif is_perfectly_centered:
                box_color = cfg.C_YELLOW
            elif is_inside_box:
                box_color = (50, 130, 230)  # orange
            else:
                box_color = cfg.C_NG

            cv2.drawContours(ann, [box], 0, box_color, 3)

            # Offset line: KTP center → reticle center
            line_clr = cfg.C_OK if all_ok else cfg.C_NG
            cv2.line(ann, (int(ktp_cx), int(ktp_cy)), (fcx, fcy),
                     line_clr, 2, cv2.LINE_AA)
            cv2.circle(ann, (int(ktp_cx), int(ktp_cy)), 10, box_color, 2, cv2.LINE_AA)

            # Tilt indicator: dashed line showing the long edge of KTP and a
            # horizontal/vertical reference at frame center for visual compare
            tilt_clr = cfg.C_OK if is_axis_aligned else (50, 130, 230)
            cv2.line(ann, (int(lp1[0]), int(lp1[1])), (int(lp2[0]), int(lp2[1])),
                     tilt_clr, 2, cv2.LINE_AA)

            ppmm_w = w_px / cfg.REF_WIDTH_MM
            ppmm_h = h_px / cfg.REF_HEIGHT_MM
            ppmm_avg = (ppmm_w + ppmm_h) / 2.0
            consistency = 1.0 - abs(ppmm_w - ppmm_h) / max(ppmm_w, ppmm_h)
            cv2.putText(ann, f"{w_px:.0f}x{h_px:.0f}px",
                        (int(ktp_cx) - 70, int(ktp_cy) - 48),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, box_color, 2, cv2.LINE_AA)
            cv2.putText(ann, f"{ppmm_avg:.2f}px/mm  ({consistency:.0%})",
                        (int(ktp_cx) - 80, int(ktp_cy) - 25),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, box_color, 2, cv2.LINE_AA)
            cv2.putText(ann, f"OFFSET: {dist_px:.0f}px / {tight_thr:.0f}px max",
                        (int(ktp_cx) - 110, int(ktp_cy) + 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                        cfg.C_OK if is_perfectly_centered else cfg.C_NG, 1, cv2.LINE_AA)
            cv2.putText(ann, f"TILT: {tilt_deg:.2f}° / {cfg.CAL_MAX_TILT_DEG:.1f}° max",
                        (int(ktp_cx) - 110, int(ktp_cy) + 50),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                        cfg.C_OK if is_axis_aligned else (50, 130, 230), 1, cv2.LINE_AA)
        else:
            cv2.putText(ann, "KTP tidak terdeteksi — atur sudut/jarak/cahaya",
                        (w_f // 2 - 250, h_f // 2 + 110),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, cfg.C_NG, 2, cv2.LINE_AA)

        # Reticle color reflects the strictest unmet criterion
        if result is not None and is_perfectly_centered and is_axis_aligned:
            reticle_clr = cfg.C_OK
        elif result is not None and is_perfectly_centered:
            reticle_clr = cfg.C_YELLOW
        elif result is not None and is_inside_box:
            reticle_clr = (50, 130, 230)
        else:
            reticle_clr = (110, 160, 220)
        _draw_reticle(ann, color=reticle_clr)

        # 4-state guidance bar at bottom — uses real-time rotation message
        cv2.rectangle(ann, (0, h_f - 50), (w_f, h_f), cfg.C_DARK, -1)
        if result is None:
            bar_msg = ">> KTP tidak terlihat — tampilkan KTP ke kamera <<"
            bar_clr = cfg.C_NG
        elif not is_inside_box:
            bar_msg = ">> Reticle DI LUAR kotak KTP — geser ke tengah <<"
            bar_clr = cfg.C_NG
        elif not is_perfectly_centered:
            bar_msg = f">> Geser KTP: offset {dist_px:.0f}px / max {tight_thr:.0f}px <<"
            bar_clr = (50, 130, 230)
        elif not is_axis_aligned:
            bar_msg = f">> {rot_msg} <<"
            bar_clr = rot_clr
        else:
            bar_msg = ">> PRESISI + LURUS — Tekan [SPACE] untuk kalibrasi <<"
            bar_clr = cfg.C_OK
        cv2.putText(ann, bar_msg,
                    (w_f // 2 - 340, h_f - 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, bar_clr, 2, cv2.LINE_AA)

        # ── Side info panel (top-left) ──────────────────────────────────────
        # Procedure + real-time status. Helps user know exactly what to do.
        panel_x, panel_y, panel_w, panel_h = 10, 100, 360, 220
        ov = ann[panel_y:panel_y + panel_h, panel_x:panel_x + panel_w].copy()
        cv2.rectangle(ov, (0, 0), (panel_w, panel_h), cfg.C_DARK, -1)
        cv2.addWeighted(ov, 0.85, ann[panel_y:panel_y + panel_h, panel_x:panel_x + panel_w],
                        0.15, 0, ann[panel_y:panel_y + panel_h, panel_x:panel_x + panel_w])
        cv2.rectangle(ann, (panel_x, panel_y),
                      (panel_x + panel_w, panel_y + panel_h),
                      reticle_clr, 1)
        cv2.putText(ann, "PROSEDUR KALIBRASI:",
                    (panel_x + 10, panel_y + 22),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, cfg.C_WHITE, 1, cv2.LINE_AA)
        cv2.putText(ann, "1. KTP DI TENGAH RETICLE (target hijau)",
                    (panel_x + 10, panel_y + 48),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, cfg.C_GRAY, 1, cv2.LINE_AA)
        cv2.putText(ann, "2. PUTAR KTP sampai LURUS axis-aligned",
                    (panel_x + 10, panel_y + 68),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, cfg.C_GRAY, 1, cv2.LINE_AA)
        cv2.putText(ann, "3. SPACE saat status PRESISI + LURUS",
                    (panel_x + 10, panel_y + 88),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, cfg.C_GRAY, 1, cv2.LINE_AA)

        cv2.line(ann, (panel_x + 10, panel_y + 105),
                 (panel_x + panel_w - 10, panel_y + 105), (60, 80, 110), 1)

        cv2.putText(ann, "STATUS REAL-TIME:",
                    (panel_x + 10, panel_y + 128),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, cfg.C_WHITE, 1, cv2.LINE_AA)

        # Detection status row
        det_clr = cfg.C_OK if result is not None else cfg.C_NG
        det_txt = "TERDETEKSI" if result is not None else "tidak ada"
        cv2.putText(ann, f"Deteksi:  {det_txt}",
                    (panel_x + 10, panel_y + 152),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, det_clr, 1, cv2.LINE_AA)

        # Centering status row
        if result is not None:
            if is_perfectly_centered:
                ctr_txt = f"PRESISI ({dist_px:.0f}px)"
                ctr_clr = cfg.C_OK
            elif is_inside_box:
                ctr_txt = f"belum center ({dist_px:.0f}px)"
                ctr_clr = (50, 130, 230)
            else:
                ctr_txt = "DI LUAR kotak"
                ctr_clr = cfg.C_NG
        else:
            ctr_txt = "—"
            ctr_clr = cfg.C_GRAY
        cv2.putText(ann, f"Center:   {ctr_txt}",
                    (panel_x + 10, panel_y + 174),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, ctr_clr, 1, cv2.LINE_AA)

        # Rotation status row — the real-time direction message
        if result is not None:
            cv2.putText(ann, f"Rotasi:   {rot_msg}",
                        (panel_x + 10, panel_y + 196),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, rot_clr, 1, cv2.LINE_AA)
        else:
            cv2.putText(ann, "Rotasi:   —",
                        (panel_x + 10, panel_y + 196),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, cfg.C_GRAY, 1, cv2.LINE_AA)

        cv2.imshow(win, ann)
        key = cv2.waitKey(1) & 0xFF

        if key == 27:
            return None

        # SPACE only works when ALL THREE: detected + centered + axis-aligned
        if (key == ord(" ") and result is not None
                and is_perfectly_centered and is_axis_aligned):
            w_px, h_px, _cnt, rect, _score = result
            ppmm_w = w_px / cfg.REF_WIDTH_MM
            ppmm_h = h_px / cfg.REF_HEIGHT_MM
            ppmm_avg = (ppmm_w + ppmm_h) / 2.0
            consistency = 1.0 - abs(ppmm_w - ppmm_h) / max(ppmm_w, ppmm_h)

            confirm = ann.copy()
            ox, oy = w_f // 2 - 280, h_f // 2 - 100
            cv2.rectangle(confirm, (ox, oy), (ox + 560, oy + 200), cfg.C_DARK, -1)
            cv2.rectangle(confirm, (ox, oy), (ox + 560, oy + 200), cfg.C_YELLOW, 2)
            cv2.putText(confirm, "VALIDASI: Apakah ini KTP yang akan dikalibrasi?",
                        (ox + 14, oy + 32),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, cfg.C_WHITE, 1, cv2.LINE_AA)
            cv2.putText(confirm, f"Skala: {ppmm_avg:.4f} px/mm  (1px = {1/ppmm_avg:.4f}mm)",
                        (ox + 14, oy + 64),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, cfg.C_GRAY, 1, cv2.LINE_AA)
            cv2.putText(confirm, f"Konsistensi W/H: {consistency:.1%}",
                        (ox + 14, oy + 90),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                        cfg.C_OK if consistency >= 0.9 else cfg.C_YELLOW,
                        1, cv2.LINE_AA)
            cv2.putText(confirm, f"Terdeteksi: {w_px:.0f}x{h_px:.0f}px",
                        (ox + 14, oy + 116),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, cfg.C_GRAY, 1, cv2.LINE_AA)
            cv2.putText(confirm, "[Y] YA, simpan       [N] TIDAK, ulang       [ESC] cancel",
                        (ox + 14, oy + 165),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, cfg.C_OK, 1, cv2.LINE_AA)
            cv2.imshow(win, confirm)

            while True:
                k2 = cv2.waitKey(0) & 0xFF
                if k2 in (ord("y"), ord("Y")):
                    # Cross-calibrate via measurement pipeline AVERAGED over
                    # multiple frames. Single-frame ppmm is sensitive to rembg
                    # frame-to-frame variation; median of N frames cancels it.
                    target_aspect = cfg.REF_WIDTH_MM / cfg.REF_HEIGHT_MM
                    ppmm_L_final = ppmm_avg
                    ppmm_W_final = ppmm_avg

                    # Show "calibrating..." overlay while we capture frames
                    busy = ann.copy()
                    cv2.rectangle(busy, (0, h_f - 90), (w_f, h_f), cfg.C_DARK, -1)
                    cv2.putText(busy,
                                f">> Capturing {cfg.CAL_AVG_FRAMES} frames for robust calibration...",
                                (w_f // 2 - 280, h_f - 36),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, cfg.C_YELLOW, 2, cv2.LINE_AA)
                    cv2.imshow(win, busy)
                    cv2.waitKey(1)

                    # Collect rembg measurements across N frames
                    L_px_samples = []
                    W_px_samples = []
                    for _ in range(cfg.CAL_AVG_FRAMES):
                        ret_s, f_s = cap.read()
                        if not (ret_s and f_s is not None):
                            continue
                        m, _, _, _ = extract_measurement(f_s)
                        if m is not None:
                            L_px_samples.append(m["L_px"])
                            W_px_samples.append(m["W_px"])

                    if len(L_px_samples) >= max(3, cfg.CAL_AVG_FRAMES // 2):
                        # Outlier rejection: drop samples > Nσ from the median
                        # before re-computing the final median. This kills any
                        # rembg flicker frames that occasionally inflate L/W.
                        L_arr = np.array(L_px_samples)
                        W_arr = np.array(W_px_samples)
                        L_med0, L_std0 = float(np.median(L_arr)), float(np.std(L_arr))
                        W_med0, W_std0 = float(np.median(W_arr)), float(np.std(W_arr))
                        sigma = cfg.CAL_OUTLIER_SIGMA
                        L_clean = L_arr[np.abs(L_arr - L_med0) <= sigma * max(L_std0, 0.5)]
                        W_clean = W_arr[np.abs(W_arr - W_med0) <= sigma * max(W_std0, 0.5)]
                        L_dropped = len(L_arr) - len(L_clean)
                        W_dropped = len(W_arr) - len(W_clean)
                        L_px_med = float(np.median(L_clean)) if len(L_clean) else L_med0
                        W_px_med = float(np.median(W_clean)) if len(W_clean) else W_med0
                        L_px_std = float(np.std(L_clean)) if len(L_clean) > 1 else L_std0
                        W_px_std = float(np.std(W_clean)) if len(W_clean) > 1 else W_std0
                        aspect_m = L_px_med / W_px_med if W_px_med > 0 else 0
                        aspect_diff = abs(aspect_m - target_aspect) / target_aspect
                        if aspect_diff < 0.10:
                            ppmm_L_x = L_px_med / cfg.REF_WIDTH_MM
                            ppmm_W_x = W_px_med / cfg.REF_HEIGHT_MM
                            change_L = (ppmm_L_x / ppmm_avg - 1) * 100
                            change_W = (ppmm_W_x / ppmm_avg - 1) * 100
                            if abs(change_L) < 25 and abs(change_W) < 25:
                                print(f"  [WIZARD] Cross-cal over {len(L_px_samples)} frames "
                                      f"(L outliers dropped: {L_dropped}, W: {W_dropped}):")
                                print(f"           L_px median = {L_px_med:.2f} (std {L_px_std:.2f})")
                                print(f"           W_px median = {W_px_med:.2f} (std {W_px_std:.2f})")
                                print(f"           aspect {aspect_m:.4f}  (target {target_aspect:.4f})")
                                print(f"           ppmm_L = {ppmm_L_x:.4f}  ({change_L:+.2f}% vs strict)")
                                print(f"           ppmm_W = {ppmm_W_x:.4f}  ({change_W:+.2f}% vs strict)")
                                print("           → KTP measured later will read 85.6 × 53.98 mm")
                                ppmm_L_final = ppmm_L_x
                                ppmm_W_final = ppmm_W_x
                            else:
                                print(f"  [WIZARD] Cross-cal change too large (L{change_L:+.1f}% W{change_W:+.1f}%) — strict")
                        else:
                            print(f"  [WIZARD] rembg aspect {aspect_m:.3f} ≠ KTP {target_aspect:.3f} — strict")
                    else:
                        print(f"  [WIZARD] Only {len(L_px_samples)} valid samples — strict scale")
                    print(f"  [WIZARD] KTP locked: ppmm_L={ppmm_L_final:.4f}  ppmm_W={ppmm_W_final:.4f}")
                    return (ppmm_L_final, ppmm_W_final)
                if k2 in (ord("n"), ord("N")):
                    print("  [WIZARD] Retry — show KTP again")
                    break
                if k2 == 27:
                    return None


def calibration_wizard(cap, win):
    """KTP-only calibration. Returns (ppmm_L, ppmm_W) or None.
    Anisotropic: separate scale for long side and short side so KTP reads
    85.6 × 53.98 mm exactly when measured via the same pipeline.
    """
    print("\n" + "=" * 60)
    print("  CALIBRATION WIZARD — KTP")
    print("=" * 60)
    print("  Tampilkan KTP ke kamera")
    result = _wizard_phase_ktp(cap, win)
    if result is None:
        print("  [WIZARD] Cancelled.")
        return None
    print("  [WIZARD] Done. System ready for measurement.\n")
    return result  # (ppmm_L, ppmm_W)


# ══════════════════════════════════════════════════════════════════════
#  KATALOG OBJEK
# ══════════════════════════════════════════════════════════════════════


class ObjectCatalog:
    def __init__(self, path=None):
        self.path = path or Config.CATALOG_FILE
        self.items = []
        self.load()

    def load(self):
        if not os.path.exists(self.path):
            print(f"  [CAT] No catalog yet — will create {self.path} on first register")
            return
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                self.items = json.load(f)
            print(
                f"  [CAT] Loaded {len(self.items)} object profile(s) from {self.path}"
            )
            for it in self.items:
                tol = it.get("tol_L", Config.DEFAULT_TOL_MM)
                print(
                    f"        - {it['name']:<20} L={it['L_mm']:.2f}mm  W={it['W_mm']:.2f}mm  ±{tol}"
                )
        except Exception as e:
            print(f"  [!] Catalog load failed: {e}")
            self.items = []

    def save(self):
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self.items, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"  [!] Catalog save failed: {e}")

    def find_by_name(self, name):
        for it in self.items:
            if it["name"] == name:
                return it
        return None

    def match(self, L, W, window=None):
        """Auto-match measurement against catalog. Return closest profile within window or None."""
        if window is None:
            window = Config.MATCH_WINDOW_MM
        best, best_dist = None, float("inf")
        for it in self.items:
            dL = abs(L - it["L_mm"])
            dW = abs(W - it["W_mm"])
            if dL <= window and dW <= window:
                d = (dL * dL + dW * dW) ** 0.5
                if d < best_dist:
                    best_dist = d
                    best = it
        return best

    def register(self, name, L, W, tol_L=None, tol_W=None):
        tol_L = tol_L if tol_L is not None else Config.DEFAULT_TOL_MM
        tol_W = tol_W if tol_W is not None else Config.DEFAULT_TOL_MM
        for it in self.items:
            if it["name"].lower() == name.lower():
                it["L_mm"] = round(L, 3)
                it["W_mm"] = round(W, 3)
                it["tol_L"] = tol_L
                it["tol_W"] = tol_W
                it["updated"] = datetime.datetime.now().isoformat()
                self.save()
                print(f"  [CAT] Updated '{name}': L={L:.2f}mm W={W:.2f}mm")
                return it
        new = {
            "name": name,
            "L_mm": round(L, 3),
            "W_mm": round(W, 3),
            "tol_L": tol_L,
            "tol_W": tol_W,
            "created": datetime.datetime.now().isoformat(),
        }
        self.items.append(new)
        self.save()
        print(
            f"  [CAT] Registered '{name}': L={L:.2f}mm W={W:.2f}mm (total {len(self.items)})"
        )
        return new

    def delete(self, name):
        before = len(self.items)
        self.items = [it for it in self.items if it["name"] != name]
        if len(self.items) < before:
            self.save()
            print(f"  [CAT] Deleted '{name}'")
            return True
        return False

    def cycle(self, current_name, direction=1):
        if not self.items:
            return None
        names = [it["name"] for it in self.items]
        if current_name in names:
            idx = (names.index(current_name) + direction) % len(names)
        else:
            idx = 0
        return self.items[idx]


def evaluate_status(L, W, profile):
    """Return (status_L, status_W, overall) — 'OK' or 'NG'."""
    tol_L = profile.get("tol_L", Config.DEFAULT_TOL_MM)
    tol_W = profile.get("tol_W", Config.DEFAULT_TOL_MM)
    sL = "OK" if abs(L - profile["L_mm"]) <= tol_L else "NG"
    sW = "OK" if abs(W - profile["W_mm"]) <= tol_W else "NG"
    overall = "OK" if sL == "OK" and sW == "OK" else "NG"
    return sL, sW, overall


def prompt_object_name(measured_L, measured_W, catalog):
    """Hybrid naming: accept input from terminal input() OR from web dashboard.

    Flow:
      1. POST {L_mm, W_mm} ke /api/pending (kalau server jalan) → dapat {id}.
      2. Print terminal prompt seperti biasa.
      3. Background daemon thread polling /api/pending/:id setiap 0.6s.
      4. Mana duluan menang:
         - User ketik di terminal + Enter (non-empty) → terminal name dipakai.
         - User submit di dashboard duluan → daemon thread cetak
           "[WEB] Nama dari web: 'X' — TEKAN ENTER untuk lanjut" → user
           tinggal tekan Enter (terminal kosong) → web name dipakai.
         - Terminal kosong + tidak ada web → skip (None).
      5. Server mati → POST gagal → pending_id None → daemon skip → fallback
         ke terminal-only (perilaku v2.0 100% kompatibel).

    Returns: name str atau None (skipped/cancelled).
    """
    cfg = Config

    print()
    print("  " + "═" * 58)
    print("  ▶  OBJEK BARU TERDETEKSI — beri nama untuk disimpan")
    print(f"     Terukur:  L = {measured_L:.2f} mm   W = {measured_W:.2f} mm")
    if catalog.items:
        print(f"     Existing: {', '.join(it['name'] for it in catalog.items)}")

    # POST pending. Kalau gagal (server mati), pending_id None → fallback
    # ke terminal-only otomatis tanpa error.
    pending_id = None
    try:
        r = requests.post(
            cfg.PENDING_URL,
            json={"L_mm": float(measured_L), "W_mm": float(measured_W)},
            timeout=cfg.API_TIMEOUT,
        )
        if r.status_code == 201:
            pending_id = r.json().get("id")
            if pending_id:
                print(f"     ▶ Atau buka http://localhost:3000  (Pending #{pending_id})")
    except Exception:
        pass  # web optional — terminal jalan terus

    print("  " + "─" * 58)

    web_result = {"name": None, "received": False}
    stop_event = threading.Event()

    def web_poller():
        if not pending_id:
            return
        poll_url = f"{cfg.PENDING_URL}/{pending_id}"
        while not stop_event.is_set():
            stop_event.wait(0.6)
            if stop_event.is_set():
                break
            try:
                pr = requests.get(poll_url, timeout=2)
                if pr.status_code != 200:
                    continue
                pdata = (pr.json() or {}).get("data", {})
                name = pdata.get("name")
                if name == "__SKIP__":
                    web_result["name"] = ""
                    web_result["received"] = True
                    print("\n  [WEB] Dilewati via web — TEKAN ENTER untuk lanjut")
                    return
                if name:
                    web_result["name"] = name
                    web_result["received"] = True
                    print(f"\n  [WEB] Nama dari web: '{name}' — TEKAN ENTER untuk lanjut")
                    return
            except Exception:
                pass

    poller = None
    if pending_id:
        poller = threading.Thread(target=web_poller, daemon=True)
        poller.start()

    # Detect if we can do truly non-blocking stdin polling (POSIX TTY).
    # When supported, web submit → edge proceeds INSTANTLY without requiring
    # user to press Enter in terminal. On Windows / non-TTY → blocking fallback.
    nonblock = False
    if not IS_WINDOWS and sys.stdin.isatty():
        try:
            select.select([sys.stdin], [], [], 0)
            nonblock = True
        except Exception:
            nonblock = False

    terminal_input = None

    if nonblock:
        # POSIX non-blocking path: poll select() + web flag setiap 0.15s.
        # Terminal Enter atau web submit, mana duluan menang — TANPA blocking.
        sys.stdout.write(
            "     Nama benda (atau submit di web — Enter = skip): "
        )
        sys.stdout.flush()
        deadline = time.time() + 120.0  # hard 2-min ceiling
        while time.time() < deadline:
            if web_result["received"]:
                # Web menang — finish prompt line, drop partial typing dari driver
                sys.stdout.write("\n")
                sys.stdout.flush()
                try:
                    import termios
                    termios.tcflush(sys.stdin.fileno(), termios.TCIFLUSH)
                except Exception:
                    pass
                if web_result["name"]:
                    print(f"  [WEB] Nama diterima: '{web_result['name']}'")
                else:
                    print("  [WEB] Dilewati via web")
                break
            try:
                rlist, _, _ = select.select([sys.stdin], [], [], 0.15)
            except Exception:
                rlist = None
            if rlist:
                line = sys.stdin.readline()
                if not line:
                    terminal_input = ""
                else:
                    terminal_input = line.rstrip("\n").strip()
                break
    else:
        # Blocking fallback (Windows / piped stdin) — daemon notice + Enter required
        def web_notice_watcher():
            while not stop_event.is_set():
                stop_event.wait(0.4)
                if web_result["received"]:
                    n = web_result["name"]
                    if n:
                        print(
                            f"\n  [WEB] Nama dari web: '{n}' — TEKAN ENTER untuk lanjut"
                        )
                    else:
                        print(
                            "\n  [WEB] Dilewati via web — TEKAN ENTER untuk lanjut"
                        )
                    return
        watcher = threading.Thread(target=web_notice_watcher, daemon=True)
        watcher.start()
        try:
            terminal_input = input(
                "     Nama benda (Enter kosong = pakai web / skip): "
            ).strip()
        except (KeyboardInterrupt, EOFError):
            terminal_input = ""
            print()

    stop_event.set()
    if poller:
        poller.join(timeout=1.0)

    # Cleanup pending di server kalau belum ter-handle (idempotent)
    if pending_id and not web_result["received"]:
        try:
            requests.delete(f"{cfg.PENDING_URL}/{pending_id}", timeout=2)
        except Exception:
            pass

    # Priority: terminal non-empty menang. Kalau terminal kosong, fallback ke web.
    if terminal_input:
        return terminal_input
    if web_result["received"]:
        return web_result["name"] or None
    print("     Dilewati.\n")
    return None


# ══════════════════════════════════════════════════════════════════════
#  PENGUKURAN — extract + draw terpisah supaya overlay bisa pakai profil
# ══════════════════════════════════════════════════════════════════════


def _draw_reticle(img, color=(110, 160, 220)):
    """Aim reticle at frame center: 2 concentric rings + 4 tick marks + dot.
    Used by both inspection overlay and calibration wizard so user always knows
    where to aim the object.
    """
    h, w = img.shape[:2]
    fcx, fcy = w // 2, h // 2
    cv2.circle(img, (fcx, fcy), 35, color, 1, cv2.LINE_AA)
    cv2.circle(img, (fcx, fcy), 70, color, 1, cv2.LINE_AA)
    cv2.line(img, (fcx, fcy - 50), (fcx, fcy - 20), color, 1, cv2.LINE_AA)
    cv2.line(img, (fcx, fcy + 20), (fcx, fcy + 50), color, 1, cv2.LINE_AA)
    cv2.line(img, (fcx - 50, fcy), (fcx - 20, fcy), color, 1, cv2.LINE_AA)
    cv2.line(img, (fcx + 20, fcy), (fcx + 50, fcy), color, 1, cv2.LINE_AA)
    cv2.circle(img, (fcx, fcy), 2, color, -1, cv2.LINE_AA)


def _refine_rect_corners(gray, contour):
    """Approximate a contour to 4 corners and sub-pixel refine each.
    Returns 4×2 float32 array (corner coords) or None if not a clean quad.

    Why: rembg's hull is slightly INSET from the actual card edge (~1-3 px).
    By approximating the contour to a 4-corner polygon and then refining each
    corner against the local image gradient (cornerSubPix), we recover the
    true card edge to <0.1 px accuracy. This eliminates the systematic bias
    of `minAreaRect(hull)` for clean rectangular objects (KTP, cards, boxes).
    Falls back gracefully (returns None) for non-rectangular objects.
    """
    peri = cv2.arcLength(contour, True)
    approx = None
    for eps_factor in (0.01, 0.015, 0.02, 0.025, 0.03, 0.04):
        a = cv2.approxPolyDP(contour, eps_factor * peri, True)
        if len(a) == 4 and cv2.isContourConvex(a):
            approx = a
            break
    if approx is None:
        return None
    corners = approx.astype(np.float32).reshape(-1, 1, 2)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.001)
    try:
        refined = cv2.cornerSubPix(gray, corners.copy(), (7, 7), (-1, -1), criteria)
    except cv2.error:
        return corners.reshape(4, 2)
    # Sanity: reject if any corner shifts more than 10 px (likely bad gradient)
    deltas = np.linalg.norm((refined - corners).reshape(4, 2), axis=1)
    if float(np.max(deltas)) > 10.0:
        return corners.reshape(4, 2)
    return refined.reshape(4, 2)


def _contour_touches_edge(cnt, h, w, margin=8):
    """True if contour bbox hugs frame edge AND is small enough to be likely
    an arm/finger/sleeve coming from outside (not the actual measurement
    target).

    Why size-gated: objek besar (tutup panci, piring, kotak besar) bisa secara
    sah mengisi hampir seluruh frame dan menyentuh tepi. Sebelum gating ini,
    filter membuang silhouette penuh dan menyisakan fragmen tengah yang
    membuat bbox jadi sliver memanjang yang aneh.

    Threshold 15% frame area dipilih karena lengan/sleeve yang masuk dari
    tepi biasanya punya bbox <10% frame, sedangkan objek pengukuran legit
    yang mengisi view biasanya >15%.
    """
    x, y, bw, bh = cv2.boundingRect(cnt)
    touches = (
        x <= margin
        or y <= margin
        or x + bw >= w - margin
        or y + bh >= h - margin
    )
    if not touches:
        return False
    # Big object filling the view → keep it (likely the actual target).
    if bw * bh > h * w * 0.15:
        return False
    return True


def _detect_skin_mask(frame):
    """YCrCb-based skin detection. Returns binary mask (uint8) where skin = 255.

    Why YCrCb: separates luminance from chrominance, so skin tones cluster in a
    compact 2D region (Cr, Cb) regardless of lighting. Robust across skin tones.
    Range dari literatur (Phung et al., 2002):  Cr ∈ [133, 173], Cb ∈ [77, 127].

    EDGE-CONNECTED ONLY: hanya komponen skin yang MENYENTUH tepi frame yang
    dianggap valid (jari/lengan datang dari luar frame, bukan muncul tiba-tiba
    di tengah). Patch warna skin di INTERIOR objek = highlight pada plastik
    oranye/kuning/coklat (warnanya kebetulan sama dengan kulit di YCrCb) →
    dipertahankan agar tidak melubangi mask objek skin-tone.

    Wajah pada KTP juga skin-tone tapi terisolasi di tengah → tidak dibuang.
    Tetap kompatibel dengan kalibrasi karena MORPH_CLOSE 21×21 + RETR_EXTERNAL
    fill di extract_measurement menghasilkan boundary yang sama atau lebih
    bersih (lebih sedikit hole untuk ditutup).
    """
    h, w = frame.shape[:2]
    ycrcb = cv2.cvtColor(frame, cv2.COLOR_BGR2YCrCb)
    lower = np.array([0, 133, 77], dtype=np.uint8)
    upper = np.array([255, 173, 127], dtype=np.uint8)
    skin_raw = cv2.inRange(ycrcb, lower, upper)

    # Keep only components that touch frame edge — those are the only ones
    # that can be hand/arm intrusions. Internal skin patches are object content.
    n_lab, labels, stats, _ = cv2.connectedComponentsWithStats(
        skin_raw, connectivity=8
    )
    skin = np.zeros_like(skin_raw)
    for i in range(1, n_lab):
        x, y, bw, bh, area = stats[i]
        if area < 200:
            continue  # noise speck
        touches_edge = (
            x <= 1 or y <= 1 or x + bw >= w - 1 or y + bh >= h - 1
        )
        if touches_edge:
            skin[labels == i] = 255

    if not np.any(skin):
        return skin  # nothing to subtract

    # Close small holes inside skin region; light dilation to catch fingertip
    # halo (anti-aliased pixels just outside skin)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    skin = cv2.morphologyEx(skin, cv2.MORPH_CLOSE, k, iterations=2)
    skin = cv2.dilate(skin, k, iterations=1)
    return skin


def _get_rembg_session():
    """Lazy-init rembg ONNX session. u2netp = small/fast (~5MB), enough for capstone."""
    global _rembg_session
    if _rembg_session is None and REMBG_AVAILABLE:
        print("  [REMBG] Loading model (first call only, ~5-30s)...")
        _rembg_session = _rembg_new_session("u2netp")
        print("  [REMBG] Model ready")
    return _rembg_session


def _rembg_mask(frame):
    """High-quality mask via rembg neural net. Returns binary uint8 mask."""
    session = _get_rembg_session()
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    raw = _rembg_remove(rgb, session=session, only_mask=True)
    if isinstance(raw, np.ndarray):
        if raw.ndim == 3:
            raw = cv2.cvtColor(raw, cv2.COLOR_RGB2GRAY)
    else:
        raw = np.array(raw)
        if raw.ndim == 3:
            raw = cv2.cvtColor(raw, cv2.COLOR_RGB2GRAY)
    _, mask = cv2.threshold(raw, 127, 255, cv2.THRESH_BINARY)
    # Light cleanup (rembg already gives clean mask, but seal small holes)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=1)
    return mask


def _dominant_color_mask(frame, base_threshold):
    """Per-frame segmentation: cluster colors, treat dominant cluster as background.
    Why: avoids needing a separate empty-background capture. Adapts to lighting
    automatically. Safeguard: if two clusters are similar in count, the one whose
    HSV mean is closer to border-pixel mean is taken as background (objects are
    almost never along the frame border).
    """
    h_full, w_full = frame.shape[:2]

    # Downsample for K-means speed
    scale = 0.25
    small = cv2.resize(frame, (max(int(w_full * scale), 32), max(int(h_full * scale), 32)),
                       interpolation=cv2.INTER_AREA)
    small_hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    pixels = small_hsv.reshape(-1, 3).astype(np.float32)

    # K-means K=2 (bg + fg)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 8, 1.0)
    _, labels, centers = cv2.kmeans(
        pixels, 2, None, criteria, 2, cv2.KMEANS_PP_CENTERS
    )
    labels = labels.flatten()
    counts = np.bincount(labels, minlength=2)

    # Border pixels of the downsampled frame ≈ background by assumption
    bw = max(int(min(small.shape[:2]) * 0.05), 2)
    border = np.concatenate([
        small_hsv[:bw, :, :].reshape(-1, 3),
        small_hsv[-bw:, :, :].reshape(-1, 3),
        small_hsv[:, :bw, :].reshape(-1, 3),
        small_hsv[:, -bw:, :].reshape(-1, 3),
    ]).astype(np.float32)
    border_mean = np.median(border, axis=0)

    # Distance of each cluster center to border mean (Hue circular)
    def center_dist(c):
        dh = abs(c[0] - border_mean[0])
        dh = min(dh, 180 - dh)
        return (dh * 2) ** 2 + (c[1] - border_mean[1]) ** 2 + ((c[2] - border_mean[2]) * 0.5) ** 2

    d0 = center_dist(centers[0])
    d1 = center_dist(centers[1])

    # Pick bg = cluster closer to border, unless one cluster is overwhelmingly bigger
    ratio = counts.max() / max(counts.min(), 1)
    if ratio >= 4:
        bg_idx = int(np.argmax(counts))
    else:
        bg_idx = 0 if d0 < d1 else 1

    bg_color = centers[bg_idx]

    # Compute distance map on full-resolution HSV
    full_hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV).astype(np.int16)
    raw_h = np.abs(full_hsv[:, :, 0] - bg_color[0])
    diff_h = np.minimum(raw_h, 180 - raw_h).astype(np.float32)
    diff_s = np.abs(full_hsv[:, :, 1] - bg_color[1]).astype(np.float32)
    diff_v = np.abs(full_hsv[:, :, 2] - bg_color[2]).astype(np.float32)

    # Weighted HSV distance: H and S more important than V (V drifts with shadow)
    distance = np.sqrt((diff_h * 2.0) ** 2 + diff_s ** 2 + (diff_v * 0.5) ** 2)
    distance = np.clip(distance, 0, 255).astype(np.uint8)
    distance = cv2.GaussianBlur(distance, (5, 5), 0)

    # Otsu auto-threshold; floor at base_threshold to prevent noise creep
    auto_t, _ = cv2.threshold(distance, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    final_t = max(int(auto_t), int(base_threshold))
    _, mask = cv2.threshold(distance, final_t, 255, cv2.THRESH_BINARY)

    # Cleanup
    k_close = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k_close, iterations=2)
    k_open = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k_open, iterations=2)
    k_erode = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    mask = cv2.erode(mask, k_erode, iterations=1)
    return mask


def extract_measurement(frame, exclude_rect=None, return_mask=False):
    """Detect dominant object via dominant-color segmentation.
    exclude_rect = a minAreaRect to skip (e.g., reference card in live mode).
    Returns (meas_dict, contour, rect, box_pts) or (..., mask) if return_mask.
    """
    cfg = Config
    h, w = frame.shape[:2]

    if REMBG_AVAILABLE:
        try:
            cleaned = _rembg_mask(frame)
        except Exception as e:
            print(f"  [!] rembg failed ({e}) — falling back to dominant-color")
            cleaned = _dominant_color_mask(frame, cfg.BG_DIFF_THRESHOLD)
    else:
        cleaned = _dominant_color_mask(frame, cfg.BG_DIFF_THRESHOLD)

    # Subtract skin (fingers/hand/arm) from object mask. Even when a finger
    # nudges the object into frame center, the finger itself never makes it
    # into the mask, so it can't win contour selection.
    skin = _detect_skin_mask(frame)
    cleaned = cv2.bitwise_and(cleaned, cv2.bitwise_not(skin))

    # Aggressive sealing: rembg can fragment masks on objects with complex
    # interior patterns (KTP back pita merah-putih, text regions, photo).
    # MORPH_CLOSE fills gaps up to kernel size. Iter=2 → bridges up to ~42px.
    seal_k = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 21))
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, seal_k, iterations=2)

    # Fill ENCLOSED interior holes — needed for shiny/dome objects (tutup
    # panci, piring, gelas) where rembg gives low confidence on highlight
    # regions, leaving black islands inside the silhouette. MORPH_CLOSE
    # alone can't bridge holes wider than ~42px.
    #
    # Strategi: ambil hanya OUTER contour (RETR_EXTERNAL — abaikan inner
    # contours yang merepresentasikan holes), lalu gambar terisi penuh.
    # Hasilnya hole internal otomatis tertutup tanpa mengubah outer boundary.
    # Untuk KTP (mask sudah solid, tidak ada hole) → idempotent: outer
    # contour = boundary asli, fill = boundary asli → bit-for-bit sama,
    # akurasi kalibrasi tidak berubah.
    contours_ext, _ = cv2.findContours(
        cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    if contours_ext:
        filled = np.zeros_like(cleaned)
        cv2.drawContours(filled, contours_ext, -1, 255, thickness=cv2.FILLED)
        cleaned = filled

    # Fine erode to compensate the slight boundary outward drift caused by
    # close (when close bridges fragments, the merged blob's outer edge is
    # ~1-2px wider than the original). 1 iter of 3x3 retracts that drift
    # → measured dimensions match true object size to <0.1mm.
    shrink_k = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    cleaned = cv2.erode(cleaned, shrink_k, iterations=1)
    debug_mask = cleaned

    contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    valid = [c for c in contours if cv2.contourArea(c) > cfg.MIN_CONTOUR_AREA]

    # Reject contours touching frame edge — anything coming in from outside
    # (arm, sleeve, partial object beyond view) shouldn't be measured.
    edge_margin = 8
    valid = [
        c for c in valid
        if not _contour_touches_edge(c, h, w, edge_margin)
    ]

    # Filter out the reference card so it doesn't get measured as the object
    if exclude_rect is not None and valid:
        (ex_cx, ex_cy), (ex_w, ex_h), _ = exclude_rect
        ex_diag = (ex_w * ex_w + ex_h * ex_h) ** 0.5
        threshold = ex_diag * 0.4
        filtered = []
        for c in valid:
            r = cv2.minAreaRect(c)
            cx_c, cy_c = r[0]
            d = ((cx_c - ex_cx) ** 2 + (cy_c - ex_cy) ** 2) ** 0.5
            if d > threshold:
                filtered.append(c)
        valid = filtered

    if not valid:
        if return_mask:
            return None, None, None, None, debug_mask
        return None, None, None, None

    # Pick the contour BEST AT FRAME CENTER (not just largest). User aims the
    # crosshair at the object → object's center is near frame center, while a
    # hand entering from edge has its centroid far from center. This rejects
    # hands without needing skin-color heuristics.
    fc_x, fc_y = w / 2.0, h / 2.0
    diag = (h * h + w * w) ** 0.5
    frame_total_area = h * w

    def score_contour(cnt):
        a = cv2.contourArea(cnt)
        M = cv2.moments(cnt)
        if M["m00"] == 0:
            return -1.0
        cx = M["m10"] / M["m00"]
        cy = M["m01"] / M["m00"]
        dist = ((cx - fc_x) ** 2 + (cy - fc_y) ** 2) ** 0.5
        # Center score: 1.0 at frame center, 0 at >35% of diagonal away
        center_s = 1.0 - min(dist / (diag * 0.35), 1.0)
        # Size score: capped at 8% of frame area (objects shouldn't fill frame)
        size_s = min(a / (frame_total_area * 0.08), 1.0)
        # Rectangularity (rejects irregular hand shapes)
        r = cv2.minAreaRect(cnt)
        rw_c, rh_c = r[1]
        rect_a = rw_c * rh_c
        rectness = a / rect_a if rect_a > 0 else 0
        # Weighted: centerness dominates so hand at edge always loses
        return center_s * 0.55 + size_s * 0.20 + rectness * 0.25

    scored = [(score_contour(c), c) for c in valid]
    scored = [(s, c) for s, c in scored if s >= 0]
    if not scored:
        if return_mask:
            return None, None, None, None, debug_mask
        return None, None, None, None
    scored.sort(key=lambda t: t[0], reverse=True)
    main_cnt = scored[0][1]
    area_px = cv2.contourArea(main_cnt)

    # Use CONVEX HULL for the bbox: hull is immune to mask notches caused by
    # finger occlusion or rembg flickering at the edges. Center & dimensions
    # become stable across frames even when a finger touches the object.
    hull = cv2.convexHull(main_cnt)
    hull_area = cv2.contourArea(hull)

    # SUB-PIXEL 4-CORNER REFINEMENT — pixel-perfect dimensions for rectangular
    # objects. Refines each card corner against the local image gradient, so
    # measured L/W matches the true card edge to <0.1 px (vs ~2 px for hull
    # bbox). Falls back to hull-based bbox for non-rectangular objects.
    gray_full = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    refined_corners = _refine_rect_corners(gray_full, main_cnt)

    if refined_corners is not None:
        # 4 corners found and sub-pixel refined. Compute dims from corner pairs.
        edge_lens = []
        for i in range(4):
            p1 = refined_corners[i]
            p2 = refined_corners[(i + 1) % 4]
            edge_lens.append(float(np.linalg.norm(p2 - p1)))
        edges_sorted = sorted(edge_lens, reverse=True)
        # Average parallel pairs (cancels small per-corner error)
        L_px = (edges_sorted[0] + edges_sorted[1]) / 2.0
        W_px = (edges_sorted[2] + edges_sorted[3]) / 2.0
        cx = float(np.mean(refined_corners[:, 0]))
        cy = float(np.mean(refined_corners[:, 1]))
        rect = cv2.minAreaRect(refined_corners.astype(np.float32))
        rw, rh = max(L_px, W_px), min(L_px, W_px)
        angle = rect[2]
        box_pts = refined_corners.astype(np.int32)
    else:
        # Non-rectangular fallback
        rect = cv2.minAreaRect(hull)
        (cx, cy), (rw, rh), angle = rect
        L_px = max(rw, rh)
        W_px = min(rw, rh)
        box_pts = cv2.boxPoints(rect).astype(int)

    L_mm = L_px / cfg.PIXELS_PER_MM_L
    W_mm = W_px / cfg.PIXELS_PER_MM_W

    # Replace fragmented debug_mask with a solid hull-filled mask. This is what
    # the user sees with [V]: a clean, padded, rectangular outline that matches
    # the actual object regardless of interior pattern complexity.
    if return_mask:
        hull_filled = np.zeros_like(debug_mask)
        cv2.fillPoly(hull_filled, [hull.reshape(-1, 2).astype(np.int32)], 255)
        debug_mask = hull_filled

    solidity = area_px / hull_area if hull_area > 0 else 0
    rect_area = L_px * W_px
    rectangularity = hull_area / rect_area if rect_area > 0 else 0
    frame_area = h * w
    size_score = min(area_px / (frame_area * 0.05), 1.0)
    confidence = round(
        min(max(solidity * 0.3 + rectangularity * 0.4 + size_score * 0.3, 0), 1.0), 3
    )
    meas = {
        "L_mm": round(L_mm, 3),
        "W_mm": round(W_mm, 3),
        "L_px": round(L_px, 1),
        "W_px": round(W_px, 1),
        "cx": int(cx),
        "cy": int(cy),
        "area_px": int(area_px),
        "rectangularity": round(rectangularity, 3),
        "confidence": confidence,
    }
    if return_mask:
        return meas, main_cnt, rect, box_pts, debug_mask
    return meas, main_cnt, rect, box_pts


def draw_overlay(frame, meas, contour, box_pts, profile, sL, sW):
    """Draw bbox, L/W labels, status colors. profile=None → unknown coloring."""
    cfg = Config
    annotated = frame.copy()
    h, w = annotated.shape[:2]

    _draw_reticle(annotated)

    if meas is None:
        return annotated

    if profile is not None and sL is not None:
        s_L, s_W, _ = evaluate_status(sL, sW, profile)
        clr_L = cfg.C_OK if s_L == "OK" else cfg.C_NG
        clr_W = cfg.C_OK if s_W == "OK" else cfg.C_NG
        clr_box = cfg.C_OK if (s_L == "OK" and s_W == "OK") else cfg.C_NG
    else:
        clr_L = clr_W = clr_box = cfg.C_UNKNOWN

    # Smooth jagged ("keriting") contour for display only — measurement still
    # uses raw contour via minAreaRect (already computed)
    peri = cv2.arcLength(contour, True)
    smooth_contour = cv2.approxPolyDP(contour, 0.003 * peri, True)
    cv2.drawContours(annotated, [smooth_contour], -1, cfg.C_CYAN, 2)
    cv2.drawContours(annotated, [box_pts], 0, clr_box, 2)

    # Object center: full crosshair (acuan kalibrasi visual)
    ox, oy = meas["cx"], meas["cy"]
    clen = 28
    cv2.line(annotated, (ox - clen, oy), (ox + clen, oy), cfg.C_YELLOW, 2, cv2.LINE_AA)
    cv2.line(annotated, (ox, oy - clen), (ox, oy + clen), cfg.C_YELLOW, 2, cv2.LINE_AA)
    cv2.circle(annotated, (ox, oy), 6, cfg.C_YELLOW, -1, cv2.LINE_AA)
    cv2.circle(annotated, (ox, oy), 14, cfg.C_YELLOW, 1, cv2.LINE_AA)

    edges = []
    for i in range(4):
        p1, p2 = box_pts[i], box_pts[(i + 1) % 4]
        elen = float(np.linalg.norm(p2 - p1))
        mid = ((p1[0] + p2[0]) // 2, (p1[1] + p2[1]) // 2)
        edges.append((elen, mid, p1, p2))
    edges.sort(key=lambda x: x[0], reverse=True)

    _, mid_L, p1L, p2L = edges[0]
    cv2.arrowedLine(annotated, tuple(p1L), tuple(p2L), cfg.C_YELLOW, 1, tipLength=0.02)
    cv2.putText(
        annotated,
        f"L={meas['L_mm']:.2f}mm",
        (mid_L[0] - 40, mid_L[1] - 10),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        clr_L,
        2,
        cv2.LINE_AA,
    )

    _, mid_W, p1W, p2W = edges[2]
    cv2.arrowedLine(annotated, tuple(p1W), tuple(p2W), cfg.C_YELLOW, 1, tipLength=0.03)
    cv2.putText(
        annotated,
        f"W={meas['W_mm']:.2f}mm",
        (mid_W[0] + 5, mid_W[1] - 10),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        clr_W,
        2,
        cv2.LINE_AA,
    )

    cv2.putText(
        annotated,
        f"Conf:{meas['confidence']:.0%}  Area:{meas['area_px']}  Rect:{meas['rectangularity']:.2f}",
        (10, h - 150),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.42,
        cfg.C_GRAY,
        1,
        cv2.LINE_AA,
    )
    return annotated


# ══════════════════════════════════════════════════════════════════════
#  SMOOTHING — ROLLING MEDIAN
# ══════════════════════════════════════════════════════════════════════


class MedianSmoother:
    def __init__(self, n=7):
        self.buf_L = deque(maxlen=n)
        self.buf_W = deque(maxlen=n)

    def add(self, L, W):
        self.buf_L.append(L)
        self.buf_W.append(W)

    def get(self):
        if len(self.buf_L) < 3:
            return None, None
        return float(np.median(self.buf_L)), float(np.median(self.buf_W))

    def reset(self):
        self.buf_L.clear()
        self.buf_W.clear()

    @property
    def count(self):
        return len(self.buf_L)


# ══════════════════════════════════════════════════════════════════════
#  ANTI-SPAM
# ══════════════════════════════════════════════════════════════════════


class SendController:
    def __init__(self):
        self.last_time = 0.0
        self.last_L = self.last_W = None
        self.last_status = None

    def should_send(self, L, W, status):
        now = time.time()
        if now - self.last_time < Config.MIN_SEND_INTERVAL:
            return False
        if self.last_L is None:
            return True
        if status != self.last_status:
            return True
        if abs(L - self.last_L) > Config.CHANGE_THRESHOLD:
            return True
        if abs(W - self.last_W) > Config.CHANGE_THRESHOLD:
            return True
        return False

    def mark(self, L, W, status):
        self.last_time = time.time()
        self.last_L, self.last_W, self.last_status = L, W, status


# ══════════════════════════════════════════════════════════════════════
#  API CLIENT
# ══════════════════════════════════════════════════════════════════════


class APIClient:
    def __init__(self):
        self._last = None

    @property
    def last_result(self):
        return self._last

    def send(self, L, W, status, conf, name=None):
        threading.Thread(
            target=self._do, args=(L, W, status, conf, name), daemon=True
        ).start()

    def _do(self, L, W, status, conf, name=None):
        payload = {
            "dimension_mm": round(L, 3),
            "width_mm": round(W, 3),
            "status": status,
            "confidence": conf,
        }
        if name:
            payload["object_name"] = name
        try:
            r = requests.post(Config.API_URL, json=payload, timeout=Config.API_TIMEOUT)
            if r.status_code == 201:
                ts = datetime.datetime.now().strftime("%H:%M:%S")
                tag = f"[{name}] " if name else ""
                print(
                    f"  [{ts}] SENT {tag}-> L={L:.3f} W={W:.3f} | {status} | conf={conf:.0%}"
                )
                self._last = "ok"
            else:
                print(f"  [!] Server {r.status_code}: {r.text[:80]}")
                self._last = "error"
        except requests.exceptions.ConnectionError:
            print("  [!] Server offline — jalankan 'node server.js'")
            self._last = "error"
        except Exception as e:
            print(f"  [!] {e}")
            self._last = "error"


# ══════════════════════════════════════════════════════════════════════
#  HUD
# ══════════════════════════════════════════════════════════════════════


def draw_hud(
    frame,
    sL,
    sW,
    meas,
    profile,
    profile_locked,
    auto_send,
    auto_register,
    api_st,
    cal,
    buf_n,
    unknown_count,
    auto_reg_thresh,
    live_cal_mode=False,
    ref_present=False,
):
    cfg = Config
    ui = frame.copy()
    h, w = ui.shape[:2]

    # ── Top bar ──
    cv2.rectangle(ui, (0, 0), (w, 58), cfg.C_DARK, -1)
    cv2.line(ui, (0, 58), (w, 58), (50, 80, 150), 1)
    cv2.putText(
        ui,
        "DIMENSIONAL INSPECTION — CATALOG MODE",
        (10, 22),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.58,
        cfg.C_WHITE,
        1,
        cv2.LINE_AA,
    )
    cv2.putText(
        ui,
        datetime.datetime.now().strftime("%H:%M:%S"),
        (w - 90, 22),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        cfg.C_GRAY,
        1,
        cv2.LINE_AA,
    )

    if live_cal_mode:
        if ref_present:
            cal_t = f"LIVE-CAL:{cfg.PIXELS_PER_MM:.2f}px/mm"
            cal_clr = cfg.C_OK
        else:
            cal_t = "LIVE-CAL: NO REF — show card!"
            cal_clr = cfg.C_NG
    elif cal:
        cal_t = f"CAL:{cfg.PIXELS_PER_MM:.2f}px/mm"
        cal_clr = cfg.C_OK
    else:
        cal_t = "NOT CALIBRATED [C]"
        cal_clr = cfg.C_NG
    cv2.putText(
        ui,
        cal_t,
        (10, 42),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.4,
        cal_clr,
        1,
        cv2.LINE_AA,
    )
    cv2.putText(
        ui,
        "AUTO-SEND:ON" if auto_send else "AUTO-SEND:OFF",
        (215, 42),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.4,
        cfg.C_OK if auto_send else cfg.C_GRAY,
        1,
        cv2.LINE_AA,
    )
    cv2.putText(
        ui,
        "AUTO-REG:ON" if auto_register else "AUTO-REG:OFF",
        (380, 42),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.4,
        cfg.C_OK if auto_register else cfg.C_GRAY,
        1,
        cv2.LINE_AA,
    )
    cv2.putText(
        ui,
        f"Buf:{buf_n}/{cfg.SMOOTH_SAMPLES}",
        (w - 110, 42),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.4,
        cfg.C_GRAY,
        1,
        cv2.LINE_AA,
    )

    # ── Bottom panel ──
    PH = 140
    y0 = h - PH
    ov = ui[y0:h, :].copy()
    cv2.rectangle(ov, (0, 0), (w, PH), cfg.C_DARK, -1)
    cv2.addWeighted(ov, 0.88, ui[y0:h, :], 0.12, 0, ui[y0:h, :])
    cv2.line(ui, (0, y0), (w, y0), (50, 80, 150), 1)
    BY = y0 + 22

    # Profile line
    if profile is not None:
        lock_tag = "  [LOCKED]" if profile_locked else "  [auto-match]"
        tol_L = profile.get("tol_L", cfg.DEFAULT_TOL_MM)
        prof_t = (
            f"Profile: {profile['name']}    target  L={profile['L_mm']:.2f}mm  "
            f"W={profile['W_mm']:.2f}mm  ±{tol_L}mm{lock_tag}"
        )
        cv2.putText(
            ui,
            prof_t,
            (12, BY),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            cfg.C_WHITE,
            1,
            cv2.LINE_AA,
        )
    elif sL is not None:
        cv2.putText(
            ui,
            "Profile: UNKNOWN — press [R] to register manually",
            (12, BY),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            cfg.C_UNKNOWN,
            1,
            cv2.LINE_AA,
        )
    else:
        cv2.putText(
            ui,
            "Profile: —  (arahkan objek ke kamera)",
            (12, BY),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            cfg.C_GRAY,
            1,
            cv2.LINE_AA,
        )

    # Measurement + status
    if sL is not None and sW is not None:
        if profile is not None:
            s_L, s_W, overall = evaluate_status(sL, sW, profile)
            clr_L = cfg.C_OK if s_L == "OK" else cfg.C_NG
            clr_W = cfg.C_OK if s_W == "OK" else cfg.C_NG
            clr_o = cfg.C_OK if overall == "OK" else cfg.C_NG
            label = "GOOD" if overall == "OK" else "NOT GOOD"
            cv2.putText(
                ui,
                f"L = {sL:.3f} mm  [{s_L}]",
                (12, BY + 26),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                clr_L,
                1,
                cv2.LINE_AA,
            )
            cv2.putText(
                ui,
                f"W = {sW:.3f} mm  [{s_W}]",
                (12, BY + 50),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                clr_W,
                1,
                cv2.LINE_AA,
            )
            cv2.putText(
                ui,
                label,
                (12, BY + 90),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.0,
                clr_o,
                3,
                cv2.LINE_AA,
            )
        else:
            cv2.putText(
                ui,
                f"L = {sL:.3f} mm",
                (12, BY + 26),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                cfg.C_UNKNOWN,
                1,
                cv2.LINE_AA,
            )
            cv2.putText(
                ui,
                f"W = {sW:.3f} mm",
                (12, BY + 50),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                cfg.C_UNKNOWN,
                1,
                cv2.LINE_AA,
            )
            cv2.putText(
                ui,
                "UNKNOWN",
                (12, BY + 90),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.0,
                cfg.C_UNKNOWN,
                3,
                cv2.LINE_AA,
            )

        # Confidence bar
        c = (meas["confidence"] if meas else 0) or 0
        bx = 240
        cv2.rectangle(ui, (bx, BY + 78), (bx + 150, BY + 90), cfg.C_GRAY, 1)
        fc = cfg.C_OK if c > 0.8 else cfg.C_YELLOW if c > 0.6 else cfg.C_NG
        cv2.rectangle(ui, (bx, BY + 78), (bx + int(150 * c), BY + 90), fc, -1)
        cv2.putText(
            ui,
            f"Conf:{c:.0%}",
            (bx + 158, BY + 90),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.4,
            cfg.C_GRAY,
            1,
            cv2.LINE_AA,
        )

        # Auto-register countdown
        if auto_register and profile is None and unknown_count > 0:
            remaining = max(auto_reg_thresh - unknown_count, 0)
            cv2.putText(
                ui,
                f"Auto-register in {remaining} frames...",
                (bx, BY + 110),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.42,
                cfg.C_YELLOW,
                1,
                cv2.LINE_AA,
            )

        # API status
        if api_st == "ok":
            cv2.putText(
                ui,
                ">> Sent",
                (12, BY + 115),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.42,
                cfg.C_OK,
                1,
                cv2.LINE_AA,
            )
        elif api_st == "error":
            cv2.putText(
                ui,
                ">> FAILED",
                (12, BY + 115),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.42,
                cfg.C_NG,
                1,
                cv2.LINE_AA,
            )
    else:
        cv2.putText(
            ui,
            "Arahkan objek ke kamera...",
            (12, BY + 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            cfg.C_GRAY,
            1,
            cv2.LINE_AA,
        )

    # Keys
    KX = w - 340
    cv2.putText(
        ui,
        "[SPACE]Inspect [A]AutoSend [C]Wizard [V]Mask [R]Reg",
        (KX, BY),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.34,
        cfg.C_GRAY,
        1,
        cv2.LINE_AA,
    )
    cv2.putText(
        ui,
        "[L]LiveCal [U]AutoReg [/]Cycle [X]Unlock [D]Delete [Q]Quit",
        (KX, BY + 18),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.34,
        cfg.C_GRAY,
        1,
        cv2.LINE_AA,
    )
    return ui


# ══════════════════════════════════════════════════════════════════════
#  CAMERA SELECTOR
# ══════════════════════════════════════════════════════════════════════


def get_platform_backends():
    if IS_MACOS:
        return [(cv2.CAP_AVFOUNDATION, "AVFoundation"), (cv2.CAP_ANY, "Default")]
    elif IS_WINDOWS:
        return [(cv2.CAP_DSHOW, "DirectShow"), (cv2.CAP_ANY, "Default")]
    else:
        return [(cv2.CAP_V4L2, "V4L2"), (cv2.CAP_ANY, "Default")]


def list_available_cameras(max_index=5):
    backends = get_platform_backends()
    available = []
    print(f"  Scanning cameras (0-{max_index})...")
    for idx in range(max_index + 1):
        for be, be_name in backends:
            cap = cv2.VideoCapture(idx, be)
            if IS_MACOS:
                time.sleep(0.3)
            if cap.isOpened():
                ret, frame = cap.read()
                if ret and frame is not None and frame.size > 0:
                    h, w = frame.shape[:2]
                    fps = cap.get(cv2.CAP_PROP_FPS) or 0
                    available.append(
                        {
                            "index": idx,
                            "backend": be,
                            "backend_name": be_name,
                            "width": w,
                            "height": h,
                            "fps": fps,
                        }
                    )
                    cap.release()
                    break
                cap.release()
            else:
                cap.release()
    return available


def select_camera(default_idx=0):
    cams = list_available_cameras(max_index=5)
    if not cams:
        return None, None
    if len(cams) == 1:
        c = cams[0]
        print(
            f"  Only 1 camera found: index {c['index']} ({c['width']}x{c['height']}) — auto-selected\n"
        )
        return c["index"], c["backend"]

    print(f"\n  Found {len(cams)} camera(s):")
    print("  " + "─" * 58)
    for i, cam in enumerate(cams):
        tag = "  ← default" if cam["index"] == default_idx else ""
        print(
            f"  [{i}] index={cam['index']}  {cam['width']}x{cam['height']} @ {cam['fps']:.0f}fps  ({cam['backend_name']}){tag}"
        )
    print("  " + "─" * 58)

    default_opt = next((i for i, c in enumerate(cams) if c["index"] == default_idx), 0)
    while True:
        try:
            choice = input(
                f"  Select camera [0-{len(cams)-1}, Enter={default_opt}]: "
            ).strip()
            choice = default_opt if choice == "" else int(choice)
            if 0 <= choice < len(cams):
                sel = cams[choice]
                print(
                    f"  → Selected camera index {sel['index']} ({sel['width']}x{sel['height']})\n"
                )
                return sel["index"], sel["backend"]
            print(f"  [!] Invalid, choose 0-{len(cams)-1}")
        except ValueError:
            print("  [!] Must be a number")
        except (KeyboardInterrupt, EOFError):
            print()
            return None, None


def parse_cli_camera_arg():
    for i, arg in enumerate(sys.argv):
        if arg in ("--camera", "-c") and i + 1 < len(sys.argv):
            try:
                return int(sys.argv[i + 1])
            except ValueError:
                print(f"  [!] Invalid camera index: {sys.argv[i + 1]}")
                return None
        if arg.startswith("--camera="):
            try:
                return int(arg.split("=", 1)[1])
            except ValueError:
                print(f"  [!] Invalid camera index in {arg}")
                return None
    return None


# ══════════════════════════════════════════════════════════════════════
#  KAMERA
# ══════════════════════════════════════════════════════════════════════


def open_camera(cam_index, backend):
    cfg = Config
    cap = cv2.VideoCapture(cam_index, backend)
    if IS_MACOS:
        time.sleep(0.5)
    if not cap.isOpened():
        return None, -1
    ret, f = cap.read()
    if not (ret and f is not None and f.size > 0):
        cap.release()
        return None, -1
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, cfg.FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg.FRAME_HEIGHT)
    cap.set(cv2.CAP_PROP_FPS, cfg.FPS)
    rw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    rh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"  Camera {cam_index} opened! {rw}x{rh}")
    return cap, cam_index


def flush_camera_buffer(cap, n=5):
    for _ in range(n):
        cap.read()


# ══════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════


def main():
    cfg = Config
    print("=" * 60)
    print("  Dimensional Inspection — CATALOG MODE")
    print("=" * 60)
    print(f"  Smooth     median of {cfg.SMOOTH_SAMPLES} frames")
    print(f"  Match win  ±{cfg.MATCH_WINDOW_MM} mm")
    print(f"  Auto-reg   {cfg.AUTO_REGISTER_SECS} s of stable unknown")
    print(f"  API        {cfg.API_URL}")
    print("-" * 60)
    print("  [SPACE]Inspect  [A]AutoSend  [C]Wizard  [V]Mask")
    print("  [R]Register  [L]LiveCal  [U]AutoReg  [/]Cycle  [X]Unlock  [D]Delete  [Q]Quit")
    print(f"  Mode awal  : {'LIVE-CAL (handheld)' if cfg.LIVE_CAL_MODE else 'STATIC (mount)'}")
    if REMBG_AVAILABLE:
        print("  Segmentasi : rembg (ML, neural network) — high quality")
    else:
        print("  Segmentasi : dominant-color K-means (fallback)")
        print("              install rembg untuk kualitas lebih baik:")
        print("              pip install rembg onnxruntime")
    print("=" * 60)

    load_calibration()
    catalog = ObjectCatalog()
    smoother = MedianSmoother(n=cfg.SMOOTH_SAMPLES)
    controller = SendController()
    api = APIClient()

    # ── Camera Selection ──
    print("\nDetecting cameras...")
    forced_cam = parse_cli_camera_arg()
    if forced_cam is not None:
        print(f"  CLI override: using camera index {forced_cam}")
        backends = get_platform_backends()
        cam_idx, cam_be = forced_cam, backends[0][0]
    else:
        cam_idx, cam_be = select_camera(default_idx=cfg.CAMERA_INDEX)
        if cam_idx is None:
            print("\n[ERROR] No camera detected or selection cancelled!")
            if IS_MACOS:
                print("  System Settings > Privacy & Security > Camera > Terminal = ON")
            input("Enter to exit...")
            return

    print(f"Opening camera {cam_idx}...")
    cap, _ = open_camera(cam_idx, cam_be)
    if not cap:
        print(f"\n[ERROR] Failed to open camera {cam_idx}!")
        if IS_MACOS:
            print(
                "  Try a different index or check System Settings > Privacy & Security > Camera"
            )
        input("Enter to exit...")
        return

    WIN = "Inspection [Q=Quit C=Cal R=Reg]"
    cv2.namedWindow(WIN, cv2.WINDOW_AUTOSIZE)

    auto_send = True
    auto_register = True
    fails = 0
    locked_profile = None
    unknown_frames = 0
    live_cal_mode = cfg.LIVE_CAL_MODE
    show_mask = False
    auto_reg_thresh = max(int(cfg.AUTO_REGISTER_SECS * cfg.FPS), 30)

    # ── First-run wizard: KTP calibration before inspection ──
    if not cfg.CALIBRATED:
        print("\n[!] Calibration belum lengkap — running wizard...")
        result = calibration_wizard(cap, WIN)
        if result is None:
            print("[ERROR] Wizard cancelled — exit.")
            cap.release()
            cv2.destroyAllWindows()
            return
        ppmm_L, ppmm_W = result
        cfg.PIXELS_PER_MM_L = ppmm_L
        cfg.PIXELS_PER_MM_W = ppmm_W
        cfg.PIXELS_PER_MM = (ppmm_L + ppmm_W) / 2.0
        cfg.CALIBRATED = True
        save_calibration(ppmm_L, ppmm_W)

    if not catalog.items:
        print(
            "[!] Catalog empty — register objects with [R] or let auto-register kick in\n"
        )

    while True:
        ret, frame = cap.read()
        if not ret or frame is None:
            fails += 1
            if fails > 30:
                break
            time.sleep(0.03)
            continue
        fails = 0

        # ── Live calibration (handheld mode): rescale tiap frame dari kartu ──
        ref_rect = None
        ref_present = False
        live_consistency = 0.0
        if live_cal_mode:
            wp_ref, hp_ref, ref_cnt, rr = detect_reference_object(frame)
            if wp_ref is not None:
                ppmm_w = wp_ref / cfg.REF_WIDTH_MM
                ppmm_h = hp_ref / cfg.REF_HEIGHT_MM
                live_consistency = 1.0 - abs(ppmm_w - ppmm_h) / max(ppmm_w, ppmm_h)
                if live_consistency >= cfg.LIVE_CAL_MIN_CONSISTENCY:
                    # wp_ref = max(rw,rh) = long side → maps to L scale
                    cfg.PIXELS_PER_MM_L = ppmm_w
                    cfg.PIXELS_PER_MM_W = ppmm_h
                    cfg.PIXELS_PER_MM = (ppmm_w + ppmm_h) / 2.0
                    cfg.CALIBRATED = True
                    ref_rect = rr
                    ref_present = True

        # ── Measurement + match ──
        debug_mask = None
        if live_cal_mode and not ref_present:
            # Tidak ada kartu referensi → tidak punya skala valid → skip measurement
            meas, contour, rect, box_pts = None, None, None, None
            smoother.reset()
            unknown_frames = 0
        else:
            meas, contour, rect, box_pts, debug_mask = extract_measurement(
                frame, exclude_rect=ref_rect, return_mask=True
            )
        sL, sW = None, None
        active_profile = None

        if meas is not None:
            smoother.add(meas["L_mm"], meas["W_mm"])
            sL, sW = smoother.get()
            if sL is not None:
                if locked_profile is not None:
                    active_profile = catalog.find_by_name(locked_profile)
                    if active_profile is None:
                        locked_profile = None
                if active_profile is None:
                    active_profile = catalog.match(sL, sW)

                if active_profile is not None:
                    unknown_frames = 0
                    if auto_send and meas["confidence"] >= cfg.CONFIDENCE_MIN:
                        _, _, overall = evaluate_status(sL, sW, active_profile)
                        if controller.should_send(sL, sW, overall):
                            api.send(
                                sL,
                                sW,
                                overall,
                                meas["confidence"],
                                active_profile["name"],
                            )
                            controller.mark(sL, sW, overall)
                else:
                    if (
                        meas["confidence"] >= cfg.CONFIDENCE_MIN
                        and smoother.count >= cfg.SMOOTH_SAMPLES
                        and cfg.CALIBRATED
                    ):
                        unknown_frames += 1
                    else:
                        unknown_frames = 0
        else:
            smoother.reset()
            unknown_frames = 0

        annotated = draw_overlay(frame, meas, contour, box_pts, active_profile, sL, sW)

        # Mask preview (top-right corner) for debugging "menjalar" issues
        if show_mask and debug_mask is not None:
            mh, mw = debug_mask.shape[:2]
            pw = 280
            ph = int(mh * pw / mw)
            mini = cv2.resize(debug_mask, (pw, ph))
            mini_bgr = cv2.cvtColor(mini, cv2.COLOR_GRAY2BGR)
            x0 = annotated.shape[1] - pw - 10
            y0 = 70
            annotated[y0 : y0 + ph, x0 : x0 + pw] = mini_bgr
            cv2.rectangle(annotated, (x0, y0), (x0 + pw, y0 + ph), cfg.C_YELLOW, 1)
            cv2.putText(
                annotated,
                "MASK",
                (x0 + 6, y0 + 18),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                cfg.C_YELLOW,
                1,
                cv2.LINE_AA,
            )

        # Draw reference card outline so user knows it's tracked
        if ref_rect is not None:
            ref_box = cv2.boxPoints(ref_rect).astype(int)
            cv2.drawContours(annotated, [ref_box], 0, cfg.C_BLUE, 2)
            (rcx, rcy) = ref_rect[0]
            cv2.putText(
                annotated,
                f"REF {cfg.PIXELS_PER_MM:.2f}px/mm",
                (int(rcx) - 60, int(rcy)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                cfg.C_BLUE,
                2,
                cv2.LINE_AA,
            )

        # ── Auto-register trigger ──
        if (
            auto_register
            and active_profile is None
            and sL is not None
            and unknown_frames >= auto_reg_thresh
        ):
            notice = annotated.copy()
            cv2.rectangle(notice, (0, 0), (notice.shape[1], 90), cfg.C_DARK, -1)
            cv2.putText(
                notice,
                ">> SWITCH TO TERMINAL — Enter object name",
                (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.85,
                cfg.C_YELLOW,
                2,
                cv2.LINE_AA,
            )
            cv2.putText(
                notice,
                f"L={sL:.2f}mm  W={sW:.2f}mm",
                (20, 72),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                cfg.C_WHITE,
                2,
                cv2.LINE_AA,
            )
            cv2.imshow(WIN, notice)
            cv2.waitKey(1)
            name = prompt_object_name(sL, sW, catalog)
            if name:
                active_profile = catalog.register(name, sL, sW)
            unknown_frames = 0
            smoother.reset()
            flush_camera_buffer(cap)

        display = draw_hud(
            annotated,
            sL,
            sW,
            meas,
            active_profile,
            bool(locked_profile),
            auto_send,
            auto_register,
            api.last_result,
            cfg.CALIBRATED,
            smoother.count,
            unknown_frames,
            auto_reg_thresh,
            live_cal_mode=live_cal_mode,
            ref_present=ref_present,
        )
        cv2.imshow(WIN, display)
        key = cv2.waitKey(1) & 0xFF

        # ── Keys ──
        if key in (ord("q"), ord("Q"), 27):
            break
        elif key == ord(" "):
            if (
                sL is not None
                and sW is not None
                and active_profile is not None
                and meas is not None
            ):
                _, _, overall = evaluate_status(sL, sW, active_profile)
                label = "GOOD" if overall == "OK" else "NOT GOOD"
                print(
                    f"\n[FORCE] {active_profile['name']}: L={sL:.3f} W={sW:.3f} -> {label}"
                )
                api.send(sL, sW, overall, meas["confidence"], active_profile["name"])
                controller.mark(sL, sW, overall)
            elif sL is not None and active_profile is None:
                print("[!] Object UNKNOWN — press [R] to register first")
            else:
                print("[!] No object!")
        elif key in (ord("a"), ord("A")):
            auto_send = not auto_send
            print(f"\n[AUTO-SEND] {'ON' if auto_send else 'OFF'}")
        elif key in (ord("c"), ord("C")):
            print("\n[CAL] Re-running calibration wizard...")
            result_new = calibration_wizard(cap, WIN)
            if result_new is not None:
                ppmm_L_new, ppmm_W_new = result_new
                cfg.PIXELS_PER_MM_L = ppmm_L_new
                cfg.PIXELS_PER_MM_W = ppmm_W_new
                cfg.PIXELS_PER_MM = (ppmm_L_new + ppmm_W_new) / 2.0
                cfg.CALIBRATED = True
                save_calibration(ppmm_L_new, ppmm_W_new)
                smoother.reset()
                unknown_frames = 0
                flush_camera_buffer(cap)
            else:
                print("[CAL] Wizard cancelled — keeping previous calibration")
        elif key in (ord("r"), ord("R")):
            if sL is not None and sW is not None:
                # Show frozen notice
                notice = annotated.copy()
                cv2.rectangle(notice, (0, 0), (notice.shape[1], 90), cfg.C_DARK, -1)
                cv2.putText(
                    notice,
                    ">> SWITCH TO TERMINAL — Enter object name",
                    (20, 40),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.85,
                    cfg.C_YELLOW,
                    2,
                    cv2.LINE_AA,
                )
                cv2.imshow(WIN, notice)
                cv2.waitKey(1)
                name = prompt_object_name(sL, sW, catalog)
                if name:
                    catalog.register(name, sL, sW)
                unknown_frames = 0
                smoother.reset()
                flush_camera_buffer(cap)
            else:
                print("[!] No stable measurement yet")
        elif key in (ord("u"), ord("U")):
            auto_register = not auto_register
            print(f"\n[AUTO-REG] {'ON' if auto_register else 'OFF'}")
            unknown_frames = 0
        elif key in (ord("l"), ord("L")):
            live_cal_mode = not live_cal_mode
            print(f"\n[LIVE-CAL] {'ON' if live_cal_mode else 'OFF'}")
            if live_cal_mode:
                print("  Letakkan kartu referensi di samping benda (sebidang)")
            smoother.reset()
            unknown_frames = 0
        elif key in (ord("v"), ord("V")):
            show_mask = not show_mask
            print(f"\n[VIZ] Mask preview {'ON' if show_mask else 'OFF'}")
        elif key == ord("]"):
            if catalog.items:
                cur = locked_profile or (
                    active_profile["name"] if active_profile else None
                )
                nxt = catalog.cycle(cur, +1)
                if nxt:
                    locked_profile = nxt["name"]
                    print(f"\n[LOCK] Profile: {locked_profile}")
        elif key == ord("["):
            if catalog.items:
                cur = locked_profile or (
                    active_profile["name"] if active_profile else None
                )
                prv = catalog.cycle(cur, -1)
                if prv:
                    locked_profile = prv["name"]
                    print(f"\n[LOCK] Profile: {locked_profile}")
        elif key in (ord("x"), ord("X")):
            if locked_profile:
                print(f"\n[UNLOCK] Was: {locked_profile} — back to auto-match")
                locked_profile = None
        elif key in (ord("d"), ord("D")):
            target = locked_profile or (
                active_profile["name"] if active_profile else None
            )
            if target:
                if catalog.delete(target):
                    locked_profile = None
                    smoother.reset()
            else:
                print("[!] No active profile to delete")

    cap.release()
    cv2.destroyAllWindows()
    print("Done.")


if __name__ == "__main__":
    main()
