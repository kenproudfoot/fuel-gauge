import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NUTRIENTS,
  DEFAULT_SETTINGS,
  mergeSettings,
  scaleFood,
  sumEntries,
  nutrientStatus,
  remaining,
  formatValue,
  formatCarbs,
  formatCarbTotal,
  validateFood,
} from '../docs/js/nutrients.js';

const byKey = Object.fromEntries(NUTRIENTS.map((n) => [n.key, n]));

const pecans = {
  name: 'test pecans',
  serving_amount: 30,
  serving_unit: 'g',
  calories: 200,
  protein_g: 2.5,
  sodium_mg: 40,
  potassium_mg: 110,
  phosphorus_mg: 75,
  effective_carbs_g: 9,
};

test('bars are in the order C P S K H with the default targets', () => {
  assert.equal(NUTRIENTS.map((n) => n.letter).join(''), 'CPSKH');
  assert.deepEqual(DEFAULT_SETTINGS.targets, {
    calories: 2150,
    protein_g: 55,
    sodium_mg: 2000,
    potassium_mg: 2000,
    phosphorus_mg: 800,
  });
});

test('only calories is a goal; the rest are limits', () => {
  assert.deepEqual(NUTRIENTS.filter((n) => n.type === 'goal').map((n) => n.key), ['calories']);
});

test('scaleFood scales every nutrient by servings', () => {
  const half = scaleFood(pecans, 0.5);
  assert.deepEqual(half, {
    calories: 100,
    protein_g: 1.25,
    sodium_mg: 20,
    potassium_mg: 55,
    phosphorus_mg: 37.5,
    effective_carbs_g: 4.5,
  });
});

test('scaleFood keeps unknown carbs unknown, not 0', () => {
  assert.equal(scaleFood({ ...pecans, effective_carbs_g: null }, 2).effective_carbs_g, null);
  assert.equal(scaleFood({ ...pecans, effective_carbs_g: '' }, 2).effective_carbs_g, null);
  assert.equal(scaleFood({ ...pecans, effective_carbs_g: 0 }, 2).effective_carbs_g, 0);
});

test('sumEntries adds entries and skips soft-deleted ones', () => {
  const entries = [
    { nutrients: scaleFood(pecans, 1) },
    { nutrients: scaleFood(pecans, 2) },
    { nutrients: scaleFood(pecans, 10), deleted: true },
  ];
  const totals = sumEntries(entries);
  assert.equal(totals.count, 2);
  assert.equal(totals.calories, 600);
  assert.equal(totals.protein_g, 7.5);
  assert.equal(totals.phosphorus_mg, 225);
  assert.equal(totals.effective_carbs_g, 27);
  assert.equal(totals.carbsUnknown, false);
});

test('sumEntries flags unknown carbs', () => {
  const totals = sumEntries([
    { nutrients: scaleFood(pecans, 1) },
    { nutrients: scaleFood({ ...pecans, effective_carbs_g: null }, 1) },
  ]);
  assert.equal(totals.carbsUnknown, true);
  assert.equal(totals.effective_carbs_g, 9);
  assert.equal(formatCarbTotal(totals), '9+? g');
});

test('a deleted unknown-carb entry does not flag the total', () => {
  const totals = sumEntries([
    { nutrients: scaleFood(pecans, 1) },
    { nutrients: scaleFood({ ...pecans, effective_carbs_g: null }, 1), deleted: true },
  ]);
  assert.equal(totals.carbsUnknown, false);
  assert.equal(formatCarbTotal(totals), '9 g');
});

test('empty day sums to zero', () => {
  const totals = sumEntries([]);
  assert.equal(totals.calories, 0);
  assert.equal(formatCarbTotal(totals), '0 g');
});

test('status: 1075 of 2150 kcal is exactly half', () => {
  const s = nutrientStatus(byKey.calories, 1075, 2150);
  assert.equal(s.fill, 0.5);
  assert.equal(s.danger, false);
  assert.equal(s.goalMet, false);
});

test('status: a limit over target clamps and is danger', () => {
  const s = nutrientStatus(byKey.sodium_mg, 2500, 2000);
  assert.equal(s.fill, 1);
  assert.equal(s.danger, true);
});

test('status: a limit exactly at target is not danger', () => {
  assert.equal(nutrientStatus(byKey.phosphorus_mg, 800, 800).danger, false);
});

test('status: calories over target is a met goal, never danger', () => {
  const s = nutrientStatus(byKey.calories, 2600, 2150);
  assert.equal(s.fill, 1);
  assert.equal(s.danger, false);
  assert.equal(s.goalMet, true);
});

