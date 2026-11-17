// Confirm card for a looked-up food: the values scaled to the amount that was
// said, each one editable. A value from AI is tagged "estimated" until the
// user confirms it; a value from a USDA record is tagged "USDA" and the card
// links to that record.
//
// The same card is the Quick entry form (`manual`): blank fields, no source
// tags, blank counts as 0. Either way an AI chat can sit in the card and fill
// the fields in from the conversation.

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
const shownValue = (value) => (value == null ? '' : String(Math.round(value * 10) / 10)); // one decimal is plenty to check against a label

/** A blank lookup for Quick entry: one "each" of something unnamed. */
export function blankLookup(name = '') {
  const food = { name, brand: '', serving_amount: 1, serving_unit: 'each', grams_per_serving: null, effective_carbs_g: null, phosphate_additives: false, notes: '' };
  for (const n of NUTRIENTS) food[n.key] = null;
  return { food, missing: [] };
}

/**
 * lookup:  { food, missing } from ai.lookupFood, or
 *          { food, missing, origins, ref } from usda.foodFromFdc
 * note:    optional line shown on the card (e.g. how an amount was converted)
 * command: the parsed command ({ amount, unit, food }); amount may be null
 * manual:  Quick entry: no source tags, blank values count as 0
 * assistant({ snapshot, apply }): optional; returns a node (the AI chat) shown
 *          in the card. snapshot() is the card's current values; apply(values)
 *          puts a chat's values into the fields.
 * onLogSave(result) / onLogOnce(result) receive
 *   { name, amount, unit, servings, nutrients, food, estimated, fromChat } where
 *   `food` is the per-serving record to save.
 */
