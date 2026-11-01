#!/usr/bin/env node
// Renders a GitHub contribution calendar as a Space Invaders arcade scene (SVG).
// Every day of the calendar is drawn as a cell at its real week/weekday position;
// the invaders are painted onto those same cells, tinted by each day's level.
//
// Usage:
//   GITHUB_TOKEN=... node scripts/space-invaders.mjs --user <login> [--out dist/space-invaders.svg]
//   node scripts/space-invaders.mjs --input calendar.json [--user <login>] [--out file.svg]
//
// No dependencies; requires Node 18+ (global fetch).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// CLI / data
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] ?? argv[++i];
  }
  return args;
}

const QUERY = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date weekday contributionCount contributionLevel } }
      }
    }
  }
}`;

async function fetchCalendar(login, token) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'space-invaders-contribution-graph',
    },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL request failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GitHub GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data.user.contributionsCollection.contributionCalendar;
}

// Accepts either a raw GraphQL response or the bare contributionCalendar object.
function unwrapCalendar(json) {
  return json?.data?.user?.contributionsCollection?.contributionCalendar ?? json;
}

const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

// ---------------------------------------------------------------------------
// Pixel art
// ---------------------------------------------------------------------------

// Invaders are 7 rows tall so they fit the 7 weekday rows exactly.
// Each has two frames; cells that differ between frames animate the legs.
const SPRITES = {
  squid: [
    ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '..X..X..', '.X.XX.X.'],
    ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '.X.XX.X.', 'X......X'],
  ],
  crab: [
    ['..X.....X..', '...X...X...', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', 'X.XXXXXXX.X', 'X.X.....X.X'],
    ['..X.....X..', 'X..X...X..X', 'X.XXXXXXX.X', 'XXX.XXX.XXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '..X.....X..'],
  ],
  octopus: [
    ['....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX', 'XXXXXXXXXXXX', '..XX.XX.XX..', 'XX........XX'],
    ['....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX', 'XXXXXXXXXXXX', '.XX..XX..XX.', '..XX....XX..'],
  ],
};

const CANNON = ['......X......', '.....XXX.....', '.....XXX.....', '.XXXXXXXXXXX.', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX'];
const UFO = ['.....XXXXXX.....', '...XXXXXXXXXX...', '..XXXXXXXXXXXX..', '.XX.XX.XX.XX.XX.', 'XXXXXXXXXXXXXXXX', '..XXX..XX..XXX..', '...X........X...'];
const BOOM = ['X...X...X', '.X..X..X.', '..X...X..', 'XX.....XX', '..X...X..', '.X..X..X.', 'X...X...X'];
const BOMB = ['X..', '.X.', '..X', '.X.', 'X..', '.X.', '..X'];
const SPARK = ['X.X.X', '.XXX.', 'XXXXX'];

// Preferred formations first; the first one that fits inside the full weeks wins.
const FORMATIONS = [
  ['squid', 'crab', 'octopus', 'crab', 'squid'],
  ['squid', 'crab', 'squid', 'crab', 'squid'],
  ['crab', 'squid', 'crab'],
  ['squid', 'crab'],
  ['squid'],
];

// 5x7 bitmap font (glyph rows as bit strings).
const FONT = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111', 3: '11111 00010 00100 00010 00001 10001 01110',
  4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
  '-': '00000 00000 00000 11111 00000 00000 00000', ':': '00000 01100 01100 00000 01100 01100 00000',
  '.': '00000 00000 00000 00000 00000 01100 01100', '<': '00010 00100 01000 10000 01000 00100 00010',
  '>': '01000 00100 00010 00001 00010 00100 01000', '/': '00001 00001 00010 00100 01000 10000 10000',
  '@': '01110 10001 10111 10101 10111 10000 01110', _: '00000 00000 00000 00000 00000 00000 11111',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
};

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

// Contribution level ramps (index = level 0..4).
const SPACE = ['#0e1330', '#1a2050', '#262c74', '#34399a', '#4748c2'];
const HUES = {
  green: ['#1b6a36', '#1f9a43', '#2ccd57', '#58f57c', '#d0ffd3'],
  cyan: ['#14647c', '#148aa6', '#1bbbdc', '#4ae6ff', '#d2f9ff'],
  magenta: ['#6e2273', '#932597', '#bf35bf', '#ec58e2', '#ffc2f7'],
};

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => rgbToHex(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * t));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const n = (v) => Math.round(v * 100) / 100;
const pct = (v) => `${n(v)}%`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

// Converts a bitmap (rows of 'X'/'1') to a compact path of horizontal runs.
function bitmapPath(rows, x, y, px) {
  let d = '';
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== 'X' && row[c] !== '1') continue;
      let len = 1;
      while (c + len < row.length && (row[c + len] === 'X' || row[c + len] === '1')) len++;
      d += `M${n(x + c * px)} ${n(y + r * px)}h${n(len * px)}v${n(px)}h${n(-len * px)}z`;
      c += len - 1;
    }
  });
  return d;
}

function text(str, x, y, px, align = 'start') {
  const chars = [...String(str).toUpperCase()];
  const width = chars.length * 6 * px - px;
  const x0 = align === 'middle' ? x - width / 2 : align === 'end' ? x - width : x;
  const d = chars.map((ch, i) => bitmapPath((FONT[ch] ?? FONT[' ']).split(' '), x0 + i * 6 * px, y, px)).join('');
  return { d, width };
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function tooltip(day) {
  const when = DATE_FMT.format(new Date(`${day.date}T00:00:00Z`));
  if (day.count === 0) return `No contributions on ${when}`;
  return `${day.count} contribution${day.count === 1 ? '' : 's'} on ${when}`;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function render(calendar, login) {
  const weeks = calendar.weeks.map((w) =>
    w.contributionDays.map((d) => ({
      date: d.date,
      weekday: d.weekday,
      count: d.contributionCount,
      level: LEVELS[d.contributionLevel] ?? 0,
    })),
  );
  const days = weeks.flat();
  const cols = weeks.length;

  // Geometry (GitHub uses 10px cells with a 3px gap).
  const CELL = 10, GAP = 3, P = CELL + GAP;
  const gridX = 46, gridY = 94;
  const gridW = cols * P - GAP, gridH = 7 * P - GAP;
  const W = gridX + gridW + 28;
  const groundY = gridY + gridH + 72;
  const cannonPx = 1.5;
  const cannonY = groundY - 4 - CANNON.length * cannonPx;
  const H = groundY + 38;
  const cellX = (c) => gridX + c * P;
  const cellY = (r) => gridY + r * P;

  // --- Formation: place invaders inside the longest run of complete weeks.
  const full = weeks.map((w) => w.length === 7);
  let run = { start: 0, len: 0 };
  for (let c = 0, s = 0; c <= cols; c++) {
    if (c < cols && full[c]) continue;
    if (c - s > run.len) run = { start: s, len: c - s };
    s = c + 1;
  }
  const widthOf = (name) => SPRITES[name][0][0].length;
  const formation = FORMATIONS.find((f) => f.reduce((a, s) => a + widthOf(s), 0) + (f.length - 1) + 2 <= run.len) ?? [];
  const spriteW = formation.reduce((a, s) => a + widthOf(s), 0);
  const gap = run.len - spriteW - (formation.length - 1) * 2 >= 2 ? 2 : 1;
  let cursor = run.start + Math.floor((run.len - spriteW - (formation.length - 1) * gap) / 2);

  const mid = (formation.length - 1) / 2;
  const aliens = formation.map((name, i) => {
    const dist = Math.abs(i - mid);
    const hue = dist === 0 ? 'magenta' : Math.round(dist) % 2 === 1 ? 'green' : 'cyan';
    const alien = { name, hue, col: cursor, width: widthOf(name) };
    cursor += alien.width + gap;
    return alien;
  });

  // Pixel map: "col,row" -> { alien, frame: 'both' | 'a' | 'b', shade }.
  const pixels = new Map();
  for (const alien of aliens) {
    const [fa, fb] = SPRITES[alien.name];
    const on = (frame, r, c) => r >= 0 && r < 7 && frame[r][c] === 'X';
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < alien.width; c++) {
        const a = on(fa, r, c), b = on(fb, r, c);
        if (!a && !b) continue;
        const above = on(fa, r - 1, c) || on(fb, r - 1, c);
        const below = on(fa, r + 1, c) || on(fb, r + 1, c);
        const shade = !above ? 'hi' : !below ? 'lo' : 'mid';
        pixels.set(`${alien.col + c},${r}`, { alien, frame: a && b ? 'both' : a ? 'a' : 'b', shade });
      }
    }
  }

  const alienColor = (hue, level, shade) => {
    const base = HUES[hue][level];
    return shade === 'hi' ? mix(base, '#ffffff', 0.16) : shade === 'lo' ? mix(base, '#000000', 0.22) : base;
  };

  // --- Cells (the real calendar) + invader overlays + glow layer.
  const cells = [], overlays = [], glow = [];
  weeks.forEach((week, c) => {
    for (const day of week) {
      const r = day.weekday;
      const x = cellX(c), y = cellY(r);
      const px = pixels.get(`${c},${r}`);
      const art = px && px.frame === 'both';
      const fill = art ? alienColor(px.alien.hue, day.level, px.shade) : SPACE[day.level];
      cells.push(
        `<rect class="d" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}" ` +
          `data-date="${day.date}" data-count="${day.count}" data-level="${day.level}"><title>${esc(tooltip(day))}</title></rect>`,
      );
      if (px) {
        const cls = px.frame === 'both' ? '' : ` class="f${px.frame}"`;
        if (!art) overlays.push(`<rect${cls} x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${alienColor(px.alien.hue, day.level, px.shade)}"/>`);
        glow.push(`<rect${cls} x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${HUES[px.alien.hue][3]}"/>`);
      }
    }
  });

  // --- Labels.
  const monthLabels = [];
  let lastLabelCol = -10;
  weeks.forEach((week, c) => {
    const first = week[0];
    if (!first) return;
    const month = Number(first.date.slice(5, 7)) - 1;
    const prev = weeks[c - 1]?.[0];
    const isNew = c === 0 ? Number(first.date.slice(8, 10)) <= 7 : Number(prev.date.slice(5, 7)) - 1 !== month;
    if (isNew && c - lastLabelCol >= 3 && c < cols - 2) {
      monthLabels.push(text(MONTHS[month], cellX(c), gridY - 14, 1).d);
      lastLabelCol = c;
    }
  });
  const dayLabels = [[1, 'Mon'], [3, 'Wed'], [5, 'Fri']].map(([r, s]) => text(s, gridX - 7, cellY(r) + 1.5, 1, 'end').d);

  // --- HUD stats from the data.
  const total = calendar.totalContributions;
  const best = Math.max(0, ...days.map((d) => d.count));
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) streak++;
    else if (i === days.length - 1) continue; // today may not have activity yet
    else break;
  }
  const pad = (v, len) => String(v).padStart(len, '0');
  const hudCols = [gridX + 50, W / 2, W - 96];
  const hudLabels = [['SCORE<1>', hudCols[0]], ['HI-SCORE', hudCols[1]], ['STREAK', hudCols[2]]].map(([s, x]) => text(s, x, 18, 1.3, 'middle').d);
  const hudValues = [[pad(total, 5), hudCols[0]], [pad(best, 4), hudCols[1]], [pad(streak, 3), hudCols[2]]].map(([s, x]) => text(s, x, 34, 1.6, 'middle').d);

  // --- Combat timeline (seconds / percentages of one loop).
  const LOOP = 12;
  const targetIdx = [...new Set([1, aliens.length - 2, Math.floor(aliens.length / 2)].filter((i) => i >= 0 && i < aliens.length))];
  if (!targetIdx.length && aliens.length) targetIdx.push(0);
  const shots = targetIdx.map((i, k) => {
    const alien = aliens[i];
    const col = alien.col + Math.floor((alien.width - 1) / 2);
    let row = -1;
    for (let r = 0; r < 7; r++) if (pixels.has(`${col},${r}`)) row = r;
    const fire = 16 + k * 26;
    return { x: cellX(col) + CELL / 2, hitY: cellY(Math.max(row, 0)) + CELL, fire };
  });
  const homeX = gridX + 24;
  const cannonFrames = [`0%{transform:translateX(${n(homeX)}px)}`];
  shots.forEach((s) => {
    cannonFrames.push(`${pct(s.fire - 3)}{transform:translateX(${n(s.x)}px)}`, `${pct(s.fire + 5)}{transform:translateX(${n(s.x)}px)}`);
  });
  cannonFrames.push(`94%{transform:translateX(${n(homeX)}px)}`, `100%{transform:translateX(${n(homeX)}px)}`);

  const laserTop = cannonY - 12;
  const shotCss = [], shotSvg = [];
  shots.forEach((s, k) => {
    const dy = n(s.hitY - laserTop);
    const t0 = s.fire, t1 = s.fire + 3.5, t2 = t1 + 6;
    shotCss.push(
      `.l${k}{animation:l${k} ${LOOP}s linear infinite}` +
        `@keyframes l${k}{0%,${pct(t0 - 0.01)}{opacity:0;transform:translateY(0)}${pct(t0)}{opacity:1;transform:translateY(0)}` +
        `${pct(t1)}{opacity:1;transform:translateY(${dy}px)}${pct(t1 + 0.01)},100%{opacity:0;transform:translateY(${dy}px)}}`,
      `.x${k}{animation:x${k} ${LOOP}s steps(1,end) infinite}` +
        `@keyframes x${k}{0%,${pct(t1 - 0.01)}{opacity:0;transform:scale(.5)}${pct(t1)}{opacity:1;transform:scale(.7)}` +
        `${pct(t1 + 1.5)}{opacity:1;transform:scale(1)}${pct(t1 + 3.5)}{opacity:.7;transform:scale(1.15)}${pct(t2)},100%{opacity:0}}`,
    );
    shotSvg.push(
      `<rect class="laser l${k}" x="${n(s.x - 1.25)}" y="${n(laserTop)}" width="2.5" height="12" rx="1.25"/>`,
      `<path class="boom x${k}" d="${bitmapPath(BOOM, s.x - 6.75, s.hitY - 7, 1.5)}"/>`,
    );
  });

  // One invader bomb drops between shots.
  let bombSvg = '', bombCss = '';
  if (aliens.length) {
    const alien = aliens[aliens.length - 1];
    const bx = cellX(alien.col + Math.floor(alien.width / 2)) + CELL / 2;
    const fall = n(groundY - 10 - (gridY + gridH + 2));
    bombSvg =
      `<path class="bomb" d="${bitmapPath(BOMB, bx - 2, gridY + gridH + 2, 1.3)}"/>` +
      `<path class="spark" d="${bitmapPath(SPARK, bx - 4, groundY - 5, 1.6)}"/>`;
    bombCss =
      `.bomb{animation:bomb ${LOOP}s linear infinite}` +
      `@keyframes bomb{0%,53.99%{opacity:0;transform:translateY(0)}54%{opacity:1;transform:translateY(0)}64%{opacity:1;transform:translateY(${fall}px)}64.01%,100%{opacity:0;transform:translateY(${fall}px)}}` +
      `.spark{animation:spark ${LOOP}s steps(1,end) infinite}` +
      `@keyframes spark{0%,63.99%{opacity:0}64%{opacity:1}68%,100%{opacity:0}}`;
  }

  // --- Starfield: deterministic, kept out of the grid and label bands.
  const rand = mulberry32(hash(login || 'github'));
  const stars = [];
  for (let tries = 0; stars.length < 46 && tries < 3000; tries++) {
    const x = 18 + rand() * (W - 36), y = 46 + rand() * (groundY - 52);
    const inGrid = x > gridX - 6 && x < gridX + gridW + 6 && y > gridY - 22 && y < gridY + gridH + 6;
    const inLabels = x < gridX && y > gridY - 22 && y < gridY + gridH;
    if (inGrid || inLabels) continue;
    if (stars.some((s) => Math.hypot(s.x - x, s.y - y) < 18)) continue;
    const r = rand();
    const size = r < 0.62 ? 1 : r < 0.9 ? 1.5 : 2;
    const color = ['#ffffff', '#bfefff', '#d9c8ff', '#fff3c4'][Math.floor(rand() * 4)];
    stars.push({ x, y, size, color, t: 1 + Math.floor(rand() * 3), delay: n(rand() * 6) });
  }
  const starSvg = stars
    .map((s) => {
      const body = `<rect x="${n(s.x)}" y="${n(s.y)}" width="${s.size}" height="${s.size}" fill="${s.color}"/>`;
      const cross = s.size === 2
        ? `<rect x="${n(s.x - 2)}" y="${n(s.y + 0.5)}" width="6" height="1" fill="${s.color}" opacity=".45"/><rect x="${n(s.x + 0.5)}" y="${n(s.y - 2)}" width="1" height="6" fill="${s.color}" opacity=".45"/>`
        : '';
      return `<g class="tw t${s.t}" style="animation-delay:-${s.delay}s">${body}${cross}</g>`;
    })
    .join('');

  // --- Footer: lives, caption, legend.
  const lives = [0, 1].map((i) => bitmapPath(CANNON, gridX + 16 + i * 24, groundY + 13, 1.2)).join('');
  const livesNum = text('3', gridX, groundY + 14, 1.3).d;
  const caption = text(`${total} contributions in the last year`, W / 2, groundY + 14, 1.15, 'middle').d;
  const legendRight = gridX + gridW;
  const sq = 8, sqGap = 2;
  const legendW = 5 * (sq + sqGap) - sqGap;
  const legendX = legendRight - text('More', 0, 0, 1.1).width - 6 - legendW;
  const legend = [];
  for (let i = 0; i < 5; i++) {
    legend.push(`<rect x="${legendX + i * (sq + sqGap)}" y="${groundY + 10}" width="${sq}" height="${sq / 2 + 1}" rx="1" fill="${SPACE[i]}"/>`);
    legend.push(`<rect x="${legendX + i * (sq + sqGap)}" y="${groundY + 15.5}" width="${sq}" height="${sq / 2 + 1}" rx="1" fill="${HUES.green[i]}"/>`);
  }
  const legendText = text('Less', legendX - 6, groundY + 13, 1.1, 'end').d + text('More', legendRight, groundY + 13, 1.1, 'end').d;

  const ufoW = UFO[0].length * 1.6;

  const css = `
.d{transition:filter .25s ease,stroke .25s ease;stroke:transparent;stroke-width:1}
.d:hover{filter:brightness(1.8) drop-shadow(0 0 3px #fff);stroke:#ffffff}
.art{pointer-events:none}
.fb{opacity:0}
.fa{animation:fa 1.2s steps(1,end) infinite}
.fb{animation:fb 1.2s steps(1,end) infinite}
@keyframes fa{0%{opacity:1}50%{opacity:0}}
@keyframes fb{0%{opacity:0}50%{opacity:1}}
.glow{animation:pulse 3.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.32}50%{opacity:.6}}
.tw{animation:tw 4s ease-in-out infinite}
.t2{animation-duration:6.5s}.t3{animation-duration:9s}
@keyframes tw{0%,100%{opacity:.85}45%{opacity:.15}55%{opacity:1}}
.cannon{animation:cannon ${LOOP}s ease-in-out infinite;transform:translateX(${n(homeX)}px)}
@keyframes cannon{${cannonFrames.join('')}}
.laser{fill:#e6fdff;filter:url(#bloom);opacity:0}
.boom{fill:#fff6c9;filter:url(#bloom);opacity:0;transform-box:fill-box;transform-origin:center}
.bomb{fill:#ffd36b;opacity:0}
.spark{fill:#ff8a5c;opacity:0}
${shotCss.join('\n')}
${bombCss}
.ufo{animation:ufo 26s linear infinite;animation-delay:3s;transform:translateX(-60px)}
@keyframes ufo{0%{transform:translateX(-60px)}32%,100%{transform:translateX(${n(W + 20)}px)}}
.ufo path{animation:ufoblink .5s steps(1,end) infinite}
@keyframes ufoblink{50%{fill:#ff8bea}}
.roll{animation:roll 7s linear infinite}
@keyframes roll{0%{transform:translateY(-60px)}100%{transform:translateY(${H + 60}px)}}
.screen{animation:flicker 9s steps(1,end) infinite}
@keyframes flicker{0%,100%{opacity:1}31%{opacity:.97}32%{opacity:1}77%{opacity:.985}78%{opacity:1}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

  const screenR = 18;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(W)} ${n(H)}" width="${n(W)}" height="${n(H)}" role="img" aria-labelledby="title desc">
<title id="title">${esc(login ? `${login}'s` : 'GitHub')} contribution graph as a Space Invaders arcade scene</title>
<desc id="desc">${esc(`${total} contributions in the last year. Each square is one day of the contribution calendar; the invaders are drawn onto the real cells and shaded by each day's activity.`)}</desc>
<style>${css}</style>
<defs>
  <radialGradient id="tube" cx="50%" cy="45%" r="75%">
    <stop offset="0" stop-color="#0c1233"/><stop offset=".6" stop-color="#070a1f"/><stop offset="1" stop-color="#020309"/>
  </radialGradient>
  <radialGradient id="vignette" cx="50%" cy="50%" r="72%">
    <stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".62"/>
  </radialGradient>
  <linearGradient id="glass" x1="0" y1="0" x2=".55" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset=".35" stop-color="#fff" stop-opacity=".015"/><stop offset=".36" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#9fd8ff" stop-opacity="0"/><stop offset=".5" stop-color="#9fd8ff" stop-opacity=".045"/><stop offset="1" stop-color="#9fd8ff" stop-opacity="0"/>
  </linearGradient>
  <pattern id="scan" width="4" height="3" patternUnits="userSpaceOnUse">
    <rect width="4" height="1" fill="#000" opacity=".32"/>
  </pattern>
  <filter id="bloom" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="halo" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="2.4"/></filter>
  <filter id="soft" x="-10%" y="-40%" width="120%" height="180%">
    <feGaussianBlur stdDeviation=".9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <clipPath id="tubeClip"><rect x="6" y="6" width="${n(W - 12)}" height="${n(H - 12)}" rx="${screenR}"/></clipPath>
