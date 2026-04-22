# -*- coding: utf-8 -*-
import os, sys
os.environ.setdefault('PYTHONUTF8', '1')
if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass

"""
edge_camera.py
==============
Edge System — Automated Dimensional Inspection
Capstone Project A3 Kelompok 2

Alur kerja:
  Kamera → Grayscale → Blur → Canny → Kontur
  → Ukur dimensi → Smoothing → Anti-spam → POST /inspection → Dashboard

Kontrol jendela kamera:
  SPASI  = Inspeksi paksa (kirim data sekarang)
  A      = Toggle auto-send ON/OFF
  Q/ESC  = Keluar
"""

# ── Impor ──────────────────────────────────────────────────────────────
import cv2
import numpy as np
import requests
import time
import datetime
import threading
from collections import deque

# ══════════════════════════════════════════════════════════════════════
#  BAGIAN 1: KONFIGURASI SISTEM
# ══════════════════════════════════════════════════════════════════════

class Config:
    # --- Kamera ---
    CAMERA_INDEX    = 0           # 0 = built-in, 1 = USB eksternal
    FRAME_WIDTH     = 1280
    FRAME_HEIGHT    = 720
    FPS             = 30

    # --- Kalibrasi dimensi ---
    # Arti: seberapa banyak piksel dalam 1 mm
    # Cara kalibrasi: ukur objek referensi (misal penggaris 100mm),
    # hitung berapa piksel lebarnya, lalu: PIXELS_PER_MM = piksel / 100
    PIXELS_PER_MM   = 10.0        # Default: 1 piksel = 0.1 mm

    # --- Toleransi inspeksi ---
    TARGET_DIMENSION = 7.5       # mm (sesuai objek nyata)
    TOLERANCE        = 0.5        # mm (±0.5 mm → OK)

    # --- Smoothing (rata-rata bergulir) ---
    SMOOTH_SAMPLES   = 5          # Jumlah frame untuk dirata-ratakan

    # --- Anti-spam (kontrol pengiriman ke API) ---
    MIN_SEND_INTERVAL = 1.5       # Minimal jeda antar pengiriman (detik)
    CHANGE_THRESHOLD  = 0.1       # Kirim jika dimensi berubah > 0.1 mm
                                  # ATAU jika status berubah (OK <-> NG)

    # --- API Backend ---
    API_URL = "http://localhost:3000/inspection"
    API_TIMEOUT = 3               # Timeout request (detik)

    # --- Visualisasi (warna BGR) ---
    COLOR_OK      = (50,  210,  50)   # Hijau
    COLOR_NG      = (50,   50, 220)   # Merah
    COLOR_LIVE    = (0,   200, 255)   # Kuning (live preview)
    COLOR_WHITE   = (255, 255, 255)
    COLOR_GRAY    = (160, 160, 160)
    COLOR_YELLOW  = (0,   215, 255)
    COLOR_DARK    = (15,  20,  38)


# ══════════════════════════════════════════════════════════════════════
#  BAGIAN 2: MODUL PENGUKURAN (OpenCV Pipeline)
# ══════════════════════════════════════════════════════════════════════

