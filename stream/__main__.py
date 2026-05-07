"""
Standalone debug runner untuk stream module.

Usage:
    python -m stream

Capture frame dari kamera default, publish ke web. Tanpa pipeline measurement
edge_camera.py. Berguna buat verifikasi end-to-end streaming sebelum hook
ke main pipeline.
"""
import sys
import time
import cv2

from . import start, publish, poll_key, config


def main() -> int:
    print("[STREAM-DEBUG] Opening camera 0…")
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[STREAM-DEBUG] Camera 0 tidak bisa dibuka. Exit.")
        return 1

    if not start():
        print("[STREAM-DEBUG] stream.start() gagal. Exit.")
        cap.release()
        return 2

    print(
        f"[STREAM-DEBUG] Buka browser: http://localhost:3000 "
        f"atau direct ws://localhost:{config.STREAM_PORT}"
    )
    print("[STREAM-DEBUG] Tekan Ctrl-C untuk exit")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.05)
                continue
            # Annotate ringan supaya kelihatan kalau streaming alive
            cv2.putText(
                frame, time.strftime("STREAM-DEBUG %H:%M:%S"),
                (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2,
            )
            publish(frame)
            web_key = poll_key()
            if web_key is not None:
                print(f"[STREAM-DEBUG] received web key: {chr(web_key) if 32 <= web_key < 127 else web_key}")
            time.sleep(1.0 / 30)
    except KeyboardInterrupt:
        print("\n[STREAM-DEBUG] Bye")
    finally:
        cap.release()
    return 0


if __name__ == "__main__":
    sys.exit(main())
