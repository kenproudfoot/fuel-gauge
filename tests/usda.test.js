import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  usdaConfigured, usdaFoodUrl, UsdaError, tidyCase, foodTitle, parseHousehold, foodFromFdc, mergeEstimates,
  gramsFromPortions, relevance, pickCandidates, searchFoods, fetchFood, testUsdaKey,
} from '../docs/js/usda.js';
import { servingsFor } from '../docs/js/units.js';
import { scaleFood } from '../docs/js/nutrients.js';

// Real FoodData Central replies, trimmed to the fields the app reads.
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const SEARCH = fixture('fdc-search.json');
const BRANDED = fixture('fdc-branded.json'); // the current record for the barcode
const BRANDED_OLD = fixture('fdc-branded-old.json'); // an older record that search surfaces first

const KEY = 'USDA-TEST-KEY';
const config = { apiKey: KEY };

function fakeFetch(...replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => reply.json };
  };
  fn.calls = calls;
  return fn;
}

test('usdaConfigured needs a key', () => {
  assert.equal(usdaConfigured({ apiKey: '' }), false);
  assert.equal(usdaConfigured(undefined), false);
  assert.equal(usdaConfigured(config), true);
});

test('tidyCase fixes ALL CAPS and leaves mixed case alone', () => {
  assert.equal(tidyCase('ORIGINAL BELGIAN STYLE WAFFLES, ORIGINAL'), 'Original Belgian Style Waffles, Original');
  assert.equal(tidyCase('MACARONI AND CHEESE'), 'Macaroni and Cheese');
  assert.equal(tidyCase("Kellogg's Eggo Waffles"), "Kellogg's Eggo Waffles");
});

test('foodTitle adds the brand when the description lacks it', () => {
  assert.equal(foodTitle(BRANDED), 'Eggo Thick & Fluffy Original Belgian Style Waffles, Original');
  assert.equal(foodTitle({ description: 'EGGO WAFFLES', brandName: 'EGGO' }), 'Eggo Waffles');
  assert.equal(foodTitle({ description: 'Waffle, plain, frozen' }), 'Waffle, plain, frozen');
});

test('parseHousehold reads label servings', () => {
  assert.deepEqual(parseHousehold('1 WAFFLE'), { amount: 1, unit: 'each' });
  assert.deepEqual(parseHousehold('1 Waffle (55g)'), { amount: 1, unit: 'each' });
  assert.deepEqual(parseHousehold('2/3 cup (55g)'), { amount: 2 / 3, unit: 'cup' });
  assert.deepEqual(parseHousehold('1 1/2 Tbsp'), { amount: 1.5, unit: 'tbsp' });
  assert.deepEqual(parseHousehold('About 12 chips'), { amount: 12, unit: 'each' });
  assert.deepEqual(parseHousehold('2 slices'), { amount: 2, unit: 'slice' });
  assert.equal(parseHousehold('1 ONZ'), null);
  assert.equal(parseHousehold('28 g'), null);
  assert.equal(parseHousehold(''), null);
  assert.equal(parseHousehold('waffle'), null);
});

test('a branded record becomes one label serving with the printed values', () => {
  const { food, missing, origins, ref } = foodFromFdc(BRANDED);
  assert.equal(food.name, 'Eggo Thick & Fluffy Original Belgian Style Waffles, Original');
  assert.deepEqual([food.serving_amount, food.serving_unit, food.grams_per_serving], [1, 'each', 55]);
  // Printed on the label, per waffle:
  assert.equal(food.calories, 160);
  assert.equal(food.protein_g, 3);
  assert.equal(food.sodium_mg, 270);
  assert.equal(food.potassium_mg, 30.2);
  // Not on the label; taken from the record's per-100 g figure (182 mg x 55 g / 100).
  assert.equal(food.phosphorus_mg, 100.1);
  // 22 g carbs minus 0.99 g fiber
  assert.equal(food.effective_carbs_g, 21.01);
  assert.deepEqual(missing, []);
  assert.equal(food.phosphate_additives, true); // "sodium aluminum phosphate" in the ingredients
  for (const key of ['calories', 'protein_g', 'sodium_mg', 'potassium_mg', 'phosphorus_mg', 'effective_carbs_g', 'phosphate_additives']) {
    assert.equal(origins[key], 'usda', key);
  }
  assert.equal(ref.fdcId, 2359968);
  assert.equal(ref.label, true);
  assert.equal(ref.date, 'Dec 2020');
  assert.equal(ref.url, 'https://fdc.nal.usda.gov/food-details/2359968/nutrients');
  assert.equal(food.notes, 'USDA FoodData Central 2359968 (label data, Dec 2020)');
});