</defs>
<rect width="${n(W)}" height="${n(H)}" rx="${screenR + 6}" fill="#04050b"/>
<g clip-path="url(#tubeClip)">
<g class="screen">
  <rect x="6" y="6" width="${n(W - 12)}" height="${n(H - 12)}" fill="url(#tube)"/>
  <g class="art">${starSvg}</g>
  <g class="ufo art"><path fill="#ff3fd2" filter="url(#bloom)" d="${bitmapPath(UFO, 0, 50, 1.6)}"/></g>
  <g class="art" fill="#5ef2ff" filter="url(#soft)"><path d="${hudLabels.join('')}"/></g>
  <g class="art" fill="#f4f7ff" filter="url(#soft)"><path d="${hudValues.join('')}"/></g>
  <g class="art" fill="#7d86b8"><path d="${monthLabels.join('')}${dayLabels.join('')}"/></g>
  <g class="glow art" filter="url(#halo)">${glow.join('')}</g>
  <g>${cells.join('')}</g>
  <g class="art">${overlays.join('')}</g>
  <g class="art">${bombSvg}${shotSvg.join('')}</g>
  <g class="art" transform="translate(${-n(CANNON[0].length * cannonPx / 2)} 0)">
    <g class="cannon"><path fill="#4cf271" filter="url(#bloom)" d="${bitmapPath(CANNON, 0, cannonY, cannonPx)}"/></g>
  </g>
  <rect class="art" x="${gridX}" y="${groundY}" width="${gridW}" height="1.5" fill="#4cf271" opacity=".85" filter="url(#bloom)"/>
  <g class="art">
    <path fill="#4cf271" d="${livesNum}${lives}"/>
    <path fill="#7d86b8" d="${caption}${legendText}"/>
    ${legend.join('')}
  </g>
  <rect class="art roll" x="6" y="0" width="${n(W - 12)}" height="60" fill="url(#band)"/>
