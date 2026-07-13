# MusicBox

A personal music journal — log the songs that matter, rate them your way (overall or part-by-part), review them, organize collections, hear 30-second previews, import your streaming history, and watch your taste move over time. Built as a static-file PWA: vanilla HTML/CSS/JS, native ES modules, no framework, no build step, no backend.

This is **v2**, a full revamp of the original demo: a real visual identity, hash routing, offline support, and ten new feature areas, with existing users' localStorage data preserved.

## The identity

Analog record culture, not streaming-service chrome:

- **Vinyl-dark base** (`#17131C` aubergine-black) with **parchment record cards** (`#EFE8D8`) — journal entries read like index cards in a crate.
- **Marigold** accent (`#E8A33D`, a turntable indicator lamp) and **groove teal** (`#3E7C7C`) secondary.
- **Type:** Bricolage Grotesque (display), Figtree (body), Courier Prime (typewriter metadata — dates, track numbers, stat numerals). Self-hosted in `fonts/` so the PWA works offline.
- **Signature element:** a vinyl disc that spins while a 30-second preview plays. Everything else stays quiet around it.

## Features

- **Journal** — log/edit/delete songs with cover art (iTunes autocomplete), reviews, favorites, collections.
- **Part ratings** — score writing, production, replay value (or your own criteria); the overall rating auto-computes unless you set it manually. Legacy single ratings remain valid as-is.
- **Duplicate detection** — matches on iTunes track ID and on normalized title+artist (ignores "(Remastered)" suffixes and "feat." tails); offers *update existing* vs. *log again*.
- **30-second previews** — the spinning-disc player, on journal cards and the detail page; hidden when no preview exists.
- **Surprise me** — weighted rediscovery: favors songs you loved but haven't looked at lately.
- **On this day** — songs logged on today's date in another month or year.
- **Streaming import** — Spotify (StreamingHistory/extended/playlist JSON) or Apple Music (CSV) exports; resolves through iTunes with polite throttling, dedupes, and reports added / skipped / unresolved.
- **Backup** — one-click JSON export of entries + collections, and merge-on-restore. The disaster-recovery story for a localStorage app.
- **Stats** — rating distribution, top artists, genre breakdown, plus canvas charts for ratings-over-time and taste-over-time (top-5 genres, colorblind-validated palette, hover tooltips).
- **Recap card** — a downloadable 1080x1350 PNG in the app's own identity, for any period.
- **Discover** — ListenBrainz trending + Last.fm charts with stale-while-revalidate caching, per-section error states with retry, lazy art enrichment.
- **PWA** — installable, offline-capable (`manifest.json` + `sw.js`), with an offline indicator.

## Structure

```
index.html      shell: pages, modals, nav, tab bar
styles.css      design system (tokens at the top)
js/
  main.js       event wiring & bootstrap
  storage.js    auth, journal, collections, backup, local queries
  api.js        fetchers + caching/backoff/SWR resilience layer
  render.js     all templates and page renderers
  nav.js        hash router + focus/announcer a11y
  audio.js      shared preview player
  importer.js   streaming-export parsing + resolution
  charts.js     canvas charts (validated palette)
  recap.js      recap card renderer
sw.js           service worker (app shell + cover art caches)
manifest.json   PWA manifest
fonts/ icons/   self-hosted fonts, generated app icons
app.js.v1.bak   the pre-revamp single-file app, kept for reference
```

## Running

ES modules and the service worker need HTTP (not `file://`):

```bash
python3 -m http.server 8000
```

then open `http://localhost:8000`. Deploy by dropping the folder on any static host.

**When you change app files**, bump `SHELL_CACHE` in `sw.js` (v2 → v3 …) so installed clients fetch the new build on their next visit.

## Data & security notes

- All data lives in `localStorage` under the same keys as v1 — updating in place keeps existing journals. Use **Export backup** regularly; it's your only copy.
- Passwords now hash with SHA-256 (`SubtleCrypto`); v1's weaker hashes upgrade silently on the next successful sign-in. This is still a client-only app with no server: the login exists to separate journals per person, not to protect secrets. **Don't reuse a real password.**
- Third-party APIs (iTunes, MusicBrainz, ListenBrainz, Last.fm, Cover Art Archive) are throttled, retried with backoff on 429/5xx, and cached aggressively in localStorage. The service worker caches only the app shell and images, so there's one cache owner per kind of thing.

## Decisions of note (v2 revamp)

- **Grotesque display over the suggested serif.** Record-sleeve culture (Blue Note, Reid Miles) argues for a bold characterful grotesque; a serif display is also the most common AI-design tell. Bricolage Grotesque carries the warmth without the cliché.
- **Imported songs arrive unrated** instead of getting a fabricated default rating — the journal only says what you actually judged.
- **Chart colors are computed, not eyeballed**: the five categorical hues were generated in OKLCH and pass lightness/chroma/colorblind-separation/contrast validation against the dark surface.
- **Import caps at 60 songs per run** to respect iTunes rate limits; re-running the same file continues where it left off (duplicates skip cheaply before any API call).
- **Dates are parsed as local, not UTC** (`parseDate` in `storage.js`) — date-only strings otherwise display a day early in most timezones.

`GEMINI.md` is an unrelated leftover prompt and not part of this app.