test('the branded food scales by count and by weight', () => {
  const { food } = foodFromFdc(BRANDED);
  assert.equal(servingsFor(food, 2, 'each'), 2);
  assert.equal(servingsFor(food, 110, 'g'), 2);
  assert.equal(scaleFood(food, 2).calories, 320);
});

test('a generic record is per 100 g, and absent nutrients are missing rather than 0', () => {
  const record = {
    fdcId: 111, description: 'Waffle, plain, frozen', dataType: 'Survey (FNDDS)', publicationDate: '10/31/2024',
    foodNutrients: [
      { nutrient: { id: 1008, unitName: 'kcal' }, amount: 273 },
      { nutrient: { id: 1062, unitName: 'kJ' }, amount: 1142 },
      { nutrient: { id: 1003, unitName: 'g' }, amount: 6.5 },
      { nutrient: { id: 1093, unitName: 'mg' }, amount: 621 },
      { nutrient: { id: 1005, unitName: 'g' }, amount: 41 },
    ],
  };
  const { food, missing, origins, ref } = foodFromFdc(record);
  assert.deepEqual([food.serving_amount, food.serving_unit, food.grams_per_serving], [100, 'g', null]);
  assert.equal(food.calories, 273);
  assert.equal(food.potassium_mg, null);
  assert.equal(food.phosphorus_mg, null);
  assert.deepEqual(missing, ['potassium_mg', 'phosphorus_mg']);
  assert.equal(origins.potassium_mg, undefined);
  // No fiber figure: total carbs are reported, and the note says so.
  assert.equal(food.effective_carbs_g, 41);
  assert.match(food.notes, /no fiber listed/);
  assert.equal(food.phosphate_additives, false);
  assert.equal(origins.phosphate_additives, undefined); // no ingredient list to read
  assert.equal(ref.label, false);
  assert.equal(ref.date, 'Oct 2024');
});

test('lab foods fall back to the Atwater energy figure', () => {
  const { food } = foodFromFdc({ fdcId: 5, description: 'Salmon', dataType: 'Foundation', foodNutrients: [{ nutrient: { id: 2047, unitName: 'kcal' }, amount: 201 }] });
  assert.equal(food.calories, 201);
});

test('a record with no usable values is rejected', () => {
  assert.equal(foodFromFdc({ fdcId: 1, description: 'Empty', dataType: 'Branded', foodNutrients: [] }), null);
  assert.equal(foodFromFdc(null), null);
});

test('the search shape (nutrientId / value) reads the same as the detail shape', () => {
  const { food } = foodFromFdc(SEARCH.foods[0]);
  assert.equal(food.serving_unit, 'each');
  assert.equal(food.calories, 157.85); // 287 kcal per 100 g x 55 g; search replies carry no label panel
});

test('a drink sold by volume keeps millilitres or its counted serving', () => {
  const base = { fdcId: 9, description: 'COLA', dataType: 'Branded', servingSize: 355, servingSizeUnit: 'MLT', labelNutrients: { calories: { value: 140 }, sodium: { value: 45 } } };
  const can = foodFromFdc({ ...base, householdServingFullText: '1 can' }).food;
  assert.deepEqual([can.serving_amount, can.serving_unit, can.grams_per_serving], [1, 'each', null]);
  const cup = foodFromFdc({ ...base, householdServingFullText: '1.5 cups' }).food;
  assert.deepEqual([cup.serving_amount, cup.serving_unit], [355, 'ml']);
  assert.equal(servingsFor(cup, 1, 'cup').toFixed(3), (236.588 / 355).toFixed(3));
});

