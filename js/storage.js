/* MusicBox — storage: auth, journal, collections, backup, local queries.
   Everything lives in localStorage; keys are unchanged from v1 so existing
   users' data survives the v2 update. */

const USERS_KEY = 'musicbox_users';
const SESSION_KEY = 'musicbox_session';

// Date-only strings ("2026-06-12") must parse as LOCAL dates; new Date()
// would treat them as UTC midnight and shift them a day in most timezones.
export function parseDate(value) {
  if (!value) return new Date(NaN);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

// ── Auth ────────────────────────────────
// v1 shipped a non-cryptographic hash; v2 verifies against it once, then
// silently re-hashes with SHA-256 on successful login.
function legacyHash(password) {
  let h = 5381;
  for (let i = 0; i < password.length; i++) {
    h = ((h << 5) + h) + password.charCodeAt(i);
    h |= 0;
  }
  return 'h_' + Math.abs(h).toString(36) + '_' + password.length;
}

async function sha256(text) {
  const data = new TextEncoder().encode('musicbox::' + text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return 's_' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; }
  catch { return []; }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function getCurrentUser() {
  return localStorage.getItem(SESSION_KEY);
}

export function setCurrentUser(username) {
  if (username) localStorage.setItem(SESSION_KEY, username);
  else localStorage.removeItem(SESSION_KEY);
}

export function isLoggedIn() {
  return !!getCurrentUser();
}

export async function signup(username, password) {
  username = username.trim();
  if (!username || username.length < 2) return { error: 'Username must be at least 2 characters.' };
  if (password.length < 4) return { error: 'Password must be at least 4 characters.' };

  const users = getUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return { error: 'That username is already taken.' };
  }

  users.push({
    username,
    passwordHash: await sha256(password),
    algo: 'sha256',
    createdAt: new Date().toISOString(),
  });
  saveUsers(users);
  setCurrentUser(username);
  return { success: true, username };
}

export async function login(username, password) {
  username = username.trim();
  const users = getUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return { error: 'No account found with that username.' };

  const shaHash = await sha256(password);
  let ok = false;
  if (user.algo === 'sha256') {
    ok = user.passwordHash === shaHash;
  } else {
    // legacy v1 hash — verify, then upgrade in place
    ok = user.passwordHash === legacyHash(password);
    if (ok) {
      user.passwordHash = shaHash;
      user.algo = 'sha256';
      saveUsers(users);
    }
  }
  if (!ok) return { error: 'Incorrect password.' };
  setCurrentUser(user.username);
  return { success: true, username: user.username };
}

export function logout() {
  setCurrentUser(null);
}

// ── Journal ─────────────────────────────
function journalKey() {
  const user = getCurrentUser();
  return user ? `musicbox_journal_${user}` : null;
}

export function getJournal() {
  const key = journalKey();
  if (!key) return [];
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch { return []; }
}

export function saveJournal(entries) {
  const key = journalKey();
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(entries));
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function addEntry(entry) {
  const entries = getJournal();
  entry.id = newId();
  entry.createdAt = new Date().toISOString();
  entries.unshift(entry);
  saveJournal(entries);
  return entry;
}

export function updateEntry(id, patch) {
  const entries = getJournal();
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return null;
  entries[idx] = { ...entries[idx], ...patch, id, updatedAt: new Date().toISOString() };
  saveJournal(entries);
  return entries[idx];
}

export function deleteEntry(id) {
  saveJournal(getJournal().filter(e => e.id !== id));
}

export function getEntry(id) {
  return getJournal().find(e => e.id === id);
}

// Effective overall rating: manual rating wins; otherwise average of the
// per-part ratings (stored in `tags` for v1 compatibility).
export function effectiveRating(entry) {
  if (entry.rating) return entry.rating;
  if (entry.tags && entry.tags.length) {
    const avg = entry.tags.reduce((s, t) => s + (t.rating || 0), 0) / entry.tags.length;
    return Math.round(avg * 2) / 2;
  }
  return 0;
}

// ── Duplicate detection ─────────────────
// Priority: hard IDs (iTunes trackId, MusicBrainz id), then a normalized
// title+artist key that ignores "(Remastered 2011)"-style suffixes.
export function normSongKey(title, artist) {
  const clean = s => (s || '')
    .toLowerCase()
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '')      // bracketed suffixes
    .replace(/\s*(feat\.?|ft\.?|featuring)\s.+$/i, '') // feat. tails
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return clean(title) + '::' + clean(artist);
}

