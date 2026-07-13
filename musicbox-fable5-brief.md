# MusicBox v2 — Build Brief for Fable 5

## What this document is

This is a creative and technical brief, not a literal spec to execute line by line. Where I've made a suggestion (a palette, a specific pattern, a library), treat it as a strong starting direction — improve on it if you find something that serves the app better, and note why you changed it. Where I've left something unspecified, make the call yourself and say what you decided and why. You have the workspace; run with it.

Work directly in the existing repo. Read `app.js`, `index.html`, `styles.css`, and this README section-by-section before changing anything — the current app already works and has real users' data in `localStorage`, so nothing here should break existing journals on update.

**Do not pause to ask clarifying questions.** Where this brief is ambiguous or silent, make the call yourself, note the decision and reasoning briefly (in a commit message, changelog entry, or code comment — your choice), and keep moving. Treat this as an open-ended session: work through Section 5's sequence end-to-end on your own judgment rather than checking in between stages.

---

## 1. What MusicBox is today

Paste of the current README, for full context:

> A personal music journal, built as a single-page app with vanilla HTML/CSS/JS — no framework, no build step, no backend. Track songs you've listened to, rate and review them, organize them into collections, discover new music, and see stats about your listening habits.
>
> MusicBox is entirely client-side. There's no server or database — accounts, journal entries, collections, and caches all live in the browser's `localStorage`. This keeps the app trivially deployable (just static files) at the cost of being single-device and not really secure.
>
> To provide real song data, cover art, and charts without a backend, the app calls free public music APIs directly from the browser: iTunes Search/Lookup, MusicBrainz, Cover Art Archive, ListenBrainz, and a Last.fm-style top-tracks endpoint. Because these are third-party rate-limited APIs, the app aggressively caches results in `localStorage` and throttles MusicBrainz requests to stay under limits.
>
> `index.html` holds all pages in one document (Home, Journal, Discover, Stats, Detail); nav swaps which `.page` is visible rather than doing real routing. `app.js` holds all logic top-to-bottom: Auth → Journal storage → Collections → Catalog/cache helpers → API fetchers → renderers → page navigation. `styles.css` holds all styling. No bundler, no package manager.

**Preserve this philosophy.** Static files, zero install, zero backend, deployable by dropping the folder on any static host. If a feature seems to need a server, find the client-only version of it instead.

---

## 2. The mission

Take MusicBox from "working demo" to "app I'd actually want to use daily." That means two tracks running together, not sequentially bolted on:

- **A real visual identity** — right now it's unstyled/generic vanilla-app territory. It should feel like *a personal music journal*, not a form with a database behind it.
- **A set of features that make the journal smarter and stickier** — surfacing your own history back to you, catching your own mistakes (dupes), working when you're offline, and giving you something to look at (recaps, taste trends) instead of just a list.

Treat every new feature as something that gets built *inside* the new visual language, not styled after the fact. Do the design pass first, or at minimum lock the design tokens first, so features 1–10 below don't end up in two different visual eras of the app.

---

## 3. Design direction

You have a `frontend-design` skill — use its full brainstorm → plan → critique → build → critique-again process against this brief before writing any CSS. What follows is my seed direction, not a finished spec. Push back on it where you think it's wrong for the subject.

**The subject to design from:** this isn't a generic media app, it's a *personal journal about music* — closer in spirit to a mixtape you made someone, liner notes, a well-worn record sleeve, a card catalog you keep adding to. Lean into analog music culture rather than streaming-service chrome. Avoid the instinct to make this look like a Spotify clone.

**Avoid the current AI-default clusters** — cream background + terracotta serif, black + single neon accent, or hairline-rule broadsheet. Pick something that comes from *this* subject instead.

A seed direction, for you to interrogate and improve:

