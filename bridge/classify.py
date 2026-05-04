import json
from pathlib import Path

_RULES_PATH = Path(__file__).parent / "classifier.json"
_rules = None

# Idle threshold for treating a sample as a real break (not just micro-pause).
IDLE_BREAK_THRESHOLD_SECONDS = 300


def _load():
    global _rules
    if _rules is None:
        _rules = json.loads(_RULES_PATH.read_text())
    return _rules


def reload():
    global _rules
    _rules = None
    return _load()


def classify(app, domain, idle_seconds):
    if idle_seconds is not None and idle_seconds >= IDLE_BREAK_THRESHOLD_SECONDS:
        return "break"

    rules = _load()

    if domain:
        domains = rules.get("domains", {})
        if domain in domains:
            return domains[domain]
        # Match subdomains: e.g. m.youtube.com -> youtube.com.
        for d, cat in domains.items():
            if domain.endswith("." + d):
                return cat

    if app and app in rules.get("apps", {}):
        return rules["apps"][app]

    return "neutral"