export function findDuplicate({ itunesTrackId, mbId, title, artist }, excludeId = null) {
  const entries = getJournal();
  const key = normSongKey(title, artist);
  return entries.find(e => {
    if (excludeId && e.id === excludeId) return false;
    if (itunesTrackId && e.itunesTrackId && String(e.itunesTrackId) === String(itunesTrackId)) return true;
    if (mbId && e.mbId && e.mbId === mbId) return true;
    return title && artist && normSongKey(e.title, e.artist) === key;
  }) || null;
}

// ── Viewed log (feeds Surprise Me weighting) ──
function viewedKey() {
  const user = getCurrentUser();
  return user ? `musicbox_viewed_${user}` : null;
}

export function markViewed(entryId) {
  const key = viewedKey();
  if (!key) return;
  let map = {};
  try { map = JSON.parse(localStorage.getItem(key)) || {}; } catch {}
  map[entryId] = Date.now();
  try { localStorage.setItem(key, JSON.stringify(map)); } catch {}
}

export function surprisePick() {
  const entries = getJournal();
  if (!entries.length) return null;
  let viewed = {};
  try { viewed = JSON.parse(localStorage.getItem(viewedKey())) || {}; } catch {}

  const now = Date.now();
  const DAY = 86400000;
  // Weight rises with time-since-last-view (capped at 90 days) and slightly
  // with rating, so rediscovery favors things you loved but haven't seen.
  const weighted = entries.map(e => {
    const last = viewed[e.id] || 0;
    const days = Math.min((now - last) / DAY, 90);
    const freshness = 0.15 + (days / 90) * 0.85;
    const affection = 0.6 + (effectiveRating(e) / 5) * 0.4;
    return { entry: e, w: freshness * affection };
  });
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let roll = Math.random() * total;
  for (const x of weighted) {
    roll -= x.w;
    if (roll <= 0) return x.entry;
  }
  return weighted[weighted.length - 1].entry;
}

// ── On this day ─────────────────────────
export function onThisDay(today = new Date()) {
  const d = today.getDate();
  const m = today.getMonth();
  const y = today.getFullYear();
  return getJournal().filter(e => {
    const when = parseDate(e.date || e.createdAt);
    if (isNaN(when)) return false;
    if (when.getDate() !== d) return false;
    return when.getMonth() !== m || when.getFullYear() !== y;
  }).sort((a, b) => parseDate(b.date || b.createdAt) - parseDate(a.date || a.createdAt));
}

// ── Recent searches ─────────────────────
const RECENT_SEARCH_LIMIT = 6;
function recentSearchesKey() {
  const user = getCurrentUser();
  return user ? `musicbox_recent_searches_${user}` : null;
}

export function getRecentSearches() {
  const key = recentSearchesKey();
  if (!key) return [];
  try { return (JSON.parse(localStorage.getItem(key)) || []).slice(0, RECENT_SEARCH_LIMIT); }
  catch { return []; }
}

export function addRecentSearch(query) {
  const key = recentSearchesKey();
  if (!key) return;
  const q = (query || '').trim();
  if (q.length < 2) return;
  const existing = getRecentSearches().filter(s => s.toLowerCase() !== q.toLowerCase());
  existing.unshift(q);
  try { localStorage.setItem(key, JSON.stringify(existing.slice(0, RECENT_SEARCH_LIMIT))); } catch {}
}

export function removeRecentSearch(query) {
  const key = recentSearchesKey();
  if (!key) return;
  const q = (query || '').trim().toLowerCase();
  const remaining = getRecentSearches().filter(s => s.toLowerCase() !== q);
  try { localStorage.setItem(key, JSON.stringify(remaining)); } catch {}
}

