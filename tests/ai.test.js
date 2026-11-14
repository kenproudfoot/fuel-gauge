import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, isConfigured, AiError, chat, listModels, testConnection, extractJson, scrubNotes, validateLookup, validateParse,
  lookupFood, parseWithAi, gramsFor, LOOKUP_SYSTEM_PROMPT, PARSE_SYSTEM_PROMPT, CONVERT_SYSTEM_PROMPT,
} from '../docs/js/ai.js';

const KEY = 'sk-TEST-KEY-123';
const openai = { baseUrl: 'https://api.openai.com/v1/', apiKey: KEY, model: 'test-model' };
const anthropic = { baseUrl: 'https://api.anthropic.com/v1', apiKey: KEY, model: 'claude-opus-5-5' };

const GOOD = {
  name: 'Candied pecans', brand: 'Test Brand', serving_amount: 30, serving_unit: 'g', grams_per_serving: 30,
  calories: 200, protein_g: 2, sodium_mg: 40, potassium_mg: 110, phosphorus_mg: 75,
  total_carbs_g: 12, fiber_g: 3, effective_carbs_g: 9, phosphate_additives: false, confidence: 'high', notes: 'USDA closest match.',
};

/** A fake fetch that replays canned replies and records every call. */
function fakeFetch(...replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => reply.json };
  };
  fn.calls = calls;
  return fn;
}
const completion = (content) => ({ json: { choices: [{ message: { role: 'assistant', content } }] } });

