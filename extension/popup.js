const TIER_COLORS = { high: "#E24B4A", medium: "#BA7517", low: "#0F6E56", unknown: "#B4B2A9" };
const TIER_BG = { high: "#FCEBEB", medium: "#FAEEDA", low: "#E1F5EE", unknown: "#F1EFE8" };
const TIER_LABELS = { high: "High spike", medium: "Medium spike", low: "Positive", unknown: "Uncategorized" };
const TIER_TOOLTIPS = {
  high: "Passive, addictive feeds — social, doomscroll, betting. Budget: 30 min/day.",
  medium: "Semi-intentional — video, forums, shopping, chat, AI tools. Budget: 120 min/day. (AI is research-flagged context-dependent at >27 min/day.)",
  low: "Positive dopamine — high-leverage build, work, study, research. No cap; break every ~3h.",
};
const TIER_BUDGETS = { high: 30 * 60, medium: 120 * 60 }; // seconds

function getToday() { return new Date().toISOString().slice(0, 10); }
function fmtTime(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// Defensive escape for any string we interpolate into innerHTML. Domains from
// URL.hostname are usually safe (the URL parser strips most metacharacters)
// but native-app names from the bridge can be literally anything (macOS lets
// app developers name their app whatever they want, including HTML).
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Local favicon URL via Chrome's _favicon API. Serves the favicon from
// Chrome's *local* cache — no outbound network call. Privacy intact.
// Requires "favicon" permission in manifest (added v0.1.0).
function faviconUrl(domain) {
  if (!domain) return "";
  const u = encodeURIComponent("https://" + domain);
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${u}&size=32`);
}

// Score formula. Tunable here.
//
// Penalties stack:
//   1. Ratio penalty — share of activity that was high-spike (capped at 60).
//   2. Budget overflow — going over the soft 30/120 min budgets.
//   3. Session-frequency penalty — each NEW high-tier session beyond the first.
//      Behavioral-addiction research: 3 × 10-min sessions are worse than
//      1 × 30-min — frequency reinforces the cue-response loop.
//   4. Micro-check penalty — sub-2-min visits to high-tier sites (the
//      "I'll just check Twitter quickly" pattern is the addiction signal).
//   5. Hard daily limit — >60 min cumulative high-tier locks score at 30.
//      No amount of productive work redeems it. Reset tomorrow.
//   6. Positive bonus — capped, so working 12 hours doesn't paper over abuse.
function calcScore(tiers, domains = {}) {
  const high = (tiers.high || 0) / 60;
  const med = (tiers.medium || 0) / 60;
  const low = (tiers.low || 0) / 60;
  const total = high + med + low;
  if (total < 1) return 100;

  const activityFactor = Math.min(total / 10, 1);
  const highRatio = high / total;

  const ratioPenalty   = highRatio * 60 * activityFactor;
  const highOverBudget = Math.max(0, high - 30) * 1.8;
  const medOverBudget  = Math.max(0, med - 120) * 0.5;
  const productiveBonus = Math.min(15, low * 0.3);

  // Session-frequency + micro-check penalties (high-tier only).
  // Frequency penalty is GAP-WEIGHTED: well-spaced sessions cost nothing
  // (the dopamine system has time to reset between hits), back-to-back
  // sessions cost the most. Computed at write-time in background.js.
  let sessionPenalty = 0;
  let microPenalty   = 0;
  for (const info of Object.values(domains)) {
    if (info.tier !== "high") continue;
    sessionPenalty += info.sessionPenaltyWeight || 0;
    microPenalty   += (info.microSessions || 0) * 3;
  }

  let score = 100 - ratioPenalty - highOverBudget - medOverBudget + productiveBonus
            - sessionPenalty - microPenalty;

  // Hard daily limit — cumulative >60 min high-tier caps the day at 30 (Fried).
  if (high > 60) score = Math.min(score, 30);

  return Math.max(0, Math.min(100, Math.round(score)));
}

// Quick dopamine-reset actions — rotates every 15 min so it stays fresh
// without flickering minute-to-minute.
const RESET_ADVICE = [
  "Stand up, look out a window for 60s.",
  "Walk 5 — leave the phone behind.",
  "Drink a glass of cold water. Slowly.",
  "10 push-ups. Now. Then come back.",
  "Step outside. 60s of sun.",
  "Box breathe: 4 in, 4 hold, 4 out, 4 hold. Ten cycles.",
  "Splash cold water on your face.",
  "Stretch your neck and shoulders for a minute.",
  "Eyes off screen — look at something 20 ft away for 20s.",
];

function getResetAdvice() {
  const idx = Math.floor(Date.now() / (15 * 60 * 1000)) % RESET_ADVICE.length;
  return RESET_ADVICE[idx];
}

// Short, human one-liner explaining what's driving the score right now.
// When the day is over budget OR pattern is unhealthy, includes a reset action.
function getScoreContext(tiers, totalSec, domains = {}) {
  const high = (tiers.high || 0) / 60;
  const med = (tiers.medium || 0) / 60;
  const low = (tiers.low || 0) / 60;
  const totalMin = Math.round(totalSec / 60);

  // Aggregate session-frequency signal across high-tier domains.
  let highSessions = 0, highMicros = 0, sessionPenaltySum = 0;
  for (const info of Object.values(domains)) {
    if (info.tier !== "high") continue;
    highSessions      += info.sessions || 0;
    highMicros        += info.microSessions || 0;
    sessionPenaltySum += info.sessionPenaltyWeight || 0;
  }

  // Every branch returns: <state description> — <one concrete action>.
  // The action tells the user what to do next, not just how the day looks.
  if (totalSec < 60)
    return "Day starts now — pick one task and commit.";
  if (high > 60)
    return `Hard limit hit (${Math.round(high)} min high) — day's locked. Tomorrow, open focus first.`;
  if (high > 30)
    return `${Math.round(high - 30)} min over high budget — ${getResetAdvice()}`;
  if (highMicros >= 3)
    return `${highMicros} micro-checks — close the tab, set a 1-hour gap.`;
  if (sessionPenaltySum >= 15)
    return `Frequent re-checking — ${getResetAdvice()}`;
  if (highSessions >= 4 && sessionPenaltySum === 0)
    return `${highSessions} sessions well-spaced — solid pattern, keep it.`;
  if (highSessions >= 4)
    return `${highSessions} high-tier sessions — batch the next one, wait 2 h+.`;
  if (med > 120)
    return `${Math.round(med - 120)} min over medium budget — ${getResetAdvice()}`;
  if (high >= 21)
    return `Approaching high budget (${Math.round(high)}/30) — pause before the next feed.`;
  if (low > high * 3 && low > 20)
    return "Positive-dominant — save your work and stretch in 30 min.";
  if (high === 0)
    return `Zero high-spike (${totalMin} min clean) — stay off the feeds.`;
  return `${totalMin} min tracked — open one positive-tier task to lift the score.`;
}

function getScoreLabel(score) {
  if (score >= 85) return ["Clean",      "#0F6E56"];
  if (score >= 60) return ["Moderate",   "#BA7517"];
  if (score >= 35) return ["Overloaded", "#E24B4A"];
  return ["Fried", "#E24B4A"];
}

// Render the 24-hour timeline. Each bar = one hour, height = total time
// that hour, internally stacked by tier (red bottom → amber → green top).
// Hidden if there's not enough data to be meaningful.
function renderHourlyTimeline(data) {
  const section = document.getElementById("timelineSection");
  const row = document.getElementById("hourlyRow");
  const hours = data.hoursByTier || {};
  const hasAny = Object.values(hours).some(h => (h && h.total) > 0);

  if (!hasAny || (data.total || 0) < 60) {
    section.style.display = "none";
    return;
  }

  const MAX_H = 38; // px — bar is 40px tall, leaves 2px breathing room
  const all = [];
  for (let h = 0; h < 24; h++) {
    const k = String(h).padStart(2, "0");
    all.push(hours[k] || { high: 0, medium: 0, low: 0, total: 0 });
  }
  const maxTotal = Math.max(...all.map(h => h.total), 1);
  const currentHour = new Date().getHours();

  row.innerHTML = all.map((h, i) => {
    const baseCls = ["hourly-bar"];
    if (i === currentHour) baseCls.push("current");
    if (h.total === 0) baseCls.push("empty");

    if (h.total === 0) {
      return `<div class="${baseCls.join(" ")}" data-hour="${i}" title="${i.toString().padStart(2,"0")}:00 — no activity"></div>`;
    }
    const totalH = (h.total / maxTotal) * MAX_H;
    const hPx = (h.high   / h.total) * totalH;
    const mPx = (h.medium / h.total) * totalH;
    const lPx = (h.low    / h.total) * totalH;
    const tooltip = `${i.toString().padStart(2,"0")}:00 — ${fmtTime(h.total)} (click for breakdown)`;
    return `
      <div class="${baseCls.join(" ")}" data-hour="${i}" title="${escapeHtml(tooltip)}">
        ${lPx > 0.5 ? `<span style="height:${lPx}px;background:#0F6E56;"></span>` : ''}
        ${mPx > 0.5 ? `<span style="height:${mPx}px;background:#BA7517;"></span>` : ''}
        ${hPx > 0.5 ? `<span style="height:${hPx}px;background:#E24B4A;"></span>` : ''}
      </div>
    `;
  }).join("");

  // Wire click-to-expand. Each render rebuilds bars, so old listeners die
  // with the old DOM nodes — no leak.
  const detail = document.getElementById("hourlyDetail");
  detail.classList.remove("open");
  detail.innerHTML = "";

  row.querySelectorAll(".hourly-bar").forEach(bar => {
    if (bar.classList.contains("empty")) return; // empty hours don't expand
    bar.addEventListener("click", () => {
      const hour = parseInt(bar.dataset.hour, 10);
      const wasActive = bar.classList.contains("active");
      // Clear all
      row.querySelectorAll(".hourly-bar.active").forEach(b => b.classList.remove("active"));
      if (wasActive) {
        detail.classList.remove("open");
        return;
      }
      bar.classList.add("active");
      const html = renderHourDetail(hour, data.rawHours || {});
      if (!html) {
        detail.classList.remove("open");
        return;
      }
      detail.innerHTML = html;
      detail.classList.add("open");
    });
  });

  section.style.display = "";
}

// Build the per-hour expanded panel — domain breakdown for a single hour.
function renderHourDetail(hour, rawHours) {
  const key = String(hour).padStart(2, "0");
  const byDomain = rawHours[key] || {};
  const sorted = Object.entries(byDomain).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return null;

  const total = sorted.reduce((s, [, sec]) => s + sec, 0);
  const rows = sorted.slice(0, 10).map(([domain, sec]) => {
    const tier = (typeof getTier === "function") ? getTier(domain) : "unknown";
    return `
      <div class="row">
        <span class="dot" style="background:${TIER_COLORS[tier] || "#B4B2A9"}"></span>
        <span class="site-favicon" style="background-image:url('${faviconUrl(domain)}'); width:11px; height:11px; border-radius:2px;"></span>
        <span class="name">${escapeHtml(domain)}</span>
        <span class="t">${escapeHtml(fmtTime(sec))}</span>
      </div>
    `;
  }).join("");

  return `
    <div class="head">
      <div>
        <strong>${key}:00</strong>
        <span class="total"> · ${escapeHtml(fmtTime(total))}</span>
      </div>
      <span class="close" data-action="close">×</span>
    </div>
    ${rows}
  `;
}

// Mood word: describes WHAT the day looks like, not the score grade.
// Score and mood are independent signals — both colored, both informative.
function getMood(tiers, total) {
  const high = (tiers.high   || 0) / 60;
  const med  = (tiers.medium || 0) / 60;
  const low  = (tiers.low    || 0) / 60;
  if (total < 60)                      return ["Quiet",      "#888780"];
  if (high > 30)                       return ["Overloaded", "#E24B4A"];
  if (high > med + low)                return ["Spiking",    "#E24B4A"];
  if (low > med && low > high * 2)     return ["Building",   "#0F6E56"];
  if (med > low && med > high * 2)     return ["Coasting",   "#BA7517"];
  if (high === 0 && total > 600)       return ["Clean",      "#0F6E56"];
  return ["Mixed", "#5F5E5A"];
}

async function loadDay(dateStr) {
  const key = `day:${dateStr}`;
  const result = await chrome.storage.local.get(key);
  const raw = result[key] || { domains: {}, tiers: { high: 0, medium: 0, low: 0, unknown: 0 }, total: 0 };
  const browser = reclassify(raw);

  // Merge native macOS app data only for *today* (the bridge only knows today).
  if (dateStr === getToday()) {
    const native = await fetchNative();
    if (native && native.total > 0) return mergeNative(browser, native);
  }
  return browser;
}

// Try the localhost bridge served by the Python tracker. Fast-fails if not
// running — the popup degrades to browser-only data with no error.
//
// Gated on host_permissions being declared in the manifest. v0.1 does NOT
// declare them (no localhost permission warning at install), so this returns
// null immediately. Power users on v0.2+ will get the bridge when we add the
// permission back. No network call, no console noise on v0.1.
async function fetchNative() {
  try {
    const manifest = chrome.runtime.getManifest();
    const hosts = manifest.host_permissions || [];
    if (!hosts.some(h => h.includes("127.0.0.1:9876") || h.includes("localhost:9876"))) {
      return null;
    }
    const r = await fetch("http://127.0.0.1:9876/today", {
      cache: "no-store",
      signal: AbortSignal.timeout(800),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Merge native-app payload into the browser-side day data. Native apps appear
// as additional rows in `domains` (using app name as the key — visually
// distinguishable from web hostnames). Tier totals and `total` are combined.
function mergeNative(browser, native) {
  const merged = {
    ...browser,
    domains: { ...browser.domains },
    tiers:   { ...browser.tiers },
    total:   browser.total || 0,
    nativeAvailable: true,
    nativeApps: native.apps || {},
  };
  for (const [app, info] of Object.entries(native.apps || {})) {
    if (!merged.domains[app]) merged.domains[app] = { seconds: 0, tier: info.tier };
    merged.domains[app].seconds += info.seconds;
    merged.domains[app].tier     = info.tier;
    merged.domains[app].native   = true;  // marker for the renderer
  }
  for (const tier of ["high", "medium", "low", "unknown"]) {
    merged.tiers[tier] = (merged.tiers[tier] || 0) + (native.tiers[tier] || 0);
  }
  merged.total += native.total || 0;
  return merged;
}

// Re-derive tier for every domain on each render. Storage keeps whatever
// tier was assigned at write time; this function makes the popup honest about
// the *current* classifier rules — fixes "claude.ai stuck on green" after
// a tier-table update.
function reclassify(raw) {
  const tiers = { high: 0, medium: 0, low: 0, unknown: 0 };
  const domains = {};
  for (const [domain, info] of Object.entries(raw.domains || {})) {
    const tier = (typeof getTier === "function") ? getTier(domain) : info.tier;
    domains[domain] = {
      seconds: info.seconds,
      tier,
      sessions: info.sessions || 1,
      microSessions: info.microSessions || 0,
      sessionPenaltyWeight: info.sessionPenaltyWeight || 0,
    };
    tiers[tier] = (tiers[tier] || 0) + info.seconds;
  }

  // Re-derive hourly tier breakdown from raw.hours (stored as { hh: {domain: sec} }).
  const hoursByTier = {};
  if (raw.hours) {
    for (const [hh, byDomain] of Object.entries(raw.hours)) {
      const t = { high: 0, medium: 0, low: 0, unknown: 0 };
      let total = 0;
      for (const [domain, sec] of Object.entries(byDomain)) {
        const tier = (typeof getTier === "function") ? getTier(domain) : "unknown";
        t[tier] += sec; total += sec;
      }
      hoursByTier[hh] = { ...t, total };
    }
  }
  return { ...raw, domains, tiers, hoursByTier, rawHours: raw.hours || {} };
}

async function renderToday() {
  const today = getToday();
  document.getElementById("dateLabel").textContent = new Date().toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric"
  });

  const data = await loadDay(today);
  const score = calcScore(data.tiers, data.domains);
  const [, scoreColor] = getScoreLabel(score);
  const [moodWord, moodColor] = getMood(data.tiers, data.total || 0);

  // Score ring — color follows score grade
  const circ = 2 * Math.PI * 22;
  document.getElementById("scoreArc").setAttribute("stroke-dasharray", `${(score / 100) * circ} ${circ}`);
  document.getElementById("scoreArc").setAttribute("stroke", scoreColor);
  document.getElementById("scoreVal").textContent = score;

  // Mood — color follows activity dominance, not score
  const moodEl = document.getElementById("scoreMood");
  moodEl.textContent = moodWord;
  moodEl.style.color = moodColor;

  // Terse stat line
  const totalMin = Math.round((data.total || 0) / 60);
  const highMin  = Math.round((data.tiers.high   || 0) / 60);
  document.getElementById("scoreStat").textContent =
    totalMin > 0
      ? `${totalMin} min · ${highMin}/30m high`
      : "0 min · browse a few seconds to start";

  // Proportional tier strip — visual mix at-a-glance.
  const strip = document.getElementById("scoreStrip");
  const totalSec = data.total || 0;
  if (totalSec > 0) {
    const hPct = ((data.tiers.high   || 0) / totalSec) * 100;
    const mPct = ((data.tiers.medium || 0) / totalSec) * 100;
    const lPct = ((data.tiers.low    || 0) / totalSec) * 100;
    strip.innerHTML = `
      <span style="width:${hPct}%; background:#E24B4A;"></span>
      <span style="width:${mPct}%; background:#BA7517;"></span>
      <span style="width:${lPct}%; background:#0F6E56;"></span>
    `;
    const medMin = Math.round((data.tiers.medium || 0) / 60);
    const lowMin = Math.round((data.tiers.low    || 0) / 60);
    strip.title = `High ${highMin}m · Medium ${medMin}m · Positive ${lowMin}m`;
  } else {
    strip.innerHTML = "";
    strip.title = "";
  }

  // Context — only shown when something's actionable
  const ctxEl = document.getElementById("scoreContext");
  const ctxText = getScoreContext(data.tiers, data.total || 0, data.domains);
  ctxEl.textContent = ctxText || "";
  ctxEl.style.display = ctxText ? "" : "none";

  // Tier bars
  const tiersEl = document.getElementById("tiersContainer");
  tiersEl.innerHTML = "";
  for (const tier of ["high", "medium", "low"]) {
    const sec = data.tiers[tier] || 0;
    const budget = TIER_BUDGETS[tier];
    const pct = budget ? Math.min((sec / budget) * 100, 100) : Math.min((sec / 7200) * 100, 100);
    const isOver = budget && sec > budget;
    const div = document.createElement("div");
    div.className = "tier";
    div.title = TIER_TOOLTIPS[tier];
    div.innerHTML = `
      <div class="tier-header">
        <span class="tier-name"><span class="tier-dot" style="background:${TIER_COLORS[tier]}"></span>${TIER_LABELS[tier]}</span>
        <span class="tier-time ${isOver ? 'over' : ''}">${fmtTime(sec)}${budget ? ' / ' + fmtTime(budget) : ''}</span>
      </div>
      <div class="tier-bar"><div class="tier-fill" style="width:${pct}%;background:${isOver ? '#E24B4A' : TIER_COLORS[tier]}"></div></div>
    `;
    tiersEl.appendChild(div);
  }

  // Hourly timeline — 24 thin stacked bars
  renderHourlyTimeline(data);

  // Sites — show top 3 by time spent, hide the rest behind a toggle.
  const sitesEl = document.getElementById("sitesContainer");
  const sorted = Object.entries(data.domains)
    .sort((a, b) => b[1].seconds - a[1].seconds)
    .slice(0, 25); // hard cap to avoid huge lists

  if (sorted.length === 0) {
    sitesEl.innerHTML = '<div class="empty-state">Browsing data will appear here</div>';
    return;
  }

  // Native-app icon (Lucide "monitor"). Clearly distinguishes desktop apps
  // from browser domains in the same list.
  const NATIVE_ICON = `<span class="native-marker" title="Native macOS app">` +
    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<rect width="20" height="14" x="2" y="3" rx="2" ry="2"/>` +
    `<line x1="8" x2="16" y1="21" y2="21"/>` +
    `<line x1="12" x2="12" y1="17" y2="21"/>` +
    `</svg></span>`;

  const renderRow = ([domain, info]) => {
    const fav = info.native
      ? "" // native apps already have the monitor SVG inside the name
      : `<span class="site-favicon" style="background-image:url('${faviconUrl(domain)}');"></span>`;
    return `
    <div class="site-row" ${info.native ? 'title="Native macOS app (via local bridge)"' : ''}>
      <span class="site-tier" style="background:${TIER_COLORS[info.tier]}"></span>
      ${fav}
      <span class="site-name">${info.native ? NATIVE_ICON : ''}${escapeHtml(domain)}</span>
      <span class="site-time">${escapeHtml(fmtTime(info.seconds))}</span>
    </div>
  `;
  };

  const top = sorted.slice(0, 3);
  const rest = sorted.slice(3);
  const topHtml = top.map(renderRow).join("");
  const restHtml = rest.map(renderRow).join("");

  sitesEl.innerHTML = topHtml + (rest.length ? `
    <div class="sites-overflow" id="sitesOverflow">${restHtml}</div>
    <div class="sites-toggle" id="sitesToggle">Show ${rest.length} more ↓</div>
  ` : "");

  if (rest.length) {
    document.getElementById("sitesToggle").addEventListener("click", () => {
      const ov = document.getElementById("sitesOverflow");
      const tog = document.getElementById("sitesToggle");
      const open = ov.classList.toggle("open");
      tog.textContent = open ? "Hide ↑" : `Show ${rest.length} more ↓`;
    });
  }
}

async function loadDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const str = d.toISOString().slice(0, 10);
    const data = await loadDay(str);
    // Week labels = "Mo/Tu", month labels = day-of-month or empty for tighter packing.
    const weekLabel = d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2);
    const monthLabel = (i % 5 === 0) ? String(d.getDate()) : ""; // every 5th day to avoid clutter
    days.push({ date: str, weekLabel, monthLabel, data });
  }
  return days;
}

function renderRangeChart(chartEl, days, labelKey) {
  const maxSec = Math.max(...days.map(d => d.data.total), 1);
  chartEl.innerHTML = days.map(d => {
    const h = d.data.tiers.high || 0;
    const m = d.data.tiers.medium || 0;
    const l = d.data.tiers.low || 0;
    const hPx = Math.round((h / maxSec) * 64);
    const mPx = Math.round((m / maxSec) * 64);
    const lPx = Math.round((l / maxSec) * 64);
    return `
      <div class="week-bar-group">
        <div class="week-stack">
          ${hPx > 0 ? `<div class="week-segment" style="height:${hPx}px;background:#E24B4A;"></div>` : ''}
          ${mPx > 0 ? `<div class="week-segment" style="height:${mPx}px;background:#BA7517;"></div>` : ''}
          ${lPx > 0 ? `<div class="week-segment" style="height:${lPx}px;background:#0F6E56;"></div>` : ''}
        </div>
        <span class="week-label">${d[labelKey]}</span>
      </div>
    `;
  }).join("");
}

function renderRangeStats(statsEl, days, n, _hiBudgetMin, sectionLabel) {
  const totals = { high: 0, medium: 0, low: 0 };
  let activeDays = 0;
  let totalSec = 0;
  days.forEach(d => {
    if ((d.data.total || 0) > 0) activeDays++;
    totals.high   += d.data.tiers.high   || 0;
    totals.medium += d.data.tiers.medium || 0;
    totals.low    += d.data.tiers.low    || 0;
    totalSec      += d.data.total        || 0;
  });
  const avgScore = activeDays > 0
    ? Math.round(days.reduce((s, d) => s + calcScore(d.data.tiers, d.data.domains), 0) / n)
    : 100;
  const [avgLabel, avgColor] = getScoreLabel(avgScore);

  const avgTotal = Math.round(totalSec / n);
  const avgHigh  = Math.round(totals.high / n);
  const avgMed   = Math.round(totals.medium / n);
  const avgLow   = Math.round(totals.low / n);

  // Proportional strip — derived from cumulative tier totals (same as today).
  const tot = totals.high + totals.medium + totals.low || 1;
  const hPct = (totals.high / tot) * 100;
  const mPct = (totals.medium / tot) * 100;
  const lPct = (totals.low / tot) * 100;

  // Score ring math
  const circ = 2 * Math.PI * 22;
  const arcLen = (avgScore / 100) * circ;

  statsEl.innerHTML = `
    <div class="range-section-label">${escapeHtml(sectionLabel)} · daily average</div>
    <div class="score-row">
      <div class="ring">
        <svg viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="22" fill="none" stroke="#F1EFE8" stroke-width="4"/>
          <circle cx="26" cy="26" r="22" fill="none" stroke="${avgColor}" stroke-width="4"
            stroke-dasharray="${arcLen} ${circ}" stroke-linecap="round"
            transform="rotate(-90 26 26)"/>
        </svg>
        <div class="ring-val">${avgScore}</div>
      </div>
      <div class="score-meta">
        <div class="score-mood" style="color:${avgColor}">${escapeHtml(avgLabel)}</div>
        <div class="score-stat">${escapeHtml(fmtTime(avgTotal))}/day · ${activeDays}/${n} days active</div>
        <div class="score-strip">
          <span style="width:${hPct}%; background:#E24B4A;"></span>
          <span style="width:${mPct}%; background:#BA7517;"></span>
          <span style="width:${lPct}%; background:#0F6E56;"></span>
        </div>
        <div class="score-context">
          <span style="color:#E24B4A;">${escapeHtml(fmtTime(avgHigh))}</span> high ·
          <span style="color:#BA7517;">${escapeHtml(fmtTime(avgMed))}</span> med ·
          <span style="color:#0F6E56;">${escapeHtml(fmtTime(avgLow))}</span> positive
        </div>
      </div>
    </div>
  `;
}

async function renderWeek() {
  const days = await loadDays(7);
  renderRangeChart(document.getElementById("weekChart"), days, "weekLabel");
  renderRangeStats(document.getElementById("weekStats"), days, 7, 30, "Last 7 days");
}

async function renderMonth() {
  const days = await loadDays(30);
  renderRangeChart(document.getElementById("monthChart"), days, "monthLabel");
  renderRangeStats(document.getElementById("monthStats"), days, 30, 30, "Last 30 days");
}

// Tab switching
const VIEW_IDS = {
  today: "todayView",
  week:  "weekView",
  month: "monthView",
  about: "aboutView",
};
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const view = tab.dataset.view;
    for (const [k, id] of Object.entries(VIEW_IDS)) {
      document.getElementById(id).style.display = view === k ? "" : "none";
    }
    if (view === "week")  renderWeek();
    if (view === "month") renderMonth();
  });
});

// "Read the full rationale" — opens the bundled about.html in a new tab.
document.getElementById("aboutFullLink").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("about.html") });
});

// Hourly-detail close button (delegated — element re-renders).
document.getElementById("hourlyDetail").addEventListener("click", (e) => {
  if (e.target.closest('[data-action="close"]')) {
    document.getElementById("hourlyDetail").classList.remove("open");
    document.querySelectorAll(".hourly-bar.active").forEach(b => b.classList.remove("active"));
  }
});

// ── Export helpers ─────────────────────────────────────────────────────

function downloadBlob(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function downloadCsv() {
  const all = await chrome.storage.local.get(null);
  const rows = ["date,domain,tier,seconds"];
  Object.keys(all).filter(k => k.startsWith("day:")).sort().forEach(key => {
    const date = key.slice(4);
    const dayData = all[key];
    Object.entries(dayData.domains).forEach(([domain, info]) => {
      // Use *current* classifier when exporting, not stored stale tier.
      const tier = (typeof getTier === "function") ? getTier(domain) : info.tier;
      rows.push(`${date},${domain},${tier},${info.seconds}`);
    });
  });
  downloadBlob(rows.join("\n"), "text/csv", `dopafit-${getToday()}.csv`);
}

async function downloadMd() {
  const md = await buildFullReport();
  downloadBlob(md, "text/markdown", `dopafit-${getToday()}.md`);
}

// ── Markdown report builder — the AI-ready format ─────────────────────

function fmtSec(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s/60)}m`;
  return `${Math.floor(s/3600)}h ${Math.round((s%3600)/60)}m`;
}

async function buildFullReport() {
  const today = getToday();
  const todayData = await loadDay(today);
  const week  = await loadDays(7);
  const month = await loadDays(30);
  const all = await chrome.storage.local.get(null);
  const notifLog = all["notif:log"] || [];

  const out = [];
  out.push(`# dopaFit — full report`);
  out.push(`Generated: ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`);
  out.push(``);

  // ── Today snapshot
  const score = calcScore(todayData.tiers, todayData.domains);
  const [label] = getScoreLabel(score);
  const t = todayData.tiers;
  out.push(`## Today — ${today}`);
  out.push(``);
  out.push(`- **Score:** ${score} / 100 (${label})`);
  out.push(`- **Total tracked:** ${fmtSec(todayData.total || 0)}`);
  out.push(`- **High spike:** ${fmtSec(t.high || 0)} / 30 min budget`);
  out.push(`- **Medium spike:** ${fmtSec(t.medium || 0)} / 120 min budget`);
  out.push(`- **Positive (high-leverage):** ${fmtSec(t.low || 0)}`);
  const ctx = getScoreContext(t, todayData.total || 0, todayData.domains);
  if (ctx) out.push(`- **Context:** ${ctx}`);
  out.push(``);

  // ── Hourly profile (today)
  if (todayData.hoursByTier && Object.keys(todayData.hoursByTier).length) {
    out.push(`## Hourly profile — today`);
    out.push(``);
    out.push(`| Hour | High | Medium | Positive | Total |`);
    out.push(`|---|---|---|---|---|`);
    for (let h = 0; h < 24; h++) {
      const hh = String(h).padStart(2, "0");
      const row = todayData.hoursByTier[hh];
      if (!row || !row.total) continue;
      out.push(`| ${hh}:00 | ${fmtSec(row.high)} | ${fmtSec(row.medium)} | ${fmtSec(row.low)} | ${fmtSec(row.total)} |`);
    }
    out.push(``);
  }

  // ── Top sites today (browser + native, mixed; native marked)
  const sortedToday = Object.entries(todayData.domains)
    .sort((a, b) => b[1].seconds - a[1].seconds).slice(0, 15);
  if (sortedToday.length) {
    out.push(`## Top sites & apps — today`);
    out.push(``);
    out.push(`| Source | Name | Tier | Time |`);
    out.push(`|---|---|---|---|`);
    for (const [d, info] of sortedToday) {
      const src = info.native ? "native (mac)" : "browser";
      out.push(`| ${src} | ${d} | ${info.tier} | ${fmtSec(info.seconds)} |`);
    }
    out.push(``);
  }

  // ── Native-only section, if the bridge is providing data
  if (todayData.nativeAvailable && todayData.nativeApps && Object.keys(todayData.nativeApps).length) {
    out.push(`## Native macOS apps — today`);
    out.push(``);
    out.push(`Source: localhost bridge from Python menu-bar tracker (Cursor, Claude Desktop, Terminal, iTerm, etc.).`);
    out.push(``);
    out.push(`| App | Tier | Time |`);
    out.push(`|---|---|---|`);
    const nativeSorted = Object.entries(todayData.nativeApps)
      .sort((a, b) => b[1].seconds - a[1].seconds);
    for (const [app, info] of nativeSorted) {
      out.push(`| ${app} | ${info.tier} | ${fmtSec(info.seconds)} |`);
    }
    out.push(``);
  }

  // ── 7-day trend
  out.push(`## 7-day trend`);
  out.push(``);
  out.push(`| Date | Score | Total | High | Medium | Positive |`);
  out.push(`|---|---|---|---|---|---|`);
  for (const d of week) {
    const s = calcScore(d.data.tiers, d.data.domains);
    out.push(`| ${d.date} | ${s} | ${fmtSec(d.data.total || 0)} | ${fmtSec(d.data.tiers.high || 0)} | ${fmtSec(d.data.tiers.medium || 0)} | ${fmtSec(d.data.tiers.low || 0)} |`);
  }
  out.push(``);

  // ── 30-day summary
  const monthTotals = { high: 0, medium: 0, low: 0, total: 0, scoreSum: 0, days: 0 };
  for (const d of month) {
    if ((d.data.total || 0) > 0) monthTotals.days++;
    monthTotals.high   += d.data.tiers.high   || 0;
    monthTotals.medium += d.data.tiers.medium || 0;
    monthTotals.low    += d.data.tiers.low    || 0;
    monthTotals.total  += d.data.total        || 0;
    monthTotals.scoreSum += calcScore(d.data.tiers, d.data.domains);
  }
  const avgScore = Math.round(monthTotals.scoreSum / month.length);
  out.push(`## 30-day summary`);
  out.push(``);
  out.push(`- Days tracked: ${monthTotals.days} / 30`);
  out.push(`- Avg score: ${avgScore}`);
  out.push(`- Total time: ${fmtSec(monthTotals.total)}`);
  out.push(`- Daily avg high: ${fmtSec(Math.round(monthTotals.high / 30))}`);
  out.push(`- Daily avg medium: ${fmtSec(Math.round(monthTotals.medium / 30))}`);
  out.push(`- Daily avg positive: ${fmtSec(Math.round(monthTotals.low / 30))}`);
  out.push(``);

  // ── Notifications today (qualitative narrative)
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const todayNotifs = notifLog.filter(n => n.ts >= startOfToday.getTime());
  if (todayNotifs.length) {
    out.push(`## Nudges fired today`);
    out.push(``);
    out.push(`| Time | Type | Tier | Domain | Message |`);
    out.push(`|---|---|---|---|---|`);
    for (const n of todayNotifs) {
      const time = new Date(n.ts).toTimeString().slice(0, 5);
      out.push(`| ${time} | ${n.type} | ${n.tier || "—"} | ${n.domain || "—"} | ${n.message} |`);
    }
    out.push(``);
  }

  // ── Last 30 nudges total (broader narrative)
  if (notifLog.length) {
    const recent = notifLog.slice(-30);
    out.push(`## Recent nudges (last ${recent.length})`);
    out.push(``);
    out.push(`| Date · time | Type | Tier | Domain | Message |`);
    out.push(`|---|---|---|---|---|`);
    for (const n of recent) {
      const dt = new Date(n.ts).toISOString().slice(0, 16).replace("T", " ");
      out.push(`| ${dt} | ${n.type} | ${n.tier || "—"} | ${n.domain || "—"} | ${n.message} |`);
    }
    out.push(``);
  }

  // ── Methodology / classifier context for the LLM
  out.push(`## Methodology & classifier`);
  out.push(``);
  out.push(`- Data is collected by dopaFit, a Chrome extension. Stored locally in chrome.storage.local; never leaves the device.`);
  out.push(`- Granularity: per-domain × per-day, with hourly buckets. Visits under 2 s are dropped.`);
  out.push(`- Idle (>60 s no input) pauses tracking.`);
  out.push(`- Tiers: **high** = social/doomscroll/betting (slot-machine pattern); **medium** = video/forums/shopping/AI tools (semi-intentional); **positive** = high-leverage build/work/study/research.`);
  out.push(`- AI tools (Claude, ChatGPT, Perplexity, etc.) sit in *medium*, not positive — research (MIT RCT 2025 n=981, METR 2025, GitClear) shows dose-dependent dependence/skill-atrophy above ~27 min/day.`);
  out.push(`- Score formula penalizes the high-tier ratio (capped at 50, ramped over 10 min of activity), high/medium budget overflow, and rewards positive time (capped bonus +20).`);
  out.push(`- Streak alerts: high → 10 min, medium → 45 min, positive → 3 h.`);
  return out.join("\n");
}

// Download dropdown — Markdown / CSV.
const downloadBtn  = document.getElementById("downloadBtn");
const downloadMenu = document.getElementById("downloadMenu");
downloadBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  downloadMenu.classList.toggle("open");
});
document.addEventListener("click", (e) => {
  if (!downloadBtn.contains(e.target) && !downloadMenu.contains(e.target)) {
    downloadMenu.classList.remove("open");
  }
});
downloadMenu.querySelectorAll("button").forEach(btn => {
  btn.addEventListener("click", async () => {
    downloadMenu.classList.remove("open");
    if (btn.dataset.format === "md")  await downloadMd();
    if (btn.dataset.format === "csv") await downloadCsv();
  });
});

// Copy-for-AI — swaps the icon to a check on success, reverts after 1.5s.
const COPY_ICON  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="13" height="13" x="9" y="9" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

document.getElementById("copyAiBtn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const md = await buildFullReport();
  const prompt = [
    `I'm tracking my browser usage with dopaFit. Below is my data.`,
    `Please give me: (1) three specific patterns you see, (2) one concrete change to make tomorrow, (3) one question I should ask myself.`,
    `Be direct. Skip preamble.`,
    ``,
    md,
  ].join("\n");
  try {
    await navigator.clipboard.writeText(prompt);
    btn.innerHTML = CHECK_ICON;
    btn.classList.add("success");
    setTimeout(() => {
      btn.innerHTML = COPY_ICON;
      btn.classList.remove("success");
    }, 1500);
  } catch (err) {
    console.warn(err);
  }
});

// Reset
document.getElementById("resetBtn").addEventListener("click", async () => {
  if (confirm("Reset today's tracking data?")) {
    await chrome.storage.local.remove(`day:${getToday()}`);
    renderToday();
  }
});

// Init
renderToday();