export function clearRecentSearches() {
  const key = recentSearchesKey();
  if (key) localStorage.removeItem(key);
}

// ── "Recently logged" dismissals (search overlay shortcut only) ──
// Non-destructive: hides an entry from the quick list without touching the
// journal, stats, or charts.
function dismissedLoggedKey() {
  const user = getCurrentUser();
  return user ? `musicbox_dismissed_logged_${user}` : null;
}

export function getDismissedLogged() {
  const key = dismissedLoggedKey();
  if (!key) return [];
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch { return []; }
}

export function dismissRecentLogged(id) {
  const key = dismissedLoggedKey();
  if (!key || !id) return;
  const list = getDismissedLogged();
  if (!list.includes(id)) list.push(id);
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
}

// Journal entries for the "Recently logged" shortcut, minus dismissed ones.
export function getRecentlyLogged(limit = 5) {
  const dismissed = new Set(getDismissedLogged());
  return getJournal().filter(e => !dismissed.has(e.id)).slice(0, limit);
}

// ── Collections ─────────────────────────
function collectionsKey() {
  const user = getCurrentUser();
  return user ? `musicbox_collections_${user}` : null;
}

export function getCollections() {
  const key = collectionsKey();
  if (!key) return [];
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch { return []; }
}

export function saveCollections(collections) {
  const key = collectionsKey();
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(collections));
}

export function createCollection(name, description) {
  const collections = getCollections();
  const col = {
    id: newId(),
    name: name.trim(),
    description: (description || '').trim(),
    songIds: [],
    createdAt: new Date().toISOString(),
  };
  collections.unshift(col);
  saveCollections(collections);
  return col;
}

export function deleteCollection(id) {
  saveCollections(getCollections().filter(c => c.id !== id));
}

export function getCollection(id) {
  return getCollections().find(c => c.id === id) || null;
}

export function addSongToCollection(collectionId, songId) {
  const collections = getCollections();
  const col = collections.find(c => c.id === collectionId);
  if (!col) return false;
  if (col.songIds.includes(songId)) return false;
  col.songIds.push(songId);
  saveCollections(collections);
  return true;
}

export function removeSongFromCollection(collectionId, songId) {
  const collections = getCollections();
  const col = collections.find(c => c.id === collectionId);
  if (!col) return;
  col.songIds = col.songIds.filter(id => id !== songId);
  saveCollections(collections);
}

// ── Backup export / restore ─────────────
export function exportBackup() {
  const user = getCurrentUser();
  if (!user) return null;
  return {
    app: 'musicbox',
    backupVersion: 2,
    exportedAt: new Date().toISOString(),
    user,
    entries: getJournal(),
    collections: getCollections(),
  };
}

export function restoreBackup(data) {
  if (!data || data.app !== 'musicbox' || !Array.isArray(data.entries)) {
    return { error: 'That file is not a MusicBox backup.' };
  }
  const existing = getJournal();
  const existingIds = new Set(existing.map(e => e.id));
  let added = 0, skipped = 0;

  const incoming = [...data.entries].reverse(); // keep newest-first order after unshift
  for (const entry of incoming) {
    if (!entry.title || !entry.artist) { skipped++; continue; }
    if (entry.id && existingIds.has(entry.id)) { skipped++; continue; }
    if (findDuplicate(entry)) { skipped++; continue; }
    existing.unshift({ ...entry, id: entry.id || newId() });
    if (entry.id) existingIds.add(entry.id);
    added++;
  }
  saveJournal(existing);

  // merge collections by id
  let colsAdded = 0;
  if (Array.isArray(data.collections)) {
    const cols = getCollections();
    const colIds = new Set(cols.map(c => c.id));
    for (const col of data.collections) {
      if (!col.id || colIds.has(col.id)) continue;
      cols.push(col);
      colsAdded++;
    }
    saveCollections(cols);
  }
  return { added, skipped, colsAdded };
}
