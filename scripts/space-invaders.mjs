#!/usr/bin/env node
// Renders a GitHub contribution calendar as a Space Invaders arcade scene (SVG).
// Every day of the calendar is drawn as a cell at its real week/weekday position;
// days with contributions become arcade blocks coloured by level, and the player
// ship shoots only at real contribution days.
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

// Player fighter: left half including the centre column, mirrored at load time.
// k outline · d/m/l/s hull dark→silver · n neon edge · c/C canopy · b blue · p purple
// e exhaust nozzle · w blinking nav light
const SHIP = [
  '...............kn',
  '...............ks',
  '..............kml',
  '..............kml',
  '.............kmls',
  '............kdmnC',
  '..n........kdmncC',
  '..s.......kdmmncc',
  '.kmk......kdmlncc',
  '.kmk.....kdmlmbcc',
  '.kmk...kkdmlmmbbc',
  '.kmlkkkddmlmmpbbm',
  'kdmldmmdmlllmpbms',
  'knlsllllllsslpbml',
  'kdmmkmmmkmmmmpdml',
  'kddwdkdmmkmmdpddm',
  '.kkkkkddddkdeedkd',
  '.........kmeeeekd',
  '..........keeeekk',
].map((r) => r + [...r.slice(0, -1)].reverse().join(''));
const SHIP_COLORS = {
  k: '#090d22', d: '#232c54', m: '#45527f', l: '#8897cc', s: '#e6ecff', n: '#41e2ff',
  c: '#169fd2', C: '#d2f9ff', b: '#2f6bff', p: '#8b5cf6', e: '#04060d', w: '#ff4fd8',
};
// Engine flame frames (4 px wide, one per nozzle): W white-hot core → c cyan → b blue → p purple.
const FLAMES = [
  ['cWWc', '.WW.', '.cc.', '.bb.', '.p..', '....', '....'],
  ['cWWc', 'cWWc', '.cc.', '.cc.', '.bb.', '..p.', '....'],
  ['cWWc', '.WW.', 'cccc', '.cc.', '.bb.', '.bb.', '..p.'],
];
const FLAME_COLORS = { W: '#f4feff', c: '#41e2ff', b: '#2f6bff', p: '#8b5cf6' };
const MUZZLE = ['..X..', 'X.X.X', '.XXX.', 'XXXXX', '.XXX.'];

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

// Block colour per contribution level (index = level 0..4): empty slot, then
// purple → blue → cyan → neon green, rising in brightness with activity.
const BLOCKS = ['#0e1330', '#35287c', '#3a5ee0', '#1cbde3', '#4cf271'];

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

