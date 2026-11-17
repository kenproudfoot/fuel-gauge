// AI chat: prompts and reply reading for free-form conversations about food.
// DOM-free. The model talks in plain prose and, when it has worked out numbers
// for something eaten, ends with a fenced ```values block the app can read and
// offer to put into the log fields. Nothing is ever logged from a reply alone.
//
// The app only REPORTS nutrients and effective carbs. Nothing here may ever
// ask for, produce or pass through insulin dosing advice.

import { NUTRIENTS, nutrientSummary } from './nutrients.js';
import { normalizeUnit, SERVING_UNITS, formatAmount } from './units.js';
import { chat } from './ai.js';

const VALUES_FORMAT = `When you give numbers for something the user ate (or is about to eat), end your reply with ONE block in exactly this form, after the prose:

\`\`\`values
{"name": "short food name", "amount": 1, "unit": "each", "calories": 0, "protein_g": 0, "sodium_mg": 0, "potassium_mg": 0, "phosphorus_mg": 0, "total_carbs_g": 0, "fiber_g": 0, "phosphate_additives": false}
\`\`\`

- The numbers are TOTALS for the whole amount given by "amount" and "unit" (unit is one of ${SERVING_UNITS.map((u) => `"${u}"`).join(', ')}).
- Use numbers, not strings. Never answer 0 for phosphorus or potassium unless the food truly has none; estimate from USDA data for the closest foods.
- "phosphate_additives" is true when processed meats, processed cheese, colas, many packaged or baked goods, or any "phos" ingredient are likely.
- Only include the block when you are giving values; leave it out for general questions. Never put more than one block in a reply.`;

const STYLE = `Style: short and plain. No headings and no tables. Use "- " bullet lines for a breakdown, one component per line with its numbers, and **bold** sparingly. Say briefly why you chose each figure (label, USDA entry, typical recipe) and flag anything that is a guess.

Never mention insulin, doses, dosing, ratios or corrections, and give no medical advice. Report nutrition facts only. If asked about dosing, say this app only reports nutrients and suggest asking their care team.`;

/** Free-form chat from the Today screen. `today` is the line from todayContext(), or ''. */
export function generalChatPrompt(today = '') {
  return `You are the nutrition assistant inside Fuel Gauge, a food-logging app for someone watching calories, protein, sodium, potassium and phosphorus (a kidney-friendly diet), plus effective carbs (total carbs minus fiber).

The user may ask about a food, compare options, or work out what something they ate contains. Answer from food labels and USDA FoodData Central values, and say which.
${today ? `\n${today}\n` : ''}
${VALUES_FORMAT}

${STYLE}`;
}

/**
 * Chat beside a confirm card. `card` is the card's current state:
 * { name, amount, unit, nutrients } where nutrients are totals for that amount
 * (a value may be null when unknown).
 */
export function refinePrompt(card) {
  const lines = NUTRIENTS.map((n) => `${n.name}: ${card.nutrients?.[n.key] == null ? 'unknown' : `${card.nutrients[n.key]} ${n.unit}`}`);
  const carbs = card.nutrients?.effective_carbs_g;
  lines.push(`Effective carbs: ${carbs == null ? 'unknown' : `${carbs} g`}`);
  const what = card.name ? `“${card.name}”, ${formatAmount(card.amount, card.unit)}` : `not named yet, ${formatAmount(card.amount, card.unit)}`;
  return `You are the nutrition assistant inside Fuel Gauge, a food-logging app for someone watching calories, protein, sodium, potassium and phosphorus (a kidney-friendly diet), plus effective carbs (total carbs minus fiber).

The user is about to log a food and wants to get the numbers right by talking it through with you. They may tell you what is in it (for example the parts of a sandwich), the brand, the size, or how it was cooked. Work out the values: list each component with its numbers, then the totals, and say why you chose them.

The entry they are checking right now:
Food: ${what}
${lines.join('\n')}

Whenever you give totals, include the values block, for the whole amount they ate. If they say they ate a different amount from the one above, use their amount in the block.

${VALUES_FORMAT}

${STYLE}`;
}

/** One line of today's totals against the targets, so the chat can answer "can I fit this in?". */
export function todayContext(totals, targets) {
  if (!totals || !targets) return '';
  const parts = NUTRIENTS.map((n) => `${n.name} ${Math.round(totals[n.key] || 0)} of ${Math.round(targets[n.key])} ${n.unit}`);
  return `So far today they have logged: ${parts.join('; ')}. Calories is a goal to reach; the others are daily limits.`;
}

// --- reading replies -------------------------------------------------------

/** Narrower than the lookup filter: chat prose may say "correction" about a food. */
const DOSING = /insulin|bolus|basal|\bdos(?:e|es|ed|ing|age)\b|carb\s*ratio|\bi:c\b|units?\s+of\s+(?:rapid|fast|long)/i;
export const DOSING_REPLY = 'Fuel Gauge only reports what food contains, so it does not discuss insulin or dosing. Your care team is the right place for that.';

const num = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
};
const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Check a values block. Returns the values in the app's shape (totals for
 * amount + unit), or null when it holds no usable nutrient number.
 * Effective carbs are recomputed from total carbs and fiber when both are given.
 */
export function validateValues(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const values = { name: String(raw.name ?? '').trim().slice(0, 80) };
  let any = false;
  for (const n of NUTRIENTS) {
    const value = num(raw[n.key]);
    values[n.key] = value != null && value >= 0 ? round1(value) : null;
    if (values[n.key] != null) any = true;
  }
  if (!any) return null;
  const total = num(raw.total_carbs_g);
  const fiber = num(raw.fiber_g);
  const stated = num(raw.effective_carbs_g);
  values.effective_carbs_g =
    total != null && fiber != null && total >= 0 && fiber >= 0 ? round1(Math.max(0, total - fiber)) : stated != null && stated >= 0 ? round1(stated) : null;
  const amount = num(raw.amount);
  const unit = normalizeUnit(raw.unit);
  if (amount > 0 && SERVING_UNITS.includes(unit)) {
    values.amount = amount;
    values.unit = unit;
  } else {
    values.amount = null;
    values.unit = null;
  }
  values.phosphate_additives = raw.phosphate_additives === true || raw.phosphate_additives === 'true';
  return values;
}

/**
 * Split a reply into the prose to show and the values block (if any).
 * Returns { text, values }. Prose that strays into dosing is replaced whole.
 */
export function parseReply(reply) {
  const raw = String(reply ?? '');
  const block = /```\s*values\s*\n([\s\S]*?)```/gi;
  let values = null;
  for (const match of raw.matchAll(block)) {
    try {
      values = validateValues(JSON.parse(match[1].trim())) || values;
    } catch {
      // a malformed block is just left out
    }
  }
  let text = raw.replace(block, '').replace(/\n{3,}/g, '\n\n').trim();
  if (DOSING.test(text)) text = DOSING_REPLY;
  return { text, values };
}

/** A one-line summary of a values block, e.g. "1 each · 420 kcal · P 24 g · …". */
export function valuesSummary(values) {
  const amount = values.amount != null ? `${formatAmount(values.amount, values.unit)} · ` : '';
  return `${amount}${nutrientSummary(values)}`;
}

/**
 * One chat turn. `history` is [{ role: 'user'|'assistant', content }] where a
 * user content may be an array with an image part. Returns { text, values, raw }.
 */
export async function askChat(config, systemPrompt, history, deps = {}) {
  const raw = await chat(config, [{ role: 'system', content: systemPrompt }, ...history], deps);
  return { ...parseReply(raw), raw };
}
