"""Serve the local campus forecasting dashboard."""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

# Small CPU matrix operations are faster and more predictable without a large
# BLAS thread pool; preserve explicit operator settings.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")

from forecasting import train_and_evaluate
from generate_data import make_dataset

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"


class Handler(BaseHTTPRequestHandler):
    payload: dict | None = None

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/data":
            body = json.dumps(self.payload, separators=(",", ":")).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path in ("/", "/index.html"):
            body = (ROOT / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

    def log_message(self, fmt, *args):
        print(f"{self.log_date_time_string()} {fmt % args}")


def main():
    required_data = [DATA / "meter_readings.csv", DATA / "schedules.csv", DATA / "weather_forecasts.csv"]
    present = [path.exists() for path in required_data]
    if any(present) and not all(present):
        missing = ", ".join(path.name for path, exists in zip(required_data, present) if not exists)
        raise RuntimeError(f"Dataset is incomplete; missing {missing}. Refusing to overwrite existing data.")
    if not any(present):
        print("Generating seeded demo dataset…")
        make_dataset(DATA)
    print("Training chronological demo model and preparing dashboard…")
    Handler.payload = train_and_evaluate(DATA)
    port = int(os.environ.get("CAMPUS_PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Dashboard ready at http://127.0.0.1:{port} (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
