/* MusicBox — importer: turn Spotify / Apple Music data exports into
   journal entries. Parsing is heuristic on purpose: exports vary by
   vintage, so we look for song+artist shapes rather than exact schemas. */

import { resolveSong } from './api.js';
import { addEntry, findDuplicate, normSongKey } from './storage.js';

export const IMPORT_CAP = 60;          // keeps iTunes usage polite
const RESOLVE_DELAY_MS = 2200;         // ~27 lookups/minute

// ── CSV parsing (quotes, commas, newlines inside quotes) ──
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

function findColumn(headers, patterns) {
  for (const p of patterns) {
    const idx = headers.findIndex(h => p.test(h));
    if (idx !== -1) return idx;
  }
  return -1;
}

// ── JSON shapes ──
function songsFromJson(data) {
  const out = [];
  const push = (artist, title) => {
    artist = (artist || '').trim();
    title = (title || '').trim();
    if (artist && title) out.push({ artist, title });
  };

  const scanArray = (arr) => {
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      // Spotify StreamingHistory*.json
      if (item.trackName && item.artistName) { push(item.artistName, item.trackName); continue; }
      // Spotify extended streaming history
      if (item.master_metadata_track_name) {
        push(item.master_metadata_album_artist_name, item.master_metadata_track_name);
        continue;
      }
      // Spotify YourLibrary.json tracks
      if (item.track && item.artist && typeof item.track === 'string') { push(item.artist, item.track); continue; }
      // playlist item wrapper
      if (item.track && typeof item.track === 'object') {
        push(item.track.artistName || item.track.artist, item.track.trackName || item.track.track);
        continue;
      }
      // generic {title, artist}
      if ((item.title || item.song) && item.artist) { push(item.artist, item.title || item.song); }
    }
  };

  if (Array.isArray(data)) scanArray(data);
  else if (data && typeof data === 'object') {
    if (Array.isArray(data.tracks)) scanArray(data.tracks);
    if (Array.isArray(data.items)) scanArray(data.items);
    if (Array.isArray(data.playlists)) {
      for (const pl of data.playlists) {
        if (Array.isArray(pl.items)) scanArray(pl.items);
        if (Array.isArray(pl.tracks)) scanArray(pl.tracks);
      }
    }
  }
  return out;
}

// ── CSV shapes (Apple Music exports and anything similar) ──
function songsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  const songCol = findColumn(headers, [/^song name$/i, /^track ?name$/i, /^title$/i, /song/i, /track/i, /name/i]);
  const artistCol = findColumn(headers, [/^artist ?name$/i, /^artist$/i, /artist/i]);
  if (songCol === -1 || artistCol === -1) return [];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const title = (rows[i][songCol] || '').trim();
    const artist = (rows[i][artistCol] || '').trim();
    if (title && artist) out.push({ artist, title });
  }
  return out;
}

// ── Public: parse a File into a de-duplicated, play-ranked song list ──
export async function parseExportFile(file) {
  const text = await file.text();
  let songs = [];
  if (file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try { songs = songsFromJson(JSON.parse(text)); }
    catch { return { error: 'That JSON file could not be parsed.' }; }
  } else {
    songs = songsFromCsv(text);
  }
  if (!songs.length) {
    return { error: 'No songs found. The file needs song and artist information (Spotify StreamingHistory JSON or an Apple Music CSV).' };
  }

  // aggregate plays per unique song, most-played first
  const counts = new Map();
  for (const s of songs) {
    const key = normSongKey(s.title, s.artist);
    const existing = counts.get(key);
    if (existing) existing.plays++;
    else counts.set(key, { ...s, plays: 1 });
  }
  const unique = [...counts.values()].sort((a, b) => b.plays - a.plays);
  return { songs: unique, total: unique.length, capped: unique.slice(0, IMPORT_CAP) };
}

// ── Public: resolve + insert, with progress callbacks ──
export async function runImport(songs, { onProgress } = {}) {
  const summary = { added: 0, skipped: 0, failed: 0, failures: [] };

  for (let i = 0; i < songs.length; i++) {
    const s = songs[i];
    if (onProgress) onProgress(i, songs.length, `${s.artist} - ${s.title}`);

    // cheap duplicate check before spending an API call
    if (findDuplicate({ title: s.title, artist: s.artist })) {
      summary.skipped++;
      continue;
    }

    const resolved = await resolveSong(s.artist, s.title);
    if (resolved) {
      // the resolved trackId may match an entry the name-match missed
      if (findDuplicate({ itunesTrackId: resolved.itunesTrackId, title: resolved.title, artist: resolved.artist })) {
        summary.skipped++;
      } else {
        addEntry({
          title: resolved.title,
          artist: resolved.artist,
          album: resolved.album,
          genre: resolved.genre,
          date: new Date().toISOString().split('T')[0],
          rating: null,            // imported songs arrive unrated
          review: '',
          favorite: false,
          tags: [],
          coverUrl: resolved.coverUrl,
          itunesTrackId: resolved.itunesTrackId,
          previewUrl: resolved.previewUrl,
          source: 'import',
        });
        summary.added++;
      }
    } else {
      summary.failed++;
      if (summary.failures.length < 12) summary.failures.push(`${s.artist} - ${s.title}`);
    }

    if (i < songs.length - 1) {
      await new Promise(r => setTimeout(r, RESOLVE_DELAY_MS));
    }
  }
  if (onProgress) onProgress(songs.length, songs.length, 'done');
  return summary;
}
