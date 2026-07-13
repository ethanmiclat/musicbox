/* MusicBox — main: event wiring and app bootstrap. */

import * as store from './storage.js';
import * as api from './api.js';
import * as ui from './render.js';
import { initRouter, navigate, goBack, parseRoute } from './nav.js';
import { togglePreview, stopPreview } from './audio.js';
import { parseExportFile, runImport, IMPORT_CAP } from './importer.js';
import { renderRatingsOverTime, renderTasteOverTime } from './charts.js';
import { renderRecap, downloadRecap } from './recap.js';
import { matchScore, highlightMatch } from './search.js';

const $ = id => document.getElementById(id);

// ── Modal helpers ───────────────────────
function openModal(el) {
  el.classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeModal(el) {
  el.classList.remove('active');
  document.body.style.overflow = '';
}
function bindModalChrome(modal, closeBtn, onClose) {
  const close = () => { closeModal(modal); if (onClose) onClose(); };
  if (closeBtn) closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  return close;
}

// ── Auth ────────────────────────────────
const authModal = $('authModal');
let authMode = 'login';

function updateAuthUI() {
  const user = store.getCurrentUser();
  $('authButtons').style.display = user ? 'none' : 'flex';
  $('userMenu').style.display = user ? 'block' : 'none';
  if (user) {
    $('userAvatar').textContent = user[0].toUpperCase();
    $('userName').textContent = user;
    $('userDropdownName').textContent = user;
  }
}

function openAuthModal(mode = 'login', message = null) {
  authMode = mode;
  updateAuthModalMode();
  openModal(authModal);
  $('authForm').reset();
  hideAuthError();
  if (message) $('authSubtitle').textContent = message;
  setTimeout(() => $('authUsername').focus(), 80);
}

function updateAuthModalMode() {
  const signup = authMode === 'signup';
  $('authTitle').textContent = signup ? 'Create your journal' : 'Welcome back';
  $('authSubtitle').textContent = signup
    ? 'Pick a username and password. Everything stays on this device.'
    : 'Sign in to your music journal.';
  $('authSubmit').textContent = signup ? 'Create account' : 'Sign in';
  $('authSwitchText').textContent = signup ? 'Already have an account?' : 'New here?';
  $('authSwitchLink').textContent = signup ? 'Sign in' : 'Create an account';
  $('authPassword').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
}

function showAuthError(msg) {
  $('authError').textContent = msg;
  $('authError').classList.add('active');
}
function hideAuthError() {
  $('authError').classList.remove('active');
  $('authError').textContent = '';
}

function requireLogin(message) {
  if (store.isLoggedIn()) return true;
  openAuthModal('login', message);
  return false;
}

// ── Log modal: criteria + overall rating ──
const logModal = $('logModal');
const DEFAULT_CRITERIA = ['writing', 'production', 'replay value'];

let selectedRating = 0;
let manualOverall = false;
let criteria = [];          // [{name, rating}]
let logPrefillExtras = {};
let selectedLogCollections = [];
let editingId = null;
let dupeEntry = null;
let dupeDismissed = false;

function starInputHtml() {
  return [1, 2, 3, 4, 5].map(v =>
    `<div class="star-input" data-value="${v}"><span class="sb-bg">&#9733;</span><span class="sb-fg">&#9733;</span></div>`
  ).join('');
}

function updateStarInput(container, rating) {
  container.querySelectorAll('.star-input').forEach((el, i) => {
    const n = i + 1;
    let pct = 0;
    if (rating >= n) pct = 100;
    else if (rating >= n - 0.5) pct = 50;
    el.querySelector('.sb-fg').style.width = pct + '%';
  });
  if (container.getAttribute('role') === 'slider') {
    container.setAttribute('aria-valuenow', rating);
    container.setAttribute('aria-valuetext', rating ? `${rating} out of 5 stars` : 'not rated');
  }
}

function starValueFromEvent(el, clientX) {
  const rect = el.getBoundingClientRect();
  const isLeft = (clientX - rect.left) < rect.width / 2;
  const n = parseInt(el.dataset.value, 10);
  return isLeft ? n - 0.5 : n;
}

function bindStarInput(container, getValue, setValue) {
  container.innerHTML = starInputHtml();
  container.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.star-input');
    if (el) updateStarInput(container, starValueFromEvent(el, e.clientX));
  });
  container.addEventListener('mouseleave', () => updateStarInput(container, getValue()));
  container.addEventListener('click', (e) => {
    const el = e.target.closest('.star-input');
    if (!el) return;
    const val = starValueFromEvent(el, e.clientX);
    setValue(val);
    updateStarInput(container, val);
  });
  if (container.getAttribute('role') === 'slider') {
    container.addEventListener('keydown', (e) => {
      let v = getValue();
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = Math.min(5, v + 0.5);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = Math.max(0, v - 0.5);
      else return;
      e.preventDefault();
      setValue(v);
      updateStarInput(container, v);
    });
  }
}

function setOverall(v, manual) {
  selectedRating = v;
  manualOverall = manual;
  $('starRatingValue').textContent = ui.formatRating(v);
  updateStarInput($('starRating'), v);
  $('ratingAutoNote').style.display = (!manual && v) ? 'block' : 'none';
}

function autoFillOverall() {
  if (manualOverall) return;
  const rated = criteria.filter(c => c.rating > 0);
  if (!rated.length) { setOverall(0, false); return; }
  const avg = rated.reduce((s, c) => s + c.rating, 0) / rated.length;
  setOverall(Math.round(avg * 2) / 2, false);
}

function renderCriteriaGrid() {
  const grid = $('criteriaGrid');
  grid.innerHTML = '';
  criteria.forEach((crit, idx) => {
    const row = document.createElement('div');
    row.className = 'criteria-input-row' + (crit.rating ? ' has-value' : '');
    row.innerHTML = `
      <span class="criteria-input-name">${ui.escapeHtml(crit.name)}</span>
      <div class="star-rating star-rating-mini" aria-label="Rating for ${ui.escapeHtml(crit.name)}"></div>
      <button type="button" class="criteria-clear" aria-label="Clear ${ui.escapeHtml(crit.name)} rating">&times;</button>
    `;
    const starsEl = row.querySelector('.star-rating');
    bindStarInput(starsEl,
      () => crit.rating,
      (v) => {
        crit.rating = v;
        row.classList.add('has-value');
        autoFillOverall();
      });
    updateStarInput(starsEl, crit.rating);
    row.querySelector('.criteria-clear').addEventListener('click', () => {
      if (DEFAULT_CRITERIA.includes(crit.name)) {
        crit.rating = 0;
        updateStarInput(starsEl, 0);
        row.classList.remove('has-value');
      } else {
        criteria.splice(idx, 1);
        renderCriteriaGrid();
      }
      autoFillOverall();
    });
    grid.appendChild(row);
  });
}

