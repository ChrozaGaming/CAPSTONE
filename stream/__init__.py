"""
stream — modul streaming kamera ke web + receive keybind dari web.

Public API minimal supaya integrasi di edge_camera.py cuma 2 baris:
    stream.publish(annotated_frame)
    web_key = stream.poll_key()

Module-level lazy init: panggil start() sekali di startup, sisanya idempotent.

Architecture:
    edge_camera.py main thread
      ├── stream.publish(frame) ───▶ WSPublisher thread (port :8765)
      └── stream.poll_key() ◀────── WSControl thread (port :8766)

Future-proof: untuk swap ke WebRTC nanti, tinggal buat WebRTCPublisher
yang implement push() interface; toggle via env STREAM_BACKEND.
"""
from . import config

_publisher = None
_control = None
_started = False


def start() -> bool:
    """Init publisher + control. Idempotent. Return True kalau sukses."""
    global _publisher, _control, _started
    if _started:
        return True

    from .publisher import WSPublisher
    from .control import WSControl

    _publisher = WSPublisher()
    _control = WSControl()

    pub_ok = _publisher.start()
    ctrl_ok = _control.start()
    _started = pub_ok and ctrl_ok
    if not _started:
        print("[STREAM] start() partial — publisher_ok={}, control_ok={}".format(
            pub_ok, ctrl_ok))
    return _started


def stop() -> None:
    if _publisher is not None:
        _publisher.stop()
    if _control is not None:
        _control.stop()


def publish(frame) -> None:
    """Push frame ke browser. No-op kalau stream belum start atau gagal."""
    if _publisher is not None:
        _publisher.push(frame)


def poll_key():
    """Return int ord dari keybind web, atau None kalau tidak ada."""
    if _control is not None:
        return _control.poll_key()
    return None


__all__ = ["start", "stop", "publish", "poll_key", "config"]
