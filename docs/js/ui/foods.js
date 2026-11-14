// My foods screen: list, add, edit, soft-delete. Values typed here have source "me".

import { el, toast } from './dom.js';
import { NUTRIENTS, validateFood } from '../nutrients.js';
import { SERVING_UNITS, normalizeUnit, unitKind, formatAmount } from '../units.js';

export function createFoodsView({ store }) {
  const root = el('section', { class: 'view' });
  let foods = [];

  async function refresh() {
    foods = await store.listFoods();
    renderList();
  }

  function renderList() {
    const card = el(
      'div',
      { class: 'card' },
      el('h2', { text: `My foods (${foods.length})` }),
      el('button', { class: 'btn primary', text: 'Add a food', onclick: () => renderForm(null) }),
    );
    if (foods.length === 0) {
      card.append(el('p', { class: 'muted', text: 'No foods yet. Add one with its nutrition-label values.' }));
    }
    for (const food of foods) {
      card.append(
        el(
          'button',
          { class: 'food-pick', onclick: () => renderForm(food) },
          el('span', { class: 'food-name', text: food.name }),
          el('span', {
            class: 'muted',
            text: `${formatAmount(food.serving_amount, food.serving_unit)} · ${food.calories} kcal`,
          }),
        ),
      );
    }
    root.replaceChildren(card);
  }

  function renderForm(existing) {
    const food = existing || {};
    const text = (value) => (value == null ? '' : String(value));
    const field = (label, input, hint) =>
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: label }), input, hint && el('span', { class: 'muted small-text', text: hint }));
    const number = (value, placeholder = '') =>
      el('input', { class: 'big-input', type: 'text', inputMode: 'decimal', value: text(value), placeholder });

    const inputs = {
      name: el('input', { class: 'big-input', type: 'text', value: text(food.name), autocapitalize: 'off' }),
      aliases: el('input', {
        class: 'big-input',
        type: 'text',
        value: (food.aliases || []).join(' | '),
        autocapitalize: 'off',
        placeholder: 'pecans | tj pecans',
      }),
      serving_amount: number(food.serving_amount),
      serving_unit: el(
        'select',
        { class: 'big-input' },
        SERVING_UNITS.map((u) =>
          el('option', { value: u, text: u, selected: u === normalizeUnit(food.serving_unit || 'g') }),
        ),
      ),
      grams_per_serving: number(food.grams_per_serving, 'optional'),
      effective_carbs_g: number(food.effective_carbs_g, 'blank = unknown'),
      phosphate_additives: el('input', { type: 'checkbox', checked: Boolean(food.phosphate_additives) }),
      notes: el('input', { class: 'big-input', type: 'text', value: text(food.notes) }),
    };
    for (const n of NUTRIENTS) inputs[n.key] = number(food[n.key]);

    // Grams per serving only matters when the serving is a volume or a count.
    const gramsField = field(
      'Grams per serving',
      inputs.grams_per_serving,
      'Lets you log this food by weight (g / oz).',
    );
    const syncGrams = () => {
      gramsField.hidden = unitKind(inputs.serving_unit.value) === 'weight';
    };
    inputs.serving_unit.addEventListener('change', syncGrams);
    syncGrams();

    const errorBox = el('div', { class: 'notice', hidden: true });

    const save = async (e) => {
      e.preventDefault();
      const raw = {};
      for (const [key, input] of Object.entries(inputs)) raw[key] = input.type === 'checkbox' ? input.checked : input.value;
      if (unitKind(raw.serving_unit) === 'weight') raw.grams_per_serving = '';
      const { ok, food: clean, errors } = validateFood(raw);
      const clash = foods.find(
        (f) => f.id !== food.id && f.name.trim().toLowerCase() === clean.name.toLowerCase(),
      );
      if (clash) errors.push(`You already have a food named "${clash.name}".`);
      if (!ok || clash) {
        errorBox.replaceChildren(...errors.map((message) => el('div', { text: message })));
        errorBox.hidden = false;
        errorBox.scrollIntoView({ block: 'nearest' });
        return;
      }
      // Typing the values yourself makes them yours, whatever the source was.
      await store.putFood({ ...food, ...clean, source: 'me' });
      toast(`Saved ${clean.name}`);
      await refresh();
    };

    const form = el(
      'form',
      { class: 'card', onsubmit: save },
      el('h2', { text: existing ? 'Edit food' : 'Add a food' }),
      field('Name', inputs.name),
      field('Aliases', inputs.aliases, 'Other names you might say, separated by |'),
      el(
        'div',
        { class: 'row' },
        field('Serving amount', inputs.serving_amount),
        field('Serving unit', inputs.serving_unit),
      ),
      gramsField,
      el('h3', { text: 'Values per serving' }),
      NUTRIENTS.map((n) => field(`${n.name} (${n.unit})`, inputs[n.key])),
      field('Effective carbs (g)', inputs.effective_carbs_g, 'Total carbs minus fiber.'),
      el(
        'label',
        { class: 'check' },
        inputs.phosphate_additives,
        el('span', { text: 'Contains phosphate additives' }),
      ),
      field('Notes', inputs.notes),
      errorBox,
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: renderList }),
        el('button', { class: 'btn primary', type: 'submit', text: 'Save food' }),
      ),
      existing &&
        el('button', {
          class: 'btn',
          type: 'button',
          text: 'Remove from my foods',
          onclick: async () => {
            await store.deleteFood(existing);
            toast(`Removed ${existing.name}`);
            await refresh();
          },
        }),
    );
    root.replaceChildren(form);
    window.scrollTo(0, 0);
  }

  return { root, refresh };
}
