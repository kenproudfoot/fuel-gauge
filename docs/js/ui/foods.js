// My foods screen: list, add, edit, soft-delete. Values typed here have source "me".

import { el, toast, shareOrDownload } from './dom.js';
import { parseFoodsFile, planImport, describeImport, serializeFoodsFile } from '../foodsFile.js';
import { NUTRIENTS, validateFood } from '../nutrients.js';
import { SERVING_UNITS, normalizeUnit, unitKind, formatAmount } from '../units.js';

export function createFoodsView({ store }) {
  const root = el('section', { class: 'view' });
  let foods = [];

  async function refresh(params) {
    foods = await store.listFoods();
    // Arriving from "Add it to my foods" opens the form with the name filled in.
    if (params?.newName) renderForm(null, { name: params.newName });
    else renderList();
  }

  async function exportFile() {
    const file = new File([serializeFoodsFile(foods)], 'my-foods.txt', { type: 'text/plain' });
    const outcome = await shareOrDownload(file);
    if (outcome === 'downloaded') toast('Saved my-foods.txt');
  }

  /** Preview what a file would change, then apply it only on confirm. */
  function renderImport(fileName, text) {
    const parsed = parseFoodsFile(text);
    const back = el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: renderList });
    if (parsed.error || parsed.foods.length === 0) {
      root.replaceChildren(
        el(
          'div',
          { class: 'card' },
          el('h2', { text: 'Import foods' }),
          el('div', { class: 'notice', text: parsed.error || 'No foods were found in that file.' }),
          parsed.skipped.map((s) => el('p', { class: 'muted small-text', text: `Line ${s.line}: ${s.reason}` })),
          back,
        ),
      );
      return;
    }

    let mode = 'merge';
    let plan = planImport(foods, parsed.foods, mode);
    const summary = el('p', { class: 'import-summary' });
    const warning = el('div', { class: 'notice', hidden: true });
    const radio = (value, label, hint) =>
      el(
        'label',
        { class: 'check' },
        el('input', {
          type: 'radio',
          name: 'import-mode',
          value,
          checked: value === mode,
          onchange: () => {
            mode = value;
            update();
          },
        }),
        el('span', {}, label, el('span', { class: 'muted small-text', text: ` ${hint}` })),
      );
    const update = () => {
      plan = planImport(foods, parsed.foods, mode);
      summary.textContent = describeImport(plan, parsed.skipped);
      warning.hidden = plan.remove.length === 0;
      warning.textContent = `Replace all removes ${plan.remove.length} food${plan.remove.length === 1 ? '' : 's'} that ${plan.remove.length === 1 ? 'is' : 'are'} not in this file. Past log entries are kept.`;
    };
    update();

    const confirm = el('button', {
      class: 'btn primary',
      type: 'button',
      text: 'Import',
      onclick: async () => {
        confirm.disabled = true;
        for (const food of [...plan.add, ...plan.update]) await store.putFood(food);
        for (const food of plan.remove) await store.deleteFood(food);
        toast(`Imported: ${describeImport(plan, [])}`, { ms: 5000 });
        await refresh();
      },
    });
    root.replaceChildren(
      el(
        'div',
        { class: 'card' },
        el('h2', { text: 'Import foods' }),
        el('p', { class: 'muted', text: fileName }),
        summary,
        radio('merge', 'Merge', 'update matching names, add new ones'),
        radio('replace', 'Replace all', 'my foods become exactly this file'),
        warning,
        el('div', { class: 'row' }, back, confirm),
      ),
    );
    window.scrollTo(0, 0);
  }

  function renderList() {
    const card = el(
      'div',
      { class: 'card' },
      el('h2', { text: `My foods (${foods.length})` }),
      el('button', { class: 'btn primary', text: 'Add a food', onclick: () => renderForm(null) }),
      el(
        'div',
        { class: 'row' },
        // A label wrapping the file input opens the iOS file picker (Files / iCloud Drive).
        el(
          'label',
          { class: 'btn file-btn' },
          'Import file',
          el('input', {
            class: 'visually-hidden',
            type: 'file',
            accept: '.txt,.csv,text/plain,text/csv',
            onchange: async (e) => {
              const file = e.target.files[0];
              if (file) renderImport(file.name, await file.text());
            },
          }),
        ),
        el('button', { class: 'btn', type: 'button', text: 'Export file', disabled: foods.length === 0, onclick: exportFile }),
      ),
      el('a', { class: 'muted small-text', href: 'example-foods.txt', download: 'example-foods.txt', text: 'Download an example foods file' }),
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

  function renderForm(existing, prefill = {}) {
    const food = existing || prefill;
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
