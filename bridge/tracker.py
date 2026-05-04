import subprocess
from urllib.parse import urlparse

from AppKit import NSWorkspace
from Quartz import (
    CGEventSourceSecondsSinceLastEventType,
    kCGEventSourceStateHIDSystemState,
)

# kCGAnyInputEventType is not exposed by name in pyobjc; the value is -1.
_ANY_INPUT_EVENT = -1

# AppleScript per browser. Apps not in this map yield no URL.
_BROWSER_SCRIPTS = {
    "Google Chrome": 'tell application "Google Chrome" to get URL of active tab of front window',
    "Google Chrome Canary": 'tell application "Google Chrome Canary" to get URL of active tab of front window',
    "Safari": 'tell application "Safari" to get URL of current tab of front window',
    "Safari Technology Preview": 'tell application "Safari Technology Preview" to get URL of current tab of front window',
    "Arc": 'tell application "Arc" to get URL of active tab of front window',
    "Brave Browser": 'tell application "Brave Browser" to get URL of active tab of front window',
    "Microsoft Edge": 'tell application "Microsoft Edge" to get URL of active tab of front window',
}


def frontmost_app():
    app = NSWorkspace.sharedWorkspace().frontmostApplication()
    if app is None:
        return None
    return app.localizedName()


def idle_seconds():
    try:
        return float(
            CGEventSourceSecondsSinceLastEventType(
                kCGEventSourceStateHIDSystemState, _ANY_INPUT_EVENT
            )
        )
    except Exception:
        return 0.0


def browser_url(app_name):
    script = _BROWSER_SCRIPTS.get(app_name)
    if not script:
        return None
    try:
        r = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            timeout=2,
            text=True,
        )
        url = r.stdout.strip()
        return url or None
    except Exception:
        return None


def domain_of(url):
    if not url:
        return None
    try:
        host = (urlparse(url).hostname or "").lower()
        if host.startswith("www."):
            host = host[4:]
        return host or None
    except Exception:
        return None


def sample():
    app = frontmost_app()
    url = browser_url(app) if app else None
    return {
        "app": app,
        "domain": domain_of(url),
        "idle_seconds": int(idle_seconds()),
    }