function renderLogCollectionPicker() {
  const picker = $('logCollectionPicker');
  const group = $('logCollectionGroup');
  const collections = store.getCollections();
  if (!collections.length) { group.style.display = 'none'; return; }
  group.style.display = '';
  picker.innerHTML = collections.map(col => {
    const sel = selectedLogCollections.includes(col.id) ? ' selected' : '';
    return `<button type="button" class="log-col-chip${sel}" data-col-id="${col.id}">${ui.escapeHtml(col.name)}</button>`;
  }).join('');
}

function hideDupeNote() {
  $('dupeNote').classList.remove('active');
  dupeEntry = null;
}

function checkForDuplicate() {
  if (editingId) { hideDupeNote(); return; }
  const title = $('songTitle').value.trim();
  const artist = $('songArtist').value.trim();
  if (!title || !artist) { hideDupeNote(); return; }
  const dupe = store.findDuplicate({
    itunesTrackId: logPrefillExtras.itunesTrackId,
    mbId: logPrefillExtras.mbId,
    title, artist,
  });
  if (dupe && !dupeDismissed) {
    dupeEntry = dupe;
    $('dupeNoteText').innerHTML =
      `You logged <strong>${ui.escapeHtml(dupe.title)}</strong> on ${ui.escapeHtml(ui.formatDate(dupe.date || dupe.createdAt))}.`;
    $('dupeNote').classList.add('active');
  } else if (!dupe) {
    dupeDismissed = false;
    hideDupeNote();
  }
}

function openLogModal(prefill = {}, { editId = null } = {}) {
  if (!requireLogin('You need an account to log songs to your journal.')) return;
  openModal(logModal);
  $('logForm').reset();
  editingId = editId;
  dupeDismissed = false;
  hideDupeNote();
  $('logModalTitle').textContent = editId ? 'Edit entry' : 'Log a song';
  $('logSubmitBtn').textContent = editId ? 'Save changes' : 'Save to journal';

  logPrefillExtras = {
    coverUrl: prefill.coverUrl || null,
    mbId: prefill.mbId || null,
    releaseId: prefill.releaseId || null,
    releaseGroupId: prefill.releaseGroupId || null,
    itunesTrackId: prefill.itunesTrackId || null,
    collectionId: prefill.collectionId || null,
    previewUrl: prefill.previewUrl || null,
  };
  selectedLogCollections = [];

  criteria = DEFAULT_CRITERIA.map(name => ({ name, rating: 0 }));
  if (prefill.tags && prefill.tags.length) {
    for (const t of prefill.tags) {
      const existing = criteria.find(c => c.name.toLowerCase() === t.name.toLowerCase());
      if (existing) existing.rating = t.rating;
      else criteria.push({ name: t.name, rating: t.rating });
    }
  }
  renderCriteriaGrid();
  setOverall(prefill.rating || 0, !!prefill.rating);
  renderLogCollectionPicker();

  $('songDate').value = prefill.date || new Date().toISOString().split('T')[0];
  $('songTitle').value = prefill.title || '';
  $('songArtist').value = prefill.artist || '';
  $('songAlbum').value = prefill.album || '';
  $('songReview').value = prefill.review || '';
  $('songFavorite').checked = !!prefill.favorite;
  if (prefill.genre) {
    const sel = $('songGenre');
    const want = prefill.genre.toLowerCase();
    const matched = Array.from(sel.options).find(o => o.value && want.includes(o.value));
    sel.value = matched ? matched.value : '';
  } else {
    $('songGenre').value = '';
  }

  if (!editId) checkForDuplicate();
  setTimeout(() => $('songTitle').focus(), 80);
}

const closeLogModal = () => { closeModal(logModal); stopPreview(); };

// ── Rendering after data changes ────────
function rerenderRoute() {
  handleRoute(parseRoute());
}

// ── Route handling ──────────────────────
function currentJournalFilter() {
  return document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
}

