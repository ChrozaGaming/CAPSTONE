"""
WSPublisher — push frame ke browser via WebSocket binary JPEG.

Threading model:
  - Thread main edge_camera.py memanggil push(frame) per iterasi loop.
  - Internal background thread menjalankan asyncio loop:
      * websockets.serve di STREAM_PORT
      * broadcast_loop async task baca single-slot frame, encode JPEG,
        kirim ke semua client connected.
  - Single-slot semantic: frame baru menimpa frame lama → otomatis drop
    kalau encoder/network lambat. Tidak ada antrian frame stale.

Backpressure handling:
  - asyncio.wait_for(ws.send(...), timeout=0.05) → kalau client lemot,
    drop frame untuk client itu (tetap kirim ke client lain).
  - Browser-side juga drop frame stale via requestAnimationFrame.
"""
import asyncio
import threading
import time
import cv2
import numpy as np

try:
    import websockets
except ImportError as e:
    raise RuntimeError(
        "[STREAM] 'websockets' tidak terinstall. "
        "Run: pip install websockets"
    ) from e

from . import config


class WSPublisher:
    def __init__(self):
        self._frame_slot = None             # numpy.ndarray | None
        self._lock = threading.Lock()
        self._clients = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._running = False

    # ── Public API (called from main thread) ─────────────────────────────

    def start(self) -> bool:
        if self._running:
            return True
        self._running = True
        self._thread = threading.Thread(
            target=self._run, daemon=True, name="StreamPublisher"
        )
        self._thread.start()
        # Wait briefly for asyncio loop to come up
        for _ in range(150):
            if self._loop is not None:
                return True
            time.sleep(0.02)
        return False

    def stop(self) -> None:
        self._running = False
        if self._loop is not None:
            try:
                self._loop.call_soon_threadsafe(self._loop.stop)
            except Exception:
                pass

    def push(self, frame: np.ndarray) -> None:
        """Non-blocking. Override single-slot dengan frame terbaru."""
        if not self._running or frame is None:
            return
        h, w = frame.shape[:2]
        if w > config.STREAM_MAX_WIDTH:
            scale = config.STREAM_MAX_WIDTH / float(w)
            new_size = (int(w * scale), int(h * scale))
            frame = cv2.resize(frame, new_size, interpolation=cv2.INTER_AREA)
        # Copy karena main loop akan reuse buffer
        with self._lock:
            self._frame_slot = frame.copy()

    # ── Internal asyncio runtime ─────────────────────────────────────────

    def _run(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._serve())
        except Exception as e:
            print(f"[STREAM] Publisher loop error: {e}")
        finally:
            try:
                self._loop.close()
            except Exception:
                pass

    async def _serve(self) -> None:
        async def handler(ws):
            self._clients.add(ws)
            client_count = len(self._clients)
            print(f"[STREAM] Viewer connected ({client_count} total)")
            try:
                async for _ in ws:
                    pass  # ignore client→server messages on this channel
            except Exception:
                pass
            finally:
                self._clients.discard(ws)
                print(f"[STREAM] Viewer disconnected ({len(self._clients)} total)")

        server = await websockets.serve(
            handler,
            config.STREAM_BIND,
            config.STREAM_PORT,
            max_size=None,           # frames bisa besar
            ping_interval=20,
            ping_timeout=10,
        )
        print(
            f"[STREAM] Publisher listening on "
            f"ws://{config.STREAM_BIND}:{config.STREAM_PORT} "
            f"(max {config.STREAM_MAX_WIDTH}px, JPEG q{config.STREAM_QUALITY}, "
            f"target {config.STREAM_FPS_TARGET}fps)"
        )

        target_dt = 1.0 / max(1, config.STREAM_FPS_TARGET)
        last_send = 0.0

        try:
            while self._running:
                now = time.monotonic()
                wait_for = target_dt - (now - last_send)
                if wait_for > 0:
                    await asyncio.sleep(wait_for)

                # Pull latest frame (consume = clear slot)
                frame = None
                with self._lock:
                    if self._frame_slot is not None:
                        frame = self._frame_slot
                        self._frame_slot = None

                if frame is None or not self._clients:
                    await asyncio.sleep(0.005)
                    continue

                # Encode JPEG (CPU bound; ~3-8ms @ 1080p on Apple Silicon)
                ok, buf = cv2.imencode(
                    ".jpg",
                    frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), config.STREAM_QUALITY],
                )
                if not ok:
                    continue
                payload = bytes(buf)

                # Broadcast (per-client timeout = backpressure drop)
                dead = []
                for ws in list(self._clients):
                    try:
                        await asyncio.wait_for(ws.send(payload), timeout=0.05)
                    except asyncio.TimeoutError:
                        # Client lemot — drop frame ini saja, jangan disconnect
                        pass
                    except Exception:
                        dead.append(ws)
                for ws in dead:
                    self._clients.discard(ws)

                last_send = time.monotonic()
        finally:
            server.close()
            try:
                await server.wait_closed()
            except Exception:
                pass
