// Confirm card for a looked-up food: the values scaled to the amount that was
// said, each one editable. A value from AI is tagged "estimated" until the
// user confirms it; a value from a USDA record is tagged "USDA" and the card
// links to that record.

import { el, parseNumber } from './dom.js';
import { NUTRIENTS, scaleFood } from '../nutrients.js';
import { servingsFor, formatAmount } from '../units.js';

const CONFIDENCE = { high: 'High confidence', med: 'Medium confidence', low: 'Low confidence: check these values' };
const DATA_KINDS = { Foundation: 'USDA lab data', 'SR Legacy': 'USDA reference data', 'Survey (FNDDS)': 'USDA survey data' };
/** The parts of a USDA food's notes after the record reference ("AI estimate: phosphorus"). */
const sourceExtras = (notes) => {
  const extras = String(notes ?? '').split('; ').slice(1).join('; ');
  return extras ? ` ${extras.charAt(0).toUpperCase()}${extras.slice(1)}.` : '';
};
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * lookup:  { food, missing } from ai.lookupFood, or
 *          { food, missing, origins, ref } from usda.foodFromFdc
 * note:    optional line shown on the card (e.g. how an amount was converted)
 * command: the parsed command ({ amount, unit, food }); amount may be null
 * onLogSave(result) / onLogOnce(result) receive
 *   { name, amount, unit, servings, nutrients, food } where `food` is the
 *   per-serving record to save.
 */
