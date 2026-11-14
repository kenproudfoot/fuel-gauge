process.env.TZ = 'America/Los_Angeles';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  entriesToCsv, parseEntriesCsv, summariesToCsv, parseSummariesCsv, exportableSettings, inRange, backupFileName,
  buildBackupFiles, parseBackupFiles, planRestore, relinkEntries, describeRestore, backupAgeLabel, backupDue, ENTRY_COLUMNS,
} from '../docs/js/backup.js';
import { buildDaySummary, buildDayText } from '../docs/js/history.js';
import { DEFAULT_SETTINGS } from '../docs/js/nutrients.js';

const DAY = 86400000;
const entry = (id, day, over = {}) => ({
  id, day, ts: new Date(`${day}T08:15:00`).getTime(), createdAt: new Date(`${day}T21:00:00`).getTime(),
  foodId: 'food-1', foodName: 'Pecans, "candied"', amount: 12, unit: 'g', servings: 0.4,
  nutrients: { calories: 80, protein_g: 1, sodium_mg: 16, potassium_mg: 44, phosphorus_mg: 30, effective_carbs_g: 3.6 },
  source: 'me', estimated: false, phosphate_additives: false, deleted: false, deletedAt: null, history: [], ...over,
});
const entries = [
  entry('e1', '2026-11-10'),
  entry('e2', '2026-11-11', { nutrients: { calories: 15, protein_g: 1, sodium_mg: 900, potassium_mg: 30, phosphorus_mg: 20, effective_carbs_g: null }, source: 'ai-confirmed', estimated: true, phosphate_additives: true }),
  entry('e3', '2026-11-12', { deleted: true, deletedAt: 1763000000000, history: [{ at: 1, action: 'edit', previous: { amount: 5, unit: 'g' } }, { at: 2, action: 'delete' }] }),
];
const foods = [{ id: 'food-1', name: 'Pecans, "candied"', aliases: ['pecans'], serving_amount: 30, serving_unit: 'g', grams_per_serving: null, calories: 200, protein_g: 2.5, sodium_mg: 40, potassium_mg: 110, phosphorus_mg: 75, effective_carbs_g: 9, phosphate_additives: false, source: 'me', notes: '' }];
const summaries = ['2026-11-10', '2026-11-11'].map((day) => {
  const dayEntries = entries.filter((e) => e.day === day);
  const s = buildDaySummary(day, dayEntries, DEFAULT_SETTINGS.targets, 1763100000000);
  return { ...s, text: buildDayText(s, dayEntries, 'en-US') };
});

test('entries.csv round-trips every entry exactly, deleted ones included and flagged', () => {
  const csv = entriesToCsv(entries);
  assert.equal(csv.split('\n')[0], ENTRY_COLUMNS.join(','));
  assert.match(csv, /2026-11-10 08:15/);
  assert.equal(csv.trim().split('\n').length, 4);
  const { entries: back, skipped } = parseEntriesCsv(csv);
  assert.equal(skipped, 0);
  assert.deepEqual(back, entries);
  assert.equal(back[2].deleted, true);
  assert.equal(back[1].nutrients.effective_carbs_g, null, 'unknown carbs stay unknown');
});

test('unreadable entry rows are skipped, not invented', () => {
  const csv = `${entriesToCsv([entries[0]])},,,\nnot-a-row\n`;
  const { entries: back, skipped } = parseEntriesCsv(csv);
  assert.equal(back.length, 1);
  assert.equal(skipped, 2);
});

test('daily_summary.csv round-trips totals, targets and exceeded limits', () => {
  const back = parseSummariesCsv(summariesToCsv(summaries));
  assert.deepEqual(back, summaries.map(({ text, ...rest }) => rest));
  assert.deepEqual(back[1].exceeded, []);
  assert.equal(back[1].carbsUnknown, true);
});

test('settings never leave with a key, token or secret in them', () => {
  const settings = { ...DEFAULT_SETTINGS, ai: { baseUrl: 'https://example.test/v1', apiKey: 'sk-SECRET', model: 'm', nested: { authToken: 'T', ok: 1 } }, secretNote: 'x' };
  const safe = exportableSettings(settings);
  assert.deepEqual(safe.ai, { baseUrl: 'https://example.test/v1', model: 'm', nested: { ok: 1 } });
  assert.deepEqual(safe.targets, DEFAULT_SETTINGS.targets);
  assert.ok(!JSON.stringify(safe).includes('SECRET'));
  assert.equal(settings.ai.apiKey, 'sk-SECRET', 'original untouched');
  const files = buildBackupFiles({ entries, summaries, foods, settings });
  assert.ok(!Object.values(files).join('').includes('sk-SECRET'));
});

test('a backup holds the expected files', () => {
  const files = buildBackupFiles({ entries, summaries, foods, settings: DEFAULT_SETTINGS });
  assert.deepEqual(Object.keys(files).sort(), [
    'daily_summary.csv', 'entries.csv', 'history/2026-11-10.txt', 'history/2026-11-11.txt', 'my-foods.txt', 'settings.json',
  ]);
});

