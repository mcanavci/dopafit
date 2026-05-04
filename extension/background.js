// Classifier lives in tiers.js — single source of truth shared with the popup.
importScripts("tiers.js");

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

// ─── STATE ────────────────────────────────────────────────────────────

let currentTab = null;    // { domain, tier, url, startTime }
let isIdle = false;

// ─── TRACKING ─────────────────────────────────────────────────────────

async function flushCurrent() {
  if (!currentTab || isIdle) return;
  
  const elapsed = Math.floor((Date.now() - currentTab.startTime) / 1000);
  if (elapsed < 2) return; // ignore sub-2s flickers
  
  const today = getToday();
  const key = `day:${today}`;
  
  const result = await chrome.storage.local.get(key);
  const dayData = result[key] || { domains: {}, tiers: { high: 0, medium: 0, low: 0, unknown: 0 }, total: 0 };
  
  // Update domain-level tracking
  if (!dayData.domains[currentTab.domain]) {
    dayData.domains[currentTab.domain] = { seconds: 0, tier: currentTab.tier };
  }
  const dom = dayData.domains[currentTab.domain];
  dom.seconds += elapsed;

  // Session-frequency tracking — the addiction signal that simple time totals
  // miss. A new session = either we just switched domains, or we've been
  // away from this one for >10 min. A micro-session = a previous session
  // that ended in <2 min (the "checking" pattern).
  const SESSION_GAP_MS  = 10 * 60 * 1000;
  const MICRO_THRESHOLD = 2  * 60 * 1000;
  const nowMs = Date.now();
  const switchedDomain = dayData.lastFlushedDomain && dayData.lastFlushedDomain !== currentTab.domain;
  const longGap = dom.lastFlushTs && (nowMs - dom.lastFlushTs) > SESSION_GAP_MS;
  const isNewSession = !dom.lastFlushTs || switchedDomain || longGap;

  if (isNewSession) {
    // Was the previous session a micro-check?
    if (dom.lastSessionStart && dom.lastFlushTs &&
        (dom.lastFlushTs - dom.lastSessionStart) < MICRO_THRESHOLD) {
      dom.microSessions = (dom.microSessions || 0) + 1;
    }
    dom.sessions = (dom.sessions || 0) + 1;

    // Gap-weighted penalty — rewards self-control. Dopamine baseline recovery
    // takes hours; back-to-back sessions reinforce compulsion, well-spaced
    // sessions let the receptor system reset. (Lembke, Dopamine Nation, 2021;
    // pleasure-pain homeostasis.)
    if (dom.lastFlushTs) {
      const gapMin = (nowMs - dom.lastFlushTs) / 60000;
      let w = 0;
      if      (gapMin <  30) w = 8; // back-to-back reinforcement
      else if (gapMin < 120) w = 5; // "checking" pattern
      else if (gapMin < 240) w = 2; // mild
      // else: 4h+ → fresh start, no penalty
      dom.sessionPenaltyWeight = (dom.sessionPenaltyWeight || 0) + w;
    }
    dom.lastSessionStart = nowMs;
  }
  dom.lastFlushTs = nowMs;
  dayData.lastFlushedDomain = currentTab.domain;

  // Update tier totals (write-time tier; popup reclassifies on read)
  dayData.tiers[currentTab.tier] = (dayData.tiers[currentTab.tier] || 0) + elapsed;
  dayData.total += elapsed;

  // Hourly buckets — { "00": { domain: seconds }, ..., "23": {...} }.
  // Stored per-domain so the popup can re-derive tier on read.
  const hour = String(new Date().getHours()).padStart(2, "0");
  if (!dayData.hours) dayData.hours = {};
  if (!dayData.hours[hour]) dayData.hours[hour] = {};
  dayData.hours[hour][currentTab.domain] = (dayData.hours[hour][currentTab.domain] || 0) + elapsed;

  await chrome.storage.local.set({ [key]: dayData });

  // Day-rollover detection: when getToday() differs from the last seen day,
  // auto-save the previous day's report once.
  await maybeAutoSaveYesterday(today);

  // Update badge
  updateBadge(dayData);

  // Fire notifications when warranted (each function self-throttles).
  await maybeNotifyBudget(dayData, today);
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────

const HIGH_BUDGET_MIN = 30;          // daily high-tier budget in minutes
// Tier-aware streak thresholds. Different tiers, different timing concerns:
//   high   — slot-machine feed, alert fast (Hunt et al. 2018)
//   medium — AI/video/forums, alert at MIT/METR threshold
//   low    — productive work; ultradian research (Kleitman BRAC) says break
//            every ~90 min, but practically most people deep-work in longer
//            blocks. Default is 3h to respect flow without ignoring fatigue.
const STREAK_THRESHOLD_SEC = {
  high: 600,    // 10 min
  medium: 2700, // 45 min
  low: 10800,   // 3 h — tunable; 5400 (90 min) for stricter ultradian model
};
const STREAK_COOLDOWN_MS = 30 * 60 * 1000; // don't re-fire more than 1×/30min

async function fireNotification(id, title, message, meta = {}) {
  try {
    chrome.notifications.create(id, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
      priority: 2,
    });
  } catch (e) {
    console.warn("notification failed:", e);
  }
  // Append to the qualitative log — what nudge fired, when, why.
  try {
    const log = (await chrome.storage.local.get("notif:log"))["notif:log"] || [];
    log.push({
      ts: Date.now(),
      type: meta.type || "unknown",
      tier: meta.tier || null,
      domain: meta.domain || null,
      title, message,
    });
    if (log.length > 500) log.splice(0, log.length - 500); // cap memory
    await chrome.storage.local.set({ "notif:log": log });
  } catch (e) { console.warn("notif log failed:", e); }
}

