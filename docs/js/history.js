// Pure day-history logic: the summary record and readable text log that are
// stored when a food day is finalized. No DOM.

import { NUTRIENTS, NUTRIENT_KEYS, sumEntries, formatValue, formatCarbTotal, nutrientSummary } from './nutrients.js';
import { formatAmount } from './units.js';

/**
 * The stored summary of one food day. Targets are copied in, so history keeps
 * showing each day against the targets that applied when it ended.
 */
export function buildDaySummary(day, entries, targets, now = Date.now()) {
  const sums = sumEntries(entries);
  const totals = {};
  const dayTargets = {};
  for (const key of NUTRIENT_KEYS) {
    totals[key] = sums[key];
    dayTargets[key] = Number(targets[key]) || 0;
  }
  return {
    day,
    entryCount: sums.count,
    totals,
    effective_carbs_g: sums.effective_carbs_g,
    carbsUnknown: sums.carbsUnknown,
    targets: dayTargets,
    exceeded: exceededLimits(totals, dayTargets),
    finalizedAt: now,
  };
}

/** Keys of the limit nutrients that went over target. Calories is a goal and never counts. */
export function exceededLimits(totals, targets) {
  return NUTRIENTS.filter((n) => n.type === 'limit' && targets[n.key] > 0 && totals[n.key] > targets[n.key]).map(
    (n) => n.key,
  );
}

/** "Fri, Nov 13, 2026" */
export function formatLongDay(dayKey, locale) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "FuelGauge 2026-11-13 Fri" — file-name stem carrying the date and weekday. */
export function dayFileStem(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const weekday = new Date(y, m - 1, d, 12).toLocaleDateString('en-US', { weekday: 'short' });
  return `FuelGauge ${dayKey} ${weekday}`;
}

/** Carbs total of a summary, e.g. "142 g" or "88+? g". */
export function summaryCarbs(summary) {
  return formatCarbTotal({ effective_carbs_g: summary.effective_carbs_g, carbsUnknown: summary.carbsUnknown });
}

function pad(text, width) {
  return String(text).padEnd(width, ' ');
}

/** The readable text log of a day: entries, totals vs targets, carbs, limits exceeded. */
export function buildDayText(summary, entries, locale) {
  const live = entries.filter((e) => !e.deleted).sort((a, b) => a.ts - b.ts);
  const lines = [`Fuel Gauge - ${formatLongDay(summary.day, locale)}`, ''];

  lines.push('ENTRIES');
  if (live.length === 0) lines.push('  (nothing logged)');
  for (const entry of live) {
    const time = new Date(entry.ts).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    const estimated = entry.estimated ? ' (estimated)' : '';
    lines.push(`  ${pad(time, 9)}${formatAmount(entry.amount, entry.unit)} ${entry.foodName}${estimated}`);
    lines.push(`  ${pad('', 9)}${nutrientSummary(entry.nutrients)}`);
  }

  lines.push('', 'TOTALS vs TARGETS');
  for (const n of NUTRIENTS) {
    const total = summary.totals[n.key];
    const target = summary.targets[n.key];
    const percent = target > 0 ? `${Math.round((total / target) * 100)}%` : '-';
    lines.push(
      `  ${pad(n.name, 11)}${pad(formatValue(n, total), 11)}of ${pad(formatValue(n, target), 11)}${pad(percent, 6)}${n.type}`,
    );
  }

  lines.push('', `Effective carbs: ${summaryCarbs(summary)}`);
  const exceeded = NUTRIENTS.filter((n) => summary.exceeded.includes(n.key)).map(
    (n) => `${n.name} (over by ${formatValue(n, summary.totals[n.key] - summary.targets[n.key])})`,
  );
  lines.push(`Limits exceeded: ${exceeded.length ? exceeded.join(', ') : 'none'}`);
  return `${lines.join('\n')}\n`;
}
