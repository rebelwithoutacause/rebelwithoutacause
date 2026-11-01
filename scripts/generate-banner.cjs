#!/usr/bin/env node
// Generates the animated terminal banner shown at the top of the GitHub profile README
// (assets/banner/terminal-banner.svg).
//
// Usage (from the repository root, or anywhere — paths are resolved from this file):
//   node scripts/generate-banner.cjs                 # writes assets/banner/terminal-banner.svg
//   node scripts/generate-banner.cjs path/to/out.svg  # writes somewhere else (e.g. for a preview)
//
// Requirements: Node.js 14+; built-in modules only, no npm install needed.
//
// The banner is an animated SVG: each message is typed out character by character, held,
// erased with a quick backspace, then the next message is typed, looping forever. GitHub
// renders SVG animations in README images (no JavaScript involved), and viewers who prefer
// reduced motion see a static "I'm Tedd".
//
// Visual identity taken from https://lonecoder.nsh.one/ (style.css): background #0a0e14,
// raised surfaces #0f1520 / #131a26, text #e8edf4, muted #8b97a8, teal accent #2dd4bf,
// 1px rgba(255,255,255,.08) borders, a 28px dot grid, Consolas monospace and the
// "<Lone Coder />" brand; the striped retro sun and "> CODE. > DEBUG. ..." come from the logo.
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'banner', 'terminal-banner.svg'));

// --- Messages, typed one after another. Add, remove or reorder freely; the first one is
// also the static fallback for reduced motion. Keep each line within ~25 characters so it
// stays clear of the retro sun on the right.
const MESSAGES = ["I'm Tedd", 'Software Developer', 'QA Automation Engineer', 'Cybersecurity Enthusiast', 'Apache JMeter Contributor'];

// --- Canvas size, corner radius and the website palette.
const W = 1200, H = 300, R = 16;
const C = { bg: '#0a0e14', elevated: '#0f1520', text: '#e8edf4', dim: '#8b97a8', accent: '#2dd4bf' };
const MONO = "Consolas,'SFMono-Regular',Menlo,'DejaVu Sans Mono','Liberation Mono','Courier New',monospace";

// --- Typed line geometry. Every character sits in its own fixed-width cell (ADV), so the
// reveal lines up whichever monospace font the viewer's system substitutes.
// FS = font size, X0 = left edge of the "> " prompt, BASE = text baseline.
const FS = 46, ADV = FS * 0.6, X0 = 52, BASE = 182;

// --- Animation timing, in milliseconds. One loop = every message typed, held and erased.
//   START_DELAY  pause before the first message starts typing
//   TYPE         time per typed character
//   HOLD         how long each finished message stays on screen (FIRST_HOLD for the first)
//   ERASE        time per erased character (backspace)
//   GAP          pause after a message is erased, before the next one starts
const START_DELAY = 500, TYPE = 70, HOLD = 1900, FIRST_HOLD = 2600, ERASE = 32, GAP = 380;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- Timeline: when each character appears/disappears and where the cursor sits.
let t = START_DELAY;
const chars = []; // { m, i, ch, on, off }
const cursor = [[0, 0]]; // [time, column]
MESSAGES.forEach((msg, m) => {
  const n = msg.length;
  for (let i = 0; i < n; i++) {
    chars.push({ m, i, ch: msg[i], on: t + i * TYPE });
    cursor.push([t + (i + 1) * TYPE, i + 1]);
  }
  const eraseStart = t + n * TYPE + (m === 0 ? FIRST_HOLD : HOLD);
  for (let i = n - 1; i >= 0; i--) {
    const off = eraseStart + (n - 1 - i) * ERASE;
    chars.find((c) => c.m === m && c.i === i).off = off;
    cursor.push([off + ERASE, i]);
  }
  t = eraseStart + n * ERASE + GAP;
});
const LOOP = t;
const pct = (ms) => `${((ms / LOOP) * 100).toFixed(3)}%`;

// Each character gets its own keyframes: hidden until typed, visible until erased.
const css = [];
const charSvg = chars
  .map((c, k) => {
    css.push(`.k${k}{animation-name:k${k}}@keyframes k${k}{0%{opacity:0}${pct(c.on)}{opacity:1}${pct(c.off)}{opacity:0}100%{opacity:0}}`);
    return c.ch === ' ' ? '' : `<text class="c k${k}${c.m === 0 ? ' m0' : ''}" x="${(X0 + (c.i + 2) * ADV).toFixed(1)}" y="${BASE}">${esc(c.ch)}</text>`;
  })
  .join('');
const cursorFrames = cursor.map(([ms, col]) => `${pct(ms)}{transform:translateX(${(col * ADV).toFixed(1)}px)}`).join('');

// --- Retro sun (from the logo): a circle cut into horizontal stripes whose gaps grow downward.
const SUN = { cx: 1012, cy: 196, r: 118, horizon: 272 };
let stripes = '', y = SUN.cy - SUN.r, band = 0;
while (y < SUN.horizon) {
  const gap = band < 3 ? 0 : 2 + (band - 3) * 1.6;
  const h = band < 3 ? 26 : Math.max(5, 11 - (band - 3) * 0.8);
  stripes += `<rect x="${SUN.cx - SUN.r}" y="${y.toFixed(1)}" width="${SUN.r * 2}" height="${Math.min(h, SUN.horizon - y).toFixed(1)}"/>`;
  y += h + gap;
  band++;
}

