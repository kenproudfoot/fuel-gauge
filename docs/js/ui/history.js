// History screen: past days with mini charts; tap one for its full chart and entries.

import { el, toast, deliverFile } from './dom.js';
import { NUTRIENTS, DANGER, nutrientSummary } from '../nutrients.js';
import { formatAmount } from '../units.js';
import { renderChartSVG } from '../chart.js';
import { formatLongDay, summaryCarbs, dayFileStem } from '../history.js';
import { finalizePastDays, dayImageFile } from './finalize.js';
import { weeklyCalories, weeklyLabel } from '../trend.js';
import { foodDayKey } from '../day.js';

export function createHistoryView(context) {
  const { store, getSettings } = context;
  const root = el('section', { class: 'view' });

  async function refresh() {
    await finalizePastDays(context);
    renderList((await store.listSummaries()).filter((s) => s.entryCount > 0));
  }

  function chartNode(summary, className) {
    const settings = getSettings();
    const node = el('div', { class: className });
    // Safe: the SVG is built by our own pure function from numbers and vetted colors.
    node.innerHTML = renderChartSVG(summary.totals, summary.targets, settings.colors, {
      showMealLabels: className === 'chart' && settings.showMealLabels,
    });
    return node;
  }

  /** "Over: Sodium, Phosphorus" in red (an exceeded limit is what red is for), or nothing. */
  function exceededNode(summary) {
    if (summary.exceeded.length === 0) return null;
    const names = NUTRIENTS.filter((n) => summary.exceeded.includes(n.key)).map((n) => n.name);
    const node = el('span', { class: 'over', text: `Over: ${names.join(', ')}` });
    node.style.color = DANGER;
    return node;
  }

  function renderList(summaries) {
    const week = weeklyCalories(summaries, foodDayKey(), getSettings().targets.calories);
    const card = el('div', { class: 'card' }, el('h2', { text: 'History' }), week && el('p', { class: 'muted', text: weeklyLabel(week) }));
    if (summaries.length === 0) {
      card.append(el('p', { class: 'muted', text: 'No past days yet. Each day is filed here after it ends at 2 AM.' }));
    }
    for (const summary of summaries) {
      card.append(
        el(
          'button',
          { class: 'day-pick', type: 'button', onclick: () => renderDay(summary) },
          chartNode(summary, 'mini-chart'),
          el(
            'span',
            { class: 'day-text' },
            el('span', { class: 'food-name', text: formatLongDay(summary.day) }),
            el('span', { class: 'muted small-text', text: `${Math.round(summary.totals.calories)} kcal · carbs ${summaryCarbs(summary)}` }),
            exceededNode(summary),
          ),
        ),
      );
    }
    root.replaceChildren(card);
  }

  async function renderDay(summary) {
    const entries = (await store.listEntriesForDay(summary.day)).filter((e) => !e.deleted).sort((a, b) => a.ts - b.ts);
    const list = el('div', { class: 'card' }, el('h2', { text: 'Entries' }));
    if (entries.length === 0) list.append(el('p', { class: 'muted', text: 'Nothing logged.' }));
    for (const entry of entries) {
      const time = new Date(entry.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      list.append(
        el(
          'div',
          { class: 'entry static' },
          el('div', { class: 'entry-title' }, el('span', { class: 'muted', text: time }), ` ${formatAmount(entry.amount, entry.unit)} ${entry.foodName}`),
          el('div', { class: 'entry-nutrients muted', text: nutrientSummary(entry.nutrients) }),
        ),
      );
    }

    const saveImage = el('button', {
      class: 'btn',
      type: 'button',
      text: 'Save chart image',
      onclick: async () => {
        saveImage.disabled = true;
        try {
          await deliverFile(await dayImageFile(summary, getSettings(), await store.getPng(summary.day)));
        } catch (error) {
          toast(error.message || 'Could not save the image.');
        }
        saveImage.disabled = false;
      },
    });
    const shareText = el('button', {
      class: 'btn',
      type: 'button',
      text: 'Share text log',
      onclick: () => deliverFile(new File([summary.text || ''], `${dayFileStem(summary.day)}.txt`, { type: 'text/plain' })),
    });

    root.replaceChildren(
      el('button', { class: 'btn small back', type: 'button', text: '‹ All days', onclick: refresh }),
      el('h2', { class: 'day-title', text: formatLongDay(summary.day) }),
      chartNode(summary, 'chart'),
      el('p', { class: 'carbs-line' }, `Carbs: ${summaryCarbs(summary)}`, exceededNode(summary) && ' · ', exceededNode(summary)),
      el('div', { class: 'row actions' }, saveImage, shareText),
      list,
    );
    window.scrollTo(0, 0);
  }

  return { root, refresh };
}