test('backup files parse back into the same records', () => {
  const files = buildBackupFiles({ entries, summaries, foods, settings: DEFAULT_SETTINGS });
  const back = parseBackupFiles(files);
  assert.equal(back.error, null);
  assert.deepEqual(back.entries, entries);
  assert.deepEqual(back.summaries, summaries);
  assert.equal(back.foods[0].name, 'Pecans, "candied"');
  assert.deepEqual(back.settings.targets, DEFAULT_SETTINGS.targets);
  assert.match(parseBackupFiles({ 'readme.txt': 'hi' }).error, /not a Fuel Gauge backup/);
});

test('the same files survive a real zip made and read by the vendored JSZip', async () => {
  // The vendored file is a browser (UMD) script; give it a CommonJS-style module to export into.
  const code = readFileSync(new URL('../docs/vendor/jszip.min.js', import.meta.url), 'utf8');
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  const JSZip = module.exports;
  const files = buildBackupFiles({ entries, summaries, foods, settings: DEFAULT_SETTINGS });
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  zip.file('history/2026-11-10.png', new Uint8Array([137, 80, 78, 71]));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const read = await JSZip.loadAsync(bytes);
  const texts = {};
  for (const path of Object.keys(files)) texts[path] = await read.file(path).async('string');
  assert.deepEqual(texts, files);
  assert.deepEqual([...(await read.file('history/2026-11-10.png').async('uint8array'))], [137, 80, 78, 71]);
  assert.deepEqual(parseBackupFiles(texts).entries, entries);
});

test('restore adds only what is missing and never duplicates', () => {
  const backup = parseBackupFiles(buildBackupFiles({ entries, summaries, foods, settings: DEFAULT_SETTINGS }));
  const empty = { entryIds: new Set(), summaryDays: new Set(), foods: [] };
  const fresh = planRestore(empty, backup);
  assert.equal(fresh.entries.length, 3);
  assert.equal(fresh.summaries.length, 2);
  assert.equal(fresh.foods.length, 1);
  assert.equal(describeRestore(fresh), '3 entries, 2 days of history, 1 food to add');

  const partial = planRestore({ entryIds: new Set(['e1', 'e3']), summaryDays: new Set(['2026-11-10']), foods: [{ id: 'z', name: 'pecans, "CANDIED"' }] }, backup);
  assert.deepEqual(partial.entries.map((e) => e.id), ['e2']);
  assert.deepEqual(partial.summaries.map((s) => s.day), ['2026-11-11']);
  assert.equal(partial.foods.length, 0);
  assert.equal(describeRestore(partial), '1 entry, 1 day of history, 0 foods to add (2 entries already here)');

  const again = planRestore({ entryIds: new Set(['e1', 'e2', 'e3']), summaryDays: new Set(['2026-11-10', '2026-11-11']), foods }, backup);
  assert.equal(again.entries.length + again.summaries.length + again.foods.length, 0);
});

test('restored entries are re-linked to this phone\'s foods by name', () => {
  const local = [{ id: 'new-id', name: 'pecans, "candied"' }];
  const linked = relinkEntries([entries[0], { ...entries[0], foodName: 'Unknown food' }], local);
  assert.equal(linked[0].foodId, 'new-id');
  assert.equal(linked[1].foodId, null);
  assert.equal(relinkEntries([entries[0]], foods)[0].foodId, 'food-1', 'a matching id is kept');
});

test('date-range filter is inclusive', () => {
  assert.deepEqual(inRange(entries, '2026-11-11', '2026-11-12').map((e) => e.id), ['e2', 'e3']);
  assert.deepEqual(inRange(entries, '2026-11-11', '2026-11-11').map((e) => e.id), ['e2']);
  assert.equal(inRange(entries, '', '').length, 3);
  assert.equal(backupFileName('2026-11-13'), 'FuelGauge backup 2026-11-13.zip');
  assert.equal(backupFileName('2026-11-13', { from: '2026-11-01', to: '2026-11-07' }), 'FuelGauge export 2026-11-01 to 2026-11-07.zip');
});

test('backup age label', () => {
  const now = 100 * DAY;
  assert.equal(backupAgeLabel(null, now), 'Last backup: never');
  assert.equal(backupAgeLabel(now - 3600000, now), 'Last backup: today');
  assert.equal(backupAgeLabel(now - DAY - 1, now), 'Last backup: 1 day ago');
  assert.equal(backupAgeLabel(now - 5 * DAY, now), 'Last backup: 5 days ago');
});

test('backup nudge after the configured number of days', () => {
  const now = 100 * DAY;
  const due = (over) => backupDue({ lastBackupAt: null, firstEntryAt: null, nudgeDays: 3, now, ...over });
  assert.equal(due({}), false, 'nothing logged yet, nothing to nudge about');
  assert.equal(due({ lastBackupAt: now - 2 * DAY }), false);
  assert.equal(due({ lastBackupAt: now - 3 * DAY }), true);
  assert.equal(due({ firstEntryAt: now - 2 * DAY }), false, 'never backed up, but data is new');
  assert.equal(due({ firstEntryAt: now - 4 * DAY }), true, 'never backed up and data is old enough');
  assert.equal(due({ lastBackupAt: now - 1 * DAY, firstEntryAt: now - 50 * DAY }), false);
  assert.equal(due({ lastBackupAt: now - 30 * DAY, nudgeDays: 0 }), false, '0 turns the reminder off');
});