// Once per day, when cumulative high-tier minutes cross the budget.
async function maybeNotifyBudget(dayData, today) {
  const highMin = Math.round((dayData.tiers.high || 0) / 60);
  if (highMin < HIGH_BUDGET_MIN) return;
  const flagKey = `notif:budget:${today}`;
  const flag = (await chrome.storage.local.get(flagKey))[flagKey];
  if (flag) return;
  await chrome.storage.local.set({ [flagKey]: true });
  fireNotification(
    `budget-${today}`,
    "High-spike budget hit",
    `${highMin} min on high-spike sites today. Time to step away?`,
    { type: "budget", tier: "high" }
  );
}

// While a continuous session on a high- or medium-tier domain crosses its
// tier-specific threshold. Low (productive) doesn't alert.
async function maybeNotifyStreak() {
  if (!currentTab || isIdle) return;
  const threshold = STREAK_THRESHOLD_SEC[currentTab.tier];
  if (!threshold) return;
  if (!currentTab.sessionStart) return;
  const sessionSec = (Date.now() - currentTab.sessionStart) / 1000;
  if (sessionSec < threshold) return;

  const lastKey = "notif:streak:lastFiredMs";
  const last = (await chrome.storage.local.get(lastKey))[lastKey] || 0;
  if (Date.now() - last < STREAK_COOLDOWN_MS) return;
  await chrome.storage.local.set({ [lastKey]: Date.now() });

  const min = Math.round(sessionSec / 60);
  // Tone is tier-aware. High = slot-machine, blunt. Medium = coach, neutral.
  // Low = productive flow, affirm and suggest a break — don't punish focus.
  let title, message;
  if (currentTab.tier === "high") {
    title = `Still on ${currentTab.domain}`;
    message = `${min} min straight. Worth it?`;
  } else if (currentTab.tier === "medium") {
    title = `Long session on ${currentTab.domain}`;
    message = `${min} min continuous. Step away for a minute?`;
  } else {
    // low / productive
    const hours = (min / 60).toFixed(1);
    title = `${hours}h of deep work — solid.`;
    message = `Stand up, walk, drink water. You'll come back sharper.`;
  }
  fireNotification(`streak-${Date.now()}`, title, message, {
    type: "streak", tier: currentTab.tier, domain: currentTab.domain,
  });
}

// ─── DAY ROLLOVER AUTO-SAVE ───────────────────────────────────────────
// When the current calendar day differs from the last seen day, generate a
// markdown report for the previous day and save it to Downloads.

async function maybeAutoSaveYesterday(today) {
  const last = (await chrome.storage.local.get("lastSeenDay"))["lastSeenDay"];
  if (last === today) return;
  await chrome.storage.local.set({ lastSeenDay: today });
  if (!last) return; // first run, nothing to save yet

  // Build markdown for `last` (yesterday from this point of view).
  const md = await buildDailyMarkdown(last);
  if (!md) return;

  try {
    const url = "data:text/markdown;charset=utf-8," + encodeURIComponent(md);
    await chrome.downloads.download({
      url,
      filename: `dopafit/${last}.md`,
      conflictAction: "uniquify",
      saveAs: false,
    });
  } catch (e) {
    console.warn("auto-save failed:", e);
  }
}

