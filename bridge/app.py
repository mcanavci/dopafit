import threading
import time
from datetime import datetime, time as dtime

import rumps

import bridge
import classify
import db
import score
import tracker

SAMPLE_INTERVAL_SECONDS = 30
REFRESH_INTERVAL_SECONDS = 60

COLOR_DOTS = {"green": "🟢", "yellow": "🟡", "red": "🔴"}


def _start_of_today_ts():
    return int(datetime.combine(datetime.now().date(), dtime.min).timestamp())


class DopamineBar(rumps.App):
    def __init__(self):
        super().__init__("⚪", quit_button="Quit")
        self.menu = [
            "Today",
            "Last hour",
            None,
            "Productive",
            "Neutral",
            "Spike",
            "Break",
            None,
            "Refresh",
        ]
        db.init()
        self._start_sampler()
        bridge.start_in_thread()  # localhost:9876 for Chrome extension merge
        self._refresh()

    def _start_sampler(self):
        t = threading.Thread(target=self._sample_loop, daemon=True)
        t.start()

    def _sample_loop(self):
        while True:
            try:
                s = tracker.sample()
                cat = classify.classify(s["app"], s["domain"], s["idle_seconds"])
                db.insert(s["app"], s["domain"], cat, s["idle_seconds"])
            except Exception as e:
                print("[dopaminebar] sample error:", e)
            time.sleep(SAMPLE_INTERVAL_SECONDS)

    @rumps.timer(REFRESH_INTERVAL_SECONDS)
    def _tick(self, _):
        self._refresh()

    def _refresh(self):
        today_samples = db.fetch_since(_start_of_today_ts())
        hour_samples = db.fetch_since(int(time.time()) - 3600)

        today_score = score.compute_score(today_samples)
        hour_score = score.compute_score(hour_samples)
        dot = COLOR_DOTS[score.color_for(today_score)]

        self.title = f"{dot}{int(round(today_score))}"
        self.menu["Today"].title = f"Today: {int(round(today_score))}"
        self.menu["Last hour"].title = f"Last hour: {int(round(hour_score))}"

        mins = score.minutes_by_category(today_samples)
        self.menu["Productive"].title = f"Productive: {int(mins.get('productive', 0))} min"
        self.menu["Neutral"].title = f"Neutral: {int(mins.get('neutral', 0))} min"
        self.menu["Spike"].title = f"Spike: {int(mins.get('spike', 0))} min"
        self.menu["Break"].title = f"Break: {int(mins.get('break', 0))} min"

    @rumps.clicked("Refresh")
    def _on_refresh(self, _):
        self._refresh()


if __name__ == "__main__":
    DopamineBar().run()
