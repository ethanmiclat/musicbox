/* MusicBox — search: fuzzy, order-independent matching + highlighting.
   Pure functions with no DOM/storage dependency so the ranking logic can be
   reasoned about (and node-tested) on its own. Consumed by the search overlay
   in main.js for both instant journal matches and re-ranking API results. */

// Lowercase and split on whitespace/punctuation into meaningful tokens.
export function tokenize(str) {
  return String(str || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

// Classic edit distance, short-circuited once it exceeds `max` (the words
// here are short, so the early bail keeps the per-keystroke cost tiny).
export function levenshtein(a, b, max = Infinity) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  if (Math.abs(al - bl) > max) return max + 1;

  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

// How many typos we tolerate for a token of a given length.
function fuzzyBudget(len) {
  if (len <= 3) return 0;   // too short to fuzz safely
  if (len <= 6) return 1;
  return 2;
}

// Best score of one query token against a set of candidate tokens.
// exact > prefix > substring > fuzzy. Returns 0 when nothing matches.
function bestTokenScore(qTok, cTokens) {
  let best = 0;
  for (const cTok of cTokens) {
    let s = 0;
    if (cTok === qTok) s = 100;
    else if (cTok.startsWith(qTok)) s = 72;
    else if (qTok.length >= 2 && cTok.includes(qTok)) s = 48;
    else {
      const budget = fuzzyBudget(qTok.length);
      if (budget > 0) {
        const d = levenshtein(qTok, cTok, budget);
        if (d <= budget) s = 34 - d * 10;
      }
    }
    if (s > best) best = s;
  }
  return best;
}

// Score a candidate {title, artist, album} against the raw query.
// Every query token must find a home in the candidate (order-independent);
// a single unmatched token drops the candidate (returns -1). Higher is better.
export function matchScore(query, candidate) {
  const qTokens = tokenize(query);
  if (!qTokens.length) return -1;

  const cText = [candidate.title, candidate.artist, candidate.album]
    .filter(Boolean).join(' ');
  const cTokens = tokenize(cText);
  if (!cTokens.length) return -1;

  let total = 0;
  for (const qTok of qTokens) {
    const s = bestTokenScore(qTok, cTokens);
    if (s === 0) return -1;        // this query word matched nothing
    total += s;
  }

  // Small nudge when the query is a clean prefix of the title, so
  // "fra" ranks "Frankie" over an artist whose name merely contains it.
  const titleLc = String(candidate.title || '').toLowerCase();
  if (titleLc.startsWith(query.trim().toLowerCase())) total += 15;

  return total;
}

// Escape without touching the DOM (search.js stays framework-free).
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Escape `text`, then wrap the parts that matched query tokens in <mark>.
export function highlightMatch(text, query) {
  const escaped = esc(text);
  const toks = [...new Set(tokenize(query))].filter(t => t.length >= 2);
  if (!toks.length) return escaped;
  // Longer tokens first so "ocean" wins over "o" style overlaps.
  toks.sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${toks.map(escapeRegex).join('|')})`, 'gi');
  return escaped.replace(re, '<mark class="search-hl">$1</mark>');
}
