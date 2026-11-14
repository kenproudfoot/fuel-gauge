// USDA FoodData Central lookup: real records (manufacturer label data for
// branded foods, lab and survey data for generic ones) with a link back to the
// record, so a value can be traced to where it came from.
// DOM-free: fetch is injectable for tests.
//
// The app only REPORTS nutrients and effective carbs. Nothing here may ever
// produce or pass through insulin dosing advice.

import { NUTRIENTS } from './nutrients.js';
import { normalizeUnit, unitKind, gramsPerServing, servingsFor } from './units.js';

const BASE = 'https://api.nal.usda.gov/fdc/v1';
export const USDA_SIGNUP_URL = 'https://fdc.nal.usda.gov/api-key-signup/';

/** The public page for one record. */
export function usdaFoodUrl(fdcId) {
  return `https://fdc.nal.usda.gov/food-details/${encodeURIComponent(fdcId)}/nutrients`;
}

export function usdaConfigured(config) {
  return Boolean(config?.apiKey);
}

/** An error the UI can explain. `kind`: config | network | auth | rate | http | cancelled */
export class UsdaError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'UsdaError';
    this.kind = kind;
  }
}

async function request(config, path, params, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  if (!config?.apiKey) throw new UsdaError('config', 'USDA lookup is not set up yet.');
  // The key goes in the query string, the form USDA documents; a plain GET
  // like this needs no preflight. The address is never logged or shown.
  const query = new URLSearchParams({ ...params, api_key: config.apiKey });
  let response;
  try {
    response = await fetchFn(`${BASE}/${path}?${query}`, { method: 'GET', signal: deps.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new UsdaError('cancelled', 'Cancelled.');
    throw new UsdaError('network', "Can't reach USDA. You may be offline.");
  }
  if (response.ok) return response.json();
  if (response.status === 401 || response.status === 403) throw new UsdaError('auth', 'USDA rejected the API key.');
  if (response.status === 429) throw new UsdaError('rate', 'USDA is rate-limiting this key. Try again in a while.');
  throw new UsdaError('http', `USDA returned an error (${response.status}).`);
}

// --- reading records -------------------------------------------------------

// FoodData Central nutrient ids. Energy has alternates on lab-analysed foods.
const NUTRIENT_IDS = {
  calories: [1008, 2047, 2048],
  protein_g: [1003],
  sodium_mg: [1093],
  potassium_mg: [1092],
  phosphorus_mg: [1091],
  total_carbs_g: [1005],
  fiber_g: [1079],
};
// The same values as printed on a package label, per serving.
const LABEL_KEYS = {
  calories: 'calories',
  protein_g: 'protein',
  sodium_mg: 'sodium',
  potassium_mg: 'potassium',
  total_carbs_g: 'carbohydrates',
  fiber_g: 'fiber',
};

const round2 = (x) => Math.round(x * 100) / 100;
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Values per 100 g (or 100 ml), from either the search or the detail shape. */
function per100(record) {
  const byId = new Map();
  for (const n of record?.foodNutrients || []) {
    const id = n?.nutrient?.id ?? n?.nutrientId;
    const value = finite(n?.amount ?? n?.value);
    const unit = String(n?.nutrient?.unitName ?? n?.unitName ?? '').toLowerCase();
    if (id != null && value != null && unit !== 'kj') byId.set(Number(id), value);
  }
  const out = {};
  for (const [key, ids] of Object.entries(NUTRIENT_IDS)) {
    const id = ids.find((candidate) => byId.has(candidate));
    out[key] = id == null ? null : byId.get(id);
  }
  return out;
}

const SMALL_WORDS = new Set(['and', 'or', 'of', 'with', 'in', 'the', 'a', 'an', 'for', 'to']);

/** USDA text is often ALL CAPS; make that readable. Mixed-case text is left alone. */
export function tidyCase(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean || clean !== clean.toUpperCase()) return clean;
  return clean
    .toLowerCase()
    .split(' ')
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/** "Eggo Thick & Fluffy Original Belgian Style Waffles, Original" */
export function foodTitle(record) {
  const description = tidyCase(record?.description);
  const lower = description.toLowerCase();
  const lead = [record?.brandName, record?.subbrandName]
    .map(tidyCase)
    .filter((part) => part && !lower.includes(part.toLowerCase()));
  return [...lead, description].join(' ').trim();
}

/** "12/1/2020" or "2020-12-01" -> { year, month } (month 1-12), or null. */
function parseDate(text) {
  const value = String(text ?? '');
  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) return { year: Number(match[3]), month: Number(match[1]), day: Number(match[2]) };
  return null;
}
const sortable = (text) => {
  const d = parseDate(text);
  return d ? d.year * 10000 + d.month * 100 + d.day : 0;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthYear(text) {
  const d = parseDate(text);
  return d ? `${MONTHS[d.month - 1] || ''} ${d.year}`.trim() : '';
}

function baseUnit(record) {
  const unit = String(record?.servingSizeUnit ?? '').trim().toLowerCase();
  if (['g', 'grm', 'gm', 'gram', 'grams'].includes(unit)) return 'g';
  if (['ml', 'mlt', 'milliliter', 'millilitre'].includes(unit)) return 'ml';
  return null;
}

/**
 * Read a label's household serving ("1 WAFFLE", "2/3 cup (55g)", "About 12 chips").
 * Returns { amount, unit } in the app's units, with a counted thing ("waffle",
 * "chips") as "each"; null when there is nothing usable.
 */
export function parseHousehold(text) {
  const clean = String(text ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*(about|approx\.?|approximately)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const match = clean.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)\s*(.*)$/);
  if (!match) return null;
  let amount = 0;
  for (const part of match[1].split(/\s+/)) {
    const [top, bottom] = part.split('/').map(Number);
    amount += bottom ? top / bottom : top;
  }
  if (!(amount > 0)) return null;
  const word = match[2].split(/[\s,]+/)[0] || '';
  if (!word) return null;
  const unit = normalizeUnit(word);
  const kind = unitKind(unit);
  // A weight ("1 ONZ", "28 g") adds nothing: the serving weight is already known.
  if (kind === 'weight' || /^(onz|grm|grams?|ounces?)$/i.test(word)) return null;
  if (kind === 'volume' || kind === 'count') return { amount, unit };
  return { amount, unit: 'each' };
}

/**
 * Turn one FoodData Central record into the app's lookup shape:
 *   { food, missing, origins, ref }
 * `food` is per serving. Branded foods use the label's own serving and its
 * printed values; anything the label lacks (phosphorus, usually) comes from the
 * record's per-100 g figures. Generic foods are per 100 g. A nutrient USDA has
 * no value for is null and listed in `missing`: never assumed to be 0.
 * `origins` records, per field, that the value came from USDA.
 * Returns null when the record has no usable nutrient values.
 */
export function foodFromFdc(record) {
  if (!record || typeof record !== 'object') return null;
  const hundred = per100(record);
  const base = baseUnit(record);
  const size = finite(record.servingSize);
  const branded = record.dataType === 'Branded' && base && size > 0;

  const values = {};
  if (branded) {
    const label = record.labelNutrients || {};
    for (const key of Object.keys(NUTRIENT_IDS)) {
      const printed = LABEL_KEYS[key] ? finite(label[LABEL_KEYS[key]]?.value) : null;
      values[key] = printed != null ? round2(printed) : hundred[key] != null ? round2((hundred[key] * size) / 100) : null;
    }
  } else {
    for (const key of Object.keys(NUTRIENT_IDS)) values[key] = hundred[key] == null ? null : round2(hundred[key]);
  }

  let serving = { serving_amount: 100, serving_unit: 'g', grams_per_serving: null };
  if (branded) {
    const household = parseHousehold(record.householdServingFullText);
    if (base === 'g') {
      serving = household
        ? { serving_amount: household.amount, serving_unit: household.unit, grams_per_serving: size }
        : { serving_amount: size, serving_unit: 'g', grams_per_serving: null };
    } else {
      // Sold by volume: a counted household serving ("1 can") is kept, otherwise millilitres.
      serving =
        household && unitKind(household.unit) === 'count'
          ? { serving_amount: household.amount, serving_unit: household.unit, grams_per_serving: null }
          : { serving_amount: size, serving_unit: 'ml', grams_per_serving: null };
    }
  }

  const food = { name: foodTitle(record), brand: '', ...serving };
  const origins = {};
  const missing = [];
  for (const n of NUTRIENTS) {
    const value = values[n.key] != null && values[n.key] >= 0 ? values[n.key] : null;
    food[n.key] = value;
    if (value == null) missing.push(n.key);
    else origins[n.key] = 'usda';
  }
  if (missing.length === NUTRIENTS.length) return null;

  const notes = [];
  food.total_carbs_g = values.total_carbs_g;
  food.fiber_g = values.fiber_g;
  if (values.total_carbs_g != null && values.total_carbs_g >= 0) {
    // With no fiber figure, total carbs is reported as it stands rather than guessed down.
    food.effective_carbs_g = round2(Math.max(0, values.total_carbs_g - (values.fiber_g > 0 ? values.fiber_g : 0)));
    origins.effective_carbs_g = 'usda';
    if (values.fiber_g == null) notes.push('no fiber listed, so carbs are total carbs');
  } else food.effective_carbs_g = null;

  // Read from the ingredient list when there is one.
  const ingredients = String(record.ingredients ?? '');
  food.phosphate_additives = /phosph/i.test(ingredients);
  if (ingredients) origins.phosphate_additives = 'usda';

  const date = branded || record.dataType === 'Branded' ? record.modifiedDate || record.publicationDate : record.publicationDate;
  const ref = {
    fdcId: record.fdcId,
    dataType: String(record.dataType || ''),
    brandOwner: tidyCase(record.brandOwner),
    date: monthYear(date),
    url: usdaFoodUrl(record.fdcId),
    label: record.dataType === 'Branded',
  };
  food.notes = [`USDA FoodData Central ${ref.fdcId}${ref.label ? ' (label data' : ` (${ref.dataType}`}${ref.date ? `, ${ref.date}` : ''})`, ...notes].join('; ');
  return { food, missing, origins, ref };
}

/**
 * Fill the values USDA lacked from an AI estimate of the same food.
 * `aiFood` is per its own serving; it is scaled by weight to the USDA serving.
 * Filled fields are marked with `origin` ('ai' by default, so they show as
 * estimated; 'usda' when the other food is a USDA record).
 * Returns a new lookup; unchanged if the two servings cannot be compared.
 */
export function mergeEstimates(lookup, aiFood, origin = 'ai') {
  if (!aiFood || lookup.missing.length === 0) return lookup;
  const grams = gramsPerServing(lookup.food);
  let scale = grams ? servingsFor(aiFood, grams, 'g') : null;
  if (scale == null) scale = servingsFor(aiFood, lookup.food.serving_amount, lookup.food.serving_unit);
  if (!(scale > 0)) return lookup;

  const food = { ...lookup.food };
  const origins = { ...lookup.origins };
  const filled = [];
  for (const n of NUTRIENTS) {
    if (food[n.key] != null) continue;
    const value = finite(aiFood[n.key]);
    if (value == null || value < 0) continue;
    food[n.key] = round2(value * scale);
    origins[n.key] = origin;
    filled.push(n.name.toLowerCase());
  }
  if (food.effective_carbs_g == null && finite(aiFood.effective_carbs_g) != null && aiFood.effective_carbs_g >= 0) {
    food.effective_carbs_g = round2(aiFood.effective_carbs_g * scale);
    origins.effective_carbs_g = origin;
    filled.push('effective carbs');
  }
  if (filled.length) food.notes = `${food.notes}; ${origin === 'usda' ? 'from USDA' : 'AI estimate'}: ${filled.join(', ')}`;
  return { ...lookup, food, origins, missing: NUTRIENTS.filter((n) => food[n.key] == null).map((n) => n.key) };
}

/**
 * Weight in grams of "amount unit" using the record's own portion table
 * ("1 cup = 158 g"), or null when the record has no portion in that unit.
 */
export function gramsFromPortions(record, amount, unit) {
  const wanted = normalizeUnit(unit);
  if (!(amount > 0) || !['volume', 'count'].includes(unitKind(wanted)) || wanted === 'each') return null;
  for (const portion of record?.foodPortions || []) {
    const weight = finite(portion?.gramWeight);
    if (!(weight > 0)) continue;
    // "1 cup, cooked" (survey foods) or amount + modifier / measure unit (lab foods).
    const described = parseHousehold(portion.portionDescription);
    const candidates = [];
    if (described) candidates.push(described);
    const quantity = finite(portion.amount) > 0 ? portion.amount : 1;
    for (const name of [portion.modifier, portion.measureUnit?.name, portion.measureUnit?.abbreviation]) {
      const word = String(name ?? '').split(/[\s,]+/)[0];
      if (word) candidates.push({ amount: quantity, unit: normalizeUnit(word) });
    }
    const match = candidates.find((c) => c.unit === wanted && c.amount > 0);
    if (match) return Math.round(((amount / match.amount) * weight) * 10) / 10;
  }
  return null;
}

// --- search ----------------------------------------------------------------

const STOP_WORDS = new Set(['and', 'the', 'of', 'with', 'a', 'an', 'in', 'or']);
const tokens = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP_WORDS.has(t))
    .map((t) => (t.length > 3 ? t.replace(/(es|s)$/, '') : t));

/** Share of the query's words found in the record's name and brand (0 to 1). */
export function relevance(query, record) {
  const wanted = tokens(query);
  if (wanted.length === 0) return 0;
  const have = tokens([record.brandName, record.subbrandName, record.brandOwner, record.description].join(' '));
  const hits = wanted.filter((w) => have.some((h) => h === w || h.startsWith(w) || w.startsWith(h))).length;
  return hits / wanted.length;
}

const DATA_TYPE_LABEL = {
  Branded: 'label data',
  Foundation: 'USDA lab data',
  'SR Legacy': 'USDA reference data',
  'Survey (FNDDS)': 'USDA survey data',
};

/**
 * Pick what to offer from a search reply: one record per barcode (the newest),
 * closest matches to the words first, at most `limit`.
 * Each: { fdcId, title, detail, dataType, score } (score: share of the words matched)
 */
export function pickCandidates(query, foods, limit = 8) {
  const newest = new Map();
  const order = [];
  (foods || []).forEach((record, index) => {
    if (!record || record.fdcId == null) return;
    const upc = String(record.gtinUpc ?? '').replace(/^0+/, '');
    const key = record.dataType === 'Branded' && upc ? `upc:${upc}` : `id:${record.fdcId}`;
    const held = newest.get(key);
    if (!held) {
      newest.set(key, { record, index });
      order.push(key);
    } else if (sortable(record.publishedDate) > sortable(held.record.publishedDate)) held.record = record;
  });
  const scored = order.map((key) => {
    const { record, index } = newest.get(key);
    return { record, index, score: relevance(query, record) };
  });
  const close = scored.filter((s) => s.score >= 0.5);
  const kept = (close.length ? close : scored.slice(0, 3)).sort((a, b) => b.score - a.score || a.index - b.index);
  return kept.slice(0, limit).map(({ record, score }) => {
    const branded = record.dataType === 'Branded';
    const size = finite(record.servingSize);
    const unit = baseUnit(record);
    const household = tidyCase(String(record.householdServingFullText ?? '').replace(/\([^)]*\)/g, '')).toLowerCase();
    const serving = branded && size > 0 && unit ? [household, `${round2(size)} ${unit}`].filter(Boolean).join(' = ') : 'per 100 g';
    const year = parseDate(branded ? record.modifiedDate || record.publishedDate : record.publishedDate)?.year;
    const kind = `${DATA_TYPE_LABEL[record.dataType] || 'USDA data'}${year ? ` ${year}` : ''}`;
    return {
      fdcId: record.fdcId,
      title: foodTitle(record),
      detail: [branded && tidyCase(record.brandOwner), serving, kind].filter(Boolean).join(' · '),
      dataType: String(record.dataType || ''),
      score,
    };
  });
}