// Multi-colour bitmap: one path per palette key. `cls` optionally tags keys with a class.
function paletteBitmap(rows, colors, x, y, px, cls = {}) {
  return Object.entries(colors)
    .map(([key, fill]) => {
      const d = bitmapPath(rows.map((r) => r.replace(/./g, (ch) => (ch === key ? 'X' : '.'))), x, y, px);
      return d ? `<path${cls[key] ? ` class="${cls[key]}"` : ''} fill="${fill}" d="${d}"/>` : '';
    })
    .join('');
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
  const groundY = gridY + gridH + 104;
  const shipPx = 1.75;
  const shipW = SHIP[0].length * shipPx, shipH = SHIP.length * shipPx;
  const shipY = groundY - 15 - shipH; // leaves room for the exhaust flames
  const H = groundY + 38;
  const cellX = (c) => gridX + c * P;
  const cellY = (r) => gridY + r * P;

  // --- Targets: in each slice of the year, the busiest day that is the lowest
  // block in its week (a clear line of fire), only from days with contributions.
  const SHOTS = 4;
  const reachable = (c) => cellX(c) + CELL / 2 - shipW / 2 >= 10 && cellX(c) + CELL / 2 + shipW / 2 <= W - 10;
  const exposed = weeks.map((week, c) => {
    const active = week.filter((d) => d.count > 0);
    if (!active.length || !reachable(c)) return null;
    const day = active.reduce((a, b) => (b.weekday > a.weekday ? b : a));
    return { c, r: day.weekday, day };
  });
  const targets = [];
  for (let k = 0; k < SHOTS; k++) {
    const lo = Math.floor((k * cols) / SHOTS), hi = Math.floor(((k + 1) * cols) / SHOTS);
    const mid = (lo + hi - 1) / 2;
    const best = exposed
      .slice(lo, hi)
      .filter(Boolean)
      .sort((a, b) => b.day.count - a.day.count || Math.abs(a.c - mid) - Math.abs(b.c - mid))[0];
    if (best) targets.push(best);
  }
  const targetOf = new Map(targets.map((t, k) => [`${t.c},${t.r}`, k]));

  // --- Cells: every calendar day. Active days are bevelled arcade blocks.
  const cells = [], glow = [];
  let bevelHi = '', bevelLo = '', glints = '';
  weeks.forEach((week, c) => {
    for (const day of week) {
      const x = cellX(c), y = cellY(day.weekday);
      const rect =
        `<rect class="d" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="1" fill="${BLOCKS[day.level]}" ` +
        `data-date="${day.date}" data-count="${day.count}" data-level="${day.level}"><title>${esc(tooltip(day))}</title></rect>`;
      if (day.count === 0) {
        cells.push(rect);
        continue;
      }
      const hi = `M${x} ${y}h${CELL}v1.5h${-(CELL - 1.5)}v${CELL - 1.5}h-1.5z`;
      const lo = `M${x + CELL} ${y + CELL}h${-CELL}v-1.5h${CELL - 1.5}v${-(CELL - 1.5)}h1.5z`;
      const glint = `M${x + 2.5} ${y + 2.5}h1.5v1.5h-1.5z`;
      const k = targetOf.get(`${c},${day.weekday}`);
      if (k === undefined) {
        cells.push(rect);
        bevelHi += hi;
        bevelLo += lo;
        glints += glint;
        if (day.level >= 3) glow.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${BLOCKS[day.level]}"/>`);
      } else {
        // Targets carry their own bevel so the whole block can be destroyed and respawned.
        cells.push(
          `<g class="tg tg${k}">${rect}<g class="art"><path d="${hi}" fill="#fff" opacity=".38"/><path d="${lo}" fill="#000" opacity=".35"/>` +
            `<path d="${glint}" fill="#fff" opacity=".85"/>` +
            `<rect class="wf wf${k}" x="${x - 1}" y="${y - 1}" width="${CELL + 2}" height="${CELL + 2}" rx="1.5" fill="#ffffff" filter="url(#bloom)"/></g></g>`,
        );
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

  // --- Combat timeline (percentages of one loop). The ship sweeps left to right,
  // destroying each target block; destroyed blocks respawn later in the loop.
  const LOOP = 12;
  const shots = targets.map((t, k) => ({
    x: cellX(t.c) + CELL / 2,
    cy: cellY(t.r) + CELL / 2,
    hitY: cellY(t.r) + CELL,
    color: BLOCKS[t.day.level],
    fire: 12 + k * 22,
  }));
  const homeX = gridX + gridW / 2;
  const cannonFrames = [`0%{transform:translateX(${n(homeX)}px)}`];
  shots.forEach((s) => {
    cannonFrames.push(`${pct(s.fire - 3)}{transform:translateX(${n(s.x)}px)}`, `${pct(s.fire + 5)}{transform:translateX(${n(s.x)}px)}`);
  });
  cannonFrames.push(`94%{transform:translateX(${n(homeX)}px)}`, `100%{transform:translateX(${n(homeX)}px)}`);

  // Recoil kick and muzzle flash at every shot.
  const kick = shots.map((s) => `${pct(s.fire - 0.01)}{transform:translateY(0)}${pct(s.fire)}{transform:translateY(2.4px)}${pct(s.fire + 1.6)}{transform:translateY(0)}`).join('');
  const flash = shots.map((s) => `${pct(s.fire - 0.01)}{opacity:0;transform:scale(.4)}${pct(s.fire)}{opacity:1;transform:scale(1.25)}${pct(s.fire + 1.1)}{opacity:0;transform:scale(.8)}`).join('');

  const laserLen = 18;
  const laserTop = shipY - laserLen + 2;
  const wingDx = (SHIP[0].length / 2 - 2.5) * shipPx; // wing-tip cannons
  const shotCss = [], shotSvg = [];
  const burst = (name, t, dx, dy) =>
    `@keyframes ${name}{0%,${pct(t.start - 0.01)}{opacity:0;transform:translate(0,0)}${pct(t.start)}{opacity:1;transform:translate(0,0)}` +
    `${pct(t.end)}{opacity:0;transform:translate(${n(dx)}px,${n(dy)}px)}100%{opacity:0;transform:translate(${n(dx)}px,${n(dy)}px)}}`;
  shots.forEach((s, k) => {
    const dy = n(s.hitY - laserTop);
    const t0 = s.fire, t1 = s.fire + 3.5; // fire → impact (≈420 ms of flight)
    const respawn = Math.min(t1 + 30, 97.5);
    shotCss.push(
      `.l${k}{animation:l${k} ${LOOP}s linear infinite}` +
        `@keyframes l${k}{0%,${pct(t0 - 0.01)}{opacity:0;transform:translateY(0)}${pct(t0)}{opacity:1;transform:translateY(0)}` +
        `${pct(t1)}{opacity:1;transform:translateY(${dy}px)}${pct(t1 + 0.01)},100%{opacity:0;transform:translateY(${dy}px)}}`,
      // Twin wing bolts escort the main beam and fade out before reaching the grid.
      `.w${k}{animation:w${k} ${LOOP}s ease-out infinite}` +
        `@keyframes w${k}{0%,${pct(t0 - 0.01)}{opacity:0;transform:translateY(0)}${pct(t0 + 0.2)}{opacity:.9;transform:translateY(0)}` +
        `${pct(t0 + 2.4)}{opacity:0;transform:translateY(${n(dy * 0.55)}px)}100%{opacity:0}}`,
      // Block: white flash (120 ms), gone, then blinks back in.
      `.wf${k}{animation:wf${k} ${LOOP}s steps(1,end) infinite}` +
        `@keyframes wf${k}{0%{opacity:0}${pct(t1)}{opacity:1}${pct(t1 + 1)}{opacity:0}}`,
      `.tg${k}{animation:tg${k} ${LOOP}s steps(1,end) infinite}` +
        `@keyframes tg${k}{0%{opacity:1}${pct(t1 + 1)}{opacity:0}${pct(respawn)}{opacity:1}${pct(respawn + 0.4)}{opacity:0}` +
        `${pct(respawn + 0.8)}{opacity:1}${pct(respawn + 1.2)}{opacity:0}${pct(respawn + 1.6)}{opacity:1}}`,
      // Shockwave ring (≈360 ms).
      `.sw${k}{animation:sw${k} ${LOOP}s ease-out infinite}` +
        `@keyframes sw${k}{0%,${pct(t1 - 0.01)}{opacity:0;transform:scale(.1)}${pct(t1)}{opacity:.95;transform:scale(.15)}` +
        `${pct(t1 + 3)}{opacity:0;transform:scale(1)}100%{opacity:0;transform:scale(1)}}`,
    );
    shotSvg.push(
      `<g class="laser l${k}"><rect class="beam" x="${n(s.x - 3)}" y="${n(laserTop - 2)}" width="6" height="${laserLen + 4}" rx="3"/>` +
        `<rect x="${n(s.x - 1.5)}" y="${n(laserTop)}" width="3" height="${laserLen}" rx="1.5" fill="#41e2ff"/>` +
        `<rect x="${n(s.x - 0.6)}" y="${n(laserTop + 1)}" width="1.2" height="${laserLen - 2}" fill="#ffffff"/></g>`,
      ...[-1, 1].map((side) => `<rect class="wbolt w${k}" x="${n(s.x + side * wingDx - 0.8)}" y="${n(shipY + 2)}" width="1.6" height="7" rx=".8"/>`),
      `<circle class="fx sw sw${k}" cx="${n(s.x)}" cy="${n(s.cy)}" r="13"/>`,
    );
    // Six glowing fragments scatter outward (≈420 ms), four sparks fly further and fade.
    const light = mix(s.color, '#ffffff', 0.55);
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * Math.PI * 2 + 0.35 + k * 0.6;
      const dist = 11 + (j % 3) * 2;
      shotCss.push(`.fr${k}_${j}{animation:fr${k}_${j} ${LOOP}s cubic-bezier(.2,.7,.3,1) infinite}` + burst(`fr${k}_${j}`, { start: t1, end: t1 + 3.5 }, Math.cos(a) * dist, Math.sin(a) * dist));
      shotSvg.push(`<rect class="fx fr${k}_${j}" x="${n(s.x - 1.2)}" y="${n(s.cy - 1.2)}" width="2.4" height="2.4" fill="${j % 2 ? '#e8fdff' : light}" filter="url(#bloom)"/>`);
    }
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * Math.PI * 2 + Math.PI / 4;
      shotCss.push(`.sp${k}_${j}{animation:sp${k}_${j} ${LOOP}s ease-out infinite}` + burst(`sp${k}_${j}`, { start: t1 + 0.3, end: t1 + 3.2 }, Math.cos(a) * 18, Math.sin(a) * 18));
      shotSvg.push(`<rect class="fx sp${k}_${j}" x="${n(s.x - 0.6)}" y="${n(s.cy - 0.6)}" width="1.2" height="1.2" fill="#fff6c9"/>`);
    }
  });

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
  const lives = [0, 1].map((i) => paletteBitmap(SHIP, SHIP_COLORS, gridX + 14 + i * 26, groundY + 9.5, 0.62)).join('');
  const livesNum = text('3', gridX, groundY + 14, 1.3).d;
  const caption = text(`${total} contributions in the last year`, W / 2, groundY + 14, 1.15, 'middle').d;
  const legendRight = gridX + gridW;
  const sq = 8, sqGap = 2;
  const legendW = 5 * (sq + sqGap) - sqGap;
  const legendX = legendRight - text('More', 0, 0, 1.1).width - 6 - legendW;
  const legend = [];
  for (let i = 0; i < 5; i++) {
    legend.push(`<rect x="${legendX + i * (sq + sqGap)}" y="${groundY + 10}" width="${sq}" height="${sq}" rx="1" fill="${BLOCKS[i]}"/>`);
  }
  const legendText = text('Less', legendX - 6, groundY + 13, 1.1, 'end').d + text('More', legendRight, groundY + 13, 1.1, 'end').d;

  // --- Player fighter: body, edge glow, canopy light, animated exhaust, muzzle flash.
  const solid = SHIP.map((r) => r.replace(/[^.]/g, 'X'));
  const flameY = shipY + shipH;
  const engineCols = [11, SHIP[0].length - 15];
  const nozzleX = engineCols.map((c) => (c + 2) * shipPx);
  const flames = FLAMES.map(
    (frame, i) => `<g class="fl fl${i}">${engineCols.map((c) => paletteBitmap(frame, FLAME_COLORS, c * shipPx, flameY, shipPx)).join('')}</g>`,
  ).join('');
  const muzzlePx = 1.4;
  const shipSvg = `<g class="art" transform="translate(${-n(shipW / 2)} 0)">
    <g class="cannon">
      <ellipse class="eglow" cx="${n(shipW / 2)}" cy="${groundY}" rx="${n(shipW * 0.62)}" ry="4" fill="url(#exhaust)"/>
      <g class="hover"><g class="kick">
        ${nozzleX.map((x) => `<ellipse class="eglow" cx="${n(x)}" cy="${n(flameY + 4)}" rx="6" ry="8" fill="url(#exhaust)"/>`).join('')}
        ${flames}
        <path d="${bitmapPath(solid, 0, shipY, shipPx)}" fill="#41e2ff" opacity=".3" filter="url(#halo)"/>
        <ellipse cx="${n(shipW / 2)}" cy="${n(shipY + 7.5 * shipPx)}" rx="4" ry="6" fill="#41e2ff" opacity=".35" filter="url(#halo)"/>
        ${paletteBitmap(SHIP, SHIP_COLORS, 0, shipY, shipPx, { w: 'nav', n: 'edge' })}
        <path class="muzzle" fill="#e8fdff" filter="url(#bloom)" d="${bitmapPath(MUZZLE, shipW / 2 - 2.5 * muzzlePx, shipY - 5 * muzzlePx - 0.5, muzzlePx)}"/>
      </g></g>
    </g>
  </g>`;

  const css = `
.d{transition:filter .25s ease,stroke .25s ease;stroke:transparent;stroke-width:1}
.d:hover{filter:brightness(1.8) drop-shadow(0 0 3px #fff);stroke:#ffffff}
.art{pointer-events:none}
.glow{animation:pulse 3.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.32}50%{opacity:.6}}
.tw{animation:tw 4s ease-in-out infinite}
.t2{animation-duration:6.5s}.t3{animation-duration:9s}
@keyframes tw{0%,100%{opacity:.85}45%{opacity:.15}55%{opacity:1}}
.cannon{animation:cannon ${LOOP}s ease-in-out infinite;transform:translateX(${n(homeX)}px)}
@keyframes cannon{${cannonFrames.join('')}}
.hover{animation:hover 2.8s ease-in-out infinite}
@keyframes hover{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.6px)}}
.kick{animation:kick ${LOOP}s linear infinite}
@keyframes kick{0%{transform:translateY(0)}${kick}100%{transform:translateY(0)}}
.fl{opacity:0;animation:fl .27s steps(1,end) infinite}
.fl1{animation-delay:-.18s}.fl2{animation-delay:-.09s}
@keyframes fl{0%{opacity:1}33.33%{opacity:0}}
.eglow{animation:eglow .9s ease-in-out infinite}
@keyframes eglow{0%,100%{opacity:.6}50%{opacity:.95}}
.nav{animation:nav 1.6s steps(1,end) infinite}
@keyframes nav{50%{fill:#4a1846}}
.edge{animation:edge 2.4s ease-in-out infinite}
@keyframes edge{50%{fill:#b4f6ff}}
.muzzle{opacity:0;transform-box:fill-box;transform-origin:center;animation:muzzle ${LOOP}s linear infinite}
@keyframes muzzle{0%{opacity:0}${flash}100%{opacity:0}}
.laser{filter:url(#bloom);opacity:0}
.beam{fill:#2f6bff;opacity:.5}
.wbolt{fill:#b48cff;filter:url(#bloom);opacity:0}
.fx,.wf{opacity:0}
.sw{fill:none;stroke:#41e2ff;stroke-width:1.4;vector-effect:non-scaling-stroke;filter:url(#bloom);transform-box:fill-box;transform-origin:center}
${shotCss.join('\n')}
.roll{animation:roll 7s linear infinite}
@keyframes roll{0%{transform:translateY(-60px)}100%{transform:translateY(${H + 60}px)}}
.screen{animation:flicker 9s steps(1,end) infinite}
@keyframes flicker{0%,100%{opacity:1}31%{opacity:.97}32%{opacity:1}77%{opacity:.985}78%{opacity:1}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

  const screenR = 18;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(W)} ${n(H)}" width="${n(W)}" height="${n(H)}" role="img" aria-labelledby="title desc">
<title id="title">${esc(login ? `${login}'s` : 'GitHub')} contribution graph as a Space Invaders arcade scene</title>
<desc id="desc">${esc(`${total} contributions in the last year. Each square is one day of the contribution calendar; days with contributions are arcade blocks coloured by activity, and the ship shoots only at real contribution days.`)}</desc>
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
  <radialGradient id="exhaust">
    <stop offset="0" stop-color="#41e2ff" stop-opacity=".55"/><stop offset=".5" stop-color="#2f6bff" stop-opacity=".18"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
  </radialGradient>
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
  <g class="art" fill="#5ef2ff" filter="url(#soft)"><path d="${hudLabels.join('')}"/></g>
  <g class="art" fill="#f4f7ff" filter="url(#soft)"><path d="${hudValues.join('')}"/></g>
  <g class="art" fill="#7d86b8"><path d="${monthLabels.join('')}${dayLabels.join('')}"/></g>
  <g class="glow art" filter="url(#halo)">${glow.join('')}</g>
  <g>${cells.join('')}</g>
  <g class="art"><path d="${bevelHi}" fill="#fff" opacity=".38"/><path d="${bevelLo}" fill="#000" opacity=".35"/><path d="${glints}" fill="#fff" opacity=".85"/></g>
  <g class="art">${shotSvg.join('')}</g>
  ${shipSvg}
  <rect class="art" x="${gridX}" y="${groundY}" width="${gridW}" height="1.5" fill="#4cf271" opacity=".85" filter="url(#bloom)"/>
  <g class="art">
    <path fill="#4cf271" d="${livesNum}"/>${lives}
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
