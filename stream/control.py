"""
WSControl — receive keybind dari browser, expose ke main loop edge_camera.py
sebagai integer ord (sama persis return value cv2.waitKey).

Threading model:
  - Background thread asyncio: WS server di CONTROL_PORT, terima
    JSON `{"key": "SPACE"}` dari browser.
  - poll_key() (called dari main thread edge_camera.py) baca single-slot
    queue, return None kalau kosong.
  - Single-slot semantic: kalau user spam click, hanya keypress terakhir
    yang dilihat main loop. Sesuai dengan cara cv2.waitKey jalan.
"""
import asyncio
import json
import queue
import threading
import time

try:
    import websockets
except ImportError as e:
    raise RuntimeError(
        "[STREAM] 'websockets' tidak terinstall. Run: pip install websockets"
    ) from e

from . import config


# Mapping: web key label → ord() integer. Match persis dengan cv2.waitKey return.
# Lowercase letters because cv2.waitKey return lowercase ASCII (A vs Caps Lock).
KEY_MAP = {
    "SPACE": ord(" "),
    "A": ord("a"),
    "C": ord("c"),
    "D": ord("d"),
    "L": ord("l"),
    "Q": ord("q"),
    "R": ord("r"),
    "U": ord("u"),
    "V": ord("v"),
    "X": ord("x"),
    "[": ord("["),
    "]": ord("]"),
    # Wizard / confirm dialog keys (Y/N saat KTP validation)
    "Y": ord("y"),
    "N": ord("n"),
    "ENTER": 13,
    "ESC": 27,
}


class WSControl:
    def __init__(self):
        self._key_queue: queue.Queue[int] = queue.Queue(maxsize=1)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._running = False

    # ── Public API ───────────────────────────────────────────────────────

    def start(self) -> bool:
        if self._running:
            return True
        self._running = True
        self._thread = threading.Thread(
            target=self._run, daemon=True, name="StreamControl"
        )
        self._thread.start()
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

    def poll_key(self):
        """Return latest key (int ord) or None. Non-blocking."""
        try:
            return self._key_queue.get_nowait()
        except queue.Empty:
            return None

    def _enqueue(self, code: int) -> None:
        # Single-slot: clear first if full
        try:
            self._key_queue.get_nowait()
        except queue.Empty:
            pass
        try:
            self._key_queue.put_nowait(code)
        except queue.Full:
            pass

    # ── asyncio runtime ──────────────────────────────────────────────────

    def _run(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._serve())
        except Exception as e:
            print(f"[STREAM] Control loop error: {e}")
        finally:
            try:
                self._loop.close()
            except Exception:
                pass

    async def _serve(self) -> None:
        async def handler(ws):
            print(f"[STREAM] Controller connected from {ws.remote_address}")
            try:
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                        label = str(msg.get("key", "")).strip().upper()
                        if label in KEY_MAP:
                            self._enqueue(KEY_MAP[label])
                            await ws.send(json.dumps({"ok": True, "key": label}))
                            print(f"[STREAM] Web keypress: {label}")
                        else:
                            await ws.send(
                                json.dumps({"ok": False, "error": f"unknown key: {label}"})
                            )
                    except json.JSONDecodeError:
                        await ws.send(json.dumps({"ok": False, "error": "bad json"}))
                    except Exception as e:
                        await ws.send(json.dumps({"ok": False, "error": str(e)}))
            except Exception:
                pass
            finally:
                print("[STREAM] Controller disconnected")

        server = await websockets.serve(
            handler,
            config.STREAM_BIND,
            config.CONTROL_PORT,
            ping_interval=20,
            ping_timeout=10,
        )
        print(
            f"[STREAM] Control listening on "
            f"ws://{config.STREAM_BIND}:{config.CONTROL_PORT}"
        )
        # Block forever (asyncio loop alive)
        try:
            await asyncio.Event().wait()
        finally:
            server.close()
            try:
                await server.wait_closed()
            except Exception:
                pass
