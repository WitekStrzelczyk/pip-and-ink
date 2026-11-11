"""Keeps FLUX.2 klein 4B loaded in memory and paints on request.

The Next.js server starts this with mflux's own Python and talks to it on 127.0.0.1:
    GET  /health -> {"ready": true}
    POST /paint  -> {"prompt", "output", "width", "height", "steps", "seed"}

It only ever writes PNG files into PAINTER_DIR, and only for callers that send the
shared secret in X-Painter-Token, so nothing else on this computer (a web page, another
program) can use it to write files. All MLX work stays on the main thread; requests are
handled one at a time.
"""

import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("PAINTER_PORT", "7861"))
MODEL_DIR = os.environ.get("PAINTER_MODEL", "")
PICTURE_DIR = os.environ.get("PAINTER_DIR", "")
TOKEN = os.environ.get("PAINTER_TOKEN", "")
FILE_NAME = re.compile(r"^[a-z0-9-]+\.png$")


def log(*args):
    print(time.strftime("%H:%M:%S"), *args, file=sys.stderr, flush=True)


if not PICTURE_DIR or not TOKEN:
    sys.exit("PAINTER_DIR and PAINTER_TOKEN must be set (the app sets them when it starts the painter)")

# Take the port before loading 4 GB of weights: a second copy started by mistake stops here.
server = HTTPServer(("127.0.0.1", PORT), None)

import mlx.core as mx  # noqa: E402  (after the port check, these imports are slow)
from mflux.models.flux2.variants import Flux2Klein  # noqa: E402

if MODEL_DIR and os.path.isdir(MODEL_DIR):
    log("loading model from", MODEL_DIR)
    model = Flux2Klein(model_path=MODEL_DIR)
else:
    log("no saved model at", MODEL_DIR or "(PAINTER_MODEL not set)", "- quantizing flux2-klein-4b to 4-bit now; see the README to save it once")
    model = Flux2Klein(quantize=4)

# One tiny throwaway picture pages the weights in, so the first real one is not slowed by it.
model.generate_image(seed=1, prompt="a pencil sketch of a cat", num_inference_steps=1, width=256, height=256)
mx.clear_cache()
log("ready on port", PORT)


def clamp(value, low, high, default):
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the caller stopped waiting (a health check while the model was loading)

    def do_GET(self):
        self._send(200, {"ready": True})

    def do_POST(self):
        # Browsers always send Origin on cross-site POSTs; the app's server never does.
        if self.headers.get("Origin") or self.headers.get("X-Painter-Token") != TOKEN:
            return self._send(403, {"ok": False, "error": "forbidden"})
        try:
            length = clamp(self.headers.get("Content-Length"), 0, 20_000, 0)
            req = json.loads(self.rfile.read(length))
            prompt = req.get("prompt")
            name = req.get("output")
            if not isinstance(prompt, str) or not prompt.strip() or not isinstance(name, str) or not FILE_NAME.match(name):
                return self._send(400, {"ok": False, "error": "needs a prompt and an output file name like abc-123.png"})
            started = time.time()
            image = model.generate_image(
                seed=clamp(req.get("seed"), 0, 2**31 - 1, 42),
                prompt=prompt[:4000],
                num_inference_steps=clamp(req.get("steps"), 1, 8, 4),
                width=clamp(req.get("width"), 256, 1024, 512) // 16 * 16,
                height=clamp(req.get("height"), 256, 1024, 512) // 16 * 16,
                guidance=1.0,  # the distilled model is trained for exactly this
            )
            image.save(path=os.path.join(PICTURE_DIR, name), overwrite=True)
            seconds = round(time.time() - started, 1)
            log(f"painted in {seconds}s:", prompt[:80])
            self._send(200, {"ok": True, "seconds": seconds})
        except Exception as error:  # report to the caller instead of dying
            log("paint failed:", repr(error))
            self._send(500, {"ok": False, "error": repr(error)})
        finally:
            mx.clear_cache()  # MLX keeps freed buffers otherwise, and memory is what makes painting slow

    def log_message(self, *args):
        pass


server.RequestHandlerClass = Handler
server.serve_forever()
