// Today screen: the chart, the carbs line, manual logging, today's entries.

import { el, parseNumber, toast, hideToast, onLongPress } from './dom.js';
import {
  NUTRIENTS,
  scaleFood,
  scaleNutrients,
  sumEntries,
  lastLoggedEntry,
  formatValue,
  formatCarbs,
  formatCarbTotal,
} from '../nutrients.js';
import { servingsFor, unitsFor, normalizeUnit, formatAmount } from '../units.js';
import { foodDayKey, formatDayKey, timeOfDay, timestampInFoodDay } from '../day.js';
import { renderChartSVG } from '../chart.js';

const UNDO_MS = 10000;

export function createTodayView({ store, getSettings, goTo }) {
  const root = el('section', { class: 'view' });
  const sheetHost = el('div');
  let foods = [];
  let entries = [];
  let day = foodDayKey();
  let filter = '';

  async function refresh() {
    day = foodDayKey();
    [foods, entries] = await Promise.all([store.listFoods(), store.listEntriesForDay(day)]);
    render();
  }

  function render() {
    const settings = getSettings();
    const live = entries.filter((e) => !e.deleted);
    const totals = sumEntries(entries);

    const chart = el('div', { class: 'chart' });
    // Safe: the SVG is built by our own pure function from numbers and vetted colors.
    chart.innerHTML = renderChartSVG(totals, settings.targets, settings.colors, {
      showMealLabels: settings.showMealLabels,
    });

    root.replaceChildren(
      el('div', { class: 'status-row' }, el('span', { text: `Food day: ${formatDayKey(day)}` })),
      chart,
      renderCarbsLine(totals, lastLoggedEntry(entries)),
      renderLogSection(),
      renderEntries(live),
      sheetHost,
    );
  }

  function renderCarbsLine(totals, lastEntry) {
    const line = el('p', { class: 'carbs-line' }, `Carbs today: ${formatCarbTotal(totals)}`);
    if (lastEntry) {
      line.append(
        ' · Last entry: ',
        el('span', { class: 'carbs-last', text: formatCarbs(lastEntry.nutrients.effective_carbs_g) }),
        ` (${lastEntry.foodName})`,
      );
    }
    return line;
  }

  function renderLogSection() {
    if (foods.length === 0) {
      return el(
        'div',
        { class: 'card' },
        el('h2', { text: 'Log a food' }),
        el('p', { class: 'muted', text: 'Your foods list is empty. Add a food first, then log it here.' }),
        el('button', { class: 'btn primary', text: 'Add a food', onclick: () => goTo('foods') }),
      );
    }
    const list = el('div', { class: 'food-list' });
    const fillList = () => {
      const q = filter.trim().toLowerCase();
      const shown = foods.filter(
        (f) => !q || f.name.toLowerCase().includes(q) || (f.aliases || []).some((a) => a.toLowerCase().includes(q)),
      );
      list.replaceChildren(
        ...(shown.length
          ? shown.map((f) =>
              el(
                'button',
                { class: 'food-pick', onclick: () => openLogSheet(f) },
                el('span', { class: 'food-name', text: f.name }),
                el('span', { class: 'muted', text: `per ${formatAmount(f.serving_amount, f.serving_unit)}` }),
              ),
            )
          : [el('p', { class: 'muted', text: 'No foods match.' })]),
      );
    };
    fillList();
    return el(
      'div',
      { class: 'card' },
      el('h2', { text: 'Log a food' }),
      el('input', {
        class: 'big-input',
        type: 'search',
        placeholder: 'Filter my foods',
        value: filter,
        autocapitalize: 'off',
        oninput: (e) => {
          filter = e.target.value;
          fillList();
        },
      }),
      list,
    );
  }

  // --- sheets -------------------------------------------------------------

  function closeSheet() {
    sheetHost.replaceChildren();
  }

  /**
   * Amount + unit + time form shared by logging and editing.
   * compute(amount, unit) returns { servings, nutrients } or null.
   */
  function openEntrySheet({ title, amount, units, unit, ts, compute, submitLabel, onSubmit, extra, held }) {
    const amountInput = el('input', {
      class: 'big-input',
      type: 'text',
      inputMode: 'decimal',
      value: String(amount),
      'aria-label': 'Amount',
    });
    const unitSelect = el(
      'select',
      { class: 'big-input', 'aria-label': 'Unit' },
      units.map((u) => el('option', { value: u, text: u, selected: u === unit })),
    );
    // Time eaten, so something logged at night can be filed under this morning.
    const timeInput = el('input', { class: 'big-input', type: 'time', value: timeOfDay(ts ?? Date.now()) });
    let timeTouched = false;
    const preview = el('p', { class: 'preview' });
    const notice = el('div', { class: 'notice', hidden: true });
    const submit = el('button', { class: 'btn primary', type: 'submit', text: submitLabel });

    const read = () => {
      const qty = parseNumber(amountInput.value);
      if (!(qty > 0)) return { error: 'Enter an amount above 0.' };
      const result = compute(qty, unitSelect.value);
      if (!result) return { error: `This food can't be converted to ${unitSelect.value}.` };
      return { amount: qty, unit: unitSelect.value, ...result };
    };
    const update = () => {
      const result = read();
      submit.disabled = Boolean(result.error);
      preview.textContent = result.error || nutrientSummary(result.nutrients);
    };
    amountInput.addEventListener('input', update);
    unitSelect.addEventListener('change', update);
    for (const type of ['input', 'change']) {
      timeInput.addEventListener(type, () => {
        timeTouched = true;
        notice.hidden = true;
      });
    }

    const form = el(
      'form',
      {
        class: 'sheet',
        onsubmit: async (e) => {
          e.preventDefault();
          const result = read();
          if (result.error) return;
          // An untouched time keeps the original moment (or "now" for a new entry).
          let when = ts ?? Date.now();
          if (timeTouched) {
            when = timestampInFoodDay(day, timeInput.value);
            if (when == null) {
              notice.textContent = 'Pick a time.';
              notice.hidden = false;
              return;
            }
            if (when > Date.now() + 60000) {
              notice.textContent = "That time hasn't happened yet in this food day.";
              notice.hidden = false;
              return;
            }
          }
          submit.disabled = true;
          await onSubmit({ ...result, ts: when });
        },
      },
      el('h2', { text: title }),
      el('div', { class: 'row' }, amountInput, unitSelect),
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Time eaten' }), timeInput),
      preview,
      notice,
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: closeSheet }),
        submit,
      ),
      extra,
    );

    // After a press-and-hold the finger is still down. Ignore the backdrop
    // until it lifts, so releasing does not instantly dismiss the sheet.
    let armed = !held;
    if (held) {
      const arm = () => setTimeout(() => (armed = true), 350);
      window.addEventListener('pointerup', arm, { once: true });
      window.addEventListener('pointercancel', arm, { once: true });
    }
    hideToast(); // a lingering toast would cover the sheet
    sheetHost.replaceChildren(el('div', { class: 'backdrop', onclick: () => armed && closeSheet() }), form);
    update();
    return amountInput;
  }

  function openLogSheet(food) {
    const amountInput = openEntrySheet({
      title: food.name,
      amount: food.serving_amount,
      units: unitsFor(food),
      unit: normalizeUnit(food.serving_unit),
      ts: null,
      submitLabel: 'Log',
      compute: (amount, unit) => {
        const servings = servingsFor(food, amount, unit);
        return servings == null ? null : { servings, nutrients: scaleFood(food, servings) };
      },
      onSubmit: async (result) => {
        const now = Date.now();
        const entry = await store.putEntry({
          ts: result.ts,
          createdAt: now,
          day,
          foodId: food.id,
          foodName: food.name,
          amount: result.amount,
          unit: result.unit,
          servings: result.servings,
          nutrients: result.nutrients,
          source: food.source,
          estimated: false,
          phosphate_additives: Boolean(food.phosphate_additives),
          deleted: false,
          history: [],
        });
        closeSheet();
        await refresh();
        toast(`Logged ${formatAmount(entry.amount, entry.unit)} ${entry.foodName}`, {
          ms: UNDO_MS,
          actionLabel: 'Undo',
          onAction: () => removeEntry(entry, false),
        });
      },
    });
    amountInput.focus();
    amountInput.select();
  }

  async function openEditSheet(entry, held) {
    // The food may have been edited or removed since; the entry's own stored
    // values stay the basis, the food is only used to convert between units.
    const food = await store.getFood(entry.foodId);
    const units = [...new Set([entry.unit, ...(food ? unitsFor(food) : [])])];
    openEntrySheet({
      title: `Edit ${entry.foodName}`,
      amount: entry.amount,
      units,
      unit: entry.unit,
      ts: entry.ts,
      submitLabel: 'Save',
      held,
      compute: (amount, unit) => {
        let factor = null;
        if (unit === entry.unit) factor = amount / entry.amount;
        else if (food && entry.servings > 0) {
          const servings = servingsFor(food, amount, unit);
          if (servings != null) factor = servings / entry.servings;
        }
        if (factor == null) return null;
        return { servings: (entry.servings || 1) * factor, nutrients: scaleNutrients(entry.nutrients, factor) };
      },
      onSubmit: async (result) => {
        const changed = result.amount !== entry.amount || result.unit !== entry.unit || result.ts !== entry.ts;
        if (changed) {
          await store.putEntry({
            ...entry,
            amount: result.amount,
            unit: result.unit,
            servings: result.servings,
            nutrients: result.nutrients,
            ts: result.ts,
            // Audit trail: every edit keeps what was there before.
            history: [
              ...(entry.history || []),
              {
                at: Date.now(),
                action: 'edit',
                previous: {
                  amount: entry.amount,
                  unit: entry.unit,
                  servings: entry.servings,
                  nutrients: entry.nutrients,
                  ts: entry.ts,
                },
              },
            ],
          });
        }
        closeSheet();
        await refresh();
        if (changed) toast(`Updated ${entry.foodName}`);
      },
      extra: el('button', {
        class: 'btn',
        type: 'button',
        text: 'Delete entry',
        onclick: async () => {
          closeSheet();
          await removeEntry(entry, true);
        },
      }),
    });
  }

  /** Soft-delete an entry. With offerUndo, the toast can bring it back. */
  async function removeEntry(entry, offerUndo) {
    const removed = await store.deleteEntry({
      ...entry,
      history: [...(entry.history || []), { at: Date.now(), action: 'delete' }],
    });
    await refresh();
    toast(`Removed ${entry.foodName}`, {
      ms: offerUndo ? UNDO_MS : 3000,
      actionLabel: offerUndo && 'Undo',
      onAction: async () => {
        await store.restoreEntry({
          ...removed,
          history: [...removed.history, { at: Date.now(), action: 'restore' }],
        });
        await refresh();
      },
    });
  }

  function renderEntries(live) {
    const last = lastLoggedEntry(live);
    const card = el(
      'div',
      { class: 'card' },
      el(
        'div',
        { class: 'card-head' },
        el('h2', { text: "Today's entries" }),
        last &&
          el('button', {
            class: 'btn small',
            type: 'button',
            text: 'Undo last',
            onclick: () => removeEntry(last, true),
          }),
      ),
    );
    if (live.length === 0) {
      card.append(el('p', { class: 'muted', text: 'Nothing logged yet today.' }));
      return card;
    }
    card.append(el('p', { class: 'muted small-text', text: 'Press and hold an entry to edit it.' }));
    for (const entry of live) {
      const time = new Date(entry.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const row = el(
        'div',
        {
          class: 'entry',
          tabIndex: 0,
          role: 'button',
          'aria-label': `${entry.foodName}, ${time}. Press and hold to edit.`,
        },
        el(
          'div',
          { class: 'entry-title' },
          el('span', { class: 'muted', text: time }),
          ` ${formatAmount(entry.amount, entry.unit)} ${entry.foodName}`,
        ),
        el('div', { class: 'entry-nutrients muted', text: nutrientSummary(entry.nutrients) }),
      );
      onLongPress(row, ({ held }) => openEditSheet(entry, held));
      card.append(row);
    }
    return card;
  }

  return { root, refresh };
}

function nutrientSummary(nutrients) {
  const parts = NUTRIENTS.map((n) =>
    n.key === 'calories' ? formatValue(n, nutrients[n.key]) : `${n.letter} ${formatValue(n, nutrients[n.key])}`,
  );
  parts.push(`carbs ${formatCarbs(nutrients.effective_carbs_g)}`);
  return parts.join(' · ');
}
