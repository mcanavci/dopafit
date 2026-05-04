// Single source of truth for domain → tier classification.
// Loaded by both the service worker (importScripts) and the popup (<script src>).
// Edit this file to retune the classifier.

const DOMAIN_TIERS = {
  // ─── HIGH SPIKE ──────────────────────────────────
  // Social / scroll feeds
  "twitter.com": "high", "x.com": "high",
  "instagram.com": "high", "facebook.com": "high",
  "tiktok.com": "high", "threads.net": "high",
  "bsky.app": "high", "mastodon.social": "high",
  "snapchat.com": "high",

  // News doomscroll
  "news.ycombinator.com": "high", "cnn.com": "high",
  "foxnews.com": "high", "bbc.com": "high", "bbc.co.uk": "high",
  "dailymail.co.uk": "high", "buzzfeed.com": "high",
  "tmz.com": "high", "vice.com": "high",

  // Dating
  "tinder.com": "high", "bumble.com": "high", "hinge.co": "high",

  // Betting / gambling
  "bet365.com": "high", "draftkings.com": "high",
  "fanduel.com": "high", "bovada.lv": "high",
  "stake.com": "high", "polymarket.com": "high",

  // ─── MEDIUM SPIKE ────────────────────────────────
  // Video / streaming
  "youtube.com": "medium", "twitch.tv": "medium",
  "netflix.com": "medium", "hulu.com": "medium",
  "disneyplus.com": "medium", "primevideo.com": "medium",
  "crunchyroll.com": "medium", "spotify.com": "medium",
  "music.youtube.com": "medium",

  // Forums / long-form
  "reddit.com": "medium", "old.reddit.com": "medium",
  "quora.com": "medium", "medium.com": "medium",
  "substack.com": "medium",

  // Chat / messaging (web)
  "discord.com": "medium", "web.whatsapp.com": "medium",
  "web.telegram.org": "medium", "slack.com": "medium",
  "messenger.com": "medium",

  // Shopping
  "amazon.com": "medium", "amazon.co.uk": "medium",
  "amazon.de": "medium", "amazon.com.tr": "medium",
  "ebay.com": "medium", "aliexpress.com": "medium",
  "etsy.com": "medium", "trendyol.com": "medium",
  "hepsiburada.com": "medium", "store.steampowered.com": "medium",

  // Networking / finance scroll
  "linkedin.com": "medium",
  "tradingview.com": "medium", "finance.yahoo.com": "medium",
  "investing.com": "medium", "coinmarketcap.com": "medium",
  "coingecko.com": "medium",

  // AI tools — research-flagged dose-dependent (MIT RCT 2025, METR 2025, GitClear).
  // Productive in short sessions, dependence patterns above ~27 min/day.
  "claude.ai": "medium", "chat.openai.com": "medium", "chatgpt.com": "medium",
  "gemini.google.com": "medium", "perplexity.ai": "medium",
  "copilot.microsoft.com": "medium", "character.ai": "medium",
  "chat.deepseek.com": "medium", "deepseek.com": "medium",
  "v0.dev": "medium", "lovable.dev": "medium",

  // ─── LOW SPIKE (productive) ──────────────────────
  // Dev / coding
  "github.com": "low", "gitlab.com": "low",
  "stackoverflow.com": "low", "stackexchange.com": "low",
  "developer.mozilla.org": "low", "docs.python.org": "low",
  "npmjs.com": "low", "pypi.org": "low",
  "codepen.io": "low", "replit.com": "low",
  "vercel.com": "low", "netlify.com": "low", "supabase.com": "low",

  // Work / productivity
  "notion.so": "low", "linear.app": "low", "figma.com": "low",
  "docs.google.com": "low", "sheets.google.com": "low",
  "slides.google.com": "low", "drive.google.com": "low",
  "calendar.google.com": "low", "mail.google.com": "low",
  "outlook.com": "low", "outlook.office.com": "low",
  "trello.com": "low", "asana.com": "low", "clickup.com": "low",
  "airtable.com": "low", "miro.com": "low",
  "canva.com": "low", "loom.com": "low",

  // Learning
  "coursera.org": "low", "udemy.com": "low", "edx.org": "low",
  "khanacademy.org": "low", "brilliant.org": "low",
  "leetcode.com": "low", "hackerrank.com": "low",
  "freecodecamp.org": "low",

  // Reading / research
  "scholar.google.com": "low", "arxiv.org": "low",
  "wikipedia.org": "low", "en.wikipedia.org": "low",

  // Job search
  "indeed.com": "low", "glassdoor.com": "low",
  "wellfound.com": "low", "lever.co": "low", "greenhouse.io": "low",
};