// Service-worker-side markdown builder (small, day-specific). The popup has
// a richer cross-day version for manual export / clipboard.
async function buildDailyMarkdown(dateStr) {
  const dayKey = `day:${dateStr}`;
  const raw = (await chrome.storage.local.get(dayKey))[dayKey];
  if (!raw || !raw.total) return null;

  // Re-classify on the fly using the shared classifier (importScripts'd at top).
  const tiers = { high: 0, medium: 0, low: 0, unknown: 0 };
  const domainList = [];
  for (const [domain, info] of Object.entries(raw.domains || {})) {
    const tier = getTier(domain);
    tiers[tier] += info.seconds;
    domainList.push({ domain, tier, seconds: info.seconds });
  }
  domainList.sort((a, b) => b.seconds - a.seconds);

  const fmt = (s) => s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s/60)}m` : `${Math.floor(s/3600)}h ${Math.round((s%3600)/60)}m`;
  const lines = [];
  lines.push(`# dopaFit — ${dateStr}`);
  lines.push(``);
  lines.push(`Total: ${fmt(raw.total)} · High: ${fmt(tiers.high)} · Medium: ${fmt(tiers.medium)} · Positive: ${fmt(tiers.low)}`);
  lines.push(``);
  lines.push(`## Top sites`);
  lines.push(`| Domain | Tier | Time |`);
  lines.push(`|---|---|---|`);
  for (const d of domainList.slice(0, 20)) {
    lines.push(`| ${d.domain} | ${d.tier} | ${fmt(d.seconds)} |`);
  }
  // Hourly profile if present
  if (raw.hours) {
    lines.push(``);
    lines.push(`## Hourly profile`);
    lines.push(`| Hour | High | Medium | Positive | Total |`);
    lines.push(`|---|---|---|---|---|`);
    for (let h = 0; h < 24; h++) {
      const hh = String(h).padStart(2, "0");
      const byDomain = raw.hours[hh] || {};
      const t = { high: 0, medium: 0, low: 0, unknown: 0 };
      let tot = 0;
      for (const [d, sec] of Object.entries(byDomain)) {
        t[getTier(d)] += sec; tot += sec;
      }
      if (tot === 0) continue;
      lines.push(`| ${hh} | ${fmt(t.high)} | ${fmt(t.medium)} | ${fmt(t.low)} | ${fmt(tot)} |`);
    }
  }
  return lines.join("\n");
}

function updateBadge(dayData) {
  const highMin = Math.round((dayData.tiers.high || 0) / 60);
  const budget = 30;
  
  if (highMin >= budget) {
    chrome.action.setBadgeBackgroundColor({ color: "#E24B4A" });
    chrome.action.setBadgeText({ text: `${highMin}m` });
  } else if (highMin >= budget * 0.7) {
    chrome.action.setBadgeBackgroundColor({ color: "#BA7517" });
    chrome.action.setBadgeText({ text: `${highMin}m` });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: "#0F6E56" });
    chrome.action.setBadgeText({ text: highMin > 0 ? `${highMin}m` : "" });
  }
}

async function startTracking(url) {
  const prev = currentTab;
  await flushCurrent();

  if (!url || url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("about:")) {
    currentTab = null;
    return;
  }

  const { domain, tier } = getTierForUrl(url);
  if (!domain) { currentTab = null; return; }

  // Keep the streak going if the user just hops between same-tier sites
  // (twitter.com → instagram.com is still doomscrolling). Reset on tier change.
  const sessionStart = (prev && prev.tier === tier) ? prev.sessionStart : Date.now();
  currentTab = { domain, tier, url, startTime: Date.now(), sessionStart };
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────────

// Tab switched
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) await startTracking(tab.url);
  } catch {}
});

// URL changed in current tab
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    await startTracking(changeInfo.url);
  }
});

// Window focus changed
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await flushCurrent();
    currentTab = null;
  } else {
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab?.url) await startTracking(tab.url);
    } catch {}
  }
});

// Idle detection — pause tracking when user is away
chrome.idle.setDetectionInterval(60); // 60 seconds
chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === "idle" || state === "locked") {
    isIdle = true;
    await flushCurrent();
  } else {
    isIdle = false;
    // Resume tracking current tab
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) await startTracking(tab.url);
    } catch {}
  }
});

// Periodic flush every 30 seconds (service worker keepalive)
chrome.alarms.create("flush", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "flush") {
    await flushCurrent();
    await maybeNotifyStreak();
    // Reset startTime to avoid double-counting; sessionStart stays put.
    if (currentTab) {
      currentTab.startTime = Date.now();
    }
  }
});

// Flush on extension suspend
self.addEventListener("beforeunload", async () => {
  await flushCurrent();
});

// ─── CLEANUP: keep only last 90 days ─────────────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  const all = await chrome.storage.local.get(null);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  
  const keysToRemove = Object.keys(all).filter(k => k.startsWith("day:") && k.slice(4) < cutoffStr);
  if (keysToRemove.length) await chrome.storage.local.remove(keysToRemove);
  
  // Restore badge for today
  const today = getToday();
  const todayData = all[`day:${today}`];
  if (todayData) updateBadge(todayData);
});