</g>
<rect class="art" x="6" y="6" width="${n(W - 12)}" height="${n(H - 12)}" fill="url(#scan)"/>
<rect class="art" x="6" y="6" width="${n(W - 12)}" height="${n(H - 12)}" fill="url(#vignette)"/>
<rect class="art" x="6" y="6" width="${n(W - 12)}" height="${n(H - 12)}" fill="url(#glass)"/>
</g>
<rect class="art" x="6.5" y="6.5" width="${n(W - 13)}" height="${n(H - 13)}" rx="${screenR}" fill="none" stroke="#1d2550" stroke-opacity=".9"/>
</svg>
`;
}

// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const login = args.user || process.env.GITHUB_USER || process.env.GITHUB_REPOSITORY_OWNER || '';
const out = args.out || 'dist/space-invaders.svg';

let calendar;
if (args.input) {
  calendar = unwrapCalendar(JSON.parse(await readFile(args.input, 'utf8')));
} else {
  const token = process.env.GITHUB_TOKEN;
  if (!login || !token) throw new Error('Provide --user and GITHUB_TOKEN, or --input <calendar.json>.');
  calendar = await fetchCalendar(login, token);
}

await mkdir(path.dirname(path.resolve(out)), { recursive: true });
await writeFile(out, render(calendar, login));
console.log(`Wrote ${out}`);
