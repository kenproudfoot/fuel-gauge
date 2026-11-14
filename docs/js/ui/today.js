// Today screen: totals, carbs line, manual logging, today's entries.
// (Phase 2 replaces the totals rows with the SVG chart.)

import { el, parseNumber, toast } from './dom.js';
import {
  NUTRIENTS,
  DANGER,
  scaleFood,
  sumEntries,
  nutrientStatus,
  formatValue,
  formatNumber,
  formatCarbs,
  formatCarbTotal,
} from '../nutrients.js';
import { servingsFor, unitsFor, normalizeUnit, formatAmount } from '../units.js';
import { foodDayKey, formatDayKey } from '../day.js';

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

    root.replaceChildren(
      el('div', { class: 'status-row' }, el('span', { text: `Food day: ${formatDayKey(day)}` })),
      renderTotals(totals, settings),
      renderCarbsLine(totals, live[0]),
      renderLogSection(),
      renderEntries(live),
      sheetHost,
    );
  }

  function renderTotals(totals, settings) {
    return el(
      'div',
      { class: 'totals' },
      NUTRIENTS.map((n) => {
        const value = totals[n.key];
        const target = settings.targets[n.key];
        const status = nutrientStatus(n, value, target);
        const fill = el('div', { class: 'meter-fill' });
        fill.style.width = `${status.fill * 100}%`;
        fill.style.backgroundColor = status.danger ? DANGER : settings.colors[n.key];
        return el(
          'div',
          { class: 'total-row' },
          el('span', { class: 'total-letter', text: n.letter }),
          el(
            'div',
            { class: 'total-main' },
            el(
              'div',
              { class: 'total-text' },
              el('span', { class: 'total-value', text: formatValue(n, value) }),
              el('span', {
                class: 'total-target',
                text: `${status.goalMet ? '✓ goal · ' : ''}of ${formatNumber(target, 0)}`,
              }),
            ),
            el('div', { class: 'meter' }, fill),
          ),
        );
      }),
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

  function openLogSheet(food) {
    const amountInput = el('input', {
      class: 'big-input',
      type: 'text',
      inputMode: 'decimal',
      value: String(food.serving_amount),
      'aria-label': 'Amount',
    });
    const baseUnit = normalizeUnit(food.serving_unit);
    const unitSelect = el(
      'select',
      { class: 'big-input', 'aria-label': 'Unit' },
      unitsFor(food).map((u) => el('option', { value: u, text: u, selected: u === baseUnit })),
    );
    const preview = el('p', { class: 'preview' });
    const logButton = el('button', { class: 'btn primary', type: 'submit', text: 'Log' });

    const compute = () => {
      const amount = parseNumber(amountInput.value);
      if (!(amount > 0)) return null;
      const servings = servingsFor(food, amount, unitSelect.value);
      if (servings == null) return null;
      return { amount, unit: unitSelect.value, servings, nutrients: scaleFood(food, servings) };
    };
    const update = () => {
      const result = compute();
      logButton.disabled = !result;
      preview.textContent = result ? nutrientSummary(result.nutrients) : 'Enter an amount above 0.';
    };
    amountInput.addEventListener('input', update);
    unitSelect.addEventListener('change', update);

    const close = () => sheetHost.replaceChildren();
    const form = el(
      'form',
      {
        class: 'sheet',
        onsubmit: async (e) => {
          e.preventDefault();
          const result = compute();
          if (!result) return;
          logButton.disabled = true;
          const now = new Date();
          await store.putEntry({
            ts: now.getTime(),
            day: foodDayKey(now),
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
          close();
          toast(`Logged ${formatAmount(result.amount, result.unit)} ${food.name}`);
          await refresh();
        },
      },
      el('h2', { text: food.name }),
      el('div', { class: 'row' }, amountInput, unitSelect),
      preview,
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: close }),
        logButton,
      ),
    );
    document.getElementById('toast').hidden = true; // a lingering toast would cover the sheet
    sheetHost.replaceChildren(el('div', { class: 'backdrop', onclick: close }), form);
    update();
    amountInput.focus();
    amountInput.select();
  }

  function renderEntries(live) {
    const card = el('div', { class: 'card' }, el('h2', { text: "Today's entries" }));
    if (live.length === 0) {
      card.append(el('p', { class: 'muted', text: 'Nothing logged yet today.' }));
      return card;
    }
    for (const entry of live) {
      const time = new Date(entry.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      card.append(
        el(
          'div',
          { class: 'entry' },
          el(
            'div',
            { class: 'entry-main' },
            el(
              'div',
              { class: 'entry-title' },
              el('span', { class: 'muted', text: time }),
              ` ${formatAmount(entry.amount, entry.unit)} ${entry.foodName}`,
            ),
            el('div', { class: 'entry-nutrients muted', text: nutrientSummary(entry.nutrients) }),
          ),
          el('button', {
            class: 'btn small',
            text: 'Delete',
            'aria-label': `Delete ${entry.foodName}`,
            onclick: async () => {
              await store.deleteEntry(entry);
              toast(`Deleted ${entry.foodName}`);
              await refresh();
            },
          }),
        ),
      );
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
