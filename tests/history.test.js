process.env.TZ = 'America/Los_Angeles';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDaySummary, buildDayText, exceededLimits, formatLongDay, dayFileStem, summaryCarbs } from '../docs/js/history.js';
import { DEFAULT_SETTINGS } from '../docs/js/nutrients.js';

const targets = DEFAULT_SETTINGS.targets;
const at = (h, m) => new Date(2026, 10, 13, h, m).getTime();
const entry = (over) => ({
  id: 'x', day: '2026-11-13', ts: at(8, 5), foodName: 'Test rice', amount: 2, unit: 'cup', deleted: false,
  nutrients: { calories: 400, protein_g: 8.4, sodium_mg: 20, potassium_mg: 100, phosphorus_mg: 140, effective_carbs_g: 88 },
  ...over,
});
const entries = [
  entry({ id: 'b', ts: at(19, 30), foodName: 'Test broth', amount: 3, nutrients: { calories: 45, protein_g: 3, sodium_mg: 2700, potassium_mg: 90, phosphorus_mg: 60, effective_carbs_g: null } }),
  entry({ id: 'a' }),
  entry({ id: 'gone', deleted: true, nutrients: { calories: 9999, protein_g: 99, sodium_mg: 9, potassium_mg: 9, phosphorus_mg: 9, effective_carbs_g: 9 } }),
];

test('summary totals skip deleted entries and copy the targets of the day', () => {
  const s = buildDaySummary('2026-11-13', entries, targets, 12345);
  assert.equal(s.day, '2026-11-13');
  assert.equal(s.entryCount, 2);
  assert.deepEqual(s.totals, { calories: 445, protein_g: 11.4, sodium_mg: 2720, potassium_mg: 190, phosphorus_mg: 200 });
  assert.equal(s.effective_carbs_g, 88);
  assert.equal(s.carbsUnknown, true);
  assert.deepEqual(s.targets, targets);
  assert.notEqual(s.targets, targets, 'targets are a copy');
  assert.deepEqual(s.exceeded, ['sodium_mg']);
  assert.equal(s.finalizedAt, 12345);
  assert.equal(summaryCarbs(s), '88+? g');
});

test('calories over goal never counts as an exceeded limit', () => {
  const totals = { calories: 5000, protein_g: 55, sodium_mg: 2000.01, potassium_mg: 0, phosphorus_mg: 801 };
  assert.deepEqual(exceededLimits(totals, targets), ['sodium_mg', 'phosphorus_mg']);
});

test('an empty day summarizes to zeros', () => {
  const s = buildDaySummary('2026-11-13', [], targets);
  assert.equal(s.entryCount, 0);
  assert.equal(s.totals.calories, 0);
  assert.deepEqual(s.exceeded, []);
  assert.match(buildDayText(s, [], 'en-US'), /\(nothing logged\)/);
});

test('dates for headings and file names', () => {
  assert.equal(formatLongDay('2026-11-13', 'en-US'), 'Fri, Nov 13, 2026');
  assert.equal(dayFileStem('2026-11-13'), 'FuelGauge 2026-11-13 Fri');
  assert.equal(dayFileStem('2027-01-01'), 'FuelGauge 2027-01-01 Fri');
});

test('text log lists entries in time order with totals, carbs and exceeded limits', () => {
  const s = buildDaySummary('2026-11-13', entries, targets);
  const text = buildDayText(s, entries, 'en-US');
  const lines = text.split('\n');
  assert.equal(lines[0], 'Fuel Gauge - Fri, Nov 13, 2026');
  assert.ok(text.indexOf('8:05 AM') < text.indexOf('7:30 PM'), 'morning first');
  assert.ok(lines.includes('  8:05 AM  2 cups Test rice'));
  assert.ok(lines.includes('           400 kcal · P 8.4 g · S 20 mg · K 100 mg · H 140 mg · carbs 88 g'));
  assert.ok(lines.includes('  Calories   445 kcal   of 2150 kcal  21%   goal'));
  assert.ok(lines.includes('  Sodium     2720 mg    of 2000 mg    136%  limit'));
  assert.ok(lines.includes('Effective carbs: 88+? g'));
  assert.ok(lines.includes('Limits exceeded: Sodium (over by 720 mg)'));
  assert.ok(!text.includes('9999'), 'deleted entries are left out');
  assert.ok(!/insulin|dose|bolus/i.test(text));
});

test('estimated entries are marked in the text log', () => {
  const s = buildDaySummary('2026-11-13', [entry({ estimated: true })], targets);
  assert.match(buildDayText(s, [entry({ estimated: true })], 'en-US'), /Test rice \(estimated\)/);
  assert.match(buildDayText(s, [entry()], 'en-US'), /Limits exceeded: none/);
});