test('mergeEstimates fills only what USDA lacked, scaled by weight, and marks it AI', () => {
  const lookup = foodFromFdc({
    fdcId: 7, description: 'CRACKERS', dataType: 'Branded', servingSize: 30, servingSizeUnit: 'g', householdServingFullText: '5 crackers',
    labelNutrients: { calories: { value: 140 }, protein: { value: 2 }, sodium: { value: 230 }, carbohydrates: { value: 20 }, fiber: { value: 1 } },
  });
  assert.deepEqual(lookup.missing, ['potassium_mg', 'phosphorus_mg']);
  // The AI describes a 15 g serving, so everything doubles for the 30 g label serving.
  const ai = { serving_amount: 15, serving_unit: 'g', grams_per_serving: null, calories: 999, protein_g: 99, sodium_mg: 999, potassium_mg: 20, phosphorus_mg: 35.5, effective_carbs_g: 99 };
  const merged = mergeEstimates(lookup, ai);
  assert.equal(merged.food.potassium_mg, 40);
  assert.equal(merged.food.phosphorus_mg, 71);
  assert.equal(merged.food.calories, 140); // USDA values are never replaced
  assert.equal(merged.food.effective_carbs_g, 19);
  assert.deepEqual(merged.missing, []);
  assert.equal(merged.origins.potassium_mg, 'ai');
  assert.equal(merged.origins.phosphorus_mg, 'ai');
  assert.equal(merged.origins.calories, 'usda');
  assert.match(merged.food.notes, /AI estimate: potassium, phosphorus$/);
  assert.equal(lookup.food.potassium_mg, null); // the original is untouched
});

test('mergeEstimates leaves blanks when the AI has no value or the servings cannot be compared', () => {
  const lookup = foodFromFdc({
    fdcId: 7, description: 'CRACKERS', dataType: 'Branded', servingSize: 30, servingSizeUnit: 'g',
    labelNutrients: { calories: { value: 140 }, protein: { value: 2 }, sodium: { value: 230 } },
  });
  const partial = mergeEstimates(lookup, { serving_amount: 30, serving_unit: 'g', potassium_mg: 40, phosphorus_mg: null });
  assert.deepEqual(partial.missing, ['phosphorus_mg']);
  const incomparable = mergeEstimates(lookup, { serving_amount: 1, serving_unit: 'cup', grams_per_serving: null, potassium_mg: 40, phosphorus_mg: 50 });
  assert.equal(incomparable, lookup);
  assert.equal(mergeEstimates(lookup, null), lookup);
});

test('gramsFromPortions uses the record’s own measures', () => {
  const record = {
    foodPortions: [
      { amount: 1, modifier: 'cup', gramWeight: 158 },
      { amount: 1, measureUnit: { name: 'tablespoon', abbreviation: 'tbsp' }, gramWeight: 9.9 },
      { portionDescription: '1 slice, thin', gramWeight: 21 },
      { portionDescription: 'Quantity not specified', gramWeight: 100 },
    ],
  };
  assert.equal(gramsFromPortions(record, 1.5, 'cups'), 237);
  assert.equal(gramsFromPortions(record, 2, 'tbsp'), 19.8);
  assert.equal(gramsFromPortions(record, 2, 'slices'), 42);
  assert.equal(gramsFromPortions(record, 1, 'tsp'), null);
  assert.equal(gramsFromPortions(record, 2, 'each'), null); // "each" could mean anything
  assert.equal(gramsFromPortions({}, 1, 'cup'), null);
});

test('relevance counts the query words found in name and brand', () => {
  assert.equal(relevance('eggo thick and fluffy waffle', BRANDED), 1);
  assert.equal(relevance('eggo thick and fluffy waffle', { description: 'Frostings, white, fluffy, dry mix' }), 0.25);
  assert.equal(relevance('', BRANDED), 0);
});

test('pickCandidates drops weak matches and describes the rest', () => {
  const picks = pickCandidates('eggo thick and fluffy waffle', SEARCH.foods);
  assert.ok(picks.length > 0 && picks.length <= 8);
  assert.equal(picks[0].fdcId, 752908);
  assert.equal(picks[0].title, "Kellogg's Eggo Waffles Original Thick & Fluffy 11.6oz");
  assert.equal(picks[0].detail, 'Kellogg Company US · 1 waffle = 55 g · label data 2018');
  assert.ok(!picks.some((p) => /Frosting|Milk shake|Pizza/i.test(p.title)));
  // The whole-grain Eggo, last in USDA's order, is a full match and moves up.
  assert.ok(picks.some((p) => p.fdcId === 2615402));
});

