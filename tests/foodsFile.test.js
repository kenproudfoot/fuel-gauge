import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFoodsFile, serializeFoodsFile, planImport, describeImport, splitCsvLine, COLUMNS } from '../docs/js/foodsFile.js';

const HEADER = COLUMNS.join(',');
const file = (...lines) => [HEADER, ...lines].join('\n');

test('splitCsvLine handles spaces, quotes and escaped quotes', () => {
  assert.deepEqual(splitCsvLine(' a ,b,  c  '), ['a', 'b', 'c']);
  assert.deepEqual(splitCsvLine('x,"one, two",y'), ['x', 'one, two', 'y']);
  assert.deepEqual(splitCsvLine('"say ""hi""",,'), ['say "hi"', '', '']);
});

test('parses a tidy file', () => {
  const { foods, skipped, error } = parseFoodsFile(
    file('Test pecans,pecans | tj pecans,30,g,,200,2.5,40,110,75,9,false,me,from the bag'),
  );
  assert.equal(error, null);
  assert.deepEqual(skipped, []);
  assert.deepEqual(foods, [
    {
      name: 'Test pecans', serving_amount: 30, serving_unit: 'g', calories: 200, protein_g: 2.5, sodium_mg: 40,
      potassium_mg: 110, phosphorus_mg: 75, effective_carbs_g: 9, grams_per_serving: null,
      aliases: ['pecans', 'tj pecans'], phosphate_additives: false, notes: 'from the bag', source: 'me',
    },
  ]);
});

test('tolerates comments, blank lines, extra spaces, CRLF and a BOM', () => {
  const text = `﻿# my foods\r\n\r\n  ${HEADER.replace(/,/g, ' , ')}  \r\n\r\n# a comment\r\n  Test rice ,  rice , 1 , cups , 158 , 200 , 4 , 10 , 50 , 70 ,  , yes , ai-confirmed ,  \r\n\r\n`;
  const { foods, skipped, error } = parseFoodsFile(text);
  assert.equal(error, null);
  assert.deepEqual(skipped, []);
  assert.equal(foods.length, 1);
  assert.equal(foods[0].name, 'Test rice');
  assert.equal(foods[0].serving_unit, 'cup');
  assert.equal(foods[0].grams_per_serving, 158);
  assert.equal(foods[0].phosphate_additives, true);
  assert.equal(foods[0].source, 'ai-confirmed');
});

test('blank effective carbs is unknown, 0 is zero', () => {
  const { foods } = parseFoodsFile(file('A,,1,cup,,10,1,1,1,1,,false,me,', 'B,,1,cup,,10,1,1,1,1,0,false,me,'));
  assert.equal(foods[0].effective_carbs_g, null);
  assert.equal(foods[1].effective_carbs_g, 0);
});

test('bad lines are skipped with a reason and line number; good lines still load', () => {
  const { foods, skipped } = parseFoodsFile(
    file(
      'Good,,1,cup,,10,1,1,1,1,1,false,me,',
      ',,1,cup,,10,1,1,1,1,1,false,me,',
      'No sodium,,1,cup,,10,1,,1,1,1,false,me,',
      'good,,2,cup,,10,1,1,1,1,1,false,me,',
      'Too many,,1,cup,,10,1,1,1,1,1,false,me,notes,extra',
    ),
  );
  assert.deepEqual(foods.map((f) => f.name), ['Good']);
  assert.deepEqual(skipped, [
    { line: 3, reason: 'name is required' },
    { line: 4, reason: 'sodium must be a number (0 or more)' },
    { line: 5, reason: 'same name as line 2' },
    { line: 6, reason: 'too many columns (15, expected 14)' },
  ]);
});

test('an unknown source becomes "me"', () => {
  assert.equal(parseFoodsFile(file('A,,1,cup,,10,1,1,1,1,,false,usda,')).foods[0].source, 'me');
});

