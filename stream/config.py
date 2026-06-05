"""
Streaming module config — semua tunable lewat env var, sensible defaults
untuk localhost dev. Dipanggil sebelum publisher/control init.
"""
import os


def _int_env(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, default))
    except (TypeError, ValueError):
        return default


# Ports — terpisah dari server.js (3000) supaya nanti VPS PM2 bisa
# manage stream service independent.
STREAM_PORT  = _int_env("STREAM_PORT",  8765)   # video frames out (Python -> browser)
CONTROL_PORT = _int_env("CONTROL_PORT", 8766)   # keybind in (browser -> Python)

# Bind address. 0.0.0.0 = listen all interfaces (LAN reachable).
# Set to 127.0.0.1 untuk lock localhost-only.
STREAM_BIND  = os.environ.get("STREAM_BIND", "0.0.0.0")

# Streaming quality knobs. Default = pass-through 1080p, JPEG q80.
# Frame measurement TIDAK terpengaruh — hanya copy untuk web yang di-resize/encode.
STREAM_MAX_WIDTH  = _int_env("STREAM_MAX_WIDTH",  1920)   # cap; lebih kecil dari ini = pass-through
STREAM_QUALITY    = _int_env("STREAM_QUALITY",    80)     # JPEG quality 1-100
STREAM_FPS_TARGET = _int_env("STREAM_FPS_TARGET", 30)     # browser tetap drop stale via rAF
