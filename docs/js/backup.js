// Pure backup logic: turning stored records into the files of a backup zip and
// back again. Zipping itself happens in the UI layer. No DOM.
//
// A backup holds: entries.csv, daily_summary.csv, history/DAY.png + .txt,
// my-foods.txt and settings.json (never an API key).

import { NUTRIENT_KEYS } from './nutrients.js';
import { splitCsvLine, csvField, serializeFoodsFile, parseFoodsFile } from './foodsFile.js';

export const ENTRY_COLUMNS = [
  'id', 'day', 'time_local', 'ts', 'created_at', 'food_id', 'food_name', 'amount', 'unit', 'servings',
  ...NUTRIENT_KEYS, 'effective_carbs_g', 'source', 'estimated', 'phosphate_additives', 'deleted', 'deleted_at', 'history',
];
export const SUMMARY_COLUMNS = [
  'day', 'entry_count', ...NUTRIENT_KEYS, 'effective_carbs_g', 'carbs_unknown',
  ...NUTRIENT_KEYS.map((key) => `target_${key}`), 'exceeded', 'finalized_at',
];

const pad = (n) => String(n).padStart(2, '0');

/** "2026-11-13 07:15" in local time, for reading the CSV in a spreadsheet. */
function localStamp(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toCsv(columns, rows) {
  return `${[columns.join(','), ...rows.map((row) => columns.map((c) => csvField(row[c])).join(','))].join('\n')}\n`;
}

function fromCsv(text) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r\n|\r|\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(header.map((column, i) => [column, cells[i] ?? '']));
  });
}

const ENTRY_SOURCES = ['me', 'ai-confirmed', 'usda-confirmed', 'label-confirmed', 'ai', 'usda', 'label'];
const num = (text) => (text === '' || text == null ? null : Number(text));
const bool = (text) => text === 'true';

/** Every entry, every day, soft-deleted ones included (flagged). */
export function entriesToCsv(entries) {
  const rows = [...entries]
    .sort((a, b) => a.ts - b.ts)
    .map((e) => ({
      id: e.id,
      day: e.day,
      time_local: localStamp(e.ts),
      ts: e.ts,
      created_at: e.createdAt ?? e.ts,
      food_id: e.foodId ?? '',
      food_name: e.foodName,
      amount: e.amount,
      unit: e.unit,
      servings: e.servings ?? '',
      ...Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, e.nutrients?.[key] ?? 0])),
      effective_carbs_g: e.nutrients?.effective_carbs_g ?? '',
      source: e.source ?? 'me',
      estimated: Boolean(e.estimated),
      phosphate_additives: Boolean(e.phosphate_additives),
      deleted: Boolean(e.deleted),
      deleted_at: e.deletedAt ?? '',
      history: e.history?.length ? JSON.stringify(e.history) : '',
    }));
  return toCsv(ENTRY_COLUMNS, rows);
}

/** Read entries.csv back into entry records. Rows without a usable id, day or time are skipped. */
export function parseEntriesCsv(text) {
  const entries = [];
  let skipped = 0;
  for (const row of fromCsv(text)) {
    const ts = num(row.ts);
    if (!row.id || !/^\d{4}-\d{2}-\d{2}$/.test(row.day || '') || !Number.isFinite(ts)) {
      skipped++;
      continue;
    }
    let history = [];
    try {
      if (row.history) history = JSON.parse(row.history);
    } catch {
      history = [];
    }
    const nutrients = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, num(row[key]) ?? 0]));
    nutrients.effective_carbs_g = num(row.effective_carbs_g);
    entries.push({
      id: row.id,
      day: row.day,
      ts,
      createdAt: num(row.created_at) ?? ts,
      foodId: row.food_id || null,
      foodName: row.food_name,
      amount: num(row.amount) ?? 0,
      unit: row.unit,
      servings: num(row.servings),
      nutrients,
      source: ENTRY_SOURCES.includes(row.source) ? row.source : 'me',
      estimated: bool(row.estimated),
      phosphate_additives: bool(row.phosphate_additives),
      deleted: bool(row.deleted),
      deletedAt: num(row.deleted_at),
      history: Array.isArray(history) ? history : [],
    });
  }
  return { entries, skipped };
}

export function summariesToCsv(summaries) {
  const rows = [...summaries]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((s) => ({
      day: s.day,
      entry_count: s.entryCount,
      ...Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, s.totals[key]])),
      effective_carbs_g: s.effective_carbs_g,
      carbs_unknown: Boolean(s.carbsUnknown),
      ...Object.fromEntries(NUTRIENT_KEYS.map((key) => [`target_${key}`, s.targets[key]])),
      exceeded: s.exceeded.join('|'),
      finalized_at: s.finalizedAt,
    }));
  return toCsv(SUMMARY_COLUMNS, rows);
}

export function parseSummariesCsv(text) {
  return fromCsv(text)
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.day || ''))
    .map((row) => ({
      day: row.day,
      entryCount: num(row.entry_count) ?? 0,
      totals: Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, num(row[key]) ?? 0])),
      effective_carbs_g: num(row.effective_carbs_g) ?? 0,
      carbsUnknown: bool(row.carbs_unknown),
      targets: Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, num(row[`target_${key}`]) ?? 0])),
      exceeded: row.exceeded ? row.exceeded.split('|').filter((key) => NUTRIENT_KEYS.includes(key)) : [],
      finalizedAt: num(row.finalized_at) ?? 0,
    }));
}

