# dopaFit — brand & logo system

## Concept

**The mark is a stylized "D" formed from three concentric arcs at staggered radii — three tiers of dopamine, layered.** The outermost arc is the longest and warmest (the high-spike tier we want to *control*); the innermost is the shortest and coolest (the positive tier we want to *protect*). Together they imply a dial — something you tune, not something that's done to you.

It reads as:
- A "D" for dopaFit — recognizable at favicon size.
- A meter / gauge — the thing the product literally is.
- Three rings of reward — the philosophy.

## Palette

Borrowed from Claude.ai's design language (warm cream + earth tones), with our three tier colors as functional accents.

| token | hex | use |
|---|---|---|
| `--bg` | `#F9F8F6` | background, cards |
| `--bg-warm` | `#FAFAF7` | popup body |
| `--ink` | `#2C2C2A` | primary text |
| `--ink-muted` | `#5F5E5A` | secondary text |
| `--ink-faint` | `#888780` | tertiary text |
| `--rule` | `#EFEDE5` | borders, dividers |
| `--brand` | `#BA5C2E` | logo accent (warm Anthropic coral) |
| `--high` | `#E24B4A` | high-tier red |
| `--medium` | `#BA7517` | medium-tier amber |
| `--positive` | `#0F6E56` | positive-tier green |

## Typography

| use | font | weight |
|---|---|---|
| Logotype | Tiempos / serif fallback | 600 (semi) |
| H1 in popup | -apple-system | 600 |
| Body | -apple-system | 400 |
| Stats / numbers | -apple-system, tabular-nums | 600 |

The popup already uses `-apple-system, BlinkMacSystemFont, "SF Pro Text"` — keeps install size at zero. The logotype gets serif treatment for hero placements (landing page, social cards) only.

## Logo files

| file | dimensions | use |
|---|---|---|
| `logo-mark.svg` | 24×24 viewBox | the "D" mark on its own — favicon, popup header, app icon |
| `logo-wordmark.svg` | 160×40 viewBox | mark + "dopaFit" wordmark — landing page, OG image |
| `icon-16.png` | 16×16 | Chrome menu bar |
| `icon-48.png` | 48×48 | Chrome management page |
| `icon-128.png` | 128×128 | Chrome Web Store listing |

All icons can be regenerated from `logo-mark.svg` (see commands at bottom of this file).

## Tone of voice

- Direct. No corporate slop.
- Plain English, short sentences.
- Show, don't preach.
- "Awareness, not blocking" is the catchphrase.
- We never shame the user. The score grades the day, not the person.

## Anti-patterns

- No emoji-heavy branding (it's a serious mental-fitness tool, not a kid app).
- No gradients in the mark (they age fast and look generic).
- No "smart" puns in copy. Plain works.
- No competitor-bashing (StayFocusd / BlockSite / Forest are different products, not enemies).

---

## Regenerating the PNG icons from the SVG mark

```bash
# Requires `rsvg-convert` (brew install librsvg) or any SVG → PNG tool.
cd extension/icons
rsvg-convert -w 16  -h 16  ../../ship/logo-mark.svg > icon16.png
rsvg-convert -w 48  -h 48  ../../ship/logo-mark.svg > icon48.png
rsvg-convert -w 128 -h 128 ../../ship/logo-mark.svg > icon128.png
```
