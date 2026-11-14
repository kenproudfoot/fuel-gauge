// Confirm card for an AI lookup: the values scaled to the amount that was
// said, each one editable and tagged "estimated" until the user confirms.

import { el, parseNumber } from './dom.js';
import { NUTRIENTS, scaleFood } from '../nutrients.js';
import { servingsFor, formatAmount } from '../units.js';

const CONFIDENCE = { high: 'High confidence', med: 'Medium confidence', low: 'Low confidence: check these values' };
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * lookup:  { food, missing } from ai.lookupFood
 * command: the parsed command ({ amount, unit, food }); amount may be null
 * onLogSave(result) / onLogOnce(result) receive
 *   { name, amount, unit, servings, nutrients, food } where `food` is the
 *   per-serving record to save.
 */
export function createConfirmCard({ lookup, command, onLogSave, onLogOnce, onCancel }) {
  const { food } = lookup;

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
  const tag = () => el('span', { class: 'badge', text: 'estimated' });
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
    return el('label', { class: 'field' }, el('span', { class: 'field-label' }, `${n.name} (${n.unit}) `, tag()), inputs[n.key]);
  });
  inputs.effective_carbs_g = numberInput(scaled.effective_carbs_g, 'Effective carbs');
  inputs.effective_carbs_g.placeholder = 'blank = unknown';
  const additives = el('input', { type: 'checkbox', checked: Boolean(food.phosphate_additives) });
  const notice = el('div', { class: 'notice', hidden: true });

  const read = () => {
    const errors = [];
    const name = nameInput.value.trim();
    if (!name) errors.push('Give the food a name.');
    const nutrients = {};
    for (const n of NUTRIENTS) {
      const value = parseNumber(inputs[n.key].value);
      if (!(value >= 0)) errors.push(`${n.name} needs a number (0 or more).`);
      nutrients[n.key] = value;
    }
    const carbsText = inputs.effective_carbs_g.value.trim();
    nutrients.effective_carbs_g = carbsText === '' ? null : parseNumber(carbsText);
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
    for (const n of NUTRIENTS) perServing[n.key] = round2(nutrients[n.key] / servings);
    perServing.effective_carbs_g = nutrients.effective_carbs_g == null ? null : round2(nutrients.effective_carbs_g / servings);
    return { name, amount, unit, servings, nutrients, food: perServing };
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
    el('p', { class: 'muted', text: `AI estimate for ${formatAmount(amount, unit)}. Nothing is logged until you choose.` }),
    conversionNote && el('div', { class: 'notice', text: conversionNote }),
    lookup.missing.length > 0 && el('div', { class: 'notice', text: 'The AI left some values blank. Fill them in from the label.' }),
    el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Food' }), nameInput),
    el('div', { class: 'grid-2' }, rows, el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Effective carbs (g) ', tag()), inputs.effective_carbs_g)),
    el('label', { class: 'check' }, additives, el('span', {}, 'Contains phosphate additives ', tag())),
    el('p', { class: 'muted small-text', text: [CONFIDENCE[food.confidence], food.notes].filter(Boolean).join('. ') }),
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