- **Color** — dark ink/vinyl base rather than cream (something like a deep aubergine-black, `#17131C`), a warm parchment surface for cards (`#EFE8D8`, distinct from the cream-default hex — check it against the skill's warning), a mustard/marigold accent evoking cassette spools or turntable indicator lights (`#E8A33D`) rather than terracotta, and a muted record-groove teal as a secondary/interactive color (`#3E7C7C`). Ink-black text on parchment cards, warm off-white text on the dark base.
- **Type** — a display face with real character for headings/titles (something warm and slightly inky, not a default geometric sans), a clean humanist body face for reviews and prose, and a monospace/typewriter utility face reserved for metadata — timestamps, track numbers, catalog-style IDs — the way liner notes credit a session date or a spine number.
- **Layout concept** — journal entries as "record cards": each logged song gets a card treatment (like a sleeve or index card), not a generic list row. Home as "the shelf" — a browsable stack rather than a dashboard. Numbered markers only where there's a real sequence (track order in a collection) — not decoratively on things that aren't actually ordered.
- **Signature element** — pick one thing this app is remembered by. A candidate: ratings rendered as something hand-marked (a hand-inked circle, a tally, a stamped grade) instead of generic star icons; or a small vinyl-disc motif that spins while a 30-second preview plays. Pick one, execute it well, and keep everything else quiet around it.
- **Motion** — sparing and purposeful: a disc spinning during audio preview playback, a card-catalog-style flip or slide between pages, a scroll reveal on the Stats heatmap. Respect `prefers-reduced-motion` throughout.

Build to a quality floor regardless of how the above evolves: responsive down to mobile, visible keyboard focus states, reduced-motion respected, and real contrast ratios on both the dark base and parchment cards.

---

## 4. Features to build

Each item below is a goal and an acceptance bar, not a step-by-step implementation. Use your judgment on the mechanism.

### 4.1 Multi-criteria rating
Replace (or extend) the single star rating with sub-ratings that roll up into an overall score — pick criteria that actually fit a music journal (e.g. hooks/writing, production, replay value — or better ones if you think of them). Existing single-ratings must migrate gracefully: an old entry's rating becomes its "overall," not lost data, and the UI should handle entries that only have a legacy rating without erroring.

### 4.2 Duplicate-entry detection
When logging a song already in the journal (match on MusicBrainz ID / iTunes trackId, not just title string), prompt: update the existing entry vs. create a new one. Should catch the "I already rated this in March" case described in the brief, not just exact re-searches.

### 4.3 Surprise me
A button (Home and/or Journal) that resurfaces a past entry — weighted toward ones not recently viewed, not pure random every time, so it actually does rediscovery work rather than repeating the same handful of entries.

### 4.4 On this day
Home widget surfacing journal entries logged on this date in a previous month/year. Pure localStorage query, no new API calls. Empty state should feel like an invitation ("nothing logged this day — yet") not an error.

### 4.5 30-second previews
Inline audio player using the `previewUrl` iTunes already returns, on journal cards and the Detail page. Handle the tracks that don't have a preview available gracefully — hide the control, don't show a broken player.

### 4.6 Import from streaming exports
A plain file input accepting a Spotify or Apple Music data export (CSV/JSON) and bulk-creating journal entries from it. Resolve metadata through the existing catalog/API pipeline you already have, dedupe against what's already in the journal (reuse 4.2's matching logic), and show the user an import summary (added / skipped-as-duplicate / couldn't-resolve) rather than a silent bulk write.

### 4.7 Weekly / yearly recap
A canvas-rendered, downloadable image (PNG) summarizing top songs/genres/stats for a period — Stats page. This is the "Wrapped" feature; make it something worth actually sharing, which means it needs to hit the same visual identity as the rest of the app, not a default chart export.

### 4.8 Offline support (PWA)
`manifest.json` + service worker so the app installs and previously-visited content works offline. Align the service worker's caching strategy with the localStorage caches that already exist (search results, art, chart data) rather than duplicating that caching logic in two places. Give the user a visible signal when they're offline and viewing something that was never cached.

### 4.9 Taste-over-time
A time-bucketed aggregation of ratings by genre/era across the journal's history (not just a current snapshot average) — Stats page, ties into the recap and the chart work in 4.10.

### 4.10 The smaller structural work
These came out of a review of the current app and should happen alongside the above, not as an afterthought:

- **Real password hashing** — swap the non-cryptographic `hashPassword` for `SubtleCrypto.digest('SHA-256', ...)`. This is still not "real" account security given there's no server, and the README's "don't reuse real passwords" caveat should stay — but there's no reason to use a worse hash than the browser gives you for free.
- **Journal backup export/import** — a separate, simpler feature from 4.6: export the whole journal (entries + collections) as a JSON file, and re-import it. This is the disaster-recovery / device-migration story for a single-device, localStorage-only app, and it's cheap to build.
- **API resilience** — exponential backoff and retry on 429s (not just throttling on the way out), a unified "this section failed to load" state per card/section instead of blank/broken UI, and a stale-while-revalidate pattern on the existing caches (show cached data immediately, refresh underneath it) instead of blocking render on a fresh fetch.
- **Modularize `app.js`** — split into native ES modules (`<script type="module">`, no bundler needed) along the seams the file already has conceptually: `auth.js`, `storage.js`, `api.js`, `render.js`, `nav.js`. Do this early — it'll make every feature above easier to place.
- **Real routing** — nav currently just toggles which `.page` is visible. Move to hash-based routing (`#/journal`, `#/discover`, etc.) so refresh, back/forward, and shared links actually land on the right page. Pair this with an accessibility pass: move focus to the new page's heading on navigation, and add an `aria-live` region announcing the page change.
- **Performance** — `loading="lazy"` on cover art, debounce the search input before it hits iTunes/MusicBrainz, and pagination or basic virtualization if Journal/Discover lists get long.
- **A real Stats chart** — you already cache the data; a lightweight canvas-based chart (no dependency needed) for ratings-over-time and the taste-over-time work in 4.9.

---

## 5. Working method

Don't build this as one enormous pass. Suggested order, adjust if you find a better sequence:

1. **Design system + shell first.** Lock the token system (color, type, layout concept, signature element) from Section 3, and get the page shell (nav, routing, page transitions) running in the new visual language before anything else, since everything downstream gets built inside it.
2. **Modularize `app.js`** (4.10) before piling new features onto the current single-file structure.
3. **Data model changes that other features depend on** — multi-criteria rating (4.1) and the ID-based matching used by duplicate detection (4.2) and import (4.6) — before building the features that consume them.
4. **Feature build-out**, in whatever order makes sense given what's already in place.
5. **Offline/PWA layer (4.8) last**, since it should wrap the finished app rather than be built against a moving target.
6. **A final critique pass** — re-run the design skill's critique step against the finished app, not just the mockup stage.

After each feature (or logical group of features), actually run the app — serve it locally (`python3 -m http.server`), exercise the feature in a real browser, check the console for errors, and verify it against that feature's acceptance bar above before moving on. If you can take screenshots in your environment, use them to self-critique the visual work the way the design skill describes — a screenshot catches things a code read-through won't.

Keep `GEMINI.md` untouched — it's an unrelated leftover, not part of this app.

---

## 6. Definition of done

- App still runs as static files, no backend, no build step (unless you introduce one and can justify the tradeoff).
- Existing users' `localStorage` data survives the update — migrate schema changes, don't wipe them.
- All ten feature areas in Section 4 are functional and meet their acceptance bar.
- The app has a real, considered visual identity per Section 3 — not the vanilla-app look it has today, and not one of the generic AI-default looks either.
- Keyboard-navigable, visible focus states, reduced-motion respected, reasonably usable on mobile widths.
- Third-party API usage still respects the existing rate-limit/caching discipline — none of the new features should hammer iTunes/MusicBrainz/ListenBrainz harder than before.