/**
 * Settings as they may leave the phone: anything that looks like a credential
 * is dropped, at any depth. The API key never goes into a backup.
 */
export function exportableSettings(settings) {
  if (Array.isArray(settings)) return settings.map(exportableSettings);
  if (settings && typeof settings === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(settings)) {
      if (/key|token|secret|password|authorization/i.test(key)) continue;
      out[key] = exportableSettings(value);
    }
    return out;
  }
  return settings;
}

/** Keep records whose day lies in [from, to] (inclusive "YYYY-MM-DD" keys; either may be empty). */
export function inRange(records, from, to) {
  return records.filter((r) => (!from || r.day >= from) && (!to || r.day <= to));
}

/** "FuelGauge backup 2026-11-13.zip" or "FuelGauge export 2026-11-01 to 2026-11-07.zip" */
export function backupFileName(today, range) {
  return range ? `FuelGauge export ${range.from} to ${range.to}.zip` : `FuelGauge backup ${today}.zip`;
}

/**
 * The text files of a backup, as { path: string }. The caller adds
 * history/DAY.png for each finalized day.
 */
export function buildBackupFiles({ entries, summaries, foods, settings }) {
  const files = {
    'entries.csv': entriesToCsv(entries),
    'daily_summary.csv': summariesToCsv(summaries),
    'my-foods.txt': serializeFoodsFile(foods),
    'settings.json': `${JSON.stringify(exportableSettings(settings), null, 2)}\n`,
  };
  for (const summary of summaries) {
    if (summary.text) files[`history/${summary.day}.txt`] = summary.text;
  }
  return files;
}

/** Read the text files of a backup ({ path: string }) back into records. */
export function parseBackupFiles(files) {
  if (!files['entries.csv']) return { error: 'This zip is not a Fuel Gauge backup (no entries.csv).' };
  const { entries, skipped } = parseEntriesCsv(files['entries.csv']);
  const summaries = parseSummariesCsv(files['daily_summary.csv'] || '').map((summary) => ({
    ...summary,
    text: files[`history/${summary.day}.txt`] || '',
  }));
  const foods = files['my-foods.txt'] ? parseFoodsFile(files['my-foods.txt']).foods : [];
  let settings = null;
  try {
    if (files['settings.json']) settings = exportableSettings(JSON.parse(files['settings.json']));
  } catch {
    settings = null;
  }
  return { error: null, entries, skippedEntries: skipped, summaries, foods, settings };
}

/**
 * Work out what a restore would add. Nothing already on the phone is ever
 * overwritten or duplicated: entries merge by id, days by date, foods by name.
 */
export function planRestore(local, backup) {
  const entries = backup.entries.filter((e) => !local.entryIds.has(e.id));
  const summaries = backup.summaries.filter((s) => !local.summaryDays.has(s.day));
  const names = new Set(local.foods.map((f) => f.name.trim().toLowerCase()));
  const foods = backup.foods.filter((f) => !names.has(f.name.toLowerCase()));
  return {
    entries,
    summaries,
    foods,
    entriesAlreadyHere: backup.entries.length - entries.length,
  };
}

/**
 * Point restored entries at the foods on this phone. Food ids are not part of
 * the foods file, so entries are re-linked by food name.
 */
export function relinkEntries(entries, foods) {
  const ids = new Set(foods.map((f) => f.id));
  const byName = new Map(foods.map((f) => [f.name.trim().toLowerCase(), f.id]));
  return entries.map((entry) =>
    ids.has(entry.foodId) ? entry : { ...entry, foodId: byName.get(String(entry.foodName).trim().toLowerCase()) ?? null },
  );
}

/** "42 entries, 5 days of history, 3 foods" */
export function describeRestore(plan) {
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    count(plan.entries.length, 'entry', 'entries'),
    count(plan.summaries.length, 'day of history', 'days of history'),
    count(plan.foods.length, 'food', 'foods'),
  ];
  let text = `${parts.join(', ')} to add`;
  if (plan.entriesAlreadyHere) text += ` (${count(plan.entriesAlreadyHere, 'entry', 'entries')} already here)`;
  return text;
}

/** Whole days since a timestamp, or null if there is none. */
export function daysSince(ts, now = Date.now()) {
  return ts ? Math.max(0, Math.floor((now - ts) / 86400000)) : null;
}

/** "Last backup: today" / "1 day ago" / "5 days ago" / "never" */
export function backupAgeLabel(lastBackupAt, now = Date.now()) {
  const days = daysSince(lastBackupAt, now);
  if (days == null) return 'Last backup: never';
  if (days === 0) return 'Last backup: today';
  return `Last backup: ${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Should the app nudge for a backup? Yes once `nudgeDays` have passed since
 * the last one, or since the first entry if there has never been one.
 */
export function backupDue({ lastBackupAt, firstEntryAt, nudgeDays, now = Date.now() }) {
  if (!(nudgeDays > 0)) return false;
  const since = daysSince(lastBackupAt || firstEntryAt, now);
  return since != null && since >= nudgeDays;
}