test('presets cover OpenAI, Gemini, Anthropic and Custom over https', () => {
  assert.deepEqual(PRESETS.map((p) => p.id), ['openai', 'gemini', 'anthropic', 'custom']);
  for (const p of PRESETS.filter((x) => x.id !== 'custom')) assert.match(p.baseUrl, /^https:\/\//);
  assert.equal(isConfigured(openai), true);
  assert.equal(isConfigured({ ...openai, apiKey: '' }), false);
  assert.equal(isConfigured({ ...openai, model: '' }), false);
  assert.equal(isConfigured(undefined), false);
});

test('chat posts a minimal OpenAI-compatible request with the bearer key', async () => {
  const fetch = fakeFetch(completion('hello'));
  assert.equal(await chat(openai, [{ role: 'user', content: 'hi' }], { fetch }), 'hello');
  const call = fetch.calls[0];
  assert.equal(call.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(call.body, { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] });
  assert.ok(!('anthropic-dangerous-direct-browser-access' in call.init.headers));
});

test('Anthropic requests add the browser-access header and a token limit', async () => {
  const fetch = fakeFetch(completion('ok'));
  await chat(anthropic, [{ role: 'user', content: 'hi' }], { fetch });
  const call = fetch.calls[0];
  assert.equal(call.url, 'https://api.anthropic.com/v1/chat/completions');
  assert.equal(call.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(call.body.max_tokens, 16000);
  assert.ok(!('response_format' in call.body) && !('temperature' in call.body));
});

test('errors are classified and never contain the API key', async () => {
  const cases = [
    [{ status: 401, json: { error: { message: `Incorrect API key provided: ${KEY}` } } }, 'auth'],
    [{ status: 403, json: {} }, 'auth'],
    [{ status: 429, json: { error: { message: 'quota' } } }, 'rate'],
    [{ status: 404, json: { error: { message: 'model not found' } } }, 'model'],
    [{ status: 500, json: {} }, 'http'],
    [new TypeError('Failed to fetch'), 'network'],
    [Object.assign(new Error('aborted'), { name: 'AbortError' }), 'cancelled'],
  ];
  for (const [reply, kind] of cases) {
    await assert.rejects(chat(openai, [], { fetch: fakeFetch(reply) }), (error) => {
      assert.ok(error instanceof AiError);
      assert.equal(error.kind, kind);
      assert.ok(!error.message.includes(KEY), 'key must not leak into messages');
      return true;
    });
  }
  await assert.rejects(chat({ ...openai, apiKey: '' }, [], { fetch: fakeFetch() }), { kind: 'config' });
  await assert.rejects(chat(openai, [], { fetch: fakeFetch(completion('   ')) }), { kind: 'format' });
});

test('listModels reads OpenAI- and Gemini-style lists', async () => {
  const fetch = fakeFetch({ json: { data: [{ id: 'b-model' }, { id: 'models/a-model' }] } });
  assert.deepEqual(await listModels(openai, { fetch }), ['a-model', 'b-model']);
  assert.equal(fetch.calls[0].url, 'https://api.openai.com/v1/models');
  assert.equal(fetch.calls[0].init.method, 'GET');
});

test('testConnection reports each stage plainly and never throws', async () => {
  const models = { json: { data: [{ id: 'test-model' }] } };
  assert.deepEqual(await testConnection(openai, { fetch: fakeFetch(models, completion('OK')) }), { ok: true, message: 'Connected. test-model answered.', models: ['test-model'] });
  const noModel = await testConnection({ ...openai, model: '' }, { fetch: fakeFetch(models) });
  assert.equal(noModel.ok, false);
  assert.match(noModel.message, /choose a model \(1 available\)/);
  const badKey = await testConnection(openai, { fetch: fakeFetch({ status: 401, json: {} }) });
  assert.equal(badKey.ok, false);
  assert.match(badKey.message, /rejected the API key/);
  const offline = await testConnection(openai, { fetch: fakeFetch(new TypeError('x')) });
  assert.match(offline.message, /offline/);
  // A provider that cannot list models can still pass on the chat check.
  const noList = await testConnection(openai, { fetch: fakeFetch({ status: 404, json: {} }, completion('OK')) });
  assert.equal(noList.ok, true);
  const badModel = await testConnection(openai, { fetch: fakeFetch(models, { status: 404, json: { error: { message: 'no such model' } } }) });
  assert.equal(badModel.ok, false);
  assert.match(badModel.message, /did not recognize the model/);
});

test('extractJson tolerates fences and stray text', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Here you go:\n{"a":{"b":2}}\nHope that helps'), { a: { b: 2 } });
  for (const bad of ['', 'no json', '[1,2]', '{"a":', null]) assert.equal(extractJson(bad), null);
});

test('the lookup prompt carries the required rules', () => {
  const p = LOOKUP_SYSTEM_PROMPT;
  for (const key of ['name', 'brand', 'serving_amount', 'serving_unit', 'grams_per_serving', 'calories', 'protein_g', 'sodium_mg', 'potassium_mg', 'phosphorus_mg', 'total_carbs_g', 'fiber_g', 'effective_carbs_g', 'phosphate_additives', 'confidence', 'notes']) {
    assert.ok(p.includes(`"${key}"`), key);
  }
  assert.match(p, /brand's nutrition label/);
  assert.match(p, /USDA FoodData Central/);
  assert.match(p, /potassium %DV x 4700 mg/);
  assert.match(p, /phosphorus %DV x 1250 mg/);
  assert.match(p, /sodium %DV x 2300 mg/);
  assert.match(p, /processed meats, colas, processed cheese/);
  assert.match(p, /containing "phos"/);
});

test('every prompt forbids insulin dosing talk, and none asks for it', () => {
  for (const p of [LOOKUP_SYSTEM_PROMPT, PARSE_SYSTEM_PROMPT, CONVERT_SYSTEM_PROMPT]) {
    assert.match(p, /Never mention insulin, doses, dosing, ratios or corrections/);
    const rest = p.replace(/Never mention insulin, doses, dosing, ratios or corrections[^.]*\./, '');
    assert.ok(!/insulin|dosing|bolus/i.test(rest));
  }
});

test('notes that stray into dosing are dropped whole', () => {
  assert.equal(scrubNotes('USDA closest match.'), 'USDA closest match.');
  for (const bad of ['Take 2 units of rapid insulin', 'Consider a correction', 'bolus for 9 g', 'Adjust your dose', 'use your carb ratio']) {
    assert.equal(scrubNotes(bad), '', bad);
  }
  assert.equal(scrubNotes('x'.repeat(500)).length, 240);
  assert.equal(scrubNotes(null), '');
});

test('validateLookup accepts a good reply and recomputes effective carbs', () => {
  const { ok, food, missing } = validateLookup({ ...GOOD, effective_carbs_g: 99 });
  assert.equal(ok, true);
  assert.deepEqual(missing, []);
  assert.equal(food.effective_carbs_g, 9, 'total minus fiber wins over the stated figure');
  assert.equal(food.grams_per_serving, null, 'a weight serving needs no grams per serving');
  assert.equal(food.brand, 'Test Brand');
  assert.equal(food.confidence, 'high');
  assert.equal(food.phosphorus_mg, 75);
});

test('validateLookup keeps unknowns unknown instead of inventing zeros', () => {
  const { ok, food, missing } = validateLookup({ ...GOOD, phosphorus_mg: null, potassium_mg: 'n/a', total_carbs_g: null, fiber_g: null, effective_carbs_g: null, confidence: 'Medium', brand: 'null' });
  assert.equal(ok, true);
  assert.deepEqual(missing, ['potassium_mg', 'phosphorus_mg']);
  assert.equal(food.phosphorus_mg, null);
  assert.equal(food.effective_carbs_g, null);
  assert.equal(food.confidence, 'med');
  assert.equal(food.brand, '');
});

test('validateLookup normalizes servings and falls back to grams', () => {
  assert.equal(validateLookup({ ...GOOD, serving_amount: '1', serving_unit: 'Cups', grams_per_serving: 110 }).food.serving_unit, 'cup');
  const bar = validateLookup({ ...GOOD, serving_amount: 1, serving_unit: 'bar', grams_per_serving: 52 }).food;
  assert.deepEqual([bar.serving_amount, bar.serving_unit, bar.grams_per_serving], [52, 'g', null]);
  assert.equal(validateLookup({ ...GOOD, serving_unit: 'bar', grams_per_serving: null }).ok, false);
});

test('validateLookup rejects unusable replies', () => {
  for (const bad of [null, 'text', {}, { ...GOOD, name: '' }, { ...GOOD, sodium_mg: -5 }, { name: 'x', serving_amount: 1, serving_unit: 'g' }]) {
    assert.equal(validateLookup(bad).ok, false);
  }
  assert.equal(validateLookup({ ...GOOD, notes: 'bolus 2 units of rapid insulin' }).food.notes, '');
});

test('validateParse yields parser-style commands', () => {
  assert.deepEqual(validateParse({ amount: 2, unit: 'slices', food: 'Sourdough Toast' }), { type: 'log', amount: 2, unit: 'slice', unitExplicit: true, food: 'sourdough toast', confident: true });
  assert.deepEqual(validateParse({ amount: 2, unit: null, food: 'eggs' }), { type: 'log', amount: 2, unit: 'each', unitExplicit: false, food: 'eggs', confident: true });
  assert.equal(validateParse({ amount: 1, unit: 'bowl', food: 'soup' }).unit, 'each');
  assert.deepEqual(validateParse({ amount: null, unit: null, food: 'banana' }), { type: 'log', amount: null, unit: null, unitExplicit: false, food: 'banana', confident: false });
  for (const none of [{ unknown: true }, {}, null, { food: ' ' }]) assert.equal(validateParse(none), null);
});

test('lookupFood sends the system prompt and the food, and returns the validated food', async () => {
  const fetch = fakeFetch(completion(`\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\``));
  const { food, missing } = await lookupFood(openai, { food: 'candied pecans', amount: 12, unit: 'g' }, { fetch });
  assert.equal(food.name, 'Candied pecans');
  assert.deepEqual(missing, []);
  assert.equal(fetch.calls.length, 1);
  assert.deepEqual(fetch.calls[0].body.messages, [
    { role: 'system', content: LOOKUP_SYSTEM_PROMPT },
    { role: 'user', content: 'Food: 12 g of candied pecans' },
  ]);
});

test('bad JSON is retried exactly once, then gives up', async () => {
  const recovered = fakeFetch(completion('Sure! Pecans are tasty.'), completion(JSON.stringify(GOOD)));
  assert.equal((await lookupFood(openai, { food: 'pecans' }, { fetch: recovered })).food.calories, 200);
  assert.equal(recovered.calls.length, 2);
  const retry = recovered.calls[1].body.messages;
  assert.equal(retry.length, 4);
  assert.deepEqual(retry[2], { role: 'assistant', content: 'Sure! Pecans are tasty.' });
  assert.match(retry[3].content, /only the JSON object/);

  const hopeless = fakeFetch(completion('nope'), completion('{"name":""}'), completion(JSON.stringify(GOOD)));
  await assert.rejects(lookupFood(openai, { food: 'pecans' }, { fetch: hopeless }), { kind: 'format' });
  assert.equal(hopeless.calls.length, 2, 'no third attempt');
});

test('an invalid but well-formed reply is also retried', async () => {
  const fetch = fakeFetch(completion(JSON.stringify({ ...GOOD, sodium_mg: -1 })), completion(JSON.stringify(GOOD)));
  assert.equal((await lookupFood(openai, { food: 'pecans' }, { fetch })).food.sodium_mg, 40);
  assert.match(fetch.calls[1].body.messages[3].content, /sodium_mg is negative/);
});

test('parseWithAi and gramsFor', async () => {
  assert.deepEqual(
    await parseWithAi(openai, 'had a couple slices of sourdough', { fetch: fakeFetch(completion('{"amount":2,"unit":"slice","food":"sourdough"}')) }),
    { type: 'log', amount: 2, unit: 'slice', unitExplicit: true, food: 'sourdough', confident: true },
  );
  assert.equal(await parseWithAi(openai, 'what time is it', { fetch: fakeFetch(completion('{"unknown":true}')) }), null);
  assert.deepEqual(await gramsFor(openai, { food: 'pecans', amount: 1, unit: 'cup' }, { fetch: fakeFetch(completion('{"grams":109.04,"notes":"halves"}')) }), { grams: 109, notes: 'halves' });
  await assert.rejects(gramsFor(openai, { food: 'x', amount: 1, unit: 'cup' }, { fetch: fakeFetch(completion('{"grams":0}'), completion('{"grams":-1}')) }), { kind: 'format' });
});

test('a network failure during lookup surfaces as offline, with no retry', async () => {
  const fetch = fakeFetch(new TypeError('Failed to fetch'));
  await assert.rejects(lookupFood(openai, { food: 'pecans' }, { fetch }), { kind: 'network' });
  assert.equal(fetch.calls.length, 1);
});

// --- label photo -----------------------------------------------------------
import { validateLabel, readLabel, LABEL_SYSTEM_PROMPT } from '../docs/js/ai.js';

const LABEL = {
  name: '', serving_amount: 1, serving_unit: 'each', grams_per_serving: 55, calories: 160, protein_g: 3, sodium_mg: 270,
  potassium_mg: 30, phosphorus_mg: null, total_carbs_g: 22, fiber_g: 0.5, ingredients_visible: true, phosphate_additives: true, notes: '',
};
const chatReply = (content) => ({ json: { choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] } });

test('validateLabel keeps printed values, leaves the rest missing, and marks origins', () => {
  const { ok, food, missing, origins } = validateLabel(LABEL, 'eggo waffle');
  assert.equal(ok, true);
  assert.equal(food.name, 'eggo waffle'); // nothing printed, so what was typed is used
  assert.deepEqual([food.serving_amount, food.serving_unit, food.grams_per_serving], [1, 'each', 55]);
  assert.equal(food.phosphorus_mg, null);
  assert.deepEqual(missing, ['phosphorus_mg']);
  assert.equal(food.effective_carbs_g, 21.5);
  assert.equal(origins.calories, 'label');
  assert.equal(origins.phosphorus_mg, undefined);
  assert.equal(origins.effective_carbs_g, 'label');
  assert.equal(food.phosphate_additives, true);
  assert.equal(origins.phosphate_additives, 'label');
  assert.match(food.notes, /^Read from a label photo/);
});

test('validateLabel prefers a printed name and allows none at all', () => {
  assert.equal(validateLabel({ ...LABEL, name: 'Thick & Fluffy Waffles' }, 'typed').food.name, 'Thick & Fluffy Waffles');
  const unnamed = validateLabel(LABEL);
  assert.equal(unnamed.ok, true);
  assert.equal(unnamed.food.name, '');
});

test('validateLabel does not claim additives without a readable ingredient list', () => {
  for (const reply of [{ ...LABEL, ingredients_visible: false }, { ...LABEL, phosphate_additives: null }]) {
    const { food, origins } = validateLabel(reply);
    assert.equal(food.phosphate_additives, false);
    assert.equal(origins.phosphate_additives, undefined);
  }
});

test('validateLabel rejects a photo that is not a label, or has no values', () => {
  const not = validateLabel({ not_a_label: true });
  assert.equal(not.ok, false);
  assert.equal(not.notLabel, true);
  assert.equal(validateLabel({ name: 'x', serving_amount: 1, serving_unit: 'each' }).ok, false);
  assert.equal(validateLabel(null).ok, false);
});

test('readLabel sends the photo as an image part and returns the lookup', async () => {
  const fetch = fakeFetch(chatReply(LABEL));
  const photo = 'data:image/jpeg;base64,AAAA';
  const lookup = await readLabel(openai, photo, 'eggo waffle', { fetch });
  assert.equal(lookup.food.calories, 160);
  assert.deepEqual(lookup.missing, ['phosphorus_mg']);
  const { body } = fetch.calls[0];
  assert.deepEqual(Object.keys(body), ['model', 'messages']);
  assert.equal(body.messages[0].content, LABEL_SYSTEM_PROMPT);
  assert.deepEqual(body.messages[1].content[1], { type: 'image_url', image_url: { url: photo } });
});

test('readLabel explains a photo that is not a label', async () => {
  const fetch = fakeFetch(chatReply({ not_a_label: true }), chatReply({ not_a_label: true }));
  await assert.rejects(readLabel(openai, 'data:image/jpeg;base64,AAAA', '', { fetch }), (error) => {
    assert.equal(error.kind, 'format');
    assert.match(error.message, /doesn't look like a nutrition label/);
    return true;
  });
});

test('the label prompt forbids estimating and any dosing talk', () => {
  assert.match(LABEL_SYSTEM_PROMPT, /Never estimate/);
  assert.match(LABEL_SYSTEM_PROMPT, /Never mention insulin, doses, dosing, ratios or corrections/);
});