test('remaining reports room left and overage', () => {
  const totals = sumEntries([{ nutrients: { ...scaleFood(pecans, 1), sodium_mg: 2100 } }]);
  const left = remaining(totals, DEFAULT_SETTINGS.targets);
  assert.equal(left.calories, 1950);
  assert.equal(left.sodium_mg, -100);
});

test('value labels carry units', () => {
  assert.equal(formatValue(byKey.calories, 1180), '1180 kcal');
  assert.equal(formatValue(byKey.protein_g, 25.4), '25.4 g');
  assert.equal(formatValue(byKey.sodium_mg, 482.4), '482 mg');
  assert.equal(formatCarbs(17.6), '18 g');
  assert.equal(formatCarbs(null), '? g');
});

test('mergeSettings fills in defaults around saved values', () => {
  const merged = mergeSettings({ targets: { calories: 2400 }, colors: { sodium_mg: '#000000' } });
  assert.equal(merged.targets.calories, 2400);
  assert.equal(merged.targets.protein_g, 55);
  assert.equal(merged.colors.sodium_mg, '#000000');
  assert.equal(merged.colors.calories, '#D63AE6');
  assert.equal(merged.proteinMin, null);
  assert.equal(mergeSettings(undefined).targets.phosphorus_mg, 800);
});

test('validateFood accepts typed form text', () => {
  const { ok, food, errors } = validateFood({
    name: '  Candied Pecans ',
    aliases: 'pecans |  tj pecans | ',
    serving_amount: '30',
    serving_unit: 'g',
    grams_per_serving: '',
    calories: '200',
    protein_g: '2,5',
    sodium_mg: '40',
    potassium_mg: '110',
    phosphorus_mg: '75',
    effective_carbs_g: '',
    phosphate_additives: false,
    notes: '',
  });
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
  assert.equal(food.name, 'Candied Pecans');
  assert.deepEqual(food.aliases, ['pecans', 'tj pecans']);
  assert.equal(food.protein_g, 2.5);
  assert.equal(food.effective_carbs_g, null);
  assert.equal(food.grams_per_serving, null);
});

test('validateFood rejects blank nutrients rather than assuming 0', () => {
  const { ok, errors } = validateFood({
    name: 'x',
    serving_amount: '1',
    serving_unit: 'cup',
    calories: '100',
    protein_g: '',
    sodium_mg: '0',
    potassium_mg: 'abc',
    phosphorus_mg: '-5',
  });
  assert.equal(ok, false);
  assert.equal(errors.length, 3);
});

test('validateFood requires a name and a positive serving', () => {
  const { ok, errors } = validateFood({
    name: ' ',
    serving_amount: '0',
    serving_unit: 'g',
    calories: 1,
    protein_g: 1,
    sodium_mg: 1,
    potassium_mg: 1,
    phosphorus_mg: 1,
  });
  assert.equal(ok, false);
  assert.equal(errors.length, 2);
});

import { scaleNutrients, lastLoggedEntry } from '../docs/js/nutrients.js';

test('scaleNutrients rescales an entry from its own stored values', () => {
  const stored = scaleFood(pecans, 1);
  assert.deepEqual(scaleNutrients(stored, 2), scaleFood(pecans, 2));
  assert.deepEqual(scaleNutrients(stored, 1), stored);
  assert.equal(scaleNutrients({ ...stored, effective_carbs_g: null }, 3).effective_carbs_g, null);
});

test('last entry is the most recently logged, not the latest eaten', () => {
  const entries = [
    { id: 'dinner', ts: 2000, createdAt: 2000 },
    { id: 'breakfast-logged-late', ts: 1000, createdAt: 3000 },
    { id: 'deleted', ts: 5000, createdAt: 5000, deleted: true },
    { id: 'old-format', ts: 1500 },
  ];
  assert.equal(lastLoggedEntry(entries).id, 'breakfast-logged-late');
  assert.equal(lastLoggedEntry([]), null);
  assert.equal(lastLoggedEntry([{ id: 'x', ts: 1, deleted: true }]), null);
});

import { remainingLines } from '../docs/js/nutrients.js';

test('"what\'s left" reports room, goals reached and limits exceeded', () => {
  const totals = { calories: 1180, protein_g: 25.4, sodium_mg: 2705, potassium_mg: 2000, phosphorus_mg: 0 };
  const lines = remainingLines(totals, DEFAULT_SETTINGS.targets);
  assert.deepEqual(lines.map((l) => l.text), ['970 kcal to go', '29.6 g left', 'over by 705 mg', '0 mg left', '800 mg left']);
  assert.deepEqual(lines.map((l) => l.danger), [false, false, true, false, false]);
  const over = remainingLines({ ...totals, calories: 2600 }, DEFAULT_SETTINGS.targets)[0];
  assert.equal(over.text, 'goal reached (+450 kcal)');
  assert.equal(over.danger, false);
});
