// Pure nutrient logic: definitions, defaults, scaling, totals. No DOM.

/** Red is reserved for danger (a limit exceeded). Nothing else may use it. */
export const DANGER = '#FF2D2D';

/** The five chart bars, in display order C P S K H. */
export const NUTRIENTS = [
  { key: 'calories', letter: 'C', name: 'Calories', unit: 'kcal', type: 'goal', decimals: 0 },
  { key: 'protein_g', letter: 'P', name: 'Protein', unit: 'g', type: 'limit', decimals: 1 },
  { key: 'sodium_mg', letter: 'S', name: 'Sodium', unit: 'mg', type: 'limit', decimals: 0 },
  { key: 'potassium_mg', letter: 'K', name: 'Potassium', unit: 'mg', type: 'limit', decimals: 0 },
  { key: 'phosphorus_mg', letter: 'H', name: 'Phosphorus', unit: 'mg', type: 'limit', decimals: 0 },
];

export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key);

export const DEFAULT_SETTINGS = {
  targets: { calories: 2150, protein_g: 55, sodium_mg: 2000, potassium_mg: 2000, phosphorus_mg: 800 },
  proteinMin: null, // optional soft floor, unset by default
  colors: {
    calories: '#D63AE6',
    protein_g: '#F26B0F',
    sodium_mg: '#3E82E6',
    potassium_mg: '#22B85C',
    phosphorus_mg: '#F5C518',
  },
  showMealLabels: true,
  // Entry badge thresholds; null = off.
  badgeThresholds: { protein_g: null, sodium_mg: null, potassium_mg: null, phosphorus_mg: 150 },
  backupNudgeDays: 3,
};