export function createConfirmCard({ lookup, command, note, manual = false, assistant, assistantOpen = false, onLogSave, onLogOnce, onCancel }) {
  const { ref, photo } = lookup;
  let food = lookup.food;
  const sourced = Boolean(ref || photo); // values with a source, not an AI estimate
  const origins = lookup.origins || {};
  let fromChat = false; // set once a chat's values have been put in

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
    autocapitalize: manual ? 'sentences' : 'off',
    placeholder: manual ? 'Quick entry' : '',
  });
  // USDA values get a quiet tag; AI values (and anything unsourced) the yellow "estimated".
  const tag = (key) =>
    manual && !fromChat
      ? null
      : fromChat || origins[key] === 'ai'
        ? el('span', { class: 'badge', text: 'estimated' })
        : origins[key] === 'usda'
          ? el('span', { class: 'badge plain', text: 'USDA' })
          : origins[key] === 'label'
            ? el('span', { class: 'badge plain', text: 'label' })
            : el('span', { class: 'badge', text: sourced ? (photo ? 'not on label' : 'not in USDA') : 'estimated' });
  const tagSlots = {};
  const slot = (key) => (tagSlots[key] = el('span', { class: 'tag-slot' }, tag(key)));
  const numberInput = (value, label) =>
    el('input', {
      class: 'big-input',
      type: 'text',
      inputMode: 'decimal',
      value: shownValue(value),
      placeholder: manual ? '0' : '',
      'aria-label': label,
    });

  const inputs = {};
  const rows = NUTRIENTS.map((n) => {
    // A value the AI left out stays blank for the user to fill; it is never shown as 0.
    inputs[n.key] = numberInput(food[n.key] == null ? null : scaled[n.key], n.name);
    return el('label', { class: 'field' }, el('span', { class: 'field-label' }, `${n.name} (${n.unit}) `, slot(n.key)), inputs[n.key]);
  });
  inputs.effective_carbs_g = numberInput(scaled.effective_carbs_g, 'Effective carbs');
  inputs.effective_carbs_g.placeholder = 'blank = unknown';
  // What each field showed at first, so untouched values keep their exact figures.
  const shown = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]));
  const untouched = (key) => !fromChat && inputs[key].value === shown[key] && food[key] != null;
  const additives = el('input', { type: 'checkbox', checked: Boolean(food.phosphate_additives) });
  const notice = el('div', { class: 'notice', hidden: true });

  const describe = () =>
    manual && !fromChat
      ? 'Enter the totals for what you ate. Blank counts as 0. Nothing is logged until you choose.'
      : `${fromChat ? 'Values from your AI chat' : photo ? 'Read from your label photo' : ref ? 'USDA values' : 'AI estimate'} for ${formatAmount(amount, unit)}. ${photo && !fromChat ? 'Check each number against the photo. ' : ''}Nothing is logged until you choose.`;
  const summary = el('p', { class: 'muted', text: describe() });

  const read = () => {
    const errors = [];
    const name = nameInput.value.trim() || (manual ? 'Quick entry' : '');
    if (!name) errors.push('Give the food a name.');
    const nutrients = {};
    for (const n of NUTRIENTS) {
      const text = inputs[n.key].value.trim();
      const value = untouched(n.key) ? scaled[n.key] : manual && text === '' ? 0 : parseNumber(text);
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
      notes: fromChat ? ['Worked out in an AI chat', food.notes].filter(Boolean).join('; ') : food.notes,
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
    const estimated = fromChat || (manual ? false : sourced ? aiKept : true);
    return { name, amount, unit, servings, nutrients, food: perServing, estimated, fromChat };
  };

  /** The card's values as they stand, for the chat's context. */
  const snapshot = () => {
    const nutrients = {};
    for (const key of Object.keys(inputs)) {
      const value = parseNumber(inputs[key].value);
      nutrients[key] = Number.isFinite(value) ? value : null;
    }
    return { name: nameInput.value.trim(), amount, unit, nutrients };
  };

  /**
   * Put a chat's values (totals for values.amount values.unit) into the fields.
   * A different amount makes that amount the food's serving, so a saved food
   * still scales correctly.
   */
  const apply = (values) => {
    fromChat = true;
    if (values.amount != null && (values.amount !== amount || values.unit !== unit)) {
      amount = values.amount;
      unit = values.unit;
      servings = 1;
      food = { ...food, serving_amount: amount, serving_unit: unit, grams_per_serving: null };
      conversionBox.hidden = true;
    }
    if (values.name) nameInput.value = values.name;
    for (const key of Object.keys(inputs)) {
      if (values[key] != null || key === 'effective_carbs_g') inputs[key].value = shownValue(values[key]);
    }
    if (typeof values.phosphate_additives === 'boolean') additives.checked = values.phosphate_additives;
    for (const [key, node] of Object.entries(tagSlots)) node.replaceChildren(tag(key) || '');
    summary.textContent = describe();
    missingBox.hidden = true;
    notice.hidden = true;
    fields.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const act = (handler) => async (event) => {
    event.preventDefault();
    const result = read();
    if (!result) return;
    for (const button of card.querySelectorAll('button')) button.disabled = true;
    await handler(result);
  };

  const conversionBox = el('div', { class: 'notice', text: conversionNote || '', hidden: !conversionNote });
  const missingBox = el('div', {
    class: 'notice',
    hidden: manual || lookup.missing.length === 0,
    text: photo
      ? 'Some values are not on the label (phosphorus rarely is). Fill them in if you know them.'
      : `${ref ? 'USDA has no value for some of these' : 'The AI left some values blank'}. Fill them in from the label.`,
  });
  const fields = el(
    'div',
    { class: 'confirm-fields' },
    el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Food' }), nameInput),
    el('div', { class: 'grid-2' }, rows, el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Effective carbs (g) ', slot('effective_carbs_g')), inputs.effective_carbs_g)),
    el('label', { class: 'check' }, additives, el('span', {}, 'Contains phosphate additives ', manual ? null : tag('phosphate_additives'))),
  );

  // The AI chat: collapsed behind a button unless asked to start open.
  let chatBox = null;
  if (assistant) {
    chatBox = el('div', { class: 'chat-in-card' });
    const openChat = () => {
      const node = assistant({ snapshot, apply });
      chatBox.replaceChildren(el('h3', { text: 'Talk it through with AI' }), node.root || node);
      node.focus?.();
    };
    if (assistantOpen) queueMicrotask(openChat);
    else {
      chatBox.append(
        el('button', {
          class: 'btn',
          type: 'button',
          text: manual ? 'Describe it to AI instead' : 'Refine with AI chat',
          onclick: openChat,
        }),
      );
    }
  }

  const source = manual
    ? null
    : photo
      ? el(
          'p',
          { class: 'muted small-text' },
          `${food.notes}.`,
          lookup.extraSource && ' ',
          lookup.extraSource && el('a', { href: lookup.extraSource.url, target: '_blank', rel: 'noopener noreferrer', text: lookup.extraSource.text }),
        )
      : ref
        ? el(
            'p',
            { class: 'muted small-text' },
            'Source: ',
            el('a', { href: ref.url, target: '_blank', rel: 'noopener noreferrer', text: `USDA FoodData Central record ${ref.fdcId}` }),
            `. ${[ref.label ? 'Manufacturer label data' : DATA_KINDS[ref.dataType] || 'USDA data', ref.brandOwner, ref.date].filter(Boolean).join(', ')}.`,
            sourceExtras(food.notes),
          )
        : el('p', { class: 'muted small-text', text: [CONFIDENCE[food.confidence], food.notes].filter(Boolean).join('. ') });

  // Default action (also what Return does): log and remember the food.
  // Quick entry is usually a one-off, so there plain "Log" comes first.
  const buttons = manual
    ? [
        el('button', { class: 'btn primary', type: 'submit', text: 'Log' }),
        el(
          'div',
          { class: 'row' },
          el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: onCancel }),
          el('button', { class: 'btn', type: 'button', text: 'Log & save to my foods', onclick: act(onLogSave) }),
        ),
      ]
    : [
        el('button', { class: 'btn primary', type: 'submit', text: 'Log & save to my foods' }),
        el(
          'div',
          { class: 'row' },
          el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: onCancel }),
          el('button', { class: 'btn', type: 'button', text: 'Log once', onclick: act(onLogOnce) }),
        ),
      ];

  const card = el(
    'form',
    { class: 'card confirm', onsubmit: act(manual ? onLogOnce : onLogSave) },
    el('h2', { text: manual ? 'Quick entry' : 'Check these values' }),
    summary,
    photo && el('img', { class: 'label-photo', src: photo, alt: 'The label photo' }),
    note && el('p', { class: 'muted small-text', text: note }),
    conversionBox,
    missingBox,
    fields,
    source,
    notice,
    buttons,
    chatBox,
  );
  card.applyValues = apply; // e.g. values handed over from the Chat screen
  return card;
}
