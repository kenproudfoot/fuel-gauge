// AI lookup through any OpenAI-compatible Chat Completions API, called with
// fetch straight from the browser. DOM-free: fetch is injectable for tests.
//
// The app only REPORTS nutrients and effective carbs. Nothing here may ever
// ask for, produce or pass through insulin dosing advice.

import { NUTRIENTS } from './nutrients.js';
import { normalizeUnit, unitKind, SERVING_UNITS } from './units.js';

/**
 * Provider presets. Each was checked for browser (CORS) access; see README.
 * `headers` and `body` are extras that provider needs on every request.
 * Models change often, so OpenAI and Gemini start blank: "Test AI connection"
 * loads the provider's current list to pick from.
 */
export const PRESETS = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '' },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: '',
  },
  { id: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', baseUrl: '', model: '' },
];

/** Per-provider request extras, chosen by the host in the base URL so "Custom" works too. */
function providerExtras(baseUrl) {
  let host = '';
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    host = '';
  }
  if (host === 'api.anthropic.com') {
    return {
      // Anthropic only answers browser requests that carry this header. The
      // name is its warning that the key lives in the browser, which is this
      // app's design for every provider: the key stays on this device.
      headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      body: { max_tokens: 16000 },
    };
  }
  return { headers: {}, body: {} };
}

export function isConfigured(config) {
  return Boolean(config?.baseUrl && config?.apiKey && config?.model);
}

/** An error the UI can explain. `kind`: config | network | auth | rate | model | http | format | cancelled */
export class AiError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
  }
}

function endpoint(baseUrl, path) {
  return `${String(baseUrl).trim().replace(/\/+$/, '')}/${path}`;
}

