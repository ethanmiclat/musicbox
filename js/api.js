/* MusicBox — api: all third-party fetchers plus the caching and
   resilience layer (backoff on 429/5xx, stale-while-revalidate).
   Cache keys are unchanged from v1. */

const LASTFM_API_KEY = '8ea070b95e74f7f872b31ea41492e055';
const DISCOVER_CACHE_KEY = 'musicbox_discover_v1';
const DISCOVER_TTL = 1000 * 60 * 60;            // 1 hour
const ART_CACHE_KEY = 'musicbox_art_cache_v1';
const ART_TTL = 1000 * 60 * 60 * 24 * 30;        // 30 days
const CATALOG_KEY = 'musicbox_catalog';
const SEARCH_CACHE_KEY = 'musicbox_mb_search_cache';
const COVER_NEG_KEY = 'musicbox_cover_misses';

// ── Resilient fetch: exponential backoff on 429 and 5xx ──
export async function fetchWithRetry(url, opts = {}, { retries = 3, baseDelay = 900 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error('HTTP ' + res.status);
        if (attempt === retries) throw lastErr;
        const retryAfter = parseFloat(res.headers.get('Retry-After')) * 1000;
        const delay = retryAfter || baseDelay * Math.pow(2, attempt) * (0.8 + Math.random() * 0.4);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

// ── Generic JSON cache helpers ──
function readStore(key, session = false) {
  try { return JSON.parse((session ? sessionStorage : localStorage).getItem(key)) || {}; }
  catch { return {}; }
}
function writeStore(key, value, session = false) {
  try { (session ? sessionStorage : localStorage).setItem(key, JSON.stringify(value)); } catch {}
}

// ── Discover cache with stale-while-revalidate reads ──
// readDiscoverSWR returns { data, stale } — callers render `data` at once
// and, when `stale`, refresh underneath and re-render.
export function readDiscoverSWR(name) {
  const entry = readStore(DISCOVER_CACHE_KEY)[name];
  if (!entry) return { data: null, stale: true };
  return { data: entry.data, stale: Date.now() - entry.fetchedAt > DISCOVER_TTL };
}
function writeCachedDiscover(name, data) {
  const c = readStore(DISCOVER_CACHE_KEY);
  c[name] = { fetchedAt: Date.now(), data };
  writeStore(DISCOVER_CACHE_KEY, c);
}

// ── Art cache ──
function readCachedArt(key) {
  const entry = readStore(ART_CACHE_KEY)[key];
  if (!entry) return undefined;                  // never tried
  if (Date.now() - entry.fetchedAt > ART_TTL) return undefined;
  return entry.url;                              // null = tried, no art exists
}
function writeCachedArt(key, url) {
  const c = readStore(ART_CACHE_KEY);
  c[key] = { fetchedAt: Date.now(), url };
  writeStore(ART_CACHE_KEY, c);
}

export function upgradeAppleArtwork(url) {
  if (!url) return null;
  return url.replace(/\/\d+x\d+(bb)?\./, '/600x600bb.');
}

// Lazy art enrichment via iTunes Search, cached aggressively.
export async function enrichArt(item, kind) {
  const key = kind === 'track'
    ? `t::${(item.artist || '').toLowerCase()}::${(item.title || '').toLowerCase()}`
    : `a::${(item.name || '').toLowerCase()}`;
  const cached = readCachedArt(key);
  if (cached !== undefined) return cached;

  const term = kind === 'track' ? `${item.artist} ${item.title}` : item.name;
  try {
    const res = await fetchWithRetry(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=1`, {}, { retries: 1 });
    if (!res.ok) throw new Error('iTunes HTTP ' + res.status);
    const data = await res.json();
    const r = (data.results || [])[0];
    const cover = r ? upgradeAppleArtwork(r.artworkUrl100) : null;
    writeCachedArt(key, cover);
    return cover;
  } catch {
    writeCachedArt(key, null);
    return null;
  }
}

// ── iTunes song search (log-modal autocomplete, search overlay, import) ──
// Captures trackId and previewUrl: trackId powers duplicate detection,
// previewUrl powers the 30-second vinyl player.
export async function searchITunesSongs(query, limit = 8) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  try {
    const res = await fetchWithRetry(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=${limit}`, {}, { retries: 2 });
    if (!res.ok) throw new Error('iTunes search HTTP ' + res.status);
    const data = await res.json();
    return (data.results || []).map(r => ({
      title: r.trackName || '',
      artist: r.artistName || '',
      album: r.collectionName || '',
      coverUrl: upgradeAppleArtwork(r.artworkUrl100),
      genre: (r.primaryGenreName || '').toLowerCase(),
      releaseDate: r.releaseDate || '',
      itunesTrackId: r.trackId || null,
      collectionId: r.collectionId || null,
      previewUrl: r.previewUrl || null,
    })).filter(r => r.title && r.artist);
  } catch (e) {
    console.warn('iTunes search failed:', e);
    return [];
  }
}

// iTunes album search (search-overlay "Albums" section). Returns enough to
// render a result card and to open the tracklist modal via collectionId.
export async function searchITunesAlbums(query, limit = 5) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  try {
    const res = await fetchWithRetry(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=${limit}`, {}, { retries: 1 });
    if (!res.ok) throw new Error('iTunes album search HTTP ' + res.status);
    const data = await res.json();
    return (data.results || []).map(r => ({
      title: r.collectionName || '',
      artist: r.artistName || '',
      coverUrl: upgradeAppleArtwork(r.artworkUrl100),
      genre: (r.primaryGenreName || '').toLowerCase(),
      releaseDate: r.releaseDate || '',
      collectionId: r.collectionId || null,
      trackCount: r.trackCount || 0,
    })).filter(r => r.title && r.artist && r.collectionId);
  } catch (e) {
    console.warn('iTunes album search failed:', e);
    return [];
  }
}

// iTunes artist search (log-modal Artist autocomplete). iTunes has no artist
// artwork, so we return name + genre only and dedupe repeated names.
export async function searchITunesArtists(query, limit = 8) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  try {
    const res = await fetchWithRetry(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=musicArtist&attribute=artistTerm&limit=${limit}`, {}, { retries: 1 });
    if (!res.ok) throw new Error('iTunes artist search HTTP ' + res.status);
    const data = await res.json();
    const seen = new Set();
    return (data.results || []).map(r => ({
      name: r.artistName || '',
      genre: (r.primaryGenreName || '').toLowerCase(),
      artistId: r.artistId || null,
    })).filter(a => {
      if (!a.name) return false;
      const k = a.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  } catch (e) {
    console.warn('iTunes artist search failed:', e);
    return [];
  }
}

// Cover for an artist = their most recent album's artwork (iTunes has no
// artist artwork of its own). Cached aggressively via the shared art cache.
export async function getArtistArtwork(artistId) {
  if (!artistId) return null;
  const key = `artist::${artistId}`;
  const cached = readCachedArt(key);
  if (cached !== undefined) return cached;   // null = looked up, none exists
  try {
    const res = await fetchWithRetry(`https://itunes.apple.com/lookup?id=${encodeURIComponent(artistId)}&entity=album&limit=50`, {}, { retries: 1 });
    if (!res.ok) throw new Error('iTunes artist lookup HTTP ' + res.status);
    const data = await res.json();
    const albums = (data.results || []).filter(r => r.wrapperType === 'collection' && r.artworkUrl100);
    albums.sort((a, b) => new Date(b.releaseDate || 0) - new Date(a.releaseDate || 0));
    const url = albums.length ? upgradeAppleArtwork(albums[0].artworkUrl100) : null;
    writeCachedArt(key, url);
    return url;
  } catch (e) {
    console.warn('Artist artwork lookup failed:', e);
    return null;
  }
}

// Resolve one song (used by streaming import). Throttled by the caller.
export async function resolveSong(artist, title) {
  const results = await searchITunesSongs(`${artist} ${title}`, 1);
  return results[0] || null;
}

// Find a 30-second preview URL for a song that was logged without one.
// Prefers an exact track-id lookup, falls back to a title+artist search.
export async function resolvePreviewUrl({ trackId, title, artist }) {
  try {
    if (trackId) {
      const res = await fetchWithRetry(`https://itunes.apple.com/lookup?id=${encodeURIComponent(trackId)}`, {}, { retries: 1 });
      if (res.ok) {
        const r = ((await res.json()).results || [])[0];
        if (r && r.previewUrl) return r.previewUrl;
      }
    }
    const results = await searchITunesSongs(`${artist} ${title}`, 3);
    const hit = results.find(r => r.previewUrl);
    return hit ? hit.previewUrl : null;
  } catch {
    return null;
  }
}

// ── Last.fm ──
function lastFmError(data) {
  return data && data.error ? new Error('Last.fm error ' + data.error + ': ' + data.message) : null;
}

async function fetchLastFmTopTracksFresh(region) {
  const base = 'https://ws.audioscrobbler.com/2.0/';
  const url = region === 'global'
    ? `${base}?method=chart.gettoptracks&api_key=${LASTFM_API_KEY}&format=json&limit=20`
    : `${base}?method=geo.gettoptracks&country=${encodeURIComponent(region)}&api_key=${LASTFM_API_KEY}&format=json&limit=20`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error('Last.fm HTTP ' + res.status);
  const data = await res.json();
  const err = lastFmError(data);
  if (err) throw err;
  const tracks = (data.tracks && data.tracks.track) || [];
  const items = tracks.map(t => ({
    title: t.name || '',
    artist: (t.artist && (t.artist.name || t.artist['#text'])) || '',
    album: '',
    listeners: parseInt(t.listeners, 10) || 0,
    playcount: parseInt(t.playcount, 10) || 0,
    url: t.url || '',
    coverUrl: pickLastFmImage(t.image),
  })).filter(t => t.title && t.artist);
  writeCachedDiscover(`lastfm_${region}`, items);
  return items;
}

// SWR entry point: resolves fast from cache when possible; `onRefresh`
// fires later with fresh data if the cache was stale.
export function getLastFmTopTracks(region, onRefresh) {
  const { data, stale } = readDiscoverSWR(`lastfm_${region}`);
  if (stale) {
    const p = fetchLastFmTopTracksFresh(region);
    if (data) p.then(onRefresh).catch(() => {});
    else return p;
  }
  return Promise.resolve(data);
}

function pickLastFmImage(images) {
  if (!Array.isArray(images)) return null;
  const order = ['mega', 'extralarge', 'large', 'medium', 'small'];
  for (const size of order) {
    const img = images.find(i => i.size === size);
    // Skip Last.fm's default placeholder-star image.
    if (img && img['#text'] && !img['#text'].includes('2a96cbd8b46e442fc41c2b86b821562f')) {
      return img['#text'];
    }
  }
  return null;
}

export async function searchLastFmTracks(query) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(q)}&api_key=${LASTFM_API_KEY}&format=json&limit=12`;
    const res = await fetchWithRetry(url, {}, { retries: 1 });
    if (!res.ok) return [];
    const data = await res.json();
    const tracks = (data.results && data.results.trackmatches && data.results.trackmatches.track) || [];
    return tracks.map(t => ({
      title: t.name || '',
      artist: t.artist || '',
      listeners: parseInt(t.listeners, 10) || 0,
      url: t.url || '',
      coverUrl: null,
    })).filter(t => t.title && t.artist);
  } catch {
    return [];
  }
}

// ── ListenBrainz ──
async function fetchListenBrainzTrendingFresh(range) {
  const url = `https://api.listenbrainz.org/1/stats/sitewide/artists?range=${encodeURIComponent(range)}&count=20`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error('ListenBrainz HTTP ' + res.status);
  const data = await res.json();
  const artists = (data.payload && data.payload.artists) || [];
  const items = artists.map(a => ({
    name: a.artist_name || '',
    mbid: a.artist_mbid || null,
    listenCount: a.listen_count || 0,
  })).filter(a => a.name);
  writeCachedDiscover(`lb_${range}`, items);
  return items;
}

export function getListenBrainzTrending(range, onRefresh) {
  const { data, stale } = readDiscoverSWR(`lb_${range}`);
  if (stale) {
    const p = fetchListenBrainzTrendingFresh(range);
    if (data) p.then(onRefresh).catch(() => {});
    else return p;
  }
  return Promise.resolve(data);
}

// ── iTunes album lookup (tracklist modal) ──
export async function fetchAlbumDetail(collectionId) {
  if (!collectionId) return null;
  try {
    const res = await fetchWithRetry(`https://itunes.apple.com/lookup?id=${encodeURIComponent(collectionId)}&entity=song&limit=200`, {}, { retries: 2 });
    if (!res.ok) throw new Error('iTunes lookup HTTP ' + res.status);
    const data = await res.json();
    const results = data.results || [];
    const album = results.find(r => r.wrapperType === 'collection');
    if (!album) return null;
    return {
      id: album.collectionId,
      title: album.collectionName || '',
      artist: album.artistName || '',
      coverUrl: upgradeAppleArtwork(album.artworkUrl100) || null,
      releaseDate: album.releaseDate || '',
      genres: album.primaryGenreName ? [album.primaryGenreName] : [],
      tracks: results
        .filter(r => r.wrapperType === 'track' && r.kind === 'song')
        .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0))
        .map(t => ({
          id: t.trackId,
          title: t.trackName || '',
          artist: t.artistName || '',
          duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : 0,
          trackPosition: t.trackNumber || 0,
          previewUrl: t.previewUrl || null,
        })),
    };
  } catch (e) {
    console.warn('Album detail fetch failed:', e);
    return null;
  }
}

