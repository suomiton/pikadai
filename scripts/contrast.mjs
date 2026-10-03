#!/usr/bin/env node
/**
 * Prints WCAG 2.1 contrast ratios for the colour pairs the UI actually uses,
 * for both themes, and exits non-zero if any pair is below its threshold.
 *
 *   node scripts/contrast.mjs
 *
 * Text needs 4.5:1 (AA, normal size); component boundaries and focus rings need 3:1.
 * Tokens are read from src/styles/tokens.css, so re-run this after changing them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'src', 'styles', 'tokens.css'), 'utf8');

// Everything before the light-scheme media query is the dark theme; the rest overrides it.
const [darkCss, lightCss = ''] = css.split('@media (prefers-color-scheme: light)');

function readTokens(block) {
  const tokens = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

const darkTokens = readTokens(darkCss);
const lightTokens = { ...darkTokens, ...readTokens(lightCss) };

function resolve(tokens, value) {
  const m = /^var\((--[\w-]+)\)$/.exec(value);
  if (!m) return value;
  if (!(m[1] in tokens)) throw new Error(`Unknown token ${m[1]}`);
  return resolve(tokens, tokens[m[1]]);
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** color-mix(in srgb, a p%, b) for opaque colours. */
function mix(a, p, b) {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  return ra.map((ch, i) => Math.round(ch * (p / 100) + rb[i] * (1 - p / 100)));
}

function luminance([r, g, b]) {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Each pair is [foreground, background, minimum, used by]. Colours are token names or
 * `mix:<token>:<percent>:<token>` for a color-mix() background.
 */
const PAIRS = [
  ['--text', '--bg-elev', 4.5, 'body text on cards'],
  ['--text', '--bg', 4.5, 'body text on the page'],
  ['--text-muted', '--bg-elev', 4.5, '.muted, .event-description, h2'],
  ['--text-muted', '--bg', 4.5, '.tagline, .hero p, .status'],
  ['--text-faint', '--bg-elev', 4.5, '.hint, .opt-year, .vote-cell.is-none'],
  ['--text-faint', '--bg-inset', 4.5, '.calendar-weekday, .input::placeholder'],
  ['--text-faint', '--bg', 4.5, '.meta, .site-footer'],
  ['--accent', '--bg-elev', 4.5, 'links, .tally strong, .tag-accent'],
  ['--accent', '--bg-inset', 4.5, '.calendar-day.is-today'],
  ['--accent', '--bg', 4.5, '.brand-mark, h1/h2 prefixes'],
  ['--accent-strong', '--bg-elev', 4.5, '.opt-tag, .step.is-done .step-icon'],
  ['--on-accent', '--accent-fill', 4.5, '.btn-primary, .calendar-day.is-selected'],
  ['--on-accent', '--accent-fill-hover', 4.5, '.btn-primary:hover'],
  ['--on-accent', '--accent-fill-active', 4.5, '.btn-primary:active'],
  ['--on-secondary', '--secondary', 4.5, '.btn-secondary'],
  ['--on-secondary', '--secondary-hover', 4.5, '.btn-secondary:hover'],
  ['--yes', '--bg-elev', 4.5, '.vote-cell.is-yes glyph'],
  ['--yes', 'mix:--yes:18:--bg-inset', 4.5, '.vote-cell.is-yes .vote-btn'],
  ['--maybe', '--bg-elev', 4.5, '.vote-cell.is-maybe glyph'],
  ['--maybe', '--bg-inset', 4.5, '.vote-cell.is-maybe .vote-btn'],
  ['--no', '--bg-elev', 4.5, '.vote-cell.is-no glyph'],
  ['--no', '--bg-inset', 4.5, '.vote-cell.is-no .vote-btn'],
  ['--danger', '--bg-elev', 4.5, '.field-error, .form-error'],
  ['--danger', '--bg', 4.5, 'errors outside cards'],
  ['--border-input', '--bg-elev', 3, '.input border against the card'],
  ['--border-input', '--bg-inset', 3, '.input border against the calendar'],
  ['--focus', '--bg-elev', 3, 'focus ring on cards'],
  ['--focus', '--bg', 3, 'focus ring on the page'],
  ['--focus', '--bg-inset', 3, 'focus ring in the calendar'],
];

function colour(tokens, spec) {
  const m = /^mix:(--[\w-]+):(\d+):(--[\w-]+)$/.exec(spec);
  if (m) return mix(resolve(tokens, `var(${m[1]})`), Number(m[2]), resolve(tokens, `var(${m[3]})`));
  return hexToRgb(resolve(tokens, `var(${spec})`));
}

let failures = 0;
const rows = PAIRS.map(([fg, bg, min, usedBy]) => {
  const dark = ratio(colour(darkTokens, fg), colour(darkTokens, bg));
  const light = ratio(colour(lightTokens, fg), colour(lightTokens, bg));
  if (dark < min) failures++;
  if (light < min) failures++;
  const mark = (r) => `${r.toFixed(2)}${r < min ? ' ✗' : '  '}`;
  return [`${fg} on ${bg}`, `${min}:1`, mark(dark), mark(light), usedBy];
});

const widths = rows[0].map((_, i) =>
  Math.max(...rows.map((r) => r[i].length), ['Pair', 'Min', 'Dark', 'Light', 'Used by'][i].length),
);
const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
console.log(line(['Pair', 'Min', 'Dark', 'Light', 'Used by']));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const r of rows) console.log(line(r));
console.log();
console.log(failures === 0 ? 'All pairs pass.' : `${failures} pair(s) below threshold.`);
process.exit(failures === 0 ? 0 : 1);
