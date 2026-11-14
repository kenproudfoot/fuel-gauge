// Pure foods-file logic: the plain-text CSV that "My foods" imports and exports. No DOM.
//
// Format: a header row, lines starting with # are comments, blank lines and
// extra spaces are ignored. A blank effective_carbs_g means unknown, not 0.

import { validateFood } from './nutrients.js';
import { unitKind, normalizeUnit } from './units.js';

export const COLUMNS = [
  'name', 'aliases', 'serving_amount', 'serving_unit', 'grams_per_serving', 'calories', 'protein_g',
  'sodium_mg', 'potassium_mg', 'phosphorus_mg', 'effective_carbs_g', 'phosphate_additives', 'source', 'notes',
];
/** Where a saved food's values came from. Values typed or edited by hand are 'me'. */
export const FOOD_SOURCES = ['me', 'ai-confirmed', 'usda-confirmed'];
const foodSource = (value) => {
  const source = String(value ?? '').trim().toLowerCase();
  return FOOD_SOURCES.includes(source) ? source : 'me';
};
const REQUIRED = ['name', 'serving_amount', 'serving_unit', 'calories', 'protein_g', 'sodium_mg', 'potassium_mg', 'phosphorus_mg'];
const COMMENT =
  '# name, aliases (| separated), serving_amount, serving_unit, grams_per_serving, calories, protein_g, sodium_mg, potassium_mg, phosphorus_mg, effective_carbs_g, phosphate_additives, source, notes';

/** Split one CSV line, honoring "quoted, fields" and "" escapes. */
export function splitCsvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      quoted = true;
      field = '';
    } else if (ch === ',') {
      out.push(field.trim());
      field = '';
    } else field += ch;
  }
  out.push(field.trim());
  return out;
}

export function csvField(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Parse a foods file. Returns { foods, skipped: [{ line, reason }], error }.
 * `error` is set when the file as a whole is unusable (no header row).
 */
export function parseFoodsFile(text) {
  const foods = [];
  const skipped = [];
  const seen = new Map();
  let header = null;

  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r\n|\r|\n/);
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const cells = splitCsvLine(line);

    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      return;
    }
    if (cells.length > header.length && cells.slice(header.length).some((c) => c !== '')) {
      skipped.push({ line: lineNumber, reason: `too many columns (${cells.length}, expected ${header.length})` });
      return;
    }
    const row = {};
    header.forEach((column, i) => (row[column] = cells[i] ?? ''));

    const truthy = /^(true|yes|y|1)$/i.test(row.phosphate_additives || '');
    const { ok, food, errors } = validateFood({ ...row, phosphate_additives: truthy });
    if (!ok) {
      skipped.push({ line: lineNumber, reason: errors[0].replace(/\.$/, '').toLowerCase() });
      return;
    }
    food.serving_unit = normalizeUnit(food.serving_unit);
    if (unitKind(food.serving_unit) === 'weight') food.grams_per_serving = null;
    // Anything unrecognized in a hand-edited file counts as yours.
    food.source = foodSource(row.source);

    const key = food.name.toLowerCase();
    if (seen.has(key)) {
      skipped.push({ line: lineNumber, reason: `same name as line ${seen.get(key)}` });
      return;
    }
    seen.set(key, lineNumber);
    foods.push(food);
  });

  if (!header) return { foods, skipped, error: 'The file has no header row.' };
  const missing = REQUIRED.filter((column) => !header.includes(column));
  if (missing.length) return { foods: [], skipped: [], error: `The header row is missing: ${missing.join(', ')}.` };
  return { foods, skipped, error: null };
}

/**
 * Work out what an import would do, without doing it.
 *   merge   -> update foods with matching names, add new ones (the default)
 *   replace -> the same, and remove every existing food not in the file
 * Matching is by name, ignoring case. Updates keep the existing food's id.
 */
export function planImport(existing, incoming, mode = 'merge') {
  const byName = new Map(existing.map((food) => [food.name.trim().toLowerCase(), food]));
  const add = [];
  const update = [];
  const kept = new Set();
  for (const food of incoming) {
    const current = byName.get(food.name.toLowerCase());
    if (current) {
      update.push({ ...current, ...food });
      kept.add(current.id);
    } else add.push(food);
  }
  const remove = mode === 'replace' ? existing.filter((food) => !kept.has(food.id)) : [];
  return { add, update, remove };
}

/** "12 new, 3 updated, 1 line skipped (line 9: name is required)" */
export function describeImport(plan, skipped) {
  const parts = [`${plan.add.length} new`, `${plan.update.length} updated`];
  if (plan.remove.length) parts.push(`${plan.remove.length} removed`);
  if (skipped.length) {
    const reasons = skipped.map((s) => `line ${s.line}: ${s.reason}`).join('; ');
    parts.push(`${skipped.length} line${skipped.length === 1 ? '' : 's'} skipped (${reasons})`);
  }
  return parts.join(', ');
}

/** Write foods in the file format. */
export function serializeFoodsFile(foods) {
  const rows = foods.map((food) =>
    COLUMNS.map((column) => {
      if (column === 'aliases') return csvField((food.aliases || []).join(' | '));
      if (column === 'phosphate_additives') return food.phosphate_additives ? 'true' : 'false';
      if (column === 'source') return foodSource(food.source);
      return csvField(food[column]);
    }).join(','),
  );
  return `${[COMMENT, COLUMNS.join(','), ...rows].join('\n')}\n`;
}
