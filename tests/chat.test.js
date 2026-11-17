import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generalChatPrompt, refinePrompt, todayContext, validateValues, parseReply, valuesSummary, askChat, DOSING_REPLY } from '../docs/js/chat.js';
import { readLabel } from '../docs/js/ai.js';

const config = { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-TEST', model: 'test-model' };
function fakeFetch(...replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: replies.shift() } }] }) };
  };
  fn.calls = calls;
  return fn;
}

const SANDWICH = `Here is the breakdown:
- **Rye bread**, 2 slices: 166 kcal, P 5.4 g
- Turkey, 2 oz: 60 kcal, P 12 g

\`\`\`values
{"name": "Turkey on rye", "amount": 1, "unit": "each", "calories": 226, "protein_g": 17.4, "sodium_mg": 980, "potassium_mg": 310, "phosphorus_mg": 240, "total_carbs_g": 31, "fiber_g": 4, "phosphate_additives": true}
\`\`\``;

test('a values block is split from the prose and validated', () => {
  const { text, values } = parseReply(SANDWICH);
  assert.ok(text.startsWith('Here is the breakdown:'));
  assert.ok(!text.includes('```'));
  assert.deepEqual(values, {
    name: 'Turkey on rye', calories: 226, protein_g: 17.4, sodium_mg: 980, potassium_mg: 310, phosphorus_mg: 240,
    effective_carbs_g: 27, amount: 1, unit: 'each', phosphate_additives: true,
  });
});

test('a reply without a block has no values; a broken block is dropped', () => {
  assert.deepEqual(parseReply('Bananas are high in potassium.'), { text: 'Bananas are high in potassium.', values: null });
  const broken = parseReply('Hmm.\n```values\n{not json}\n```');
  assert.equal(broken.values, null);
  assert.equal(broken.text, 'Hmm.');
});

test('the last good block wins when there are several', () => {
  const reply = '```values\n{"calories": 100}\n```\nActually:\n```values\n{"calories": 150, "amount": 2, "unit": "slices"}\n```';
  const { values } = parseReply(reply);
  assert.equal(values.calories, 150);
  assert.equal(values.amount, 2);
  assert.equal(values.unit, 'slice');
});

test('validateValues keeps unknowns as null and rejects blocks with no numbers', () => {
  assert.equal(validateValues({ name: 'x' }), null);
  assert.equal(validateValues(null), null);
  assert.equal(validateValues([1]), null);
  const v = validateValues({ calories: '250', protein_g: -3, sodium_mg: 'lots', amount: 0, unit: 'bowl' });
  assert.equal(v.calories, 250);
  assert.equal(v.protein_g, null);
  assert.equal(v.sodium_mg, null);
  assert.equal(v.effective_carbs_g, null);
  assert.equal(v.amount, null);
  assert.equal(v.unit, null);
  assert.equal(validateValues({ calories: 1, effective_carbs_g: 12 }).effective_carbs_g, 12);
});

test('prose that strays into dosing is replaced; a food "correction" is fine', () => {
  assert.equal(parseReply('Take 4 units of insulin for that.').text, DOSING_REPLY);
  assert.equal(parseReply('Correction: the bun is 150 kcal.').text, 'Correction: the bun is 150 kcal.');
  // The numbers are still nutrition facts, so they survive.
  assert.equal(parseReply('Your bolus dose...\n```values\n{"calories": 90}\n```').values.calories, 90);
});

test('prompts carry the values format, the card, and today, and forbid dosing', () => {
  const general = generalChatPrompt(todayContext({ calories: 900, protein_g: 20 }, { calories: 2150, protein_g: 55, sodium_mg: 2000, potassium_mg: 2000, phosphorus_mg: 800 }));
  assert.match(general, /```values/);
  assert.match(general, /Calories 900 of 2150 kcal; Protein 20 of 55 g; Sodium 0 of 2000 mg/);
  assert.match(general, /Never mention insulin/);
  const refine = refinePrompt({ name: 'Sandwich', amount: 1, unit: 'each', nutrients: { calories: 300, protein_g: null, effective_carbs_g: 20 } });
  assert.match(refine, /Food: “Sandwich”, 1 each/);
  assert.match(refine, /Calories: 300 kcal/);
  assert.match(refine, /Protein: unknown/);
  assert.match(refine, /Effective carbs: 20 g/);
  assert.match(refine, /Never mention insulin/);
  assert.equal(todayContext(null, null), '');
});

test('valuesSummary reads like an entry line', () => {
  const { values } = parseReply(SANDWICH);
  assert.equal(valuesSummary(values), '1 each · 226 kcal · P 17.4 g · S 980 mg · K 310 mg · H 240 mg · carbs 27 g');
});

test('askChat sends the system prompt then the history, images included', async () => {
  const fetch = fakeFetch(SANDWICH);
  const history = [{ role: 'user', content: [{ type: 'text', text: 'this' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } }] }];
  const reply = await askChat(config, 'SYSTEM', history, { fetch });
  assert.equal(reply.values.calories, 226);
  assert.equal(reply.raw, SANDWICH);
  assert.deepEqual(fetch.calls[0].messages, [{ role: 'system', content: 'SYSTEM' }, ...history]);
});

test('a photo that is not a label says so, so the app can offer the chat', async () => {
  const fetch = fakeFetch('{"not_a_label": true}', '{"not_a_label": true}');
  await assert.rejects(readLabel(config, 'data:image/jpeg;base64,AAA', '', { fetch }), (error) => error.kind === 'format' && error.notLabel === true);
});
