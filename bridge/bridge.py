"""Localhost bridge that exposes today's native macOS app activity to the
Chrome extension popup.

The Python tracker writes per-30s samples to SQLite (db.py). This module
aggregates today's *native* samples (rows where domain IS NULL — i.e. Cursor,
Claude Desktop, Terminal, iTerm, etc., not browser tabs) and serves them as
JSON on localhost:9876. The Chrome extension fetches this on each popup
render and merges into its display.

Tier scheme is mapped to the Chrome extension's vocabulary so the merge is
trivial:
    spike      → high
    neutral    → medium
    productive → low
    break      → dropped (don't double-count idle)
"""

import json
import sqlite3
import threading
from datetime import datetime, time as dtime
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

DB_PATH = Path.home() / ".dopaminebar" / "samples.db"
SAMPLE_SECONDS = 30  # must match SAMPLE_INTERVAL_SECONDS in app.py
HOST = "127.0.0.1"
PORT = 9876

_TIER_MAP = {
    "spike":      "high",
    "neutral":    "medium",
    "productive": "low",
    "break":      None,  # skip — Chrome extension doesn't model breaks
}

# Apps that the Chrome extension already tracks. The Python sampler also sees
# them as the frontmost app when AppleScript fails to grab a URL, so we filter
# them out of native data to avoid double-counting browser time.
_BROWSER_APPS = {
    "Google Chrome", "Google Chrome Canary",
    "Safari", "Safari Technology Preview",
    "Arc", "Brave Browser", "Microsoft Edge", "Firefox",
}


class _Handler(BaseHTTPRequestHandler):
    # Silence the default per-request access log.
    def log_message(self, *a, **kw): pass

    def do_GET(self):
        if self.path == "/today":
            self._json(200, _aggregate_today())
        elif self.path == "/health":
            self._json(200, {"status": "ok"})
        else:
            self._json(404, {"error": "not found"})

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _cors_headers(self):
        # Permissive CORS — bound to 127.0.0.1 only, so this is fine.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)


def _aggregate_today():
    today_ts = int(datetime.combine(datetime.now().date(), dtime.min).timestamp())
    if not DB_PATH.exists():
        return _empty_payload()

    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            """
            SELECT app, category, COUNT(*) AS samples
            FROM samples
            WHERE ts >= ? AND domain IS NULL
            GROUP BY app, category
            """,
            (today_ts,),
        ).fetchall()

    apps = {}
    tiers = {"high": 0, "medium": 0, "low": 0, "unknown": 0}
    total = 0
    for app, category, samples in rows:
        tier = _TIER_MAP.get(category)
        if tier is None or app is None:
            continue
        if app in _BROWSER_APPS:
            continue  # Chrome extension owns browser time
        seconds = samples * SAMPLE_SECONDS
        cur = apps.setdefault(app, {"seconds": 0, "tier": tier})
        cur["seconds"] += seconds
        cur["tier"] = tier  # tier may flip between samples; keep latest
        tiers[tier] += seconds
        total += seconds

    return {
        "source": "native-mac",
        "today":  datetime.now().date().isoformat(),
        "total":  total,
        "apps":   apps,
        "tiers":  tiers,
    }


def _empty_payload():
    return {
        "source": "native-mac",
        "today":  datetime.now().date().isoformat(),
        "total":  0,
        "apps":   {},
        "tiers":  {"high": 0, "medium": 0, "low": 0, "unknown": 0},
    }


def serve_forever():
    server = HTTPServer((HOST, PORT), _Handler)
    print(f"[bridge] serving on http://{HOST}:{PORT}")
    server.serve_forever()


def start_in_thread():
    """Start the HTTP server in a daemon thread. Returns the thread."""
    t = threading.Thread(target=serve_forever, daemon=True, name="bridge-http")
    t.start()
    return t


if __name__ == "__main__":
    serve_forever()
