import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUnit,
  unitKind,
  toGrams,
  gramsPerServing,
  servingsFor,
  unitsFor,
  formatAmount,
} from '../docs/js/units.js';

const close = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} is not close to ${expected}`);

const byWeight = { serving_amount: 30, serving_unit: 'g' };
const rice = { serving_amount: 1, serving_unit: 'cup', grams_per_serving: 158 };
const riceNoGrams = { serving_amount: 1, serving_unit: 'cup', grams_per_serving: null };
const toast = { serving_amount: 1, serving_unit: 'slice', grams_per_serving: 28 };
const toastNoGrams = { serving_amount: 2, serving_unit: 'slice' };

test('normalizeUnit maps spoken variants', () => {
  for (const [input, expected] of [
    ['gm', 'g'], ['Grams', 'g'], ['g', 'g'], ['ounces', 'oz'], ['lbs', 'lb'],
    ['cups', 'cup'], ['Tablespoons', 'tbsp'], ['tsp.', 'tsp'], ['mL', 'ml'],
    ['slices', 'slice'], ['pieces', 'piece'], ['each', 'each'], [' oz ', 'oz'],
  ]) {
    assert.equal(normalizeUnit(input), expected, input);
  }
});

test('unitKind sorts units into weight, volume, count', () => {
  assert.equal(unitKind('oz'), 'weight');
  assert.equal(unitKind('tbsp'), 'volume');
  assert.equal(unitKind('slice'), 'count');
  assert.equal(unitKind('bucket'), null);
});

test('toGrams converts weights only', () => {
  assert.equal(toGrams(12, 'g'), 12);
  close(toGrams(1.5, 'oz'), 42.52425);
  close(toGrams(1, 'lb'), 453.592);
  assert.equal(toGrams(1, 'cup'), null);
});

test('weight to weight always works', () => {
  close(servingsFor(byWeight, 12, 'gm'), 0.4);
  close(servingsFor(byWeight, 1, 'oz'), 28.3495 / 30);
  close(servingsFor({ serving_amount: 1, serving_unit: 'oz' }, 56.699, 'g'), 2);
});

test('volume to volume always works', () => {
  close(servingsFor(riceNoGrams, 0.5, 'cup'), 0.5);
  close(servingsFor(riceNoGrams, 16, 'tbsp'), 1, 1e-3);
  close(servingsFor({ serving_amount: 2, serving_unit: 'tbsp' }, 1, 'tbsp'), 0.5);
});

test('count units scale by serving amount', () => {
  assert.equal(servingsFor(toastNoGrams, 2, 'slices'), 1);
  assert.equal(servingsFor(toastNoGrams, 1, 'slice'), 0.5);
  assert.equal(servingsFor(toastNoGrams, 3, 'pieces'), 1.5);
});

test('weight for a volume or count food needs grams per serving', () => {
  close(servingsFor(rice, 79, 'g'), 0.5);
  close(servingsFor(toast, 56, 'g'), 2);
  assert.equal(servingsFor(riceNoGrams, 79, 'g'), null);
  assert.equal(servingsFor(toastNoGrams, 56, 'g'), null);
});

test('impossible conversions return null', () => {
  assert.equal(servingsFor(byWeight, 1, 'cup'), null);
  assert.equal(servingsFor(byWeight, 2, 'slices'), null);
  assert.equal(servingsFor(rice, 2, 'slices'), null);
  assert.equal(servingsFor(byWeight, -1, 'g'), null);
  assert.equal(servingsFor({ serving_amount: 0, serving_unit: 'g' }, 5, 'g'), null);
});

test('"serving" always means the food\'s own serving', () => {
  assert.equal(servingsFor(rice, 2, 'servings'), 2);
});

test('gramsPerServing prefers the weight of the serving itself', () => {
  assert.equal(gramsPerServing(byWeight), 30);
  assert.equal(gramsPerServing(rice), 158);
  assert.equal(gramsPerServing(riceNoGrams), null);
});

test('unitsFor lists only units that can be converted', () => {
  assert.deepEqual(unitsFor(byWeight), ['g', 'oz', 'lb']);
  assert.deepEqual(unitsFor(riceNoGrams), ['cup', 'ml', 'tsp', 'tbsp']);
  assert.deepEqual(unitsFor(rice), ['cup', 'ml', 'tsp', 'tbsp', 'g', 'oz', 'lb']);
  assert.deepEqual(unitsFor(toastNoGrams), ['slice']);
  assert.deepEqual(unitsFor(toast), ['slice', 'g', 'oz', 'lb']);
  for (const food of [byWeight, rice, riceNoGrams, toast, toastNoGrams]) {
    for (const unit of unitsFor(food)) assert.notEqual(servingsFor(food, 1, unit), null, unit);
  }
});

test('formatAmount pluralizes counts', () => {
  assert.equal(formatAmount(12, 'g'), '12 g');
  assert.equal(formatAmount(1.5, 'oz'), '1.5 oz');
  assert.equal(formatAmount(2, 'slice'), '2 slices');
  assert.equal(formatAmount(1, 'cup'), '1 cup');
  assert.equal(formatAmount(0.5, 'cup'), '0.5 cups');
  assert.equal(formatAmount(3, 'each'), '3 each');
});