function handleRoute(route) {
  stopPreview();
  updateAuthUI();
  switch (route.page) {
    case 'home':
      ui.renderHome();
      break;
    case 'journal': {
      const tab = route.tab || 'songs';
      document.querySelectorAll('.journal-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.jtab === tab));
      document.querySelectorAll('.journal-subpage').forEach(p =>
        p.classList.toggle('active', p.dataset.jtabContent === tab));
      if (tab === 'songs') ui.renderJournal(currentJournalFilter(), $('sortSelect').value);
      else ui.renderCollections();
      break;
    }
    case 'collection':
      ui.renderCollectionDetail(route.id);
      break;
    case 'discover':
      ui.renderDiscover();
      break;
    case 'stats':
      ui.renderStatsBasics();
      renderRatingsOverTime($('ratingsTimeCanvas'), store.getJournal());
      renderTasteOverTime($('tasteTimeCanvas'), $('tasteLegend'), store.getJournal());
      break;
    case 'detail': {
      const entry = store.getEntry(route.id);
      if (!entry) { navigate('journal'); return; }
      store.markViewed(entry.id);
      $('detailView').innerHTML = ui.renderDetailView(entry);
      break;
    }
  }
}

// ── Search overlay ──────────────────────
const searchOverlay = $('searchOverlay');
const searchInput = $('searchInput');
const searchResults = $('searchResults');
let searchSelectedIdx = -1;
let searchToken = 0;
let currentQuery = '';

function openSearch() {
  searchOverlay.classList.add('active');
  searchInput.value = '';
  searchSelectedIdx = -1;
  renderSearchPreState();
  setTimeout(() => searchInput.focus(), 80);
}
function closeSearch() {
  searchOverlay.classList.remove('active');
  searchSelectedIdx = -1;
}

function searchSectionHeader(label) {
  return `<div class="search-section-label">${ui.escapeHtml(label)}</div>`;
}

function searchActionLabel(action) {
  if (action === 'detail') return 'View';
  if (action === 'album') return 'Songs';
  return '+ Log';
}

function searchResultCard(opts) {
  const coverImg = opts.cover
    ? `<img class="search-result-cover-img" src="${ui.escapeHtml(opts.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
    : '';
  const badge = opts.type ? `<span class="search-badge search-badge-${opts.type.toLowerCase()}">${ui.escapeHtml(opts.type)}</span>` : '';
  const listenersStr = opts.listeners ? `<span class="search-listeners">${api.formatListenCount(opts.listeners)} listeners</span>` : '';
  const ratingStr = opts.rating ? `<span class="search-rating">&#9733; ${opts.rating}</span>` : '';
  const metaParts = [highlightMatch(opts.artist || '', currentQuery)];
  if (opts.album) metaParts.push(ui.escapeHtml(opts.album));

  const dataAttrs = [
    `data-action="${opts.action || 'log'}"`,
    opts.id ? `data-id="${opts.id}"` : '',
    `data-title="${ui.escapeHtml(opts.title || '')}"`,
    `data-artist="${ui.escapeHtml(opts.artist || '')}"`,
    `data-album="${ui.escapeHtml(opts.album || '')}"`,
    `data-genre="${ui.escapeHtml(opts.genre || '')}"`,
    opts.cover ? `data-cover="${ui.escapeHtml(opts.cover)}"` : '',
    opts.itunesTrackId ? `data-tid="${opts.itunesTrackId}"` : '',
    opts.collectionId ? `data-cid="${opts.collectionId}"` : '',
    opts.previewUrl ? `data-preview="${ui.escapeHtml(opts.previewUrl)}"` : '',
  ].filter(Boolean).join(' ');

  return `
    <div class="search-result-item" ${dataAttrs}>
      <div class="search-result-cover"><span class="cover-wrap">${ui.renderCoverArt({ title: opts.title, artist: opts.artist, coverUrl: null })}</span>${coverImg}</div>
      <div class="search-result-info">
        <div class="search-result-title-row">
          <span class="search-result-title">${highlightMatch(opts.title || '', currentQuery)}</span>
          ${badge}
        </div>
        <div class="search-result-meta">${metaParts.join(' &middot; ')}</div>
      </div>
      <div class="search-result-right">
        ${listenersStr}${ratingStr}
        <span class="search-result-action">${searchActionLabel(opts.action)}</span>
        ${opts.dismissable ? `<button type="button" class="search-dismiss" data-dismiss-logged="${opts.id}" aria-label="Hide ${ui.escapeHtml(opts.title || '')} from recently logged">&times;</button>` : ''}
      </div>
    </div>
  `;
}

function renderRecentSearches() {
  const recents = store.getRecentSearches();
  if (!recents.length) return '';
  const chips = recents.map(q => {
    const esc = ui.escapeHtml(q);
    return `<span class="search-recent-chip">
      <button type="button" class="search-recent-chip-label" data-recent="${esc}">${esc}</button>
      <button type="button" class="search-recent-chip-x" data-remove-recent="${esc}" aria-label="Remove ${esc} from recent searches">&times;</button>
    </span>`;
  }).join('');
  return `<div class="search-recent-head">
      <span class="search-section-label">Recent searches</span>
      <button type="button" class="search-recent-clear" data-clear-recent>Clear</button>
    </div><div class="search-recent-row">${chips}</div>`;
}

function renderSearchPreState() {
  currentQuery = '';
  const recentLogged = store.getRecentlyLogged(5);
  let html = renderRecentSearches();
  if (recentLogged.length) {
    html += searchSectionHeader('Recently logged');
    html += recentLogged.map(e => searchResultCard({
      action: 'detail', id: e.id, title: e.title, artist: e.artist,
      album: e.album, cover: e.coverUrl, type: 'Song', rating: store.effectiveRating(e) || null,
      dismissable: true,
    })).join('');
  }
  searchResults.innerHTML = html
    || '<div class="search-empty">Start typing to search for songs, artists, or albums.</div>';
}

function renderSearchSkeleton() {
  return Array.from({ length: 5 }).map(() => `
    <div class="search-result-item search-skeleton" aria-hidden="true">
      <div class="search-result-cover skeleton-shimmer" style="background:var(--ink-800);"></div>
      <div class="search-result-info">
        <div class="skeleton-line" style="width:55%;height:14px;margin-bottom:6px;"></div>
        <div class="skeleton-line" style="width:35%;height:11px;"></div>
      </div>
    </div>
  `).join('');
}

// Score the journal with the fuzzy matcher (order-independent + typo-tolerant).
function journalMatchesFor(query) {
  const scored = [];
  for (const e of store.getJournal()) {
    const s = matchScore(query, { title: e.title, artist: e.artist, album: e.album });
    if (s > 0) scored.push({ e, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, 5).map(x => x.e);
}

// Ensure the stable two-section shell (journal + external) exists so instant
// local matches and the debounced network results can update independently.
function ensureResultsShell() {
  if (!document.getElementById('searchExternalSection')) {
    searchResults.innerHTML =
      '<div id="searchJournalSection"></div>' +
      `<div id="searchExternalSection">${searchSectionHeader('Songs')}${renderSearchSkeleton()}</div>`;
  }
}

// Instant, synchronous — runs on every keystroke, updates only the journal block.
function renderLocalMatches(query) {
  ensureResultsShell();
  const section = document.getElementById('searchJournalSection');
  const matches = journalMatchesFor(query);
  section.innerHTML = matches.length
    ? searchSectionHeader('From your journal') + matches.map(e => searchResultCard({
        action: 'detail', id: e.id, title: e.title, artist: e.artist,
        album: e.album, cover: e.coverUrl, type: 'Song', rating: store.effectiveRating(e) || null,
      })).join('')
    : '';
  searchSelectedIdx = -1;
}

// Debounced network layer: iTunes songs + Last.fm (for popularity) + iTunes
// albums, re-ranked by match quality with popularity as the tiebreaker.
async function fetchExternalResults(query, token) {
  const merged = [];
  const seen = new Set();

  const [lastFmResults, itunesResults, albumResults] = await Promise.all([
    api.searchLastFmTracks(query),
    api.searchITunesSongs(query),
    api.searchITunesAlbums(query),
  ]);
  if (token !== searchToken) return;

  const lfmMap = {};
  lastFmResults.forEach(t => { lfmMap[`${t.artist.toLowerCase()}::${t.title.toLowerCase()}`] = t.listeners; });
  itunesResults.forEach(r => {
    const key = `${r.artist.toLowerCase()}::${r.title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ ...r, cover: r.coverUrl, listeners: lfmMap[key] || 0, type: 'Song' });
  });
  lastFmResults.forEach(t => {
    const key = `${t.artist.toLowerCase()}::${t.title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ title: t.title, artist: t.artist, album: '', cover: null, genre: '', listeners: t.listeners, type: 'Song' });
  });

  const songs = merged
    .map(r => ({ r, s: matchScore(query, { title: r.title, artist: r.artist, album: r.album }) }))
    .filter(x => x.s > 0)
    .sort((a, b) => (b.s - a.s) || ((b.r.listeners || 0) - (a.r.listeners || 0)))
    .slice(0, 10)
    .map(x => x.r);

  const albums = albumResults
    .map(a => ({ a, s: matchScore(query, { title: a.title, artist: a.artist }) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map(x => x.a);

  const section = document.getElementById('searchExternalSection');
  if (!section) return;

  let html = '';
  if (albums.length) {
    html += searchSectionHeader('Albums');
    html += albums.map(a => searchResultCard({
      action: 'album', title: a.title, artist: a.artist, cover: a.coverUrl,
      genre: a.genre, type: 'Album', collectionId: a.collectionId,
    })).join('');
  }
  if (songs.length) {
    html += searchSectionHeader('Songs');
    html += '<div id="searchSongList">' + songs.map(r => searchResultCard({
      action: 'log', title: r.title, artist: r.artist, album: r.album,
      cover: r.cover, genre: r.genre, type: r.type, listeners: r.listeners,
      itunesTrackId: r.itunesTrackId, collectionId: r.collectionId, previewUrl: r.previewUrl,
    })).join('') + '</div>';
  }
  section.innerHTML = html || '<div class="search-empty">No results found. Try a different search.</div>';
  searchSelectedIdx = -1;

  if (songs.length || albums.length) store.addRecentSearch(query);

  // Lazy cover enrichment for songs that came back without art.
  const songList = document.getElementById('searchSongList');
  if (songList) {
    songs.forEach(async (r, i) => {
      if (r.cover) return;
      const cover = await api.enrichArt(r, 'track');
      if (token !== searchToken || !cover) return;
      const el = songList.querySelectorAll('.search-result-item')[i];
      if (!el) return;
      el.dataset.cover = cover;
      const wrap = el.querySelector('.search-result-cover');
      if (wrap && !wrap.querySelector('.search-result-cover-img')) {
        wrap.insertAdjacentHTML('beforeend',
          `<img class="search-result-cover-img" src="${ui.escapeHtml(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`);
      }
    });
  }
}

// Immediate combined run (recent-chip click) — skips the input debounce.
function runSearch(query) {
  currentQuery = query;
  if (!query.trim()) { renderSearchPreState(); searchSelectedIdx = -1; return; }
  const token = ++searchToken;
  renderLocalMatches(query);
  fetchExternalResults(query, token);
}

// Fetch a searched album's tracklist and open the tracklist modal. Clicking a
// track row is already wired (album modal handler) to open the log modal.
async function openAlbumFromSearch(collectionId, fallback = {}) {
  if (!collectionId) return;
  closeSearch();
  const modal = $('albumModal');
  const header = $('albumModalHeader');
  const tracks = $('albumModalTracks');
  const titleEl = $('albumModalTitle');

  titleEl.textContent = fallback.title || 'Album';
  header.innerHTML =
    `<div class="album-modal-cover"><span class="cover-wrap">${ui.renderCoverArt({ title: fallback.title, artist: fallback.artist, coverUrl: fallback.coverUrl })}</span></div>` +
    `<div><div class="album-modal-name">${ui.escapeHtml(fallback.title || '')}</div><div class="album-modal-artist">${ui.escapeHtml(fallback.artist || '')}</div></div>`;
  tracks.innerHTML = renderSearchSkeleton();
  openModal(modal);

  const album = await api.fetchAlbumDetail(collectionId);
  if (!modal.classList.contains('active')) return;   // user closed it while loading
  if (!album) {
    tracks.innerHTML = '<div class="search-empty">Could not load this album. Try again.</div>';
    return;
  }
  titleEl.textContent = album.title || 'Album';
  const rendered = ui.renderAlbumModal(album);
  header.innerHTML = rendered.header;
  tracks.innerHTML = rendered.tracks;
}

function handleSearchKeydown(e) {
  const items = searchResults.querySelectorAll('.search-result-item:not(.search-skeleton)');
  const count = items.length;
  if (!count) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    searchSelectedIdx = (searchSelectedIdx + 1) % count;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    searchSelectedIdx = (searchSelectedIdx - 1 + count) % count;
  } else if (e.key === 'Enter' && searchSelectedIdx >= 0 && items[searchSelectedIdx]) {
    e.preventDefault();
    items[searchSelectedIdx].click();
    return;
  } else return;
  items.forEach((el, i) => el.classList.toggle('search-selected', i === searchSelectedIdx));
  if (items[searchSelectedIdx]) items[searchSelectedIdx].scrollIntoView({ block: 'nearest' });
}

// ── Import flow ─────────────────────────
const importModal = $('importModal');
let importCandidates = null;
let importRunning = false;

function resetImportModal() {
  $('importIntro').style.display = 'block';
  $('importFoundNote').style.display = 'none';
  $('importProgress').classList.remove('active');
  $('importSummary').classList.remove('active');
  $('importFileInput').value = '';
  importCandidates = null;
}

async function handleImportFile(file) {
  if (!file) return;
  const parsed = await parseExportFile(file);
  if (parsed.error) {
    ui.showToast(parsed.error, 'error');
    return;
  }
  importCandidates = parsed.capped;
  const extra = parsed.total > IMPORT_CAP
    ? ` Your ${IMPORT_CAP} most-played will be imported now (music lookups are rate-limited); run the file again later for the rest.`
    : '';
  $('importFoundText').textContent =
    `Found ${parsed.total} unique song${parsed.total !== 1 ? 's' : ''} in ${file.name}.${extra}`;
  $('importFoundNote').style.display = 'block';
}

async function startImport() {
  if (!importCandidates || importRunning) return;
  importRunning = true;
  $('importIntro').style.display = 'none';
  $('importProgress').classList.add('active');

  const summary = await runImport(importCandidates, {
    onProgress: (i, total, label) => {
      $('importProgressFill').style.width = `${Math.round(i / total * 100)}%`;
      $('importProgressLabel').textContent = i >= total
        ? 'Finishing up...'
        : `Resolving ${i + 1} of ${total}: ${label}`;
    },
  });

  importRunning = false;
  $('importProgress').classList.remove('active');
  $('importAddedNum').textContent = summary.added;
  $('importSkippedNum').textContent = summary.skipped;
  $('importFailedNum').textContent = summary.failed;
  $('importDetailList').innerHTML = summary.failures.map(f =>
    `<li>${ui.escapeHtml(f)}</li>`).join('');
  $('importSummary').classList.add('active');
  rerenderRoute();
}

// ── Bootstrap ───────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // offline signal
  const setOnlineState = () => document.body.classList.toggle('is-offline', !navigator.onLine);
  window.addEventListener('online', setOnlineState);
  window.addEventListener('offline', setOnlineState);
  setOnlineState();

  // service worker
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  updateAuthUI();
  initRouter(handleRoute);

  // ── auth events ──
  $('openLoginBtn').addEventListener('click', () => openAuthModal('login'));
  bindModalChrome(authModal, $('closeAuthModal'));
  $('authSwitchLink').addEventListener('click', (e) => {
    e.preventDefault();
    authMode = authMode === 'login' ? 'signup' : 'login';
    updateAuthModalMode();
    hideAuthError();
  });
  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();
    const username = $('authUsername').value;
    const password = $('authPassword').value;
    const result = authMode === 'signup'
      ? await store.signup(username, password)
      : await store.login(username, password);
    if (result.error) { showAuthError(result.error); return; }
    closeModal(authModal);
    updateAuthUI();
    ui.showToast(authMode === 'signup' ? `Welcome, ${result.username}!` : `Welcome back, ${result.username}!`);
    rerenderRoute();
  });

  const userDropdown = $('userDropdown');
  $('userChip').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = userDropdown.classList.toggle('active');
    $('userChip').setAttribute('aria-expanded', open);
  });
  document.addEventListener('click', (e) => {
    if (!userDropdown.contains(e.target)) {
      userDropdown.classList.remove('active');
      $('userChip').setAttribute('aria-expanded', 'false');
    }
  });
  $('logoutBtn').addEventListener('click', () => {
    store.logout();
    userDropdown.classList.remove('active');
    updateAuthUI();
    ui.showToast('Signed out.');
    navigate('');
    rerenderRoute();
  });

  // ── log modal ──
  $('openLogModal').addEventListener('click', () => openLogModal());
  $('heroLogBtn').addEventListener('click', () => openLogModal());
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('open-log-modal')) openLogModal();
  });
  bindModalChrome(logModal, $('closeLogModal'), stopPreview);
  $('cancelLog').addEventListener('click', closeLogModal);

  bindStarInput($('starRating'), () => selectedRating, (v) => setOverall(v, true));

  $('addCritBtn').addEventListener('click', () => {
    const input = $('critCustomName');
    const name = input.value.trim().toLowerCase();
    if (!name) { ui.showToast('Name the part first (e.g. lyrics).', 'error'); return; }
    if (criteria.some(c => c.name.toLowerCase() === name)) {
      ui.showToast('That part is already listed.', 'error');
      return;
    }
    criteria.push({ name, rating: 0 });
    renderCriteriaGrid();
    input.value = '';
    input.focus();
  });
  $('critCustomName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('addCritBtn').click(); }
  });

  // duplicate detection while typing
  let dupeTimer;
  const scheduleDupeCheck = () => {
    clearTimeout(dupeTimer);
    dupeTimer = setTimeout(checkForDuplicate, 350);
  };
  $('songTitle').addEventListener('input', () => { logPrefillExtras.itunesTrackId = null; scheduleDupeCheck(); });
  $('songArtist').addEventListener('input', scheduleDupeCheck);

  $('dupeUpdateBtn').addEventListener('click', () => {
    if (!dupeEntry) return;
    const target = dupeEntry;
    hideDupeNote();
    openLogModal({ ...target }, { editId: target.id });
  });
  $('dupeNewBtn').addEventListener('click', () => {
    dupeDismissed = true;
    hideDupeNote();
  });

  $('logCollectionPicker').addEventListener('click', (e) => {
    const chip = e.target.closest('.log-col-chip');
    if (!chip) return;
    const colId = chip.dataset.colId;
    if (selectedLogCollections.includes(colId)) {
      selectedLogCollections = selectedLogCollections.filter(id => id !== colId);
      chip.classList.remove('selected');
    } else {
      selectedLogCollections.push(colId);
      chip.classList.add('selected');
    }
  });

  $('logForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('songTitle').value.trim();
    const artist = $('songArtist').value.trim();
    if (!title || !artist) {
      ui.showToast('Please fill in the song title and artist.', 'error');
      return;
    }

    if (!editingId && !dupeDismissed) {
      const dupe = store.findDuplicate({
        itunesTrackId: logPrefillExtras.itunesTrackId,
        mbId: logPrefillExtras.mbId,
        title, artist,
      });
      if (dupe) {
        dupeEntry = dupe;
        $('dupeNoteText').innerHTML =
          `You logged <strong>${ui.escapeHtml(dupe.title)}</strong> on ${ui.escapeHtml(ui.formatDate(dupe.date || dupe.createdAt))}. Update it instead?`;
        $('dupeNote').classList.add('active');
        $('dupeNote').scrollIntoView({ block: 'nearest' });
        return;
      }
    }

    const ratedCriteria = criteria.filter(c => c.rating > 0);
    const entryData = {
      title, artist,
      album: $('songAlbum').value.trim(),
      genre: $('songGenre').value,
      date: $('songDate').value,
      rating: manualOverall ? selectedRating : null,
      review: $('songReview').value.trim(),
      favorite: $('songFavorite').checked,
      tags: ratedCriteria.map(c => ({ name: c.name, rating: c.rating })),
      coverUrl: logPrefillExtras.coverUrl || null,
      mbId: logPrefillExtras.mbId || null,
      releaseId: logPrefillExtras.releaseId || null,
      releaseGroupId: logPrefillExtras.releaseGroupId || null,
      itunesTrackId: logPrefillExtras.itunesTrackId || null,
      collectionId: logPrefillExtras.collectionId || null,
      previewUrl: logPrefillExtras.previewUrl || null,
    };

    let saved;
    if (editingId) {
      saved = store.updateEntry(editingId, entryData);
      ui.showToast(`"${title}" updated.`);
    } else {
      saved = store.addEntry(entryData);
      if (selectedLogCollections.length) {
        selectedLogCollections.forEach(colId => store.addSongToCollection(colId, saved.id));
      }
      const colMsg = selectedLogCollections.length
        ? ` and added to ${selectedLogCollections.length} collection${selectedLogCollections.length > 1 ? 's' : ''}`
        : '';
      ui.showToast(`"${title}" added to your journal${colMsg}!`);
    }
    closeLogModal();
    rerenderRoute();
  });

  // autocomplete (iTunes) on title + artist
  const coverThumb = (url) => url
    ? `<img class="suggestion-cover" src="${ui.escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`
    : '<div class="suggestion-cover"></div>';

  const applyGenre = (genre, { onlyIfEmpty = false } = {}) => {
    if (!genre) return;
    const sel = $('songGenre');
    if (onlyIfEmpty && sel.value) return;
    const matched = Array.from(sel.options).find(o => o.value && genre.includes(o.value));
    if (matched) sel.value = matched.value;
  };

  // Each field wires the same dropdown mechanics to a different search source,
  // result template, and fill behavior.
  const AUTOCOMPLETE = {
    song: {
      search: (q) => api.searchITunesSongs(q),
      render: (s, i) => `
        <div class="suggestion-item" data-index="${i}">
          ${coverThumb(s.coverUrl)}
          <div class="suggestion-info">
            <div class="suggestion-title">${ui.escapeHtml(s.title)}</div>
            <div class="suggestion-meta">${ui.escapeHtml(s.artist)}${s.album ? ' &middot; ' + ui.escapeHtml(s.album) : ''}</div>
          </div>
        </div>`,
      select: (data) => {
        $('songTitle').value = data.title || '';
        $('songArtist').value = data.artist || '';
        $('songAlbum').value = data.album || '';
        applyGenre(data.genre);
        logPrefillExtras.coverUrl = data.coverUrl || logPrefillExtras.coverUrl;
        logPrefillExtras.itunesTrackId = data.itunesTrackId || null;
        logPrefillExtras.collectionId = data.collectionId || null;
        logPrefillExtras.previewUrl = data.previewUrl || null;
      },
    },
    artist: {
      search: (q) => api.searchITunesArtists(q, 6),
      render: (a, i) => `
        <div class="suggestion-item" data-index="${i}">
          <div class="suggestion-cover suggestion-cover-icon" aria-hidden="true">&#9835;</div>
          <div class="suggestion-info">
            <div class="suggestion-title">${ui.escapeHtml(a.name)}</div>
            <div class="suggestion-meta">${a.genre ? ui.escapeHtml(a.genre) : 'Artist'}</div>
          </div>
        </div>`,
      // iTunes has no artist artwork, so pull each artist's newest-album cover
      // in the background and swap it in for the placeholder icon as it lands.
      enrich: (container, results, isCurrent) => {
        results.forEach(async (a, i) => {
          if (!a.artistId) return;
          const url = await api.getArtistArtwork(a.artistId);
          if (!url || !isCurrent()) return;
          const slot = container.querySelectorAll('.suggestion-item')[i]?.querySelector('.suggestion-cover');
          if (slot) {
            slot.outerHTML = `<img class="suggestion-cover" src="${ui.escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`;
          }
        });
      },
      select: (data) => {
        $('songArtist').value = data.name || '';
        applyGenre(data.genre, { onlyIfEmpty: true });
      },
    },
    album: {
      search: (q) => api.searchITunesAlbums(q, 8),
      render: (al, i) => `
        <div class="suggestion-item" data-index="${i}">
          ${coverThumb(al.coverUrl)}
          <div class="suggestion-info">
            <div class="suggestion-title">${ui.escapeHtml(al.title)}</div>
            <div class="suggestion-meta">${ui.escapeHtml(al.artist)}${al.trackCount ? ' &middot; ' + al.trackCount + ' tracks' : ''}</div>
          </div>
        </div>`,
      select: (data) => {
        $('songAlbum').value = data.title || '';
        if (data.artist) $('songArtist').value = data.artist;
        applyGenre(data.genre, { onlyIfEmpty: true });
        logPrefillExtras.coverUrl = data.coverUrl || logPrefillExtras.coverUrl;
        logPrefillExtras.collectionId = data.collectionId || null;
      },
    },
  };

  const bindAutocomplete = (input, container, cfg) => {
    let token = 0, timer;
    input.addEventListener('input', () => {
      const q = input.value;
      clearTimeout(timer);
      if (q.trim().length < 2) { container.classList.remove('active'); return; }
      timer = setTimeout(async () => {
        const myToken = ++token;
        const results = await cfg.search(q);
        if (myToken !== token) return;
        if (!results.length) { container.classList.remove('active'); container.innerHTML = ''; return; }
        container.innerHTML = results.map((r, i) => cfg.render(r, i)).join('');
        container._items = results;
        container.classList.add('active');
        if (cfg.enrich) cfg.enrich(container, results, () => myToken === token);
      }, 280);
    });
    input.addEventListener('focus', () => { if (container.innerHTML) container.classList.add('active'); });
    input.addEventListener('blur', () => setTimeout(() => container.classList.remove('active'), 150));
    container.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.suggestion-item');
      if (!item) return;
      e.preventDefault();
      const data = container._items && container._items[parseInt(item.dataset.index, 10)];
      if (!data) return;
      cfg.select(data);
      container.classList.remove('active');
      checkForDuplicate();
    });
  };
  bindAutocomplete($('songTitle'), $('titleSuggestions'), AUTOCOMPLETE.song);
  bindAutocomplete($('songArtist'), $('artistSuggestions'), AUTOCOMPLETE.artist);
  bindAutocomplete($('songAlbum'), $('albumSuggestions'), AUTOCOMPLETE.album);

  // ── search overlay ──
  $('navSearchBtn').addEventListener('click', openSearch);
  searchOverlay.addEventListener('click', (e) => { if (e.target === searchOverlay) closeSearch(); });
  let searchDebounce;
  searchInput.addEventListener('input', (e) => {
    const q = e.target.value;
    currentQuery = q;
    searchSelectedIdx = -1;
    clearTimeout(searchDebounce);
    if (!q.trim()) { renderSearchPreState(); return; }
    const token = ++searchToken;      // invalidate any in-flight external fetch
    renderLocalMatches(q);            // instant journal matches
    searchDebounce = setTimeout(() => fetchExternalResults(q, token), 300);
  });
  searchInput.addEventListener('keydown', handleSearchKeydown);
  searchResults.addEventListener('click', (e) => {
    // Clear recent-search history.
    if (e.target.closest('[data-clear-recent]')) {
      store.clearRecentSearches();
      renderSearchPreState();
      searchInput.focus();
      return;
    }
    // Remove one recent search.
    const rem = e.target.closest('[data-remove-recent]');
    if (rem) {
      store.removeRecentSearch(rem.dataset.removeRecent);
      renderSearchPreState();
      searchInput.focus();
      return;
    }
    // Recent-search chip: replay that query immediately.
    const chip = e.target.closest('.search-recent-chip-label');
    if (chip) {
      searchInput.value = chip.dataset.recent;
      searchInput.focus();
      runSearch(chip.dataset.recent);
      return;
    }
    // Hide one entry from the "Recently logged" shortcut (journal untouched).
    const dismiss = e.target.closest('[data-dismiss-logged]');
    if (dismiss) {
      store.dismissRecentLogged(dismiss.dataset.dismissLogged);
      renderSearchPreState();
      searchInput.focus();
      return;
    }
    const item = e.target.closest('.search-result-item');
    if (!item || item.classList.contains('search-skeleton')) return;
    if (item.dataset.action === 'detail') {
      closeSearch();
      navigate(`song/${item.dataset.id}`);
    } else if (item.dataset.action === 'album') {
      openAlbumFromSearch(item.dataset.cid, {
        title: item.dataset.title, artist: item.dataset.artist, coverUrl: item.dataset.cover || null,
      });
    } else {
      closeSearch();
      openLogModal({
        title: item.dataset.title,
        artist: item.dataset.artist,
        album: item.dataset.album,
        genre: item.dataset.genre,
        coverUrl: item.dataset.cover || null,
        itunesTrackId: item.dataset.tid || null,
        collectionId: item.dataset.cid || null,
        previewUrl: item.dataset.preview || null,
      });
    }
  });

  // ── global keyboard ──
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (searchOverlay.classList.contains('active')) closeSearch();
      else document.querySelectorAll('.modal-overlay.active').forEach(m => closeModal(m));
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchOverlay.classList.contains('active') ? closeSearch() : openSearch();
    }
  });

  // ── previews: the spinning disc ──
  document.addEventListener('click', async (e) => {
    const disc = e.target.closest('.disc-btn');
    if (!disc || disc.dataset.resolving) return;
    e.preventDefault();
    const key = disc.dataset.previewKey;
    let url = disc.dataset.previewUrl;

    // No stored preview? Look one up from iTunes, then cache it on the entry.
    if (!url) {
      disc.dataset.resolving = '1';
      disc.classList.add('resolving');
      url = await api.resolvePreviewUrl({
        trackId: disc.dataset.previewTid,
        title: disc.dataset.previewTitle,
        artist: disc.dataset.previewArtist,
      });
      disc.classList.remove('resolving');
      delete disc.dataset.resolving;
      if (!url) {
        ui.showToast('No 30-second preview exists for this track.', 'error');
        return;
      }
      disc.dataset.previewUrl = url;
      if (store.getEntry(key)) store.updateEntry(key, { previewUrl: url });
    }

    togglePreview(key, url, {
      onError: () => ui.showToast('Preview unavailable for this track.', 'error'),
    });
  });
  document.addEventListener('musicbox:preview', (e) => {
    document.querySelectorAll('.disc-btn.playing').forEach(b => b.classList.remove('playing'));
    if (e.detail.state === 'playing') {
      document.querySelectorAll(`[data-preview-key="${CSS.escape(e.detail.key)}"]`)
        .forEach(b => b.classList.add('playing'));
    }
  });

  // ── card navigation (ignore clicks on interactive children) ──
  const interactiveChild = (e) =>
    e.target.closest('.disc-btn, button, a, input, select');

  document.addEventListener('click', (e) => {
    if (interactiveChild(e)) return;
    const card = e.target.closest('.song-card, .journal-card, .collection-song-row');
    if (card && card.dataset.id) { navigate(`song/${card.dataset.id}`); return; }
    const col = e.target.closest('.collection-card');
    if (col && col.dataset.collectionId) navigate(`collection/${col.dataset.collectionId}`);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const card = e.target.closest('.song-card, .journal-card, .collection-song-row, .collection-card');
    if (card) card.click();
  });

  // on-this-day entries
  document.addEventListener('click', (e) => {
    const otd = e.target.closest('.otd-entry');
    if (otd && otd.dataset.id) navigate(`song/${otd.dataset.id}`);
  });

  // surprise me
  const surprise = () => {
    if (!requireLogin('Sign in to rediscover songs from your journal.')) return;
    const pick = store.surprisePick();
    if (!pick) { ui.showToast('Log some songs first, then I can surprise you.', 'error'); return; }
    navigate(`song/${pick.id}`);
    ui.showToast('From the shelf: a song worth revisiting.');
  };
  $('homeSurpriseBtn').addEventListener('click', surprise);
  $('journalSurpriseBtn').addEventListener('click', surprise);

  // ── discover tabs + retry ──
  $('trendingTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.discover-tab');
    if (!tab || tab.dataset.range === ui.discoverState.trendingRange) return;
    ui.discoverState.trendingRange = tab.dataset.range;
    document.querySelectorAll('#trendingTabs .discover-tab').forEach(t =>
      t.classList.toggle('active', t === tab));
    ui.renderTrendingNow();
  });
  $('chartsTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.discover-tab');
    if (!tab || tab.dataset.region === ui.discoverState.chartRegion) return;
    ui.discoverState.chartRegion = tab.dataset.region;
    document.querySelectorAll('#chartsTabs .discover-tab').forEach(t =>
      t.classList.toggle('active', t === tab));
    ui.renderTopCharts();
  });
  document.addEventListener('click', (e) => {
    const retry = e.target.closest('[data-retry]');
    if (!retry) return;
    if (retry.dataset.retry === 'trending') ui.renderTrendingNow();
    if (retry.dataset.retry === 'charts') ui.renderTopCharts();
  });

  // chart rows → log modal
  document.addEventListener('click', (e) => {
    if (interactiveChild(e) && !e.target.closest('.chart-log-btn')) return;
    const row = e.target.closest('.chart-row');
    if (!row || row.classList.contains('chart-skeleton')) return;
    openLogModal({
      title: row.dataset.title || '',
      artist: row.dataset.artist || '',
      album: row.dataset.album || '',
      genre: row.dataset.genre || '',
      coverUrl: row.dataset.cover || null,
    });
  });

  // ── journal filters / sort / paging ──
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ui.renderJournal(btn.dataset.filter, $('sortSelect').value);
    });
  });
  $('sortSelect').addEventListener('change', (e) => {
    ui.renderJournal(currentJournalFilter(), e.target.value);
  });
  document.addEventListener('click', (e) => {
    if (e.target.id === 'journalMoreBtn') {
      ui.bumpJournalPaging();
      ui.renderJournal(currentJournalFilter(), $('sortSelect').value, { keepPaging: true });
    }
  });

  // ── collections ──
  const createCollectionModal = $('createCollectionModal');
  const openCreateCollectionModal = () => {
    if (!requireLogin('You need an account to create collections.')) return;
    openModal(createCollectionModal);
    $('createCollectionForm').reset();
    setTimeout(() => $('collectionName').focus(), 80);
  };
  $('openCreateCollection').addEventListener('click', openCreateCollectionModal);
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('js-create-collection')) openCreateCollectionModal();
  });
  bindModalChrome(createCollectionModal, $('closeCreateCollectionModal'));
  $('cancelCreateCollection').addEventListener('click', () => closeModal(createCollectionModal));
  $('createCollectionForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('collectionName').value.trim();
    if (!name) return;
    store.createCollection(name, $('collectionDesc').value.trim());
    closeModal(createCollectionModal);
    ui.showToast(`Collection "${name}" created!`);
    ui.renderCollections();
  });

  document.addEventListener('click', (e) => {
    const del = e.target.closest('#deleteCollectionBtn');
    if (del) {
      if (confirm('Delete this collection? Songs stay in your journal.')) {
        store.deleteCollection(del.dataset.id);
        ui.showToast('Collection deleted.');
        navigate('journal/collections');
      }
      return;
    }
    const remove = e.target.closest('.collection-song-remove');
    if (remove) {
      store.removeSongFromCollection(remove.dataset.collectionId, remove.dataset.songId);
      ui.renderCollectionDetail(remove.dataset.collectionId);
      ui.showToast('Song removed from collection.');
    }
  });

  // detail page actions
  document.addEventListener('click', (e) => {
    const edit = e.target.closest('#detailEdit');
    if (edit) {
      const entry = store.getEntry(edit.dataset.id);
      if (entry) openLogModal({ ...entry }, { editId: entry.id });
      return;
    }
    const addTo = e.target.closest('#detailAddToCollection');
    if (addTo) { openAddToCollectionModal(addTo.dataset.id); return; }
    const del = e.target.closest('#detailDelete');
    if (del && confirm('Delete this entry from your journal?')) {
      store.deleteEntry(del.dataset.id);
      ui.showToast('Entry deleted.');
      goBack('journal');
    }
  });

  // add-to-collection modal
  const addToCollectionModal = $('addToCollectionModal');
  bindModalChrome(addToCollectionModal, $('closeAddToCollectionModal'));
  function openAddToCollectionModal(songId) {
    const list = $('addToCollectionList');
    const collections = store.getCollections();
    list.innerHTML = collections.length
      ? collections.map(col => {
          const inCol = col.songIds.includes(songId);
          return `
            <div class="add-to-collection-item ${inCol ? 'in-collection' : ''}"
              data-collection-id="${col.id}" data-song-id="${songId}" role="button" tabindex="0">
              <div class="add-to-collection-item-check" aria-hidden="true">&check;</div>
              <div class="add-to-collection-item-name">${ui.escapeHtml(col.name)}</div>
              <div class="add-to-collection-item-count">${col.songIds.length} song${col.songIds.length !== 1 ? 's' : ''}</div>
            </div>
          `;
        }).join('')
      : '<p class="muted" style="padding:8px;">No collections yet. Create one from the Journal page first.</p>';
    openModal(addToCollectionModal);
  }
  $('addToCollectionList').addEventListener('click', (e) => {
    const item = e.target.closest('.add-to-collection-item');
    if (!item) return;
    const colId = item.dataset.collectionId;
    const songId = item.dataset.songId;
    const col = store.getCollection(colId);
    if (item.classList.contains('in-collection')) {
      store.removeSongFromCollection(colId, songId);
      item.classList.remove('in-collection');
      ui.showToast('Removed from collection.');
    } else if (store.addSongToCollection(colId, songId)) {
      item.classList.add('in-collection');
      ui.showToast('Added to collection!');
    }
    const fresh = store.getCollection(colId);
    const countEl = item.querySelector('.add-to-collection-item-count');
    if (countEl && fresh) countEl.textContent = `${fresh.songIds.length} song${fresh.songIds.length !== 1 ? 's' : ''}`;
  });

  // ── backup export / restore ──
  $('exportBackupBtn').addEventListener('click', () => {
    if (!requireLogin('Sign in to export your journal.')) return;
    const data = store.exportBackup();
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `musicbox-backup-${data.user}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    ui.showToast('Backup downloaded. Keep it somewhere safe.');
  });
  $('restoreBackupBtn').addEventListener('click', () => {
    if (!requireLogin('Sign in to restore a backup.')) return;
    $('backupFileInput').click();
  });
  $('backupFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const result = store.restoreBackup(data);
      if (result.error) { ui.showToast(result.error, 'error'); return; }
      ui.showToast(`Restored ${result.added} entr${result.added === 1 ? 'y' : 'ies'} (${result.skipped} already present).`);
      rerenderRoute();
    } catch {
      ui.showToast('That file could not be read as a backup.', 'error');
    }
  });

  // ── streaming import ──
  $('openImportBtn').addEventListener('click', () => {
    if (!requireLogin('Sign in to import your streaming history.')) return;
    resetImportModal();
    openModal(importModal);
  });
  bindModalChrome(importModal, $('closeImportModal'));
  $('importPickBtn').addEventListener('click', () => $('importFileInput').click());
  $('importFileInput').addEventListener('change', (e) => handleImportFile(e.target.files[0]));
  const drop = $('importDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    handleImportFile(e.dataTransfer.files[0]);
  });
  $('importStartBtn').addEventListener('click', startImport);
  $('importCancelBtn').addEventListener('click', resetImportModal);
  $('importDoneBtn').addEventListener('click', () => { closeModal(importModal); resetImportModal(); });

  // ── album modal ──
  const albumModal = $('albumModal');
  bindModalChrome(albumModal, $('closeAlbumModal'));
  document.addEventListener('click', (e) => {
    const trackRow = e.target.closest('.album-track-row');
    if (!trackRow) return;
    closeModal(albumModal);
    openLogModal({
      title: trackRow.dataset.title,
      artist: trackRow.dataset.artist,
      album: trackRow.dataset.album,
      coverUrl: trackRow.dataset.cover || null,
      itunesTrackId: trackRow.dataset.tid || null,
      previewUrl: trackRow.dataset.preview || null,
    });
  });

  // ── recap ──
  $('generateRecapBtn').addEventListener('click', async () => {
    if (!requireLogin('Sign in to build your recap.')) return;
    const period = $('recapPeriod').value;
    const result = await renderRecap($('recapCanvas'), period);
    if (result.error) { ui.showToast(result.error, 'error'); return; }
    $('recapPreviewBlock').style.display = 'block';
    $('downloadRecapBtn').style.display = 'inline-flex';
    $('recapPreviewBlock').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('downloadRecapBtn').addEventListener('click', () => {
    downloadRecap($('recapCanvas'), $('recapPeriod').value);
  });
});