test('columns may come in any order', () => {
  const text = 'calories,name,serving_unit,serving_amount,protein_g,sodium_mg,potassium_mg,phosphorus_mg\n100,Test,g,50,1,2,3,4';
  const { foods, error } = parseFoodsFile(text);
  assert.equal(error, null);
  assert.equal(foods[0].name, 'Test');
  assert.equal(foods[0].phosphorus_mg, 4);
  assert.equal(foods[0].effective_carbs_g, null);
});

test('a file without a usable header is rejected', () => {
  assert.match(parseFoodsFile('# only a comment\n').error, /no header/);
  assert.match(parseFoodsFile('name,calories\nA,1').error, /missing: serving_amount/);
  assert.match(parseFoodsFile('').error, /no header/);
});

test('export then import gives the same foods back', () => {
  const original = [
    { name: 'Pecans, candied', aliases: ['pecans', 'tj "best" pecans'], serving_amount: 30, serving_unit: 'g', grams_per_serving: null, calories: 200, protein_g: 2.5, sodium_mg: 40, potassium_mg: 110, phosphorus_mg: 75, effective_carbs_g: null, phosphate_additives: true, source: 'ai-confirmed', notes: 'a note, with a comma' },
    { name: 'Rice', aliases: [], serving_amount: 1, serving_unit: 'cup', grams_per_serving: 158, calories: 205, protein_g: 4.3, sodium_mg: 2, potassium_mg: 55, phosphorus_mg: 68, effective_carbs_g: 44, phosphate_additives: false, source: 'me', notes: '' },
  ];
  const text = serializeFoodsFile(original.map((f, i) => ({ ...f, id: `id${i}`, createdAt: 1, deleted: false })));
  assert.ok(text.startsWith('# name, aliases (| separated)'));
  assert.equal(text.split('\n')[1], HEADER);
  const { foods, skipped, error } = parseFoodsFile(text);
  assert.equal(error, null);
  assert.deepEqual(skipped, []);
  assert.deepEqual(foods, original);
});

test('export never contains ids or other internal fields', () => {
  const text = serializeFoodsFile([{ id: 'SECRET-ID', name: 'A', aliases: [], serving_amount: 1, serving_unit: 'g', calories: 1, protein_g: 1, sodium_mg: 1, potassium_mg: 1, phosphorus_mg: 1, apiKey: 'nope' }]);
  assert.ok(!text.includes('SECRET-ID') && !text.includes('nope'));
});

test('merge updates matching names and adds new ones, keeping ids', () => {
  const existing = [{ id: 'a', name: 'Rice', calories: 1 }, { id: 'b', name: 'Toast', calories: 2 }];
  const incoming = [{ name: 'rice', calories: 205 }, { name: 'Banana', calories: 105 }];
  const plan = planImport(existing, incoming, 'merge');
  assert.deepEqual(plan.add, [{ name: 'Banana', calories: 105 }]);
  assert.deepEqual(plan.update, [{ id: 'a', name: 'rice', calories: 205 }]);
  assert.deepEqual(plan.remove, []);
  assert.equal(describeImport(plan, []), '1 new, 1 updated');
});

test('replace also removes foods that are not in the file', () => {
  const existing = [{ id: 'a', name: 'Rice' }, { id: 'b', name: 'Toast' }];
  const plan = planImport(existing, [{ name: 'Rice' }, { name: 'Banana' }], 'replace');
  assert.deepEqual(plan.remove, [{ id: 'b', name: 'Toast' }]);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.add.length, 1);
  assert.equal(
    describeImport(plan, [{ line: 9, reason: 'name is required' }]),
    '1 new, 1 updated, 1 removed, 1 line skipped (line 9: name is required)',
  );
});

test('the shipped example file has the header and only a commented example', () => {
  const text = readFileSync(new URL('../docs/example-foods.txt', import.meta.url), 'utf8');
  const { foods, skipped, error } = parseFoodsFile(text);
  assert.equal(error, null);
  assert.deepEqual(foods, []);
  assert.deepEqual(skipped, []);
  assert.ok(text.split('\n').some((line) => line.trim() === HEADER));
});
