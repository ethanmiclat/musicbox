/* MusicBox — charts: hand-drawn canvas 2D for the Stats page.
   Palette below is dataviz-validated against the #17131c surface
   (lightness band, chroma floor, CVD separation, contrast all pass).
   Identity is never color-alone: multi-series charts ship an HTML
   legend plus direct labels at line ends. */

import { effectiveRating, parseDate } from './storage.js';

// fixed categorical order — assigned to top genres in rank order at render
// time, then kept stable for the life of the chart (no repainting).
export const CHART_COLORS = ['#ba7f14', '#009a9b', '#cd6151', '#b9649f', '#519d55'];

const INK_MID = '#b3aab6';
const INK_LOW = '#877e8b';
const GRID = 'rgba(242, 237, 228, 0.07)';
const ACCENT = '#e8a33d';
const TOOLTIP_BG = '#2d2637';

// ── Canvas setup (retina-aware) ──
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
  const cssH = parseInt(canvas.getAttribute('height'), 10) || 220;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: cssW, h: cssH };
}

function drawEmptyNote(canvas, text) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = INK_LOW;
  ctx.font = '13px Figtree, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2);
}

// ── Time bucketing ──
function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}
function monthRange(entries) {
  const dates = entries
    .map(e => parseDate(e.date || e.createdAt))
    .filter(d => !isNaN(d))
    .sort((a, b) => a - b);
  if (!dates.length) return [];
  const keys = [];
  const cur = new Date(dates[0].getFullYear(), dates[0].getMonth(), 1);
  const end = new Date(dates[dates.length - 1].getFullYear(), dates[dates.length - 1].getMonth(), 1);
  while (cur <= end) {
    keys.push(monthKey(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return keys;
}

// ── Shared frame: grid, axes, scales ──
function frame(ctx, w, h, pad, yMax, yTicks, xLabels) {
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  ctx.clearRect(0, 0, w, h);

  ctx.font = '11px "Courier Prime", monospace';
  ctx.fillStyle = INK_LOW;
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;

  for (const t of yTicks) {
    const y = pad.t + plotH - (t / yMax) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(String(t), pad.l - 8, y + 3.5);
  }

  const n = xLabels.length;
  const step = Math.max(1, Math.ceil(n / Math.floor(plotW / 64)));
  ctx.textAlign = 'center';
  xLabels.forEach((label, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const x = pad.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    ctx.fillText(label, x, h - pad.b + 18);
  });

  return {
    x: i => pad.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW),
    y: v => pad.t + plotH - (v / yMax) * plotH,
    plotW, plotH, pad,
  };
}

function drawLine(ctx, points, color, { dots = false } = {}) {
  if (!points.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  let started = false;
  for (const p of points) {
    if (p == null) { started = false; continue; }
    if (!started) { ctx.moveTo(p.x, p.y); started = true; }
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  if (dots) {
    ctx.fillStyle = color;
    for (const p of points) {
      if (p == null) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ── Hover layer: crosshair + tooltip, shared by both line charts ──
function attachHover(canvas, redraw) {
  if (canvas._hoverBound) return;
  canvas._hoverBound = true;
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    redraw({ mx: e.clientX - rect.left, my: e.clientY - rect.top });
  });
  canvas.addEventListener('mouseleave', () => redraw(null));
}

function drawTooltip(ctx, w, lines, x, yTop) {
  ctx.font = '11px "Courier Prime", monospace';
  const boxW = Math.max(...lines.map(l => ctx.measureText(l.text).width)) + 26;
  const boxH = lines.length * 16 + 12;
  let bx = x + 12;
  if (bx + boxW > w - 4) bx = x - boxW - 12;
  const by = Math.max(4, yTop);
  ctx.fillStyle = TOOLTIP_BG;
  ctx.strokeStyle = 'rgba(242,237,228,0.18)';
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 6);
  ctx.fill();
  ctx.stroke();
  lines.forEach((l, i) => {
    if (l.swatch) {
      ctx.fillStyle = l.swatch;
      ctx.fillRect(bx + 8, by + 10 + i * 16 - 6, 7, 7);
    }
    ctx.fillStyle = l.strong ? '#f2ede4' : INK_MID;
    ctx.textAlign = 'left';
    ctx.fillText(l.text, bx + (l.swatch ? 20 : 10), by + 12 + i * 16);
  });
}

// ── Chart 1: average rating per month (single series — no legend) ──
export function renderRatingsOverTime(canvas, entries) {
  const rated = entries.filter(e => effectiveRating(e) > 0);
  const months = monthRange(rated);
  if (months.length < 2) {
    drawEmptyNote(canvas, 'Log rated songs across a few months to see your rating trend.');
    return;
  }

  const byMonth = {};
  for (const e of rated) {
    const d = parseDate(e.date || e.createdAt);
    if (isNaN(d)) continue;
    const k = monthKey(d);
    (byMonth[k] = byMonth[k] || []).push(effectiveRating(e));
  }
  const values = months.map(k => {
    const arr = byMonth[k];
    return arr ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  });

  const redraw = (hover) => {
    const { ctx, w, h } = setupCanvas(canvas);
    const f = frame(ctx, w, h, { l: 34, r: 14, t: 12, b: 28 }, 5, [1, 2, 3, 4, 5], months.map(monthLabel));
    const pts = values.map((v, i) => v == null ? null : { x: f.x(i), y: f.y(v), v, i });
    drawLine(ctx, pts, ACCENT, { dots: months.length <= 24 });

    if (hover) {
      const valid = pts.filter(Boolean);
      if (valid.length) {
        const nearest = valid.reduce((a, b) => Math.abs(b.x - hover.mx) < Math.abs(a.x - hover.mx) ? b : a);
        ctx.strokeStyle = 'rgba(242,237,228,0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(nearest.x, f.pad.t);
        ctx.lineTo(nearest.x, f.pad.t + f.plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = ACCENT;
        ctx.beginPath();
        ctx.arc(nearest.x, nearest.y, 5, 0, Math.PI * 2);
        ctx.fill();
        drawTooltip(ctx, w, [
          { text: monthLabel(months[nearest.i]), strong: true },
          { text: `avg ${nearest.v.toFixed(2)} / 5` },
        ], nearest.x, nearest.y - 46);
      }
    }
  };

  redraw(null);
  attachHover(canvas, redraw);
}

// ── Chart 2: taste over time (top 5 genres, count per month) ──
export function renderTasteOverTime(canvas, legendEl, entries) {
  const withGenre = entries.filter(e => e.genre);
  const months = monthRange(withGenre);
  if (months.length < 2 || withGenre.length < 4) {
    drawEmptyNote(canvas, 'Log songs with genres across a few months to see how your taste moves.');
    if (legendEl) legendEl.innerHTML = '';
    return;
  }

  const totals = {};
  withGenre.forEach(e => { totals[e.genre] = (totals[e.genre] || 0) + 1; });
  const topGenres = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);

  const counts = {}; // genre -> month -> n
  for (const e of withGenre) {
    if (!topGenres.includes(e.genre)) continue;
    const d = parseDate(e.date || e.createdAt);
    if (isNaN(d)) continue;
    const k = monthKey(d);
    counts[e.genre] = counts[e.genre] || {};
    counts[e.genre][k] = (counts[e.genre][k] || 0) + 1;
  }

  const series = topGenres.map((g, gi) => ({
    name: g,
    color: CHART_COLORS[gi],
    values: months.map(k => (counts[g] && counts[g][k]) || 0),
  }));
  const yMax = Math.max(2, ...series.flatMap(s => s.values));
  const yTicks = [];
  const tickStep = Math.max(1, Math.ceil(yMax / 4));
  for (let t = 0; t <= yMax; t += tickStep) yTicks.push(t);

  if (legendEl) {
    legendEl.innerHTML = series.map(s => `
      <span class="chart-legend-item">
        <span class="chart-legend-swatch" style="background:${s.color}"></span>${s.name}
      </span>
    `).join('');
  }

  const redraw = (hover) => {
    const { ctx, w, h } = setupCanvas(canvas);
    const f = frame(ctx, w, h, { l: 30, r: 76, t: 12, b: 28 }, yMax, yTicks, months.map(monthLabel));
    const allPts = series.map(s => ({
      ...s,
      pts: s.values.map((v, i) => ({ x: f.x(i), y: f.y(v), v, i })),
    }));

    for (const s of allPts) drawLine(ctx, s.pts, s.color);

    // direct labels at line ends (identity is never color-alone).
    // Sort by end height, then space labels 13px apart within the plot.
    ctx.font = '11px Figtree, sans-serif';
    ctx.textAlign = 'left';
    const labeled = allPts
      .map(s => ({ s, y: s.pts[s.pts.length - 1].y + 4 }))
      .sort((a, b) => a.y - b.y);
    for (let i = 0; i < labeled.length; i++) {
      const minY = i === 0 ? f.pad.t + 8 : labeled[i - 1].y + 13;
      labeled[i].y = Math.max(labeled[i].y, minY);
    }
    const overflow = labeled.length
      ? labeled[labeled.length - 1].y - (h - f.pad.b) : 0;
    for (const l of labeled) {
      const last = l.s.pts[l.s.pts.length - 1];
      ctx.fillStyle = INK_MID;
      ctx.fillText(l.s.name, last.x + 8, l.y - Math.max(0, overflow));
    }

    if (hover) {
      const n = months.length;
      const idx = Math.max(0, Math.min(n - 1, Math.round(
        ((hover.mx - f.pad.l) / f.plotW) * (n - 1))));
      const cx = f.x(idx);
      ctx.strokeStyle = 'rgba(242,237,228,0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, f.pad.t);
      ctx.lineTo(cx, f.pad.t + f.plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const s of allPts) {
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(cx, s.pts[idx].y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      drawTooltip(ctx, w, [
        { text: monthLabel(months[idx]), strong: true },
        ...series.map(s => ({ text: `${s.name}: ${s.values[idx]}`, swatch: s.color })),
      ], cx, f.pad.t + 8);
    }
  };

  redraw(null);
  attachHover(canvas, redraw);
}
