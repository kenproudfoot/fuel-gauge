// Pure unit logic: normalizing unit names and converting amounts to servings. No DOM.

const WEIGHT_G = { g: 1, oz: 28.3495, lb: 453.592 };
const VOLUME_ML = { ml: 1, tsp: 4.92892, tbsp: 14.7868, cup: 236.588 };
const COUNT = { each: 1, slice: 1, piece: 1 };

const ALIASES = {
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  cup: 'cup', cups: 'cup', c: 'cup',
  tbsp: 'tbsp', tbsps: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  each: 'each', ea: 'each',
  slice: 'slice', slices: 'slice',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
  serving: 'serving', servings: 'serving',
};

/** Units offered when defining a food's serving. */
export const SERVING_UNITS = ['g', 'oz', 'lb', 'cup', 'tbsp', 'tsp', 'ml', 'each', 'slice', 'piece'];

/** Canonical unit name; unknown units come back lowercased and trimmed. */
export function normalizeUnit(unit) {
  const key = String(unit ?? '').trim().toLowerCase().replace(/\.$/, '');
  return ALIASES[key] || key;
}

/** 'weight' | 'volume' | 'count' | null */
export function unitKind(unit) {
  const u = normalizeUnit(unit);
  if (u in WEIGHT_G) return 'weight';
  if (u in VOLUME_ML) return 'volume';
  if (u in COUNT) return 'count';
  return null;
}

function toBase(amount, unit) {
  const u = normalizeUnit(unit);
  return amount * (WEIGHT_G[u] ?? VOLUME_ML[u] ?? COUNT[u] ?? NaN);
}

/** Convert a weight to grams, or null if the unit is not a weight. */
export function toGrams(amount, unit) {
  return unitKind(unit) === 'weight' ? toBase(amount, unit) : null;
}

/**
 * Grams in one serving of a food: taken from the serving itself when it is a
 * weight, otherwise from grams_per_serving. Null when unknown.
 */
export function gramsPerServing(food) {
  const fromServing = toGrams(Number(food.serving_amount), food.serving_unit);
  if (fromServing > 0) return fromServing;
  const gps = Number(food.grams_per_serving);
  return gps > 0 ? gps : null;
}

/**
 * How many servings of `food` is `amount unit`?
 * Weight<->weight and volume<->volume always work. Volume or count <-> weight
 * needs grams per serving. Returns null when no conversion is possible.
 */
export function servingsFor(food, amount, unit) {
  const qty = Number(amount);
  const servingAmount = Number(food.serving_amount);
  if (!(qty >= 0) || !(servingAmount > 0)) return null;

  const u = normalizeUnit(unit);
  const su = normalizeUnit(food.serving_unit);
  if (u === 'serving') return qty;

  const kind = unitKind(u);
  if (kind && kind === unitKind(su)) return toBase(qty, u) / toBase(servingAmount, su);
  if (u && u === su) return qty / servingAmount;

  if (kind === 'weight') {
    const gps = gramsPerServing(food);
    if (gps) return toBase(qty, u) / gps;
  }
  return null;
}

/** Units this food can be logged in, its own serving unit first. */
export function unitsFor(food) {
  const su = normalizeUnit(food.serving_unit);
  const kind = unitKind(su);
  const units = [su];
  if (kind === 'volume') units.push(...Object.keys(VOLUME_ML));
  if (kind === 'weight' || gramsPerServing(food)) units.push(...Object.keys(WEIGHT_G));
  return [...new Set(units)].filter(Boolean);
}

/** "12 g", "1.5 oz", "2 slices", "1 cup" */
export function formatAmount(amount, unit) {
  const qty = Math.round(Number(amount) * 100) / 100;
  let u = normalizeUnit(unit);
  if (qty !== 1 && ['cup', 'slice', 'piece', 'serving'].includes(u)) u += 's';
  return `${qty} ${u}`;
}