const cursorX = X0 + 2 * ADV;
const reducedCol = MESSAGES[0].length;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">Tedd — Software Developer, QA Automation Engineer, Cybersecurity Enthusiast, Apache JMeter Contributor</title>
<desc id="d">A retro terminal window that types five lines in turn: ${MESSAGES.map((m) => `“${esc(m)}”`).join(', ')}.</desc>
<style>
.c{opacity:0;animation-duration:${LOOP}ms;animation-timing-function:steps(1,end);animation-iteration-count:infinite}
${css.join('\n')}
.cur{transform:translateX(0);animation:cur ${LOOP}ms steps(1,end) infinite}
@keyframes cur{${cursorFrames}}
.blink{animation:blink 1.06s steps(1,end) infinite}
@keyframes blink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){
  .c,.cur,.blink{animation:none}
  .m0{opacity:1}
  .cur{transform:translateX(${(reducedCol * ADV).toFixed(1)}px)}
}
</style>
<defs>
  <clipPath id="card"><rect width="${W}" height="${H}" rx="${R}"/></clipPath>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.elevated}"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>
  <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#fff" fill-opacity=".05"/></pattern>
  <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.accent}" stop-opacity=".42"/><stop offset="1" stop-color="${C.accent}" stop-opacity=".05"/></linearGradient>
  <clipPath id="sunClip"><circle cx="${SUN.cx}" cy="${SUN.cy}" r="${SUN.r}"/></clipPath>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<g clip-path="url(#card)">
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>
  <g clip-path="url(#sunClip)" fill="url(#sun)">${stripes}</g>
  <rect x="${SUN.cx - SUN.r - 40}" y="${SUN.horizon}" width="${SUN.r * 2 + 80}" height="1" fill="${C.accent}" fill-opacity=".25"/>
  <rect y="0" width="${W}" height="52" fill="#fff" fill-opacity=".015"/>
  <rect y="52" width="${W}" height="1" fill="#fff" fill-opacity=".08"/>
</g>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="${R}" fill="none" stroke="#fff" stroke-opacity=".10"/>
<g font-family="${MONO}">
  <text x="32" y="33" font-size="18" font-weight="700" fill="${C.text}">&lt;Lone <tspan fill="${C.accent}">Coder</tspan> /&gt;</text>
  <g transform="translate(${W - 32} 0)">
    <rect x="-128" y="13" width="128" height="27" rx="6" fill="${C.accent}" fill-opacity=".06" stroke="${C.accent}" stroke-opacity=".3"/>
    <circle cx="-110" cy="26.5" r="4" fill="${C.accent}" filter="url(#glow)"/>
    <text x="-96" y="31.5" font-size="14" fill="${C.accent}">Available</text>
  </g>
  <text x="${X0}" y="110" font-size="17" fill="${C.dim}"><tspan fill="${C.accent}">rebelwithoutacause@github</tspan>:~$ ./intro.sh</text>
  <text x="${X0}" y="${BASE}" font-size="${FS}" font-weight="700" fill="${C.accent}">&gt;</text>
  <g font-size="${FS}" font-weight="700" fill="${C.text}">${charSvg}</g>
  <g class="cur"><rect class="blink" x="${(cursorX + 2).toFixed(1)}" y="${BASE - FS * 0.78}" width="${(ADV - 4).toFixed(1)}" height="${(FS * 0.92).toFixed(1)}" rx="2" fill="${C.accent}" fill-opacity=".9" filter="url(#glow)"/></g>
  <text x="${X0}" y="228" font-size="15" fill="${C.dim}" fill-opacity=".85"><tspan fill="${C.accent}">&gt;</tspan> CODE.  <tspan fill="${C.accent}">&gt;</tspan> DEBUG.  <tspan fill="${C.accent}">&gt;</tspan> COFFEE.  <tspan fill="${C.accent}">&gt;</tspan> REPEAT.</text>
  <text x="${X0}" y="274" font-size="14" fill="${C.dim}">github.com/rebelwithoutacause  <tspan fill="${C.accent}">·</tspan>  lonecoder.nsh.one</text>
</g>
</svg>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, svg);
console.log(`Wrote ${path.relative(process.cwd(), out) || out}: ${(svg.length / 1024).toFixed(1)} KB, loop ${(LOOP / 1000).toFixed(1)} s, ${chars.length} characters`);
const hold = (m) => { const cs = chars.filter((c) => c.m === m); return [Math.max(...cs.map((c) => c.on)) + TYPE, Math.min(...cs.map((c) => c.off))]; };
console.log('Fully typed (s):', MESSAGES.map((m, i) => `${m}: ${hold(i).map((x) => (x / 1000).toFixed(2)).join('-')}`).join(' | '));
