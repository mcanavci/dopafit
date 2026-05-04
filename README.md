# dopaFit

Mental fitness for your devices. A Chrome extension that classifies every site into three dopamine tiers and shows you, honestly, where your day went.

```
🔴 High      < 30 min/day    slot-machine feeds, social, doomscroll, betting
🟠 Medium    < 90 min/day    video, forums, shopping, AI tools
🟢 Positive  no cap          high-leverage build, work, study, research
```

Awareness, not blocking. The score (0–100) grades the day. A one-line context tells you what to do next. Streak alerts ping you mid-binge.

> The goal isn't less screen time. The goal is more of the screen time that compounds — and less of the screen time that costs you your edge.

---

## Install (when published)

Chrome Web Store: *(coming soon)*

## Install from source (now)

1. Clone this repo.
2. Open `chrome://extensions` in Chrome.
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and pick the `extension/` folder.

That's it. Nothing leaves your machine.

---

## Why three tiers, why these budgets

The classifier and budgets are research-backed. Full sources in `extension/about.html` (also accessible from the popup's About tab).

- **MIT / OpenAI 2025 RCT (n=981)** — AI chat use above ~27 min/day correlates with dependence. That's why Claude / ChatGPT / Perplexity are `medium`, not `positive`.
- **Hunt et al. 2018, J. Soc. Clin. Psychology** — limiting social media to 30 min/day reduced loneliness and depression. That's the high-tier 30-min budget.
- **METR 2025** — developers feel 20% faster with AI; measured 19% slower. The vibe-coding perception gap.
- **GitClear 2025** — 8× rise in code-clone churn with AI use. Output speed up, output quality down.

---

## Privacy

Hard guarantees:

- **No login.** No account.
- **No cloud.** All data lives in `chrome.storage.local` on your machine.
- **No analytics.** We don't know who installed this.
- **No telemetry.** No call-home.
- **Open source.** Audit it yourself.

Hit **Reset today** in the popup to delete a day. Uninstall to delete everything.

---

## Repo structure

```
dopafit/
├── extension/        # the Chrome extension (what's on the Web Store)
│   ├── manifest.json
│   ├── popup.html / popup.js
│   ├── background.js (service worker)
│   ├── tiers.js      (the classifier — edit this to retune)
│   ├── about.html    (the rationale page)
│   └── icons/
└── bridge/           # optional macOS power-user companion (see below)
    ├── app.py        (menu-bar tracker)
    ├── bridge.py     (localhost HTTP server)
    └── ...
```

## macOS power-user companion (optional)

Want to track your native desktop apps too — Cursor, Claude Desktop, iTerm, Codex CLI? There's an opt-in Python tracker in `bridge/`.

```bash
cd bridge
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

This:
- Samples your frontmost app every 30s.
- Stores native-app activity in `~/.dopaminebar/samples.db`.
- Serves it on `localhost:9876` for the Chrome extension to merge.

The extension currently does **not** declare `host_permissions` for `127.0.0.1` to keep the Web-Store install permission set minimal — so the bridge is a no-op until v0.2 when we add an opt-in setting. This is by design.

---

## Roadmap

- **v0.1** — Chrome on Mac/Win/Linux. (Current.)
- **v0.2** — opt-in toggle for the macOS native bridge.
- **v0.3** — Safari iOS extension.
- **v0.4** — Claude / MCP integration: ask Claude "how was my week?" and it pulls your data.
- **v1.0** — multi-device unified.

---

## Contributing

Issues and PRs welcome. The classifier in [`extension/tiers.js`](extension/tiers.js) is the most opinionated thing in the repo — if you disagree with how a domain is classified, that's a one-line fix. The budgets and weights in [`extension/popup.js`](extension/popup.js) and [`extension/background.js`](extension/background.js) are tunable; please cite a source if you propose changing them.

## License

MIT — see [LICENSE](LICENSE).
