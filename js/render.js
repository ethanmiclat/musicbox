/* MusicBox — render: every template and page renderer. */

import {
  getJournal, getCollections, getCollection, effectiveRating, onThisDay, parseDate,
} from './storage.js';
import {
  getLastFmTopTracks, getListenBrainzTrending, enrichArt, formatListenCount,
} from './api.js';

// ── Utilities ───────────────────────────
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = parseDate(dateStr);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatRating(r) {
  if (!r) return '-';
  return Number.isInteger(r) ? r.toFixed(1) : r.toString();
}

export function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

function hashStr(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function coverHue(title, artist) {
  return hashStr((title || '') + (artist || '')) % 360;
}

export function renderCoverArt(item) {
  const hue = coverHue(item.title, item.artist);
  const img = item.coverUrl
    ? `<img class="cover-img" src="${escapeHtml(item.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.classList.add('cover-img-failed')">`
    : '';
  return `
    <div class="cover-gradient" style="background: linear-gradient(135deg, hsl(${hue}, 32%, 26%) 0%, hsl(${hue + 40}, 28%, 17%) 100%);"></div>
    <span class="cover-icon" aria-hidden="true">&#9835;</span>
    ${img}
  `;
}

export function renderStars(rating) {
  const r = Number(rating) || 0;
  let html = '<span class="stars-display">';
  for (let i = 1; i <= 5; i++) {
    let pct = 0;
    if (r >= i) pct = 100;
    else if (r >= i - 0.5) pct = 50;
    html += `<span class="star-box"><span class="sb-bg">&#9733;</span><span class="sb-fg" style="width:${pct}%">&#9733;</span></span>`;
  }
  return html + '</span>';
}

// Always rendered. If we don't already have a previewUrl we carry the
// track id / title / artist so the click handler can resolve one from
// iTunes on demand and cache it back onto the entry.
function discButton(entry, size = '') {
  const attrs = [
    `class="disc-btn ${size}"`,
    `data-preview-key="${entry.id}"`,
    entry.previewUrl ? `data-preview-url="${escapeHtml(entry.previewUrl)}"` : '',
    entry.itunesTrackId ? `data-preview-tid="${escapeHtml(String(entry.itunesTrackId))}"` : '',
    `data-preview-title="${escapeHtml(entry.title)}"`,
    `data-preview-artist="${escapeHtml(entry.artist)}"`,
  ].filter(Boolean).join(' ');
  return `<button type="button" ${attrs}
    aria-label="Play 30 second preview of ${escapeHtml(entry.title)}"></button>`;
}

// ── Song cards (home shelves) ───────────
export function renderSongCard(entry) {
  const rating = effectiveRating(entry);
  return `
    <div class="song-card" data-id="${entry.id}" role="link" tabindex="0"
      aria-label="${escapeHtml(entry.title)} by ${escapeHtml(entry.artist)}">
      <div class="song-card-cover">
        <div class="cover-wrap">${renderCoverArt(entry)}</div>
        ${entry.favorite ? '<span class="song-card-favorite" aria-hidden="true">&hearts;</span>' : ''}
      </div>
      <div class="song-card-title">${escapeHtml(entry.title)}</div>
      <div class="song-card-artist">${escapeHtml(entry.artist)}</div>
      <div class="song-card-stars">${renderStars(rating)}</div>
    </div>
  `;
}

// ── Journal record-card rows ────────────
export function renderJournalCard(entry) {
  const rating = effectiveRating(entry);
  const catalogBits = [formatDate(entry.date || entry.createdAt)];
  if (entry.genre) catalogBits.push(entry.genre);
  return `
    <div class="journal-card" data-id="${entry.id}" role="link" tabindex="0"
      aria-label="${escapeHtml(entry.title)} by ${escapeHtml(entry.artist)}, rated ${formatRating(rating)}">
      <div class="journal-card-cover"><div class="cover-wrap">${renderCoverArt(entry)}</div></div>
      <div class="journal-card-main">
        <div class="journal-card-catalog">${catalogBits.map(escapeHtml).join(' &middot; ')}</div>
        <div class="journal-card-title">${escapeHtml(entry.title)} ${entry.favorite ? '<span class="fav" aria-hidden="true">&hearts;</span>' : ''}</div>
        <div class="journal-card-artist">${escapeHtml(entry.artist)}</div>
      </div>
      <div class="journal-card-side">
        <div class="journal-card-rating">
          ${renderStars(rating)}
          <div class="journal-card-ratingnum">${formatRating(rating)} / 5</div>
        </div>
        ${discButton(entry)}
      </div>
    </div>
  `;
}

// ── Empty & error states ────────────────
export function emptyState({ title, body, cta, ctaClass = 'open-log-modal' }) {
  return `
    <div class="empty-state">
      <div class="sleeve-disc" aria-hidden="true"></div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
      ${cta ? `<button class="btn btn-primary ${ctaClass}">${escapeHtml(cta)}</button>` : ''}
    </div>
  `;
}

export function errorState(sectionKey, message) {
  return `
    <div class="error-state">
      <span class="mono">couldn't load</span>
      <p>${escapeHtml(message)}</p>
      <button class="btn btn-ghost btn-sm" data-retry="${sectionKey}">Try again</button>
    </div>
  `;
}

// ── Home ────────────────────────────────
export function renderHome() {
  const entries = getJournal();

  document.getElementById('totalLogged').textContent = entries.length;
  document.getElementById('totalReviews').textContent = entries.filter(e => e.review).length;
  if (entries.length > 0) {
    const avg = entries.reduce((s, e) => s + effectiveRating(e), 0) / entries.length;
    document.getElementById('avgRating').textContent = avg.toFixed(1);
  } else {
    document.getElementById('avgRating').textContent = '-';
  }

  // hero shelf: last three covers as leaned record sleeves
  const shelf = document.getElementById('heroShelf');
  const withCovers = entries.filter(e => e.coverUrl).slice(0, 3);
  shelf.innerHTML = [0, 1, 2].map(i => {
    const e = withCovers[i];
    const inner = e
      ? `<img src="${escapeHtml(e.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
      : '<div class="sleeve-blank"><div class="sleeve-disc"></div></div>';
    return `<div class="shelf-sleeve shelf-sleeve-${i + 1}">${inner}</div>`;
  }).join('');

  // on this day
  const otdSection = document.getElementById('otdSection');
  const otdCard = document.getElementById('otdCard');
  const matches = onThisDay();
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  otdSection.style.display = 'block';
  if (matches.length) {
    otdCard.innerHTML = `
      <span class="otd-date">on this day</span>
      <div class="otd-body">
        <div class="otd-title">You've been here before.</div>
        <div class="otd-sub">Songs you logged on ${escapeHtml(today)} in another month or year:</div>
        <div class="otd-entries">
          ${matches.slice(0, 4).map(e => `
            <button type="button" class="otd-entry" data-id="${e.id}">
              <span class="otd-entry-cover"><span class="cover-wrap">${renderCoverArt(e)}</span></span>
              <span>
                <span class="otd-entry-title">${escapeHtml(e.title)}</span><br>
                <span class="otd-entry-meta">${escapeHtml(formatDate(e.date || e.createdAt))}</span>
              </span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  } else {
    otdCard.innerHTML = `
      <span class="otd-date">on this day</span>
      <div class="otd-body">
        <div class="otd-title">Nothing logged on ${escapeHtml(today)} yet.</div>
        <div class="otd-sub">Log something today and it'll greet you here next year.</div>
      </div>
    `;
  }

  // recent shelf
  const recentGrid = document.getElementById('recentGrid');
  if (entries.length === 0) {
    recentGrid.innerHTML = emptyState({
      title: 'No songs logged yet',
      body: 'Start building your music journal by logging your first song.',
      cta: 'Log your first song',
    });
  } else {
    recentGrid.innerHTML = entries.slice(0, 8).map(renderSongCard).join('');
  }

  // top rated
  const topRated = [...entries]
    .filter(e => effectiveRating(e) >= 4)
    .sort((a, b) => effectiveRating(b) - effectiveRating(a))
    .slice(0, 6);
  const topSection = document.getElementById('topRatedSection');
  if (topRated.length > 0) {
    topSection.style.display = 'block';
    document.getElementById('topRatedGrid').innerHTML = topRated.map(renderSongCard).join('');
  } else {
    topSection.style.display = 'none';
  }
}

// ── Journal ─────────────────────────────
const PAGE_SIZE = 40;
let journalShown = PAGE_SIZE;

export function resetJournalPaging() { journalShown = PAGE_SIZE; }

export function renderJournal(filter = 'all', sort = 'date-desc', { keepPaging = false } = {}) {
  if (!keepPaging) journalShown = PAGE_SIZE;
  let entries = getJournal();
  const list = document.getElementById('journalList');

  if (filter !== 'all') {
    const min = parseInt(filter, 10);
    entries = entries.filter(e => effectiveRating(e) >= min);
  }

  switch (sort) {
    case 'date-asc': entries.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); break;
    case 'date-desc': entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); break;
    case 'rating-desc': entries.sort((a, b) => effectiveRating(b) - effectiveRating(a)); break;
    case 'rating-asc': entries.sort((a, b) => effectiveRating(a) - effectiveRating(b)); break;
    case 'title-asc': entries.sort((a, b) => a.title.localeCompare(b.title)); break;
  }

  if (entries.length === 0) {
    list.innerHTML = emptyState({
      title: filter === 'all' ? 'Your journal is empty' : 'No songs match this filter',
      body: filter === 'all' ? 'Log songs to see them appear here.' : 'Try a different filter.',
      cta: filter === 'all' ? 'Log a song' : null,
    });
    return;
  }

  const visible = entries.slice(0, journalShown);
  let html = visible.map(renderJournalCard).join('');
  if (entries.length > journalShown) {
    html += `<button class="btn btn-quiet" id="journalMoreBtn" style="align-self:center;">
      Show more (${entries.length - journalShown} left)</button>`;
  }
  list.innerHTML = html;
}

export function bumpJournalPaging() { journalShown += PAGE_SIZE; }

// ── Collections ─────────────────────────
export function renderCollections() {
  const grid = document.getElementById('collectionsGrid');
  const collections = getCollections();
  const journal = getJournal();

  if (!collections.length) {
    grid.innerHTML = emptyState({
      title: 'No collections yet',
      body: 'Create a collection to group your logged songs together.',
      cta: 'Create your first collection',
      ctaClass: 'js-create-collection',
    });
    return;
  }

  grid.innerHTML = collections.map(col => {
    const songs = col.songIds.map(id => journal.find(e => e.id === id)).filter(Boolean);
    const cells = Array.from({ length: 4 }).map((_, i) => {
      const s = songs[i];
      if (s) return `<div class="collection-card-cover-cell"><span class="cover-wrap">${renderCoverArt(s)}</span></div>`;
      return `<div class="collection-card-cover-cell"><div class="cover-gradient" style="background: linear-gradient(135deg, var(--ink-800), var(--ink-900));"></div></div>`;
    }).join('');
    return `
      <div class="collection-card" data-collection-id="${col.id}" role="link" tabindex="0"
        aria-label="Collection ${escapeHtml(col.name)}, ${songs.length} songs">
        <div class="collection-card-covers">${cells}</div>
        <div class="collection-card-name">${escapeHtml(col.name)}</div>
        <div class="collection-card-meta">${songs.length} song${songs.length !== 1 ? 's' : ''}${col.description ? ' &middot; ' + escapeHtml(col.description) : ''}</div>
      </div>
    `;
  }).join('');
}

export function renderCollectionDetail(collectionId) {
  const col = getCollection(collectionId);
  const view = document.getElementById('collectionDetailView');
  if (!view) return;
  if (!col) {
    view.innerHTML = emptyState({ title: 'Collection not found', body: 'It may have been deleted.' });
    return;
  }
  const journal = getJournal();
  const songs = col.songIds.map(id => journal.find(e => e.id === id)).filter(Boolean);

  let html = `
    <a class="back-link" href="#/journal/collections">&larr; All collections</a>
    <div class="collection-detail-header">
      <div>
        <h1 class="collection-detail-name" data-page-heading tabindex="-1">${escapeHtml(col.name)}</h1>
        ${col.description ? `<div class="collection-detail-desc">${escapeHtml(col.description)}</div>` : ''}
        <div class="collection-detail-count">${songs.length} song${songs.length !== 1 ? 's' : ''}</div>
      </div>
      <button class="btn btn-danger btn-sm" id="deleteCollectionBtn" data-id="${col.id}">Delete collection</button>
    </div>
  `;

  if (!songs.length) {
    html += emptyState({
      title: 'No songs in this collection',
      body: 'Open a song from your journal and add it to this collection.',
    });
  } else {
    html += songs.map((entry, i) => `
      <div class="collection-song-row" data-id="${entry.id}" role="link" tabindex="0">
        <div class="collection-song-num">${i + 1}</div>
        <div class="collection-song-cover"><span class="cover-wrap">${renderCoverArt(entry)}</span></div>
        <div>
          <div class="collection-song-title">${escapeHtml(entry.title)}</div>
          <div class="collection-song-artist">${escapeHtml(entry.artist)}</div>
        </div>
        ${renderStars(effectiveRating(entry))}
        <button class="collection-song-remove" data-song-id="${entry.id}" data-collection-id="${col.id}" type="button">Remove</button>
      </div>
    `).join('');
  }
  view.innerHTML = html;
}

// ── Discover ────────────────────────────
export const discoverState = {
  trendingRange: 'week',
  chartRegion: 'global',
  topSongsCache: [],
  trendingArtistsCache: [],
};

const SKELETON_ROWS = 10;
function skeletonRows(n = SKELETON_ROWS) {
  return Array.from({ length: n }).map(() => `
    <div class="chart-row chart-skeleton" aria-hidden="true">
      <div class="skeleton-rank"></div>
      <div class="skeleton-cover"></div>
      <div class="skeleton-info">
        <div class="skeleton-line skeleton-line-title"></div>
        <div class="skeleton-line skeleton-line-sub"></div>
      </div>
    </div>
  `).join('');
}

export function renderDiscover() {
  renderTrendingNow();
  renderTopCharts();
}

export async function renderTrendingNow() {
  const el = document.getElementById('trendingList');
  if (!el) return;
  const range = discoverState.trendingRange;

  const paint = (artists) => {
    if (range !== discoverState.trendingRange) return;
    discoverState.trendingArtistsCache = artists;
    el.innerHTML = artists.map((a, i) => trendingRow(a, i + 1)).join('');
    artists.forEach(async (a, i) => {
      const cover = await enrichArt(a, 'artist');
      if (range !== discoverState.trendingRange || !cover) return;
      const wrap = el.querySelector(`[data-trend-idx="${i}"] .chart-cover`);
      if (wrap && !wrap.querySelector('img')) {
        wrap.insertAdjacentHTML('beforeend',
          `<img class="cover-img" src="${escapeHtml(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">`);
      }
    });
  };

  el.innerHTML = skeletonRows();
  try {
    const artists = await getListenBrainzTrending(range, paint);
    if (range !== discoverState.trendingRange) return;
    if (!artists || !artists.length) throw new Error('empty');
    paint(artists);
  } catch {
    if (range !== discoverState.trendingRange) return;
    el.innerHTML = errorState('trending', navigator.onLine
      ? 'Trending artists are unavailable right now.'
      : 'You are offline and this chart was never cached.');
  }
}

function trendingRow(artist, rank) {
  const item = { title: artist.name, artist: artist.name };
  return `
    <div class="chart-row" data-trend-idx="${rank - 1}"
      data-title="" data-artist="${escapeHtml(artist.name)}" data-album="" data-genre="">
      <div class="chart-rank">${rank}</div>
      <div class="chart-cover"><span class="cover-wrap">${renderCoverArt(item)}</span></div>
      <div class="chart-info">
        <div class="chart-title">${escapeHtml(artist.name)}</div>
        <div class="chart-artist">${formatListenCount(artist.listenCount)} listens</div>
      </div>
      <span></span>
      <button class="chart-log-btn" type="button">+ Log</button>
    </div>
  `;
}

export async function renderTopCharts() {
  const el = document.getElementById('chartsList');
  if (!el) return;
  const region = discoverState.chartRegion;

  const paint = (tracks) => {
    if (region !== discoverState.chartRegion) return;
    discoverState.topSongsCache = tracks;
    el.innerHTML = tracks.map((t, i) => lastFmRow(t, i + 1)).join('');
    tracks.forEach(async (t, i) => {
      if (t.coverUrl) return;
      const cover = await enrichArt(t, 'track');
      if (region !== discoverState.chartRegion || !cover) return;
      t.coverUrl = cover;
      const row = el.querySelector(`[data-chart-idx="${i}"]`);
      if (!row) return;
      row.dataset.cover = cover;
      const wrap = row.querySelector('.chart-cover');
      if (wrap && !wrap.querySelector('img')) {
        wrap.insertAdjacentHTML('beforeend',
          `<img class="cover-img" src="${escapeHtml(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">`);
      }
    });
  };

  el.innerHTML = skeletonRows();
  try {
    const tracks = await getLastFmTopTracks(region, paint);
    if (region !== discoverState.chartRegion) return;
    if (!tracks || !tracks.length) throw new Error('empty');
    paint(tracks);
  } catch {
    if (region !== discoverState.chartRegion) return;
    el.innerHTML = errorState('charts', navigator.onLine
      ? 'The chart is unavailable right now.'
      : 'You are offline and this chart was never cached.');
  }
}

function lastFmRow(t, rank) {
  return `
    <div class="chart-row" data-chart-idx="${rank - 1}"
      data-title="${escapeHtml(t.title)}" data-artist="${escapeHtml(t.artist)}"
      data-album="" data-genre=""
      ${t.coverUrl ? `data-cover="${escapeHtml(t.coverUrl)}"` : ''}>
      <div class="chart-rank">${rank}</div>
      <div class="chart-cover"><span class="cover-wrap">${renderCoverArt(t)}</span></div>
      <div class="chart-info">
        <div class="chart-title">${escapeHtml(t.title)}</div>
        <div class="chart-artist">${escapeHtml(t.artist)}</div>
      </div>
      <div class="chart-genre">${t.listeners ? formatListenCount(t.listeners) + ' listeners' : ''}</div>
      <button class="chart-log-btn" type="button">+ Log</button>
    </div>
  `;
}

// ── Album tracklist modal ───────────────
function formatTrackTime(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Builds the header + tracklist markup for #albumModal. Each track row carries
// the data-* attributes the album-track-row click handler in main.js reads to
// open the log modal pre-filled, so no extra wiring is needed here.
export function renderAlbumModal(album) {
  const header = `
    <div class="album-modal-cover"><span class="cover-wrap">${renderCoverArt(album)}</span></div>
    <div>
      <div class="album-modal-name">${escapeHtml(album.title)}</div>
      <div class="album-modal-artist">${escapeHtml(album.artist)}</div>
      ${album.tracks && album.tracks.length ? `<div class="album-modal-count">${album.tracks.length} track${album.tracks.length === 1 ? '' : 's'}</div>` : ''}
    </div>
  `;

  const tracks = (album.tracks || []).map((t, i) => {
    const artist = t.artist || album.artist;
    return `
      <div class="album-track-row"
        data-title="${escapeHtml(t.title)}"
        data-artist="${escapeHtml(artist)}"
        data-album="${escapeHtml(album.title)}"
        ${album.coverUrl ? `data-cover="${escapeHtml(album.coverUrl)}"` : ''}
        ${t.id ? `data-tid="${escapeHtml(String(t.id))}"` : ''}
        ${t.previewUrl ? `data-preview="${escapeHtml(t.previewUrl)}"` : ''}>
        <div class="album-track-num">${t.trackPosition || i + 1}</div>
        <div>
          <div class="album-track-title">${escapeHtml(t.title)}</div>
          <div class="album-track-artist">${escapeHtml(artist)}</div>
        </div>
        <div class="album-track-duration">${formatTrackTime(t.duration)}</div>
        <span class="album-track-add">+ Log</span>
      </div>
    `;
  }).join('');

  return { header, tracks: tracks || '<div class="search-empty">No tracks found for this album.</div>' };
}

// ── Detail ──────────────────────────────
export function renderDetailView(entry) {
  const rating = effectiveRating(entry);
  const isAuto = !entry.rating && entry.tags && entry.tags.length;
  return `
    <a class="back-link" href="#/journal">&larr; Journal</a>
    <div class="detail-header">
      <div class="detail-cover"><div class="cover-wrap">${renderCoverArt(entry)}</div></div>
      <div class="detail-info">
        <h1 class="detail-title" data-page-heading tabindex="-1">${escapeHtml(entry.title)}</h1>
        <div class="detail-artist">${escapeHtml(entry.artist)}</div>
        ${entry.album ? `<div class="detail-album">${escapeHtml(entry.album)}</div>` : ''}
        <div class="detail-stars">${renderStars(rating)}<span class="detail-rating-num">${formatRating(rating)} / 5${isAuto ? ' (from part ratings)' : ''}</span></div>
        <div class="detail-tags">
          ${entry.genre ? `<span class="detail-tag">${escapeHtml(entry.genre)}</span>` : ''}
          ${entry.favorite ? '<span class="detail-tag detail-tag-fav">&hearts; favorite</span>' : ''}
          ${entry.date ? `<span class="detail-tag">${formatDate(entry.date)}</span>` : ''}
        </div>
        <div class="detail-player">
          ${discButton(entry, 'disc-lg')}
          <span class="detail-player-hint">30-second preview &middot; courtesy of iTunes</span>
        </div>
      </div>
    </div>
    ${entry.review ? `
      <div class="detail-section">
        <h3>Your review</h3>
        <div class="detail-review-text">${escapeHtml(entry.review)}</div>
      </div>
    ` : ''}
    ${entry.tags && entry.tags.length ? `
      <div class="detail-section">
        <h3>Part ratings</h3>
        ${entry.tags.map(t => `
          <div class="criteria-row">
            <span class="criteria-name">${escapeHtml(t.name)}</span>
            ${renderStars(t.rating)}
            <span class="criteria-value">${formatRating(t.rating)}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
    <div class="detail-actions">
      <button class="btn btn-primary btn-sm" id="detailEdit" data-id="${entry.id}">Edit entry</button>
      <button class="btn btn-ghost btn-sm" id="detailAddToCollection" data-id="${entry.id}">Add to collection</button>
      <button class="btn btn-danger btn-sm" id="detailDelete" data-id="${entry.id}">Delete</button>
    </div>
  `;
}

// ── Stats (bars & lists; canvas charts live in charts.js) ──
const GENRE_COLORS = {
  pop: '#e8a33d', rock: '#d96c5f', 'hip-hop': '#c8862a', 'r&b': '#b0729e',
  electronic: '#529a9a', jazz: '#a3854e', classical: '#8f8fc0', indie: '#7da878',
  country: '#bc9455', metal: '#8d8798', folk: '#a08a6a', soul: '#cd7f62',
  blues: '#6486b4', latin: '#d3855b', other: '#877e8b',
};

export function genreColor(genre) {
  return GENRE_COLORS[genre] || '#877e8b';
}

export function renderStatsBasics() {
  const entries = getJournal();

  document.getElementById('statTotal').textContent = entries.length;
  document.getElementById('statArtists').textContent = new Set(entries.map(e => e.artist.toLowerCase())).size;
  document.getElementById('statFives').textContent = entries.filter(e => effectiveRating(e) === 5).length;
  document.getElementById('statAvg').textContent = entries.length
    ? (entries.reduce((s, e) => s + effectiveRating(e), 0) / entries.length).toFixed(1)
    : '-';

  const counts = [0, 0, 0, 0, 0];
  entries.forEach(e => {
    const r = Math.round(effectiveRating(e));
    if (r >= 1 && r <= 5) counts[r - 1]++;
  });
  const maxCount = Math.max(...counts, 1);
  document.getElementById('ratingBars').innerHTML = [5, 4, 3, 2, 1].map(r => `
    <div class="rating-bar-row">
      <div class="rating-bar-label">${'&#9733;'.repeat(r)}</div>
      <div class="rating-bar-track"><div class="rating-bar-fill" style="width: ${(counts[r - 1] / maxCount) * 100}%"></div></div>
      <div class="rating-bar-count">${counts[r - 1]}</div>
    </div>
  `).join('');

  const artistMap = {};
  entries.forEach(e => { artistMap[e.artist] = (artistMap[e.artist] || 0) + 1; });
  const topArtists = Object.entries(artistMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  document.getElementById('topArtistsList').innerHTML = topArtists.length
    ? topArtists.map(([name, count], i) => `
        <div class="top-artist-row">
          <div class="top-artist-rank">${i + 1}</div>
          <div class="top-artist-name">${escapeHtml(name)}</div>
          <div class="top-artist-count">${count} song${count !== 1 ? 's' : ''}</div>
        </div>
      `).join('')
    : '<p class="muted">Log more songs to see your top artists.</p>';

  const genreMap = {};
  entries.forEach(e => { if (e.genre) genreMap[e.genre] = (genreMap[e.genre] || 0) + 1; });
  const genres = Object.entries(genreMap).sort((a, b) => b[1] - a[1]);
  document.getElementById('genreBreakdown').innerHTML = genres.length
    ? genres.map(([genre, count]) => `
        <div class="genre-bar-row">
          <div class="genre-bar-label">${escapeHtml(genre)}</div>
          <div class="genre-bar-track"><div class="genre-bar-fill" style="width: ${(count / Math.max(...genres.map(g => g[1]), 1)) * 100}%; background: ${genreColor(genre)};"></div></div>
          <div class="genre-bar-pct">${Math.round(count / entries.length * 100)}%</div>
        </div>
      `).join('')
    : '<p class="muted">Log more songs to see your genre breakdown.</p>';
}
