/* MusicBox — recap: a downloadable 1080x1350 canvas card summarizing a
   period, drawn in the app's own identity (vinyl base, parchment card,
   marigold, typewriter metadata). Cover art loads with CORS enabled;
   if any image taints the canvas we redraw without images so the PNG
   export always works. */

import { getJournal, getCurrentUser, effectiveRating, parseDate } from './storage.js';

const W = 1080, H = 1350;

function periodStart(period, now = new Date()) {
  if (period === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); return d; }
  if (period === 'month') { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d; }
  if (period === 'year') { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d; }
  return new Date(0);
}

const PERIOD_LABELS = {
  week: 'the last 7 days',
  month: 'the last month',
  year: 'the last year',
  all: 'all time',
};

export function buildRecapData(period) {
  const start = periodStart(period);
  const entries = getJournal().filter(e => parseDate(e.date || e.createdAt) >= start);
  if (!entries.length) return null;

  const rated = entries.filter(e => effectiveRating(e) > 0);
  const avg = rated.length
    ? rated.reduce((s, e) => s + effectiveRating(e), 0) / rated.length
    : 0;

  const topSongs = [...entries]
    .sort((a, b) => effectiveRating(b) - effectiveRating(a) ||
      parseDate(b.date || b.createdAt) - parseDate(a.date || a.createdAt))
    .slice(0, 5);

  const artistCounts = {};
  entries.forEach(e => { artistCounts[e.artist] = (artistCounts[e.artist] || 0) + 1; });
  const topArtist = Object.entries(artistCounts).sort((a, b) => b[1] - a[1])[0];

  const genreCounts = {};
  entries.forEach(e => { if (e.genre) genreCounts[e.genre] = (genreCounts[e.genre] || 0) + 1; });
  const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0];

  return {
    periodLabel: PERIOD_LABELS[period] || period,
    count: entries.length,
    reviews: entries.filter(e => e.review).length,
    avg,
    topSongs,
    topArtist: topArtist ? topArtist[0] : null,
    topGenre: topGenre ? topGenre[0] : null,
    user: getCurrentUser() || 'my',
  };
}

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 4000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}

function drawDisc(ctx, cx, cy, r, labelColor = '#e8a33d') {
  ctx.save();
  const grooves = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
  grooves.addColorStop(0, '#241e2c');
  grooves.addColorStop(1, '#2e2637');
  ctx.fillStyle = grooves;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(242,237,228,0.10)';
  for (let g = r * 0.45; g < r; g += 7) {
    ctx.beginPath(); ctx.arc(cx, cy, g, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = labelColor;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#17131c';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.05, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

async function draw(canvas, data, { withImages = true } = {}) {
  await document.fonts.ready;
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  // vinyl base
  ctx.fillStyle = '#17131c';
  ctx.fillRect(0, 0, W, H);

  // oversized disc bleeding off the top-right corner
  drawDisc(ctx, W - 130, 96, 300);

  // masthead
  ctx.fillStyle = '#e8a33d';
  ctx.font = '700 30px "Courier Prime", monospace';
  ctx.fillText('MUSICBOX RECAP', 72, 110);
  ctx.fillStyle = '#f2ede4';
  ctx.font = '800 88px "Bricolage Grotesque", sans-serif';
  ctx.fillText(`${data.user}'s listening,`, 68, 220);
  ctx.fillStyle = '#e8a33d';
  ctx.fillText(data.periodLabel + '.', 68, 318);

  // ledger row
  ctx.font = '700 54px "Courier Prime", monospace';
  ctx.fillStyle = '#f2ede4';
  const ledger = [
    [String(data.count), data.count === 1 ? 'song logged' : 'songs logged'],
    [data.avg ? data.avg.toFixed(1) : '-', 'avg rating'],
    [String(data.reviews), data.reviews === 1 ? 'review' : 'reviews'],
  ];
  ledger.forEach(([num, label], i) => {
    const x = 72 + i * 320;
    ctx.fillStyle = '#e8a33d';
    ctx.font = '700 64px "Courier Prime", monospace';
    ctx.fillText(num, x, 430);
    ctx.fillStyle = '#b3aab6';
    ctx.font = '400 26px "Courier Prime", monospace';
    ctx.fillText(label, x, 468);
  });

  // parchment card: top five
  const cardY = 520, cardH = 620;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = '#efe8d8';
  roundRect(ctx, 60, cardY, W - 120, cardH, 18);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#6d6357';
  ctx.font = '400 26px "Courier Prime", monospace';
  ctx.fillText('SIDE A  ·  TOP RATED', 104, cardY + 66);

  const rowH = 104;
  for (let i = 0; i < data.topSongs.length; i++) {
    const e = data.topSongs[i];
    const y = cardY + 100 + i * rowH;

    // artwork slot: cover if allowed, mini disc otherwise
    let drew = false;
    if (withImages && e.coverUrl) {
      const img = await loadImage(e.coverUrl);
      if (img) {
        ctx.save();
        roundRect(ctx, 104, y, 76, 76, 8);
        ctx.clip();
        ctx.drawImage(img, 104, y, 76, 76);
        ctx.restore();
        drew = true;
      }
    }
    if (!drew) drawDisc(ctx, 142, y + 38, 38);

    ctx.fillStyle = '#221c1a';
    ctx.font = '700 34px "Bricolage Grotesque", sans-serif';
    let title = e.title;
    while (ctx.measureText(title).width > 620 && title.length > 3) title = title.slice(0, -4) + '…';
    ctx.fillText(title, 210, y + 36);
    ctx.fillStyle = '#6d6357';
    ctx.font = '400 26px Figtree, sans-serif';
    let artist = e.artist;
    while (ctx.measureText(artist).width > 620 && artist.length > 3) artist = artist.slice(0, -4) + '…';
    ctx.fillText(artist, 210, y + 70);

    const r = effectiveRating(e);
    ctx.fillStyle = '#c8862a';
    ctx.font = '700 30px "Courier Prime", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(r ? r.toFixed(1) + ' ★' : 'unrated', W - 110, y + 52);
    ctx.textAlign = 'left';
  }

  // footer strip
  let footY = 1225;
  ctx.fillStyle = '#b3aab6';
  ctx.font = '400 28px Figtree, sans-serif';
  const bits = [];
  if (data.topArtist) bits.push(`most logged: ${data.topArtist}`);
  if (data.topGenre) bits.push(`top genre: ${data.topGenre}`);
  ctx.fillText(bits.join('   ·   '), 72, footY);

  ctx.fillStyle = '#877e8b';
  ctx.font = '400 24px "Courier Prime", monospace';
  ctx.fillText('made with MusicBox, a personal music journal', 72, 1300);
  drawDisc(ctx, W - 110, 1280, 44);
}

export async function renderRecap(canvas, period) {
  const data = buildRecapData(period);
  if (!data) return { error: 'Nothing logged in that period yet.' };
  await draw(canvas, data, { withImages: true });

  // If remote art tainted the canvas, PNG export would fail — redraw clean.
  try {
    canvas.toDataURL();
  } catch {
    await draw(canvas, data, { withImages: false });
  }
  return { ok: true, data };
}

export function downloadRecap(canvas, period) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `musicbox-recap-${period}-${new Date().toISOString().split('T')[0]}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}