/** Merge saved settings over the defaults so new fields always exist. */
export function mergeSettings(saved) {
  const s = saved || {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    targets: { ...DEFAULT_SETTINGS.targets, ...(s.targets || {}) },
    colors: { ...DEFAULT_SETTINGS.colors, ...(s.colors || {}) },
    badgeThresholds: { ...DEFAULT_SETTINGS.badgeThresholds, ...(s.badgeThresholds || {}) },
  };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

/**
 * Scale a food's per-serving values by a number of servings.
 * Effective carbs stay null (unknown) when the food has none recorded.
 */
export function scaleFood(food, servings) {
  const out = {};
  for (const key of NUTRIENT_KEYS) out[key] = round2((Number(food[key]) || 0) * servings);
  const carbs = food.effective_carbs_g;
  out.effective_carbs_g = carbs == null || carbs === '' ? null : round2(Number(carbs) * servings);
  return out;
}

/**
 * Sum the nutrients of all non-deleted entries.
 * carbsUnknown is true when any counted entry has unknown effective carbs;
 * effective_carbs_g is then only the sum of the known ones.
 */
export function sumEntries(entries) {
  const totals = { effective_carbs_g: 0, carbsUnknown: false, count: 0 };
  for (const key of NUTRIENT_KEYS) totals[key] = 0;
  for (const entry of entries) {
    if (entry.deleted) continue;
    totals.count += 1;
    const n = entry.nutrients || {};
    for (const key of NUTRIENT_KEYS) totals[key] += Number(n[key]) || 0;
    if (n.effective_carbs_g == null) totals.carbsUnknown = true;
    else totals.effective_carbs_g += Number(n.effective_carbs_g) || 0;
  }
  for (const key of [...NUTRIENT_KEYS, 'effective_carbs_g']) totals[key] = round2(totals[key]);
  return totals;
}

/** Where a value stands against its target. */
export function nutrientStatus(nutrient, value, target) {
  const ratio = target > 0 ? value / target : 0;
  const over = target > 0 && value > target;
  return {
    ratio,
    fill: Math.min(Math.max(ratio, 0), 1), // bar height/width, clamped 0..1
    danger: nutrient.type === 'limit' && over, // only limits ever go red
    goalMet: nutrient.type === 'goal' && target > 0 && value >= target,
  };
}

/** Room left per nutrient (negative = over). */
export function remaining(totals, targets) {
  const out = {};
  for (const key of NUTRIENT_KEYS) out[key] = round2(targets[key] - totals[key]);
  return out;
}

/** "1180 kcal", "25.4 g", "482 mg" */
export function formatValue(nutrient, value) {
  return `${formatNumber(value, nutrient.decimals)} ${nutrient.unit}`;
}

export function formatNumber(value, decimals = 0) {
  return (Number(value) || 0).toFixed(decimals);
}

/** Whole grams, or "?" when unknown. */
export function formatCarbs(value) {
  return value == null ? '? g' : `${Math.round(value)} g`;
}

/** Today's carb total; flags unknown entries with "+?" rather than hiding them. */
export function formatCarbTotal(totals) {
  if (!totals.carbsUnknown) return formatCarbs(totals.effective_carbs_g);
  return `${Math.round(totals.effective_carbs_g)}+? g`;
}

function toNumber(raw) {
  if (typeof raw === 'number') return raw;
  const text = String(raw ?? '').trim().replace(',', '.');
  return text === '' ? NaN : Number(text);
}

/**
 * Validate raw form values for a food. Returns { ok, food, errors }.
 * The five bar nutrients are required (a blank must never silently mean 0);
 * effective carbs may be blank, meaning unknown.
 */
export function validateFood(raw) {
  const errors = [];
  const name = String(raw.name ?? '').trim();
  if (!name) errors.push('Name is required.');

  const serving_amount = toNumber(raw.serving_amount);
  if (!(serving_amount > 0)) errors.push('Serving amount must be more than 0.');

  const serving_unit = String(raw.serving_unit ?? '').trim();
  if (!serving_unit) errors.push('Serving unit is required.');

  const food = { name, serving_amount, serving_unit };
  for (const n of NUTRIENTS) {
    const value = toNumber(raw[n.key]);
    if (!(value >= 0)) errors.push(`${n.name} must be a number (0 or more).`);
    food[n.key] = value;
  }

  const carbsText = String(raw.effective_carbs_g ?? '').trim();
  if (carbsText === '') {
    food.effective_carbs_g = null;
  } else {
    const carbs = toNumber(carbsText);
    if (!(carbs >= 0)) errors.push('Effective carbs must be a number, or blank if unknown.');
    food.effective_carbs_g = carbs;
  }

  const gpsText = String(raw.grams_per_serving ?? '').trim();
  if (gpsText === '') {
    food.grams_per_serving = null;
  } else {
    const gps = toNumber(gpsText);
    if (!(gps > 0)) errors.push('Grams per serving must be more than 0, or blank.');
    food.grams_per_serving = gps;
  }

  food.aliases = String(raw.aliases ?? '')
    .split('|')
    .map((a) => a.trim())
    .filter(Boolean);
  food.phosphate_additives = Boolean(raw.phosphate_additives);
  food.notes = String(raw.notes ?? '').trim();

  return { ok: errors.length === 0, food, errors };
}

/** Multiply an entry's stored nutrient values by a factor (unknown carbs stay unknown). */
export function scaleNutrients(nutrients, factor) {
  const out = {};
  for (const key of NUTRIENT_KEYS) out[key] = round2((Number(nutrients[key]) || 0) * factor);
  out.effective_carbs_g =
    nutrients.effective_carbs_g == null ? null : round2(Number(nutrients.effective_carbs_g) * factor);
  return out;
}

/**
 * The entry that was logged most recently, whatever time of day it was eaten.
 * This is the one the "Last entry" carbs figure reports.
 */
export function lastLoggedEntry(entries) {
  let last = null;
  for (const entry of entries) {
    if (entry.deleted) continue;
    if (!last || (entry.createdAt ?? entry.ts) > (last.createdAt ?? last.ts)) last = entry;
  }
  return last;
}
