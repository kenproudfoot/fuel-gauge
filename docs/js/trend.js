// Pure trend logic: the status-row indicator and the 7-day calorie average. No DOM.
//
//   green  up arrow   on pace: calories and protein minimum on pace, no limit near or over
//   yellow dash       behind on calories or protein minimum, or a limit close
//   red    down arrow a limit exceeded (the only red: red means danger)
//   grey   dot        nothing logged yet today
//
// Pace is checked at meal checkpoints: the eating window is split in thirds,
// and by the end of each third a third more of the goal is expected. Between
// checkpoints only the last one passed counts, which leaves room to catch up.

import { NUTRIENTS, DANGER } from './nutrients.js';
import { foodDayRange } from './day.js';

export const TREND_COLORS = { green: '#22B85C', yellow: '#F5C518', red: DANGER, grey: '#A6A6B2' };
export const NEAR_LIMIT = 0.85; // a limit at 85% of its target is "close"
export const EARLY_LIMIT = 0.5; // ...and so is 50% before the first checkpoint

/** "06:30" -> minutes after midnight, or null. */
export function parseClock(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : null;
}

/** 690 -> "11:30 AM" */
export function formatClock(minutes) {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Minutes since midnight of the food day's calendar date. Times after midnight
 * (before the 2 AM rollover) count past 1440, so they stay in the same day.
 */
export function minutesIntoDay(dayKey, now) {
  const { start } = foodDayRange(dayKey);
  const midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  return Math.round((now - midnight) / 60000);
}

/** The three checkpoints of an eating window, in minutes: [first, second, end]. */
export function checkpoints(window) {
  const start = parseClock(window?.start);
  let end = parseClock(window?.end);
  if (start == null || end == null) return null;
  if (end <= start) end += 1440; // a window that runs past midnight
  const third = (end - start) / 3;
  return [start + third, start + 2 * third, end];
}

/** Share of a daily amount expected by `minutes` (0, 1/3, 2/3 or 1). */
export function expectedShare(window, minutes) {
  const marks = checkpoints(window);
  if (!marks) return 0;
  return marks.filter((mark) => minutes >= mark).length / 3;
}

/**
 * The indicator for today.
 * totals:   sumEntries() of today
 * settings: targets, proteinMin, eatingWindow
 * Returns { state, label, reasons: [{ level, text }], window } where state is
 * 'green' | 'yellow' | 'red' | 'grey'.
 */
export function computeTrend({ totals, entryCount, settings, dayKey, now = Date.now() }) {
  const { targets, proteinMin, eatingWindow } = settings;
  const minutes = minutesIntoDay(dayKey, now);
  const marks = checkpoints(eatingWindow);
  const share = expectedShare(eatingWindow, minutes);
  const early = marks ? minutes < marks[0] : false;
  const reasons = [];

  if (!entryCount) {
    return { state: 'grey', label: 'Nothing logged yet', reasons: [], marks };
  }

  // Limits: over is red; close (85%, or 50% before the first checkpoint) is yellow.
  for (const n of NUTRIENTS.filter((x) => x.type === 'limit')) {
    const target = Number(targets[n.key]);
    if (!(target > 0)) continue;
    const used = totals[n.key] / target;
    if (totals[n.key] > target) reasons.push({ level: 'red', key: n.key, text: `${n.name} is over its limit` });
    else if (used >= NEAR_LIMIT) reasons.push({ level: 'yellow', key: n.key, text: `${n.name} is at ${Math.round(used * 100)}% of its limit` });
    else if (early && used >= EARLY_LIMIT) {
      reasons.push({ level: 'yellow', key: n.key, text: `${n.name} is at ${Math.round(used * 100)}% before ${formatClock(marks[0])}` });
    }
  }

  // Calories: behind the last checkpoint passed is yellow. Over the goal is fine.
  const goal = Number(targets.calories);
  if (goal > 0 && share > 0 && totals.calories < goal * share) {
    reasons.push({ level: 'yellow', key: 'calories', text: `Behind on calories: ${Math.round(totals.calories)} of ${Math.round(goal * share)} kcal expected by now` });
  }

  // Protein minimum, on the same checkpoints.
  if (proteinMin > 0 && share > 0 && totals.protein_g < proteinMin * share) {
    reasons.push({ level: 'yellow', key: 'protein_min', text: `Behind on protein: ${Math.round(totals.protein_g * 10) / 10} of ${Math.round(proteinMin * share * 10) / 10} g minimum expected by now` });
  }

  const red = reasons.filter((r) => r.level === 'red');
  if (red.length) {
    return { state: 'red', label: red.length === 1 ? red[0].text.replace(' is over its limit', ' over') : `${red.length} limits over`, reasons, marks };
  }
  if (reasons.length) {
    const first = reasons[0];
    const short = first.key === 'calories' ? 'Behind on calories' : first.key === 'protein_min' ? 'Behind on protein' : `${NUTRIENTS.find((n) => n.key === first.key).name} close to limit`;
    return { state: 'yellow', label: reasons.length > 1 ? `${short} +${reasons.length - 1}` : short, reasons, marks };
  }
  return { state: 'green', label: 'On pace', reasons, marks };
}

/**
 * Average calories over the last `days` completed days before `todayKey`
 * (days with nothing logged are left out). Returns { average, goal, percent, days } or null.
 */
export function weeklyCalories(summaries, todayKey, goal, days = 7) {
  const recent = summaries
    .filter((s) => s.day < todayKey && s.entryCount > 0)
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, days);
  if (recent.length === 0) return null;
  const average = recent.reduce((sum, s) => sum + (Number(s.totals?.calories) || 0), 0) / recent.length;
  return { average: Math.round(average), goal, percent: goal > 0 ? Math.round((average / goal) * 100) : null, days: recent.length };
}

/** "7-day average: 1980 kcal (92% of goal)" */
export function weeklyLabel(week) {
  if (!week) return 'No completed days yet for a weekly average.';
  const span = week.days === 7 ? '7-day' : `${week.days}-day`;
  return `${span} average: ${week.average} kcal${week.percent != null ? ` (${week.percent}% of goal)` : ''}`;
}

/** The icon as SVG markup, drawn from fixed shapes and the state's color. */
export function trendIconSVG(state, size = 18) {
  const color = TREND_COLORS[state] || TREND_COLORS.grey;
  const shapes = {
    green: `<path d="M9 3 L16 14 H2 Z" fill="${color}"/>`,
    yellow: `<rect x="2" y="7" width="14" height="4" rx="2" fill="${color}"/>`,
    red: `<path d="M9 15 L16 4 H2 Z" fill="${color}"/>`,
    grey: `<circle cx="9" cy="9" r="5" fill="${color}"/>`,
  };
  return `<svg viewBox="0 0 18 18" width="${size}" height="${size}" aria-hidden="true">${shapes[state] || shapes.grey}</svg>`;
}