export function createConfirmCard({ lookup, command, note, onLogSave, onLogOnce, onCancel }) {
  const { food, ref } = lookup;
  const origins = lookup.origins || {};

  // Scale to what was said; if that can't be converted, show one serving and say so.
  let amount = command.amount;
  let unit = command.unit;
  let servings = amount != null ? servingsFor(food, amount, unit) : null;
  let conversionNote = null;
  if (servings == null) {
    if (amount != null) {
      conversionNote = `“${formatAmount(amount, unit)}” couldn't be converted, so this shows one serving. Edit the values, or log it and then press and hold the entry to change the amount.`;
    }
    amount = food.serving_amount;
    unit = food.serving_unit;
    servings = 1;
  }
  const scaled = scaleFood(food, servings);

  const nameInput = el('input', {
    class: 'big-input',
    type: 'text',
    value: [food.brand, food.name].filter(Boolean).join(' '),
    autocapitalize: 'off',
  });
  // USDA values get a quiet tag; AI values (and anything unsourced) the yellow "estimated".
  const tag = (key) =>
    origins[key] === 'usda'
      ? el('span', { class: 'badge plain', text: 'USDA' })
      : el('span', { class: 'badge', text: ref && origins[key] !== 'ai' ? 'not in USDA' : 'estimated' });
  const numberInput = (value, label) =>
    el('input', {
      class: 'big-input',
      type: 'text',
      inputMode: 'decimal',
      value: value == null ? '' : String(Math.round(value * 10) / 10), // one decimal is plenty to check against a label
      'aria-label': label,
    });

  const inputs = {};
  const rows = NUTRIENTS.map((n) => {
    // A value the AI left out stays blank for the user to fill; it is never shown as 0.
    inputs[n.key] = numberInput(food[n.key] == null ? null : scaled[n.key], n.name);
    return el('label', { class: 'field' }, el('span', { class: 'field-label' }, `${n.name} (${n.unit}) `, tag(n.key)), inputs[n.key]);
  });
  inputs.effective_carbs_g = numberInput(scaled.effective_carbs_g, 'Effective carbs');
  inputs.effective_carbs_g.placeholder = 'blank = unknown';
  // What each field showed at first, so untouched values keep their exact figures.
  const shown = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]));
  const untouched = (key) => inputs[key].value === shown[key] && food[key] != null;
  const additives = el('input', { type: 'checkbox', checked: Boolean(food.phosphate_additives) });
  const notice = el('div', { class: 'notice', hidden: true });

  const read = () => {
    const errors = [];
    const name = nameInput.value.trim();
    if (!name) errors.push('Give the food a name.');
    const nutrients = {};
    for (const n of NUTRIENTS) {
      const value = untouched(n.key) ? scaled[n.key] : parseNumber(inputs[n.key].value);
      if (!(value >= 0)) errors.push(`${n.name} needs a number (0 or more).`);
      nutrients[n.key] = value;
    }
    const carbsText = inputs.effective_carbs_g.value.trim();
    nutrients.effective_carbs_g = carbsText === '' ? null : untouched('effective_carbs_g') ? scaled.effective_carbs_g : parseNumber(carbsText);
    if (carbsText !== '' && !(nutrients.effective_carbs_g >= 0)) errors.push('Effective carbs needs a number, or blank if unknown.');
    if (errors.length) {
      notice.replaceChildren(...errors.map((message) => el('div', { text: message })));
      notice.hidden = false;
      return null;
    }
    // Back out to one serving, so the saved food scales correctly next time.
    const perServing = {
      name,
      serving_amount: food.serving_amount,
      serving_unit: food.serving_unit,
      grams_per_serving: food.grams_per_serving,
      phosphate_additives: additives.checked,
      notes: food.notes,
    };
    for (const n of NUTRIENTS) perServing[n.key] = untouched(n.key) ? food[n.key] : round2(nutrients[n.key] / servings);
    perServing.effective_carbs_g =
      nutrients.effective_carbs_g == null
        ? null
        : untouched('effective_carbs_g')
          ? food.effective_carbs_g
          : round2(nutrients.effective_carbs_g / servings);
    // Still an estimate if any AI value was accepted as it stood.
    const aiKept = Object.keys(inputs).some((key) => origins[key] === 'ai' && untouched(key));
    return { name, amount, unit, servings, nutrients, food: perServing, estimated: ref ? aiKept : true };
  };

  const act = (handler) => async (event) => {
    event.preventDefault();
    const result = read();
    if (!result) return;
    for (const button of card.querySelectorAll('button')) button.disabled = true;
    await handler(result);
  };

  const card = el(
    'form',
    { class: 'card confirm', onsubmit: act(onLogSave) },
    el('h2', { text: 'Check these values' }),
    el('p', { class: 'muted', text: `${ref ? 'USDA values' : 'AI estimate'} for ${formatAmount(amount, unit)}. Nothing is logged until you choose.` }),
    note && el('p', { class: 'muted small-text', text: note }),
    conversionNote && el('div', { class: 'notice', text: conversionNote }),
    lookup.missing.length > 0 &&
      el('div', { class: 'notice', text: `${ref ? 'USDA has no value for some of these' : 'The AI left some values blank'}. Fill them in from the label.` }),
    el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Food' }), nameInput),
    el('div', { class: 'grid-2' }, rows, el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Effective carbs (g) ', tag('effective_carbs_g')), inputs.effective_carbs_g)),
    el('label', { class: 'check' }, additives, el('span', {}, 'Contains phosphate additives ', tag('phosphate_additives'))),
    ref
      ? el(
          'p',
          { class: 'muted small-text' },
          'Source: ',
          el('a', { href: ref.url, target: '_blank', rel: 'noopener noreferrer', text: `USDA FoodData Central record ${ref.fdcId}` }),
          `. ${[ref.label ? 'Manufacturer label data' : DATA_KINDS[ref.dataType] || 'USDA data', ref.brandOwner, ref.date].filter(Boolean).join(', ')}.`,
          sourceExtras(food.notes),
        )
      : el('p', { class: 'muted small-text', text: [CONFIDENCE[food.confidence], food.notes].filter(Boolean).join('. ') }),
    notice,
    // Default action (also what Return does): log it and remember the food.
    el('button', { class: 'btn primary', type: 'submit', text: 'Log & save to my foods' }),
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: onCancel }),
      el('button', { class: 'btn', type: 'button', text: 'Log once', onclick: act(onLogOnce) }),
    ),
  );
  return card;
}