test('pickCandidates keeps one record per barcode: the newest', () => {
  const foods = [
    { fdcId: 1, description: 'Bar', dataType: 'Branded', gtinUpc: '00012345', publishedDate: '2019-04-01' },
    { fdcId: 2, description: 'Bar', dataType: 'Branded', gtinUpc: '12345', publishedDate: '2022-12-07' },
    { fdcId: 3, description: 'Bar, generic', dataType: 'SR Legacy', publishedDate: '2019-04-01' },
  ];
  const picks = pickCandidates('bar', foods);
  assert.deepEqual(picks.map((p) => p.fdcId), [2, 3]);
  assert.equal(picks[1].detail, 'per 100 g · USDA reference data 2019');
});

test('pickCandidates still offers something when nothing matches well', () => {
  const picks = pickCandidates('zzz', [{ fdcId: 1, description: 'Apple', dataType: 'Foundation' }]);
  assert.equal(picks.length, 1);
  assert.deepEqual(pickCandidates('apple', undefined), []);
});

test('searchFoods sends the words and the key to USDA only', async () => {
  const fetch = fakeFetch({ json: SEARCH });
  const picks = await searchFoods(config, 'eggo thick and fluffy waffle', { fetch });
  assert.ok(picks.length > 0);
  const url = new URL(fetch.calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://api.nal.usda.gov/fdc/v1/foods/search');
  assert.equal(url.searchParams.get('query'), 'eggo thick and fluffy waffle');
  assert.equal(url.searchParams.get('api_key'), KEY);
  assert.equal(fetch.calls[0].init.method, 'GET');
  assert.equal(fetch.calls[0].init.headers, undefined);
});

test('fetchFood follows an old record to the newest version of the barcode', async () => {
  const fetch = fakeFetch({ json: BRANDED_OLD }, { json: BRANDED });
  const record = await fetchFood(config, 752908, { fetch });
  assert.equal(record.fdcId, 2359968);
  assert.equal(fetch.calls.length, 2);
  assert.match(fetch.calls[0].url, /\/food\/752908\?/);
  assert.match(fetch.calls[1].url, /\/food\/2359968\?/);
});

test('fetchFood makes one request when the record is already the newest', async () => {
  const fetch = fakeFetch({ json: BRANDED });
  assert.equal((await fetchFood(config, 2359968, { fetch })).fdcId, 2359968);
  assert.equal(fetch.calls.length, 1);
});

test('fetchFood keeps the older record if the newer one cannot be fetched', async () => {
  const fetch = fakeFetch({ json: BRANDED_OLD }, { status: 500, json: {} });
  assert.equal((await fetchFood(config, 752908, { fetch })).fdcId, 752908);
});

test('errors are explained and never contain the key', async () => {
  const cases = [
    [{ status: 403, json: { error: { code: 'API_KEY_INVALID', message: `bad key ${KEY}` } } }, 'auth'],
    [{ status: 429, json: {} }, 'rate'],
    [{ status: 500, json: {} }, 'http'],
    [new TypeError('Failed to fetch'), 'network'],
    [Object.assign(new Error('aborted'), { name: 'AbortError' }), 'cancelled'],
  ];
  for (const [reply, kind] of cases) {
    await assert.rejects(searchFoods(config, 'apple', { fetch: fakeFetch(reply) }), (error) => {
      assert.ok(error instanceof UsdaError);
      assert.equal(error.kind, kind);
      assert.ok(!error.message.includes(KEY));
      return true;
    });
  }
  await assert.rejects(searchFoods({ apiKey: '' }, 'apple', { fetch: fakeFetch() }), (error) => error.kind === 'config');
});

test('testUsdaKey reports success and failure without throwing', async () => {
  assert.deepEqual(await testUsdaKey(config, { fetch: fakeFetch({ json: { foods: [] } }) }), { ok: true, message: 'Connected. USDA answered.' });
  const bad = await testUsdaKey(config, { fetch: fakeFetch({ status: 403, json: {} }) });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /rejected the API key/);
});

test('the record link points at the USDA page', () => {
  assert.equal(usdaFoodUrl(123), 'https://fdc.nal.usda.gov/food-details/123/nutrients');
});
