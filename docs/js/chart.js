// Pure chart rendering: totals + targets + colors -> SVG string. No DOM.
// The same function drives the live chart and (later) the daily PNG snapshot,
// so it uses only presentation attributes and a system font stack.

import { NUTRIENTS, DEFAULT_SETTINGS, DANGER, nutrientStatus, formatValue } from './nutrients.js';

const W = 1000;
const H = 1000;
const GAP = 6; // thin black gaps between and around columns
const BG = '#1E1E22';
const FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";

const LABEL_SIZE = 37;
const LABEL_GAP = 14; // space between a label and the bar top
const LETTER_SIZE = 76;
const LETTER_BASELINE_UP = 48; // letter baseline, measured up from the column bottom
const CHAR_WIDTH = 0.56; // rough bold glyph width in ems, used to keep labels inside a column

function r(x) {
  return Math.round(x * 100) / 100;
}

function safeColor(color, fallback) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(color)) ? color : fallback;
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * All chart geometry, in a 1000 x 1000 box. Each bar is scaled to its own
 * target: height = value / target of the column height, clamped at 100%.
 */
export function chartLayout(totals, targets, colors, options = {}) {
  const count = NUTRIENTS.length;
  const colW = (W - GAP * (count + 1)) / count;
  const colTop = GAP;
  const colH = H - 2 * GAP;
  const colBottom = colTop + colH;
  const letterBaseline = colBottom - LETTER_BASELINE_UP;
  const letterTop = letterBaseline - LETTER_SIZE;

  const texts = NUTRIENTS.map((n) => formatValue(n, Number(totals?.[n.key]) || 0));
  // One size for every label, shrunk if the widest would not fit its column.
  const longest = Math.max(...texts.map((t) => t.length));
  const labelSize = Math.min(LABEL_SIZE, (colW - 16) / (longest * CHAR_WIDTH));

  const bars = NUTRIENTS.map((n, i) => {
    const value = Number(totals?.[n.key]) || 0;
    const target = Number(targets?.[n.key]) || 0;
    const status = nutrientStatus(n, value, target);
    const x = GAP + i * (colW + GAP);
    const height = status.fill * colH;
    const top = colBottom - height;
    const centerX = x + colW / 2;

    // Label sits just above the bar, but never lower than the letter, so it
    // stays readable when the bar is near 0%.
    const aboveBaseline = Math.min(top - LABEL_GAP, letterTop - LABEL_GAP);
    const fitsAbove = !status.goalMet && aboveBaseline - labelSize >= colTop + 8;
    const label = { text: texts[i], x: centerX, size: labelSize, inside: !fitsAbove };
    if (fitsAbove) {
      label.y = aboveBaseline;
    } else {
      // Near 100% the label moves inside the top of the bar, on a dark pill
      // so white text stays readable on any bar color.
      const goalH = status.goalMet ? labelSize * 0.9 : 0;
      const textW = texts[i].length * CHAR_WIDTH * labelSize;
      const pillW = Math.min(colW - 12, textW + 30);
      label.pill = { x: centerX - pillW / 2, y: colTop + 12, w: pillW, h: labelSize * 1.5 + goalH };
      label.y = label.pill.y + labelSize * 1.1;
      if (status.goalMet) label.goalY = label.y + goalH;
    }

    return {
      key: n.key,
      letter: n.letter,
      value,
      target,
      ratio: status.ratio,
      fill: status.fill,
      danger: status.danger,
      goalMet: status.goalMet,
      // Red is reserved for an exceeded limit. Calories (a goal) never go red.
      color: status.danger ? DANGER : safeColor(colors?.[n.key], DEFAULT_SETTINGS.colors[n.key]),
      column: { x, y: colTop, w: colW, h: colH },
      x,
      y: top,
      w: colW,
      h: height,
      label,
      letterPos: { x: centerX, y: letterBaseline },
    };
  });

  return {
    width: W,
    height: H,
    colTop,
    colH,
    bars,
    // Dotted lines at 1/3 and 2/3 height split the day into B / L / D zones.
    lines: [colBottom - (colH * 2) / 3, colBottom - colH / 3],
    mealLabels:
      options.showMealLabels === false
        ? []
        : [
            { text: 'D', y: colTop + 26 },
            { text: 'L', y: colBottom - (colH * 2) / 3 + 28 },
            { text: 'B', y: colBottom - colH / 3 + 28 },
          ],
  };
}

