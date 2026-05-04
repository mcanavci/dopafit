import sqlite3
import time
from pathlib import Path

DB_PATH = Path.home() / ".dopaminebar" / "samples.db"


def init():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as c:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS samples (
                ts INTEGER NOT NULL,
                app TEXT,
                domain TEXT,
                category TEXT NOT NULL,
                idle_seconds INTEGER
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts)")


def insert(app, domain, category, idle_seconds):
    with sqlite3.connect(DB_PATH) as c:
        c.execute(
            "INSERT INTO samples (ts, app, domain, category, idle_seconds) VALUES (?,?,?,?,?)",
            (int(time.time()), app, domain, category, idle_seconds),
        )


def fetch_since(ts):
    with sqlite3.connect(DB_PATH) as c:
        c.row_factory = sqlite3.Row
        rows = c.execute(
            "SELECT ts, app, domain, category, idle_seconds FROM samples WHERE ts >= ? ORDER BY ts",
            (ts,),
        ).fetchall()
        return [dict(r) for r in rows]


def category_breakdown_since(ts):
    with sqlite3.connect(DB_PATH) as c:
        rows = c.execute(
            "SELECT category, COUNT(*) FROM samples WHERE ts >= ? GROUP BY category",
            (ts,),
        ).fetchall()
        return {cat: count for cat, count in rows}