def proses_frame(frame):
    """
    Pipeline deteksi dan pengukuran objek dari satu frame kamera.

    Langkah:
      1. Grayscale       — kurangi data warna, fokus ke bentuk
      2. Gaussian Blur   — haluskan gambar, kurangi noise
      3. Canny           — deteksi tepi/edge objek
      4. Dilasi          — perkuat garis tepi
      5. Kontur          — temukan batas objek
      6. Bounding box    — kotak pembatas objek terbesar
      7. Hitung dimensi  — konversi piksel ke mm

    Returns:
      dimension_mm (float | None) — dimensi terukur, None jika gagal
      frame_annotated (np.ndarray) — frame dengan anotasi visual
    """
    cfg = Config
    annotated = frame.copy()
    h, w = frame.shape[:2]

    # ── Panduan tengah layar ──────────────────────────────────────────
    # Garis silang membantu pengguna menempatkan objek di tengah
    cv2.line(annotated, (w//2, h//2 - 30), (w//2, h//2 + 30), (50, 70, 130), 1)
    cv2.line(annotated, (w//2 - 30, h//2), (w//2 + 30, h//2), (50, 70, 130), 1)

    # ── LANGKAH 1: Grayscale ─────────────────────────────────────────
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    # ── LANGKAH 2: Gaussian Blur ─────────────────────────────────────
    # Kernel (5,5) cukup untuk menghilangkan noise ringan
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # ── LANGKAH 3: Canny Edge Detection ─────────────────────────────
    # threshold1=50 (tepi lemah), threshold2=150 (tepi kuat)
    # Sesuaikan nilai ini jika objek sulit terdeteksi
    edges = cv2.Canny(blurred, threshold1=50, threshold2=150)

    # ── LANGKAH 4: Dilasi tepi ───────────────────────────────────────
    # Memperkuat garis tepi agar kontur lebih mudah ditemukan
    kernel = np.ones((3, 3), np.uint8)
    edges_dilated = cv2.dilate(edges, kernel, iterations=1)

    # ── LANGKAH 5: Deteksi Kontur ────────────────────────────────────
    contours, _ = cv2.findContours(
        edges_dilated,
        cv2.RETR_EXTERNAL,        # Hanya kontur paling luar
        cv2.CHAIN_APPROX_SIMPLE   # Kompresi titik (hemat memori)
    )

    # Filter: abaikan kontur terlalu kecil (noise/debu/bayangan)
    MIN_CONTOUR_AREA = 500        # Piksel kuadrat minimum
    valid_contours = [c for c in contours if cv2.contourArea(c) > MIN_CONTOUR_AREA]

    if not valid_contours:
        # Tidak ada objek terdeteksi
        return None, annotated

    # ── LANGKAH 6: Ambil objek terbesar ──────────────────────────────
    main_contour = max(valid_contours, key=cv2.contourArea)
    area_px = cv2.contourArea(main_contour)

    # Bounding box = kotak terkecil yang melingkupi kontur
    x, y, bw, bh = cv2.boundingRect(main_contour)

    # ── LANGKAH 7: Hitung dimensi ────────────────────────────────────
    # Ambil dimensi terkecil (lebar atau tinggi) sebagai referensi
    pixel_size   = min(bw, bh)
    dimension_mm = pixel_size / cfg.PIXELS_PER_MM

    # ── Visualisasi: gambar kontur ────────────────────────────────────
    cv2.drawContours(annotated, [main_contour], -1, cfg.COLOR_LIVE, 2)

    # Bounding box
    cv2.rectangle(annotated, (x, y), (x + bw, y + bh), cfg.COLOR_WHITE, 2)

    # Garis pengukuran horizontal (di tengah objek)
    #   Panah kiri ← dan → kanan menunjukkan rentang pengukuran
    mid_y  = y + bh // 2
    margin = 5
    cv2.arrowedLine(annotated,
                    (x + bw + margin, mid_y), (x - margin, mid_y),
                    cfg.COLOR_YELLOW, 2, tipLength=0.04)
    cv2.arrowedLine(annotated,
                    (x - margin, mid_y), (x + bw + margin, mid_y),
                    cfg.COLOR_YELLOW, 2, tipLength=0.04)

    # Label dimensi di atas bounding box
    label_x = max(x, 5)
    label_y = y - 14 if y > 30 else y + bh + 24
    cv2.putText(annotated,
                f"{dimension_mm:.3f} mm",
                (label_x, label_y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, cfg.COLOR_YELLOW, 2, cv2.LINE_AA)

    # Titik pusat objek
    cx, cy = x + bw // 2, y + bh // 2
    cv2.circle(annotated, (cx, cy), 5, cfg.COLOR_YELLOW, -1)

    # Info tambahan: area dan ukuran piksel
    cv2.putText(annotated,
                f"Px: {pixel_size}  Area: {int(area_px)}",
                (x, y + bh + 42 if (y + bh + 42) < h else y - 32),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, cfg.COLOR_GRAY, 1, cv2.LINE_AA)

    return dimension_mm, annotated


# ══════════════════════════════════════════════════════════════════════
#  BAGIAN 3: MODUL SMOOTHING (Rata-rata Bergulir)
# ══════════════════════════════════════════════════════════════════════

class DimensionSmoother:
    """
    Menyimpan N nilai dimensi terakhir dan menghitung rata-ratanya.
    Tujuan: menghindari nilai yang 'loncat-loncat' akibat noise kamera.
    """

    def __init__(self, n_samples=5):
        self.buffer = deque(maxlen=n_samples)  # Buffer FIFO

    def add(self, value):
        """Tambahkan nilai baru ke buffer."""
        self.buffer.append(value)

    def get_average(self):
        """Kembalikan rata-rata, atau None jika buffer kosong."""
        if not self.buffer:
            return None
        return sum(self.buffer) / len(self.buffer)

    def reset(self):
        """Kosongkan buffer."""
        self.buffer.clear()


# ══════════════════════════════════════════════════════════════════════
#  BAGIAN 4: MODUL ANTI-SPAM (Kontrol Pengiriman API)
# ══════════════════════════════════════════════════════════════════════

class SendController:
    """
    Mengontrol kapan data boleh dikirim ke API.

    Aturan kirim:
      1. Minimal N detik sejak pengiriman terakhir
      2. Nilai dimensi berubah > threshold, ATAU status berubah
    """

    def __init__(self, min_interval=1.5, change_threshold=0.1):
        self.min_interval      = min_interval
        self.change_threshold  = change_threshold
        self.last_sent_time    = 0.0
        self.last_sent_dim     = None
        self.last_sent_status  = None

    def should_send(self, dimension_mm, status):
        """
        Cek apakah data layak dikirim.
        Returns: True jika harus dikirim, False jika tidak.
        """
        now = time.time()

        # Jeda waktu belum cukup
        if now - self.last_sent_time < self.min_interval:
            return False

        # Pengiriman pertama → selalu kirim
        if self.last_sent_dim is None:
            return True

        # Status berubah (OK → NG atau sebaliknya) → kirim
        if status != self.last_sent_status:
            return True

        # Dimensi berubah signifikan → kirim
        if abs(dimension_mm - self.last_sent_dim) > self.change_threshold:
            return True

        return False

    def mark_sent(self, dimension_mm, status):
        """Catat bahwa data baru saja dikirim."""
        self.last_sent_time   = time.time()
        self.last_sent_dim    = dimension_mm
        self.last_sent_status = status


# ══════════════════════════════════════════════════════════════════════
#  BAGIAN 5: MODUL API — Kirim ke Backend
# ══════════════════════════════════════════════════════════════════════

class APIClient:
    """
    Menangani pengiriman data ke Node.js backend.
    Menggunakan threading supaya pengiriman tidak mem-block live preview.
    """

    def __init__(self, url, timeout=3):
        self.url     = url
        self.timeout = timeout
        self._last_result = None   # 'ok' | 'error' | None

    @property
    def last_result(self):
        return self._last_result

    def send_async(self, dimension_mm, status):
        """Kirim data di thread terpisah (non-blocking)."""
        t = threading.Thread(
            target=self._send,
            args=(dimension_mm, status),
            daemon=True
        )
        t.start()

    def _send(self, dimension_mm, status):
        """Fungsi internal pengiriman (berjalan di thread background)."""
        payload = {
            "dimension_mm": round(float(dimension_mm), 3),
            "status": status
            # Tidak perlu timestamp — backend yang generate otomatis
        }
        try:
            resp = requests.post(self.url, json=payload, timeout=self.timeout)
            if resp.status_code == 201:
                ts = datetime.datetime.now().strftime("%H:%M:%S")
                print(f"  [{ts}] TERKIRIM -> {dimension_mm:.3f} mm | {status}")
                self._last_result = 'ok'
            else:
                print(f"  [!] Server error: {resp.status_code} — {resp.text[:80]}")
                self._last_result = 'error'

        except requests.exceptions.ConnectionError:
            print("  [!] Tidak bisa konek ke server. Pastikan 'node server.js' berjalan!")
            self._last_result = 'error'
        except requests.exceptions.Timeout:
            print("  [!] Request timeout — server lambat merespons")
            self._last_result = 'error'
        except Exception as e:
            print(f"  [!] Error tidak terduga: {e}")
            self._last_result = 'error'


# ══════════════════════════════════════════════════════════════════════
#  BAGIAN 6: VISUALISASI HUD
# ══════════════════════════════════════════════════════════════════════

def gambar_hud(frame, last_dim, last_status, auto_send,
               api_result, smooth_dim):
    """
    Gambar panel HUD (Heads-Up Display) di atas dan bawah frame.

    Panel atas  : judul, jam, status auto-send
    Panel bawah : hasil terakhir, status kirim, panduan kontrol
    """
    cfg = Config
    ui  = frame.copy()
    h, w = ui.shape[:2]

    # ────────────────────────────────────────────────
    # PANEL ATAS
    # ────────────────────────────────────────────────
    cv2.rectangle(ui, (0, 0), (w, 54), cfg.COLOR_DARK, -1)
    cv2.line(ui, (0, 54), (w, 54), (50, 80, 150), 1)

    # Judul
    cv2.putText(ui, "AUTOMATED DIMENSIONAL INSPECTION",
                (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.65, cfg.COLOR_WHITE, 1, cv2.LINE_AA)

    # Jam real-time
    jam = datetime.datetime.now().strftime("%H:%M:%S")
    cv2.putText(ui, jam,
                (w - 92, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.58, cfg.COLOR_GRAY, 1, cv2.LINE_AA)

    # Status auto-send
    a_txt = " AUTO-SEND: ON " if auto_send else " AUTO-SEND: OFF "
    a_clr = cfg.COLOR_OK if auto_send else (100, 100, 100)
    cv2.putText(ui, a_txt,
                (10, 46), cv2.FONT_HERSHEY_SIMPLEX, 0.42, a_clr, 1, cv2.LINE_AA)

    # Info Target & Tolerance
    cv2.putText(ui, f"Target: {cfg.TARGET_DIMENSION:.1f} mm | Tolerance: +/- {cfg.TOLERANCE:.1f} mm",
                (180, 46), cv2.FONT_HERSHEY_SIMPLEX, 0.42, cfg.COLOR_YELLOW, 1, cv2.LINE_AA)

    # Nilai smooth (rata-rata bergulir) di header
    if smooth_dim is not None:
        cv2.putText(ui, f"Smooth: {smooth_dim:.3f} mm",
                    (520, 46), cv2.FONT_HERSHEY_SIMPLEX, 0.42, cfg.COLOR_GRAY, 1, cv2.LINE_AA)

    # ────────────────────────────────────────────────
    # PANEL BAWAH
    # ────────────────────────────────────────────────
    PH = 120  # tinggi panel bawah
    y0 = h - PH

    # Background semi-transparan
    overlay = ui[y0:h, :].copy()
    cv2.rectangle(overlay, (0, 0), (w, PH), cfg.COLOR_DARK, -1)
    cv2.addWeighted(overlay, 0.86, ui[y0:h, :], 0.14, 0, ui[y0:h, :])
    cv2.line(ui, (0, y0), (w, y0), (50, 80, 150), 1)

    BASE_Y = y0 + 22

    # ── Hasil inspeksi terakhir ──
    if last_dim is not None and last_status is not None:
        clr = cfg.COLOR_OK if last_status == "OK" else cfg.COLOR_NG

        cv2.putText(ui,
                    f"Dimensi : {last_dim:.3f} mm",
                    (12, BASE_Y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.62, cfg.COLOR_WHITE, 1, cv2.LINE_AA)

        cv2.putText(ui,
                    f"Status  : {last_status}",
                    (12, BASE_Y + 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.75, clr, 2, cv2.LINE_AA)

        # Indikator pengiriman API
        if api_result == 'ok':
            cv2.putText(ui, ">> Terkirim ke Dashboard",
                        (12, BASE_Y + 54),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.48, cfg.COLOR_OK, 1, cv2.LINE_AA)
        elif api_result == 'error':
            cv2.putText(ui, ">> GAGAL KIRIM - cek server!",
                        (12, BASE_Y + 54),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.48, cfg.COLOR_NG, 1, cv2.LINE_AA)
    else:
        cv2.putText(ui, "Arahkan objek ke kamera...",
                    (12, BASE_Y + 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.58, cfg.COLOR_GRAY, 1, cv2.LINE_AA)

    # ── Panduan kontrol (kanan bawah) ──
    KX = w - 300
    cv2.putText(ui, "[SPASI]   Kirim inspeksi manual",
                (KX, BASE_Y),      cv2.FONT_HERSHEY_SIMPLEX, 0.44, cfg.COLOR_GRAY, 1, cv2.LINE_AA)
    cv2.putText(ui, "[A]       Toggle auto-send",
                (KX, BASE_Y + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.44, cfg.COLOR_GRAY, 1, cv2.LINE_AA)
    cv2.putText(ui, "[UP/DOWN] Ubah target dimensi",
                (KX, BASE_Y + 40), cv2.FONT_HERSHEY_SIMPLEX, 0.44, cfg.COLOR_YELLOW, 1, cv2.LINE_AA)
    cv2.putText(ui, "[Q/ESC]   Keluar",
                (KX, BASE_Y + 60), cv2.FONT_HERSHEY_SIMPLEX, 0.44, cfg.COLOR_GRAY, 1, cv2.LINE_AA)

    return ui


def tampilkan_status_live(frame, dim_mm, cfg):
    """
    Tampilkan nilai dimensi live DAN indikator OK/NG di pojok frame.
    Ini berjalan setiap frame — bukan hanya saat inspeksi.
    """
    if dim_mm is None:
        cv2.putText(frame, "Tidak ada objek",
                    (10, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.6, cfg.COLOR_GRAY, 1, cv2.LINE_AA)
        return

    is_ok   = (cfg.TARGET_DIMENSION - cfg.TOLERANCE) <= dim_mm <= (cfg.TARGET_DIMENSION + cfg.TOLERANCE)
    status  = "OK" if is_ok else "NG"
    clr     = cfg.COLOR_OK if is_ok else cfg.COLOR_NG
    tanda   = "v" if is_ok else "x"

    # Kotak status (pojok kiri, bawah header)
    cv2.rectangle(frame, (8, 62), (230, 94), (0, 0, 0), -1)
    cv2.rectangle(frame, (8, 62), (230, 94), clr, 1)
    cv2.putText(frame,
                f"LIVE [{tanda}] {dim_mm:.3f} mm = {status}",
                (14, 83),
                cv2.FONT_HERSHEY_SIMPLEX, 0.52, clr, 1, cv2.LINE_AA)


# ══════════════════════════════════════════════════════════════════════
#  BAGIAN 7: INISIALISASI KAMERA
# ══════════════════════════════════════════════════════════════════════

def buka_kamera():
    """
    Coba buka kamera dari index 0, 1, 2.
    Gunakan DirectShow (CAP_DSHOW) yang lebih stabil di Windows.
    Returns: (VideoCapture object, index) atau (None, -1) jika gagal.
    """
    cfg = Config
    for idx in range(3):
        print(f"  Mencoba kamera index {idx} ...")
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        if cap.isOpened():
            ret, _ = cap.read()
            if ret:
                # Set properti kamera
                cap.set(cv2.CAP_PROP_FRAME_WIDTH,  cfg.FRAME_WIDTH)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg.FRAME_HEIGHT)
                cap.set(cv2.CAP_PROP_FPS,          cfg.FPS)
                rw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                rh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                print(f"  Kamera {idx} berhasil dibuka! Resolusi: {rw}x{rh}")
                return cap, idx
            cap.release()
    return None, -1


# ══════════════════════════════════════════════════════════════════════
#  BAGIAN 8: MAIN LOOP
# ══════════════════════════════════════════════════════════════════════

def main():
    cfg = Config

    # ── Banner startup ─────────────────────────────────────────────
    print("=" * 58)
    print("  Automated Dimensional Inspection — Edge System")
    print("=" * 58)
    print(f"  Target     : {cfg.TARGET_DIMENSION} mm +/- {cfg.TOLERANCE} mm")
    print(f"  Kalibrasi  : {cfg.PIXELS_PER_MM} px/mm  (1px = {1/cfg.PIXELS_PER_MM:.2f} mm)")
    print(f"  Smoothing  : {cfg.SMOOTH_SAMPLES} frame terakhir dirata-rata")
    print(f"  Anti-spam  : kirim jika selisih > {cfg.CHANGE_THRESHOLD} mm")
    print(f"               atau jika status berubah")
    print(f"               atau jeda minimal {cfg.MIN_SEND_INTERVAL}s")
    print(f"  API        : {cfg.API_URL}")
    print("-" * 58)
    print("  Kontrol:")
    print("    SPASI   -> Kirim inspeksi sekarang (paksa)")
    print("    A       -> Toggle auto-send ON/OFF")
    print("    UP/DOWN -> Ubah target dimensi")
    print("    Q/ESC   -> Keluar")
    print("=" * 58)

    # ── Inisialisasi modul ─────────────────────────────────────────
    smoother   = DimensionSmoother(n_samples=cfg.SMOOTH_SAMPLES)
    controller = SendController(
        min_interval     = cfg.MIN_SEND_INTERVAL,
        change_threshold = cfg.CHANGE_THRESHOLD
    )
    api        = APIClient(url=cfg.API_URL, timeout=cfg.API_TIMEOUT)

    # ── Buka kamera ───────────────────────────────────────────────
    print("\nMembuka kamera...")
    cap, cam_idx = buka_kamera()
    if cap is None:
        print("\n[ERROR] Tidak ada kamera yang ditemukan!")
        print("  Pastikan webcam terhubung dan tidak dipakai aplikasi lain.")
        input("Tekan Enter untuk keluar...")
        return

    # ── Setup window OpenCV ────────────────────────────────────────
    WINDOW_NAME = "Inspection Edge System  [Q = Keluar]"
    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WINDOW_NAME, 960, 580)

    # ── State variabel ─────────────────────────────────────────────
    last_dim    = None   # Dimensi terakhir yang berhasil dikirim
    last_status = None   # Status terakhir yang berhasil dikirim
    auto_send   = True   # Auto-send default ON

    print("\nKamera aktif. Arahkan objek ke depan kamera.\n")

    # ══════════════════════════════════════════════════════════════
    #  MAIN LOOP — berjalan setiap frame
    # ══════════════════════════════════════════════════════════════
    while True:

        # ── 1. Baca frame ────────────────────────────────────────
        ret, frame = cap.read()
        if not ret:
            print("[!] Gagal baca frame, mencoba ulang...")
            time.sleep(0.05)
            continue

        # ── 2. Proses frame (Canny + Kontur + Ukur) ──────────────
        dim_raw, frame_plot = proses_frame(frame)

        # ── 3. Smoothing: masukkan ke buffer rata-rata ────────────
        smooth_val = None
        if dim_raw is not None:
            smoother.add(dim_raw)
            smooth_val = smoother.get_average()
        else:
            # Jika tidak ada objek, reset buffer (hindari data lama)
            smoother.reset()

        # ── 4. Tentukan status OK/NG dari nilai smooth ────────────
        if smooth_val is not None:
            if cfg.TARGET_DIMENSION - cfg.TOLERANCE <= smooth_val <= cfg.TARGET_DIMENSION + cfg.TOLERANCE:
                status = "OK"
            else:
                status = "NG"
        else:
            status = None

        # ── 5. Auto-send: kirim jika memenuhi kriteria ────────────
        if auto_send and smooth_val is not None and status is not None:
            if controller.should_send(smooth_val, status):
                api.send_async(smooth_val, status)
                controller.mark_sent(smooth_val, status)
                last_dim    = smooth_val
                last_status = status

        # ── 6. Tampilkan indikator live di frame ──────────────────
        tampilkan_status_live(frame_plot, smooth_val, cfg)

        # ── 7. Gambar HUD ──────────────────────────────────────────
        display = gambar_hud(
            frame_plot,
            last_dim, last_status,
            auto_send,
            api.last_result,
            smooth_val
        )

        # ── 8. Tampilkan ke layar ──────────────────────────────────
        cv2.imshow(WINDOW_NAME, display)

        # ── 9. Tangkap input keyboard ─────────────────────────────
        key = cv2.waitKeyEx(1)

        # Q atau ESC → keluar
        if key in (ord('q'), ord('Q'), 27):
            print("\nMenutup program...")
            break

        # SPASI → kirim inspeksi paksa (abaikan anti-spam)
        elif key == ord(' '):
            if smooth_val is not None and status is not None:
                print(f"\n[PAKSA] Mengirim: {smooth_val:.3f} mm → {status}")
                api.send_async(smooth_val, status)
                controller.mark_sent(smooth_val, status)
                last_dim    = smooth_val
                last_status = status
            else:
                print("[!] Tidak ada objek terdeteksi untuk dikirim!")

        # A → toggle auto-send
        elif key in (ord('a'), ord('A')):
            auto_send = not auto_send
            txt = "ON" if auto_send else "OFF"
            print(f"\n[AUTO] Auto-send: {txt}")

        # UP / DOWN → Ubah target dimensi
        elif key in (2490368, 65362, 82, ord('+'), ord('=')): # Arrow UP atau '+'
            cfg.TARGET_DIMENSION += 0.5
            print(f"[TARGET] Diubah menjadi: {cfg.TARGET_DIMENSION:.1f} mm")
            
        elif key in (2621440, 65364, 84, ord('-'), ord('_')): # Arrow DOWN atau '-'
            cfg.TARGET_DIMENSION -= 0.5
            if cfg.TARGET_DIMENSION < 0.5:
                cfg.TARGET_DIMENSION = 0.5
            print(f"[TARGET] Diubah menjadi: {cfg.TARGET_DIMENSION:.1f} mm")

    # ── Cleanup ────────────────────────────────────────────────────
    cap.release()
    cv2.destroyAllWindows()
    print("Program selesai.")


# ══════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    main()
