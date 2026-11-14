import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokens, scoreName, scoreFood, matchFoods } from '../docs/js/fuzzy.js';

const food = (name, aliases = []) => ({ id: name, name, aliases });
const foods = [
  food("Trader Joe's Candied Pecans", ['pecans', 'tj pecans']),
  food('White rice', ['jasmine rice']),
  food('Brown rice'),
  food('Sourdough toast', ['toast']),
  food('Cheddar cheese', ['cheddar']),
  food('Banana'),
  food('Peanut butter'),
  food('Butter'),
];
const top = (query) => matchFoods(query, foods);

test('tokens fold case, punctuation and plurals', () => {
  assert.deepEqual(tokens("Trader Joe's Candied Pecans"), ['trader', 'joe', 'candied', 'pecan']);
  assert.deepEqual(tokens('blueberries'), ['blueberry']);
  assert.deepEqual(tokens('  2% Milk '), ['2%', 'milk']);
  assert.deepEqual(tokens('glass'), ['glass']);
});

test('exact names score 1 regardless of case or plural', () => {
  assert.equal(scoreName('banana', 'Banana'), 1);
  assert.equal(scoreName('bananas', 'banana'), 1);
  assert.equal(scoreName("trader joes candied pecans", "Trader Joe's Candied Pecans"), 1);
});

test('unrelated names score 0', () => {
  assert.equal(scoreName('banana', 'cheddar cheese'), 0);
  assert.equal(scoreName('', 'banana'), 0);
});

test('aliases count', () => {
  assert.equal(scoreFood('toast', foods[3]), 1);
  assert.equal(scoreFood('jasmine rice', foods[1]), 1);
});

test('one strong match is chosen outright', () => {
  for (const [query, name] of [
    ["trader joe's candied pecans", "Trader Joe's Candied Pecans"],
    ['candied pecans', "Trader Joe's Candied Pecans"],
    ['pecans', "Trader Joe's Candied Pecans"],
    ['toast', 'Sourdough toast'],
    ['cheddar', 'Cheddar cheese'],
    ['bananas', 'Banana'],
    ['white rice', 'White rice'],
    ['butter', 'Butter'],
    ['peanut butter', 'Peanut butter'],
  ]) {
    const result = top(query);
    assert.equal(result.status, 'strong', query);
    assert.equal(result.matches[0].food.name, name, query);
  }
});

test('typos and mis-heard words still match', () => {
  for (const [query, name] of [['bannana', 'Banana'], ['chedar', 'Cheddar cheese'], ['candied pecons', "Trader Joe's Candied Pecans"]]) {
    const result = top(query);
    assert.notEqual(result.status, 'none', query);
    assert.equal(result.matches[0].food.name, name, query);
  }
});

test('several close matches are offered as choices', () => {
  const result = top('rice');
  assert.equal(result.status, 'choices');
  assert.deepEqual(result.matches.map((m) => m.food.name).sort(), ['Brown rice', 'White rice']);
});

test('nothing close gives none', () => {
  for (const query of ['salmon', 'xyz', '']) assert.equal(top(query).status, 'none', query);
  assert.equal(matchFoods('banana', []).status, 'none');
});

test('matches are sorted best first and capped', () => {
  const many = Array.from({ length: 10 }, (_, i) => food(`rice bowl ${i}`));
  const result = matchFoods('rice bowl', many);
  assert.equal(result.matches.length, 5);
  for (let i = 1; i < result.matches.length; i++) assert.ok(result.matches[i - 1].score >= result.matches[i].score);
});