// Fallback keyword patterns for unknown domains.
//
// HIGH-tier patterns are aggressive (no \b) — false positives are rare for
// words like "porn" or "casino", and missing actual high-tier sites is the
// expensive failure. MEDIUM/LOW patterns use leading \b only — catches
// compound domains like "devforum.io" (matches /\bdev/) but not "underdev".
// Some short words use full \b\b to avoid medical "doctors.com" → low.
const TIER_PATTERNS = {
  high: [
    // Adult / explicit — broad match acceptable
    /porn/, /xxx/, /nsfw/, /erotic/, /adult/,
    // Gambling — broad
    /casino/, /gambl/, /\bslot/, /poker/, /roulette/, /\bbet\b/, /betting/, /\bodds\b/,
    // Dating / hookup
    /dating/, /hookup/, /\btinder/, /\bbumble/, /\bhinge/,
    // Doomscroll / clickbait
    /viral/, /trending/, /clickbait/, /tabloid/,
  ],
  medium: [
    // Shopping
    /\bshop/, /\bstore/, /\bcart\b/, /\bbuy\b/, /\bsale\b/, /\bdeal\b/, /coupon/,
    // Streaming / video
    /stream/, /\bwatch\b/, /video/, /\btube\b/, /\btv\b/, /movies?/,
    // Gaming — broad, multiple stems for compound matching
    /\bplay\b/, /game/, /gaming/, /\bsteam/, /\bxbox/, /playstation/,
    // News / media — broad enough to catch "newssite"
    /news/, /\bpost\b/, /headline/, /\btimes\b/, /\bdaily/,
    // Forums / discussion — broad
    /forum/, /discuss/, /\bthread/, /\bsubreddit/,
    // Chat / messaging
    /\bchat\b/, /messenger/, /\btalk\b/,
    // Trading scroll
    /\btrade\b/, /\bstocks?\b/, /crypto/, /\bcoin\b/, /\bmarket\b/,
    // AI chat signals
    /\bgpt\b/, /\bllm\b/, /chatbot/, /companion/,
  ],
  low: [
    // Documentation — \b\b on the short word to avoid "doctors.com"
    /\bdocs\b/, /\bdoc\.[a-z]/, /documentation/, /reference/, /\bhandbook/, /\bmanual\b/,
    // Dev / engineering — multiple variants for compound matching
    /\bdev\./, /\bdev-/, /devops/, /devforum/, /developer/,
    /\bapi\./, /\bapi-/, /\bsdk\b/, /\bcli\b/,
    /github/, /gitlab/, /bitbucket/,
    // Learning
    /\blearn/, /tutorial/, /course/, /\blesson/, /training/, /\bschool/, /bootcamp/,
    // Academic
    /university/, /college/, /academy/, /faculty/, /campus/,
    // Knowledge / research
    /\bwiki/, /encyclopedia/, /scholar/, /research/, /\bpaper\b/, /\bjournal\b/, /preprint/, /arxiv/,
    // Code / programming
    /\bcode\b/, /coding/, /programming/, /algorithm/, /\brepo\b/,
    // Work tools
    /\bwork\b/, /\boffice\b/, /productivity/, /\badmin\b/, /dashboard/, /\bconsole\b/,
    // Reading / writing tools
    /notebook/, /\beditor\b/, /writing/,
  ],
};

// TLD hints — applied as a final pass before "unknown". Soft signal; only
// fires if no domain or pattern match. Most TLDs are too generic to map
// cleanly, so we only encode the ones with clear semantics.
const TLD_TIER = {
  ".edu":     "low",
  ".gov":     "low",
  ".ac.uk":   "low",
  ".edu.au":  "low",
  ".casino":  "high",
  ".bet":     "high",
  ".porn":    "high",
  ".xxx":     "high",
  ".adult":   "high",
};

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function getTier(domain) {
  if (!domain) return "unknown";

  // 1. Direct match — explicit table hit
  if (DOMAIN_TIERS[domain]) return DOMAIN_TIERS[domain];

  // 2. Parent-domain match — m.youtube.com → youtube.com
  const parts = domain.split(".");
  if (parts.length > 2) {
    const parent = parts.slice(-2).join(".");
    if (DOMAIN_TIERS[parent]) return DOMAIN_TIERS[parent];
  }

  // 3. Pattern matching on the full domain
  for (const [tier, patterns] of Object.entries(TIER_PATTERNS)) {
    for (const p of patterns) {
      if (p.test(domain)) return tier;
    }
  }

  // 4. TLD hints — last semantic signal before giving up
  for (const [tld, tier] of Object.entries(TLD_TIER)) {
    if (domain.endsWith(tld)) return tier;
  }

  // 5. Unknown — no signal. Counts toward time totals but doesn't move the
  //    score. Defending the user from being punished for one-off curiosity.
  return "unknown";
}

// URL-aware classification (catches /shorts).
function getTierForUrl(url) {
  const domain = extractDomain(url);
  let tier = getTier(domain);
  try {
    const u = new URL(url);
    if ((domain === "youtube.com" || domain === "m.youtube.com") && u.pathname.startsWith("/shorts")) {
      tier = "high";
    }
  } catch {}
  return { domain, tier };
}