/**
 * Render the day chart as an SVG string.
 * options: { showMealLabels = true, size = 1000 (pixel width and height) }
 */
export function renderChartSVG(totals, targets, colors, options = {}) {
  const layout = chartLayout(totals, targets, colors, options);
  const size = Number(options.size) > 0 ? Number(options.size) : W;
  const out = [];

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${size}" height="${size}" role="img" aria-label="${esc(
      layout.bars.map((b) => `${b.letter} ${b.label.text}`).join(', '),
    )}" font-family="${FONT}">`,
  );
  out.push(`<rect width="${W}" height="${H}" fill="#000000"/>`);

  for (const b of layout.bars) {
    const c = b.column;
    out.push(`<rect x="${r(c.x)}" y="${r(c.y)}" width="${r(c.w)}" height="${r(c.h)}" fill="${BG}"/>`);
    if (b.h > 0) {
      out.push(
        `<rect class="bar" data-key="${b.key}" x="${r(b.x)}" y="${r(b.y)}" width="${r(b.w)}" height="${r(b.h)}" fill="${b.color}"/>`,
      );
      // Thin black edge on top of the bar, as in the reference.
      if (b.y - 4 >= c.y) out.push(`<rect x="${r(b.x)}" y="${r(b.y - 4)}" width="${r(b.w)}" height="4" fill="#000000"/>`);
    }
  }

  for (const y of layout.lines) {
    out.push(
      `<line x1="${GAP}" y1="${r(y)}" x2="${W - GAP}" y2="${r(y)}" stroke="#9A9AA3" stroke-opacity="0.75" stroke-width="4" stroke-dasharray="0.1 12" stroke-linecap="round"/>`,
    );
  }

  for (const m of layout.mealLabels) {
    out.push(
      `<text x="${GAP + 9}" y="${r(m.y)}" font-size="20" font-weight="600" fill="#FFFFFF" fill-opacity="0.38">${m.text}</text>`,
    );
  }

  for (const b of layout.bars) {
    out.push(
      `<text x="${r(b.letterPos.x)}" y="${r(b.letterPos.y)}" text-anchor="middle" font-size="${LETTER_SIZE}" font-weight="200" fill="#FFFFFF">${b.letter}</text>`,
    );
    const l = b.label;
    if (l.pill) {
      out.push(
        `<rect x="${r(l.pill.x)}" y="${r(l.pill.y)}" width="${r(l.pill.w)}" height="${r(l.pill.h)}" rx="14" fill="#000000" fill-opacity="0.5"/>`,
      );
    }
    out.push(
      `<text class="value" x="${r(l.x)}" y="${r(l.y)}" text-anchor="middle" font-size="${r(l.size)}" font-weight="700" fill="#FFFFFF">${esc(l.text)}</text>`,
    );
    if (b.goalMet) {
      // Check mark drawn as a path so it never depends on a font glyph.
      const s = l.size * 0.72;
      const cx = l.x - s * 1.55;
      const cy = l.goalY - s * 0.32;
      out.push(
        `<path d="M${r(cx - s * 0.3)} ${r(cy)} l${r(s * 0.22)} ${r(s * 0.24)} l${r(s * 0.42)} ${r(-s * 0.5)}" fill="none" stroke="#FFFFFF" stroke-width="${r(s * 0.14)}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
      out.push(
        `<text class="goal" x="${r(l.x + s * 0.35)}" y="${r(l.goalY)}" text-anchor="middle" font-size="${r(s)}" font-weight="600" fill="#FFFFFF">goal</text>`,
      );
    }
  }

  out.push('</svg>');
  return out.join('');
}
