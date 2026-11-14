import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput } from '../docs/js/parser.js';

// [phrase, amount, unit, food]
const LOG_PHRASES = [
  ["log 12gm of trader joe's candied pecans", 12, 'g', "trader joe's candied pecans"],
  ['2 slices toast', 2, 'slice', 'toast'],
  ['half a banana', 0.5, 'each', 'banana'],
  ['a cup of rice', 1, 'cup', 'rice'],
  ['1.5 oz cheddar', 1.5, 'oz', 'cheddar'],
  ['Log 12 grams of candied pecans.', 12, 'g', 'candied pecans'],
  ['add 2 tbsp peanut butter', 2, 'tbsp', 'peanut butter'],
  ['I had a slice of toast', 1, 'slice', 'toast'],
  ['i ate two eggs', 2, 'each', 'eggs'],
  ['I just had 250 ml of apple juice', 250, 'ml', 'apple juice'],
  ['one and a half cups of rice', 1.5, 'cup', 'rice'],
  ['a cup and a half of rice', 1.5, 'cup', 'rice'],
  ['1 1/2 cups rice', 1.5, 'cup', 'rice'],
  ['1/2 cup oatmeal', 0.5, 'cup', 'oatmeal'],
  ['½ cup oatmeal', 0.5, 'cup', 'oatmeal'],
  ['1½ cups oatmeal', 1.5, 'cup', 'oatmeal'],
  ['a quarter cup of blueberries', 0.25, 'cup', 'blueberries'],
  ['three quarters of a cup of milk', 0.75, 'cup', 'milk'],
  ['half an apple', 0.5, 'each', 'apple'],
  ['an apple', 1, 'each', 'apple'],
  ['a banana', 1, 'each', 'banana'],
  ['3 pieces of bacon', 3, 'piece', 'bacon'],
  ['two tablespoons of olive oil', 2, 'tbsp', 'olive oil'],
  ['1 teaspoon butter', 1, 'tsp', 'butter'],
  ['0.25 lb ground beef', 0.25, 'lb', 'ground beef'],
  ['2 pounds of potatoes', 2, 'lb', 'potatoes'],
  ['twenty five grams of almonds', 25, 'g', 'almonds'],
  ['one hundred fifty grams of rice', 150, 'g', 'rice'],
  ['a hundred grams of chicken', 100, 'g', 'chicken'],
  ['a couple of eggs', 2, 'each', 'eggs'],
  ['a dozen grapes', 12, 'each', 'grapes'],
  ['2 servings of chili', 2, 'serving', 'chili'],
  ['1,5 oz cheddar', 1.5, 'oz', 'cheddar'],
  ['candied pecans 12 grams', 12, 'g', 'candied pecans'],
  ['toast, 2 slices', 2, 'slice', 'toast'],
  ['Log 12 gm of Trader Joe’s candied pecans', 12, 'g', "trader joe's candied pecans"],
  ['3 cupcakes', 3, 'each', 'cupcakes'],
  ['2 grapes', 2, 'each', 'grapes'],
  ['had 4 oz. of salmon', 4, 'oz', 'salmon'],
  ['please add 10 g of the butter', 10, 'g', 'butter'],
];

test(`parses ${LOG_PHRASES.length} log phrases into amount + unit + food`, () => {
  for (const [phrase, amount, unit, food] of LOG_PHRASES) {
    const result = parseInput(phrase);
    assert.equal(result.type, 'log', phrase);
    assert.equal(result.confident, true, phrase);
    assert.ok(Math.abs(result.amount - amount) < 1e-9, `${phrase}: amount ${result.amount}`);
    assert.equal(result.unit, unit, phrase);
    assert.equal(result.food, food, phrase);
  }
});

test('a bare count is marked as having no explicit unit', () => {
  assert.equal(parseInput('2 eggs').unitExplicit, false);
  assert.equal(parseInput('2 slices toast').unitExplicit, true);
  assert.equal(parseInput('12 g pecans').unitExplicit, true);
});

test('a food with no amount is a log that is not confident', () => {
  for (const [phrase, food] of [['banana', 'banana'], ['log candied pecans', 'candied pecans'], ['I had some toast', 'toast']]) {
    const result = parseInput(phrase);
    assert.equal(result.type, 'log', phrase);
    assert.equal(result.confident, false, phrase);
    assert.equal(result.amount, null, phrase);
    assert.equal(result.food, food, phrase);
  }
});

test('undo commands', () => {
  for (const phrase of ['undo', 'Undo.', 'undo that', 'undo last', 'remove the last entry', 'delete last entry', 'remove last', 'delete the last one', 'scratch that']) {
    assert.deepEqual(parseInput(phrase), { type: 'undo' }, phrase);
  }
});

test('delete commands carry the food to look for', () => {
  assert.deepEqual(parseInput('delete the pecans'), { type: 'delete', query: 'pecans' });
  assert.deepEqual(parseInput('remove candied pecans'), { type: 'delete', query: 'candied pecans' });
  assert.deepEqual(parseInput('Delete my toast.'), { type: 'delete', query: 'toast' });
});

test('"what\'s left" commands', () => {
  for (const phrase of ["what's left?", 'whats left', 'What’s left', 'what is left', "what's remaining", 'how much is left', 'what do I have left?', 'remaining']) {
    assert.deepEqual(parseInput(phrase), { type: 'remaining' }, phrase);
  }
});

test('empty or amount-only input is unknown', () => {
  for (const phrase of ['', '   ', null, undefined, 'log', '12 grams', '2', '...']) {
    assert.equal(parseInput(phrase).type, 'unknown', String(phrase));
  }
});

test('zero or malformed amounts never produce a confident log', () => {
  for (const phrase of ['0 g pecans', '1/0 cup rice']) {
    const result = parseInput(phrase);
    assert.ok(result.type !== 'log' || result.confident === false || result.amount > 0, phrase);
  }
});