// ── MusicBrainz (metadata enrichment; ≤1 req/sec per their guidelines) ──
let mbLastRequest = 0;
async function mbThrottle() {
  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - mbLastRequest));
  if (wait) await new Promise(r => setTimeout(r, wait));
  mbLastRequest = Date.now();
}

function getCoverMisses() { return readStore(COVER_NEG_KEY, true); }
export function buildCoverUrl(releaseGroupId) {
  if (!releaseGroupId) return null;
  if (getCoverMisses()[releaseGroupId]) return null;
  return `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`;
}

export async function searchMusicBrainz(query) {
  const q = query.trim();
  if (!q) return [];
  const key = q.toLowerCase();
  const cached = readStore(SEARCH_CACHE_KEY, true)[key];
  if (cached) return cached;

  await mbThrottle();
  try {
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&limit=10&fmt=json`;
    const res = await fetchWithRetry(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('MusicBrainz HTTP ' + res.status);
    const data = await res.json();
    const results = (data.recordings || []).map(r => {
      const release = (r.releases && r.releases[0]) || null;
      const releaseGroup = release && release['release-group'] ? release['release-group'] : null;
      const releaseGroupId = releaseGroup ? releaseGroup.id : null;
      return {
        mbId: r.id,
        title: r.title || '',
        artist: (r['artist-credit'] || []).map(a => a.name).join(', '),
        album: release ? release.title : '',
        releaseId: release ? release.id : null,
        releaseGroupId,
        date: (release && release.date) || r['first-release-date'] || '',
        coverUrl: buildCoverUrl(releaseGroupId),
      };
    });
    const cache = readStore(SEARCH_CACHE_KEY, true);
    cache[key] = results;
    writeStore(SEARCH_CACHE_KEY, cache, true);
    results.forEach(cacheCatalogItem);
    return results;
  } catch (e) {
    console.warn('MusicBrainz search failed:', e);
    return [];
  }
}

export function cacheCatalogItem(item) {
  if (!item || !item.mbId) return;
  const c = readStore(CATALOG_KEY);
  c[item.mbId] = { ...item, cachedAt: Date.now() };
  writeStore(CATALOG_KEY, c);
}

// ── Formatting helpers shared by render ──
export function formatListenCount(n) {
  if (!n || isNaN(n)) return '';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