async function request(config, path, init, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  if (!config?.baseUrl || !config?.apiKey) throw new AiError('config', 'AI lookup is not set up yet.');
  const extras = providerExtras(config.baseUrl);
  let response;
  try {
    response = await fetchFn(endpoint(config.baseUrl, path), {
      ...init,
      signal: deps.signal,
      headers: { Authorization: `Bearer ${config.apiKey}`, ...extras.headers, ...(init.headers || {}) },
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new AiError('cancelled', 'Cancelled.');
    // Offline, DNS failure, or a server that does not allow browser requests.
    throw new AiError('network', "Can't reach the AI service. You may be offline.");
  }
  if (response.ok) return response.json();

  // Error bodies are provider text; keep a short piece for the message, never the key.
  let detail = '';
  try {
    const body = await response.json();
    detail = String(body?.error?.message || body?.message || '').slice(0, 160);
  } catch {
    detail = '';
  }
  detail = detail.split(config.apiKey).join('[key]');
  const suffix = detail ? ` (${detail})` : '';
  if (response.status === 401 || response.status === 403) throw new AiError('auth', `The AI service rejected the API key.${suffix}`);
  if (response.status === 429) throw new AiError('rate', `The AI service is rate-limiting or out of quota.${suffix}`);
  if (response.status === 404) throw new AiError('model', `The AI service did not recognize the model or address.${suffix}`);
  throw new AiError('http', `The AI service returned an error (${response.status}).${suffix}`);
}

/**
 * One chat completion; returns the reply text.
 * Deliberately minimal: no response_format, temperature or token-limit fields,
 * because providers disagree on them. JSON is requested in the prompt and
 * checked here instead.
 */
export async function chat(config, messages, deps = {}) {
  if (!config?.model) throw new AiError('config', 'Choose an AI model in Settings.');
  const extras = providerExtras(config.baseUrl);
  const data = await request(
    config,
    'chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, messages, ...extras.body }),
    },
    deps,
  );
  const content = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((part) => part?.text || '').join('') : content;
  if (typeof text !== 'string' || text.trim() === '') throw new AiError('format', 'The AI service sent an empty reply.');
  return text;
}

/** Model ids the provider offers, sorted. */
export async function listModels(config, deps = {}) {
  const data = await request(config, 'models', { method: 'GET' }, deps);
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return list
    .map((m) => String(m?.id || m?.name || '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort();
}

/** Check the settings end to end. Returns { ok, message, models }. Never throws. */
export async function testConnection(config, deps = {}) {
  let models = [];
  let listError = null;
  try {
    models = await listModels(config, deps);
  } catch (error) {
    listError = error;
    if (['config', 'network', 'auth'].includes(error.kind)) return { ok: false, message: error.message, models };
  }
  if (!config.model) {
    return models.length
      ? { ok: false, message: `Connected. Now choose a model (${models.length} available).`, models }
      : { ok: false, message: listError?.message || 'Connected, but no models were listed. Type a model name.', models };
  }
  try {
    await chat(config, [{ role: 'user', content: 'Reply with the single word: OK' }], deps);
    return { ok: true, message: `Connected. ${config.model} answered.`, models };
  } catch (error) {
    return { ok: false, message: error.message, models };
  }
}

// --- prompts ---------------------------------------------------------------

export const LOOKUP_SYSTEM_PROMPT = `You are a nutrition data assistant inside a food-logging app that tracks calories, protein, sodium, potassium, phosphorus and carbohydrates.

The user names a food, sometimes with an amount. Reply with ONE JSON object describing ONE serving of that food, and nothing else: no prose, no markdown, no code fences.

Keys (all required):
  "name": string, the food's plain name without the brand
  "brand": string or null
  "serving_amount": number > 0
  "serving_unit": one of "g", "oz", "lb", "cup", "tbsp", "tsp", "ml", "each", "slice", "piece"
  "grams_per_serving": number, the weight of one serving in grams (your best estimate; null only if truly unknowable)
  "calories": number (kcal)
  "protein_g": number
  "sodium_mg": number
  "potassium_mg": number
  "phosphorus_mg": number
  "total_carbs_g": number
  "fiber_g": number
  "effective_carbs_g": number, equal to total_carbs_g minus fiber_g
  "phosphate_additives": true or false
  "confidence": "low", "med" or "high"
  "notes": string, at most 200 characters: the source used and any assumption made

Rules:
- Sources: prefer the actual brand's nutrition label. If there is no brand, or you do not know its label, use USDA FoodData Central values for the closest matching food.
- All numbers are for one serving as defined by serving_amount and serving_unit. If the user gave a unit, define the serving in that unit when it is sensible, and always fill grams_per_serving so the app can convert.
- When a label gives a percent Daily Value instead of milligrams, convert with the FDA Daily Values: potassium %DV x 4700 mg, phosphorus %DV x 1250 mg, sodium %DV x 2300 mg.
- Phosphorus is rarely printed on labels. Estimate it as closely as possible from USDA data for the closest matching food. Do not leave it out and do not answer 0 unless the food truly has none.
- Set "phosphate_additives" to true when phosphate additives are likely: processed meats, colas, processed cheese, many packaged and baked goods, and anything with an ingredient containing "phos".
- "confidence" is "high" only when the values come from a label or USDA entry you know well; use "low" when you are guessing.
- Use numbers, not strings, for numeric values. Never invent a brand.
- Never mention insulin, doses, dosing, ratios or corrections, and give no medical advice. Report nutrition facts only.`;

export const PARSE_SYSTEM_PROMPT = `You turn one line of dictated or typed text from a food-logging app into JSON. Reply with ONE JSON object and nothing else: no prose, no markdown, no code fences.

If the text says the user ate or drank something, reply:
  {"amount": number or null, "unit": one of "g","oz","lb","cup","tbsp","tsp","ml","each","slice","piece","serving" or null, "food": string}
- "amount" and "unit" are null when no amount was said. Use "each" for a bare count such as "2 eggs".
- "food" is the food name only, including any brand, without the amount.
- If several foods are named, return only the first.

If the text is not about eating or drinking something, reply: {"unknown": true}

Never mention insulin, doses, dosing, ratios or corrections, and give no medical advice.`;

export const CONVERT_SYSTEM_PROMPT = `You convert a kitchen measure of a food to grams for a food-logging app. Reply with ONE JSON object and nothing else: {"grams": number, "notes": string}
- "grams" is your best estimate of the weight in grams of the amount described.
- "notes" is at most 120 characters on the assumption used.
Never mention insulin, doses, dosing, ratios or corrections, and give no medical advice.`;

export const LABEL_SYSTEM_PROMPT = `You read a photo of a packaged food's Nutrition Facts label for a food-logging app. Reply with ONE JSON object and nothing else: no prose, no markdown, no code fences.

Copy ONLY what is printed in the photo. Never estimate, never fill a value in from memory, and use null for anything that is not printed or that you cannot read with confidence.

If the photo does not show a nutrition label you can read, reply: {"not_a_label": true}

Otherwise reply with these keys (all required):
  "name": string, the product name if it is printed in the photo, otherwise ""
  "serving_amount": number > 0, from the label's serving size
  "serving_unit": one of "g", "oz", "lb", "cup", "tbsp", "tsp", "ml", "each", "slice", "piece" (use "each" for a counted item such as "1 waffle" or "12 chips")
  "grams_per_serving": number or null, the serving weight in grams when the label prints it, e.g. "1 waffle (55g)"
  "calories": number or null
  "protein_g": number or null
  "sodium_mg": number or null
  "potassium_mg": number or null
  "phosphorus_mg": number or null
  "total_carbs_g": number or null
  "fiber_g": number or null
  "ingredients_visible": true or false, whether an ingredient list can be read in the photo
  "phosphate_additives": true if a readable ingredient list has any ingredient containing "phos", false if a readable list has none, null if no ingredient list can be read
  "notes": string, at most 160 characters: anything that was hard to read

Rules:
- All numbers are for ONE serving as printed. If the label has several columns (per serving and per container, or as packaged and as prepared), use the per-serving, as-packaged column.
- A value printed only as a percent Daily Value may be converted with the FDA Daily Values: potassium %DV x 4700 mg, phosphorus %DV x 1250 mg, sodium %DV x 2300 mg. Say so in "notes".
- "<1 g" is 0.5. Use numbers, not strings.
- Never mention insulin, doses, dosing, ratios or corrections, and give no medical advice. Report what is printed only.`;

// --- reading replies -------------------------------------------------------

/** Pull the JSON object out of a reply, tolerating code fences or stray text around it. */
export function extractJson(text) {
  const raw = String(text ?? '').trim();
  const candidates = [raw, raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')];
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {
      // try the next shape
    }
  }
  return null;
}

const DOSING_WORDS = /insulin|bolus|basal|\bdos(?:e|es|ed|ing|age)\b|correction|carb\s*ratio|i:c\b|units?\s+of\s+(?:rapid|fast|long)/i;

/** Notes are shown to the user. Anything that strays into dosing is dropped whole. */
export function scrubNotes(text) {
  const notes = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  return DOSING_WORDS.test(notes) ? '' : notes;
}

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/**
 * Check a lookup reply. Returns { ok, food, missing, errors }.
 * `food` is in the app's food shape (per serving). Nutrients the model left
 * out are null and listed in `missing`, for the user to fill in. Effective
 * carbs are recomputed from total carbs and fiber when both are present.
 */
export function validateLookup(reply) {
  const errors = [];
  if (!reply || typeof reply !== 'object') return { ok: false, food: null, missing: [], errors: ['The reply was not a JSON object.'] };

  const name = String(reply.name ?? '').trim();
  if (!name) errors.push('name is missing');

  let serving_amount = number(reply.serving_amount);
  let serving_unit = normalizeUnit(reply.serving_unit);
  let grams_per_serving = number(reply.grams_per_serving);
  if (!(grams_per_serving > 0)) grams_per_serving = null;
  if (!(serving_amount > 0) || !SERVING_UNITS.includes(serving_unit)) {
    // An unusable serving ("1 bar") can still be logged by weight.
    if (grams_per_serving) {
      serving_amount = grams_per_serving;
      serving_unit = 'g';
    } else errors.push('serving is missing or not in a known unit');
  }
  if (unitKind(serving_unit) === 'weight') grams_per_serving = null;

  const food = { name, serving_amount, serving_unit, grams_per_serving };
  const missing = [];
  for (const n of NUTRIENTS) {
    const value = number(reply[n.key]);
    if (value != null && value < 0) errors.push(`${n.key} is negative`);
    food[n.key] = value;
    if (value == null) missing.push(n.key);
  }

  const total = number(reply.total_carbs_g);
  const fiber = number(reply.fiber_g);
  const stated = number(reply.effective_carbs_g);
  if (total != null && fiber != null && total >= 0 && fiber >= 0) {
    food.effective_carbs_g = Math.round(Math.max(0, total - fiber) * 100) / 100;
  } else if (stated != null && stated >= 0) food.effective_carbs_g = stated;
  else food.effective_carbs_g = null; // unknown, never assumed to be 0
  food.total_carbs_g = total;
  food.fiber_g = fiber;

  const brand = String(reply.brand ?? '').trim();
  food.brand = brand && !/^(null|none|n\/a|generic|unknown)$/i.test(brand) ? brand : '';
  food.phosphate_additives = reply.phosphate_additives === true || reply.phosphate_additives === 'true';
  const confidence = String(reply.confidence ?? '').toLowerCase();
  food.confidence = confidence === 'high' ? 'high' : confidence.startsWith('med') ? 'med' : 'low';
  food.notes = scrubNotes(reply.notes);

  // A reply with no nutrient numbers at all is not a lookup.
  if (missing.length === NUTRIENTS.length) errors.push('no nutrient values were given');
  return { ok: errors.length === 0, food: errors.length === 0 ? food : null, missing, errors };
}

/**
 * Check a label-photo reply. Returns { ok, food, missing, origins, errors }.
 * Values the label did not print are null and listed in `missing`. `origins`
 * marks what was read from the photo as 'label'. `fallbackName` is used when
 * the photo shows no product name.
 */
export function validateLabel(reply, fallbackName = '') {
  if (reply && typeof reply === 'object' && reply.not_a_label === true) {
    return { ok: false, notLabel: true, food: null, missing: [], origins: {}, errors: ['the photo is not a readable nutrition label'] };
  }
  const named = String(reply?.name ?? '').trim();
  // The lookup check needs a name; a label photo often has none, which is fine.
  const result = validateLookup({ ...(reply || {}), name: named || fallbackName || 'unnamed', brand: null, confidence: 'high' });
  if (!result.ok) return { ...result, origins: {} };
  const food = { ...result.food, name: named || fallbackName, confidence: undefined };
  const origins = {};
  for (const n of NUTRIENTS) if (food[n.key] != null) origins[n.key] = 'label';
  if (food.effective_carbs_g != null) origins.effective_carbs_g = 'label';
  // Additives are only known when an ingredient list was actually read.
  const listRead = reply.ingredients_visible === true && typeof reply.phosphate_additives === 'boolean';
  food.phosphate_additives = listRead ? reply.phosphate_additives : false;
  if (listRead) origins.phosphate_additives = 'label';
  food.notes = ['Read from a label photo', food.notes].filter(Boolean).join('; ');
  return { ok: true, food, missing: result.missing, origins, errors: [] };
}

/** Check a parse reply. Returns a parser-style command, or null if the text was not a food. */
export function validateParse(reply) {
  if (!reply || typeof reply !== 'object' || reply.unknown === true) return null;
  const food = String(reply.food ?? '').trim().toLowerCase();
  if (!food) return null;
  const amount = number(reply.amount);
  const unit = reply.unit == null ? null : normalizeUnit(reply.unit);
  const knownUnit = unit && (unitKind(unit) || unit === 'serving');
  if (!(amount > 0)) return { type: 'log', amount: null, unit: null, unitExplicit: false, food, confident: false };
  return {
    type: 'log',
    amount,
    unit: knownUnit ? unit : 'each',
    unitExplicit: Boolean(knownUnit) && unit !== 'each',
    food,
    confident: true,
  };
}

// --- tasks -----------------------------------------------------------------

/**
 * Ask for JSON, validate it, and retry once if the reply is unusable.
 * `check(reply)` returns { ok, value, problem }.
 */
async function askForJson(config, messages, check, deps) {
  const first = await chat(config, messages, deps);
  let result = check(extractJson(first));
  if (result.ok) return result.value;
  const second = await chat(
    config,
    [
      ...messages,
      { role: 'assistant', content: first },
      {
        role: 'user',
        content: `That reply could not be used (${result.problem}). Reply again with only the JSON object described, with every required key.`,
      },
    ],
    deps,
  );
  result = check(extractJson(second));
  if (result.ok) return result.value;
  throw new AiError('format', "The AI's answer could not be read.");
}

function describe(query) {
  const amount = query.amount != null && query.unit ? `${query.amount} ${query.unit} of ` : '';
  return `${amount}${query.food}`;
}

/** Look up one food. `query`: { food, amount?, unit? }. Returns { food, missing }. */
export function lookupFood(config, query, deps = {}) {
  return askForJson(
    config,
    [
      { role: 'system', content: LOOKUP_SYSTEM_PROMPT },
      { role: 'user', content: `Food: ${describe(query)}` },
    ],
    (reply) => {
      const result = validateLookup(reply);
      return { ok: result.ok, value: { food: result.food, missing: result.missing }, problem: result.errors.join('; ') || 'not valid JSON' };
    },
    deps,
  );
}

/** Parse text the local parser could not. Returns a command, or null if it is not a food. */
export function parseWithAi(config, text, deps = {}) {
  return askForJson(
    config,
    [
      { role: 'system', content: PARSE_SYSTEM_PROMPT },
      { role: 'user', content: String(text).slice(0, 300) },
    ],
    (reply) => ({ ok: reply != null, value: validateParse(reply), problem: 'not valid JSON' }),
    deps,
  );
}

/** Estimate the weight in grams of "amount unit of food". Returns { grams, notes }. */
export function gramsFor(config, query, deps = {}) {
  return askForJson(
    config,
    [
      { role: 'system', content: CONVERT_SYSTEM_PROMPT },
      { role: 'user', content: describe(query) },
    ],
    (reply) => {
      const grams = number(reply?.grams);
      return { ok: grams > 0, value: { grams: Math.round(grams * 10) / 10, notes: scrubNotes(reply?.notes) }, problem: 'grams must be a positive number' };
    },
    deps,
  );
}

/**
 * Read a nutrition label from a photo. `imageDataUrl` is a data: URL (JPEG).
 * Returns { food, missing, origins }; throws AiError('format') when the photo
 * is not a readable label. Needs a model that accepts images.
 */
export async function readLabel(config, imageDataUrl, fallbackName = '', deps = {}) {
  let notLabel = false;
  try {
    return await askForJson(
      config,
      [
        { role: 'system', content: LABEL_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Read this nutrition label.' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      (reply) => {
        const result = validateLabel(reply, fallbackName);
        notLabel = Boolean(result.notLabel);
        return { ok: result.ok, value: { food: result.food, missing: result.missing, origins: result.origins }, problem: result.errors.join('; ') || 'not valid JSON' };
      },
      deps,
    );
  } catch (error) {
    if (error.kind === 'format' && notLabel) {
      const notLabelError = new AiError('format', "That photo doesn't look like a nutrition label the AI could read. Try again closer, flat and in good light.");
      notLabelError.notLabel = true; // the UI can offer to estimate from the picture instead
      throw notLabelError;
    }
    throw error;
  }
}