// --- tasks -----------------------------------------------------------------

/** Search by food words. Returns candidates (possibly none). */
export async function searchFoods(config, query, deps = {}) {
  const data = await request(config, 'foods/search', { query: String(query).slice(0, 200), pageSize: '25' }, deps);
  return pickCandidates(query, data?.foods);
}

/**
 * Fetch one record in full. A barcode can have several records over the years
 * and search often surfaces an old one, so the newest version is fetched when
 * the record lists one. Returns the raw record.
 */
export async function fetchFood(config, fdcId, deps = {}) {
  const record = await request(config, `food/${encodeURIComponent(fdcId)}`, {}, deps);
  let newest = record;
  for (const version of record?.foodUpdateLog || []) {
    if (version?.fdcId != null && sortable(version.publicationDate) > sortable(newest.publicationDate)) newest = version;
  }
  if (newest.fdcId === record.fdcId) return record;
  try {
    return await request(config, `food/${encodeURIComponent(newest.fdcId)}`, {}, deps);
  } catch (error) {
    if (error.kind === 'cancelled') throw error;
    return record; // the older record is still real data
  }
}

/** Check the key. Returns { ok, message }. Never throws. */
export async function testUsdaKey(config, deps = {}) {
  try {
    const data = await request(config, 'foods/search', { query: 'apple', pageSize: '1' }, deps);
    return Array.isArray(data?.foods)
      ? { ok: true, message: 'Connected. USDA answered.' }
      : { ok: false, message: 'USDA answered, but not in the expected form.' };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}
