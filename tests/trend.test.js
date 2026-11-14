import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseClock, formatClock, minutesIntoDay, checkpoints, expectedShare, computeTrend, weeklyCalories, weeklyLabel,
  trendIconSVG, TREND_COLORS,
} from '../docs/js/trend.js';
import { DEFAULT_SETTINGS, DANGER } from '../docs/js/nutrients.js';

const DAY = '2026-11-14';
const at = (hh, mm, dayOffset = 0) => new Date(2026, 10, 14 + dayOffset, hh, mm).getTime();
const settings = { ...DEFAULT_SETTINGS, eatingWindow: { start: '06:30', end: '21:30' } };
const zero = { calories: 0, protein_g: 0, sodium_mg: 0, potassium_mg: 0, phosphorus_mg: 0 };
const trend = (totals, now, over = {}) =>
  computeTrend({ totals: { ...zero, ...totals }, entryCount: 1, settings: { ...settings, ...over }, dayKey: DAY, now });

test('clock parsing and formatting', () => {
  assert.equal(parseClock('06:30'), 390);
  assert.equal(parseClock('6:30'), 390);
  assert.equal(parseClock('24:00'), null);
  assert.equal(parseClock(''), null);
  assert.equal(formatClock(690), '11:30 AM');
  assert.equal(formatClock(0), '12:00 AM');
  assert.equal(formatClock(1290), '9:30 PM');
});

test('the default window is 6:30 AM to 9:30 PM', () => {
  assert.deepEqual(DEFAULT_SETTINGS.eatingWindow, { start: '06:30', end: '21:30' });
});

test('checkpoints split the window in thirds: 11:30 AM, 4:30 PM, 9:30 PM', () => {
  assert.deepEqual(checkpoints(settings.eatingWindow), [690, 990, 1290]);
  assert.deepEqual(checkpoints({ start: '18:00', end: '03:00' }), [1080 + 180, 1080 + 360, 1620]);
  assert.equal(checkpoints({ start: 'x', end: '21:30' }), null);
});

test('expected share steps up only at each checkpoint', () => {
  const w = settings.eatingWindow;
  assert.equal(expectedShare(w, 600), 0);
  assert.equal(expectedShare(w, 689), 0);
  assert.equal(expectedShare(w, 690), 1 / 3);
  assert.equal(expectedShare(w, 989), 1 / 3);
  assert.equal(expectedShare(w, 990), 2 / 3);
  assert.equal(expectedShare(w, 1290), 1);
});

test('minutes into the food day continue past midnight until the 2 AM rollover', () => {
  assert.equal(minutesIntoDay(DAY, at(11, 30)), 690);
  assert.equal(minutesIntoDay(DAY, at(1, 15, 1)), 1440 + 75);
});

test('grey with nothing logged', () => {
  const t = computeTrend({ totals: zero, entryCount: 0, settings, dayKey: DAY, now: at(15, 0) });
  assert.equal(t.state, 'grey');
  assert.equal(t.label, 'Nothing logged yet');
});

test('green before the first checkpoint, whatever has been eaten', () => {
  assert.equal(trend({ calories: 50 }, at(9, 0)).state, 'green');
});

test('calories: behind the last checkpoint passed is yellow, on it is green', () => {
  // 2150 / 3 = 716.67 expected by 11:30
  assert.equal(trend({ calories: 700 }, at(11, 30)).state, 'yellow');
  assert.equal(trend({ calories: 717 }, at(11, 30)).state, 'green');
  // At 3 PM only the 11:30 checkpoint counts: room to catch up until 4:30.
  assert.equal(trend({ calories: 800 }, at(15, 0)).state, 'green');
  assert.equal(trend({ calories: 800 }, at(16, 30)).state, 'yellow');
  const t = trend({ calories: 1400 }, at(16, 30));
  assert.equal(t.state, 'yellow');
  assert.equal(t.label, 'Behind on calories');
  assert.match(t.reasons[0].text, /1400 of 1433 kcal expected by now/);
});

test('after the window, short of the goal stays yellow; past midnight too', () => {
  assert.equal(trend({ calories: 2100 }, at(22, 0)).state, 'yellow');
  assert.equal(trend({ calories: 2100 }, at(1, 0, 1)).state, 'yellow');
  assert.equal(trend({ calories: 2150 }, at(22, 0)).state, 'green');
  assert.equal(trend({ calories: 3000 }, at(22, 0)).state, 'green'); // over the goal is good
});

test('a limit at 85% is yellow; under is green', () => {
  assert.equal(trend({ calories: 2150, sodium_mg: 1690 }, at(22, 0)).state, 'green');
  const t = trend({ calories: 2150, sodium_mg: 1700 }, at(22, 0));
  assert.equal(t.state, 'yellow');
  assert.equal(t.label, 'Sodium close to limit');
  assert.equal(t.reasons[0].text, 'Sodium is at 85% of its limit');
});

test('a limit at 50% before the first checkpoint is yellow, but not after it', () => {
  const early = trend({ potassium_mg: 1000 }, at(10, 0));
  assert.equal(early.state, 'yellow');
  assert.equal(early.reasons[0].text, 'Potassium is at 50% before 11:30 AM');
  assert.equal(trend({ calories: 800, potassium_mg: 1000 }, at(12, 0)).state, 'green');
});

test('a limit over is red, and red wins over everything else', () => {
  const t = trend({ calories: 10, phosphorus_mg: 801, sodium_mg: 1900 }, at(18, 0));
  assert.equal(t.state, 'red');
  assert.equal(t.label, 'Phosphorus over');
  assert.equal(trend({ calories: 2150, phosphorus_mg: 801, sodium_mg: 2001 }, at(22, 0)).label, '2 limits over');
  // Exactly at the limit is not over.
  assert.equal(trend({ calories: 2150, phosphorus_mg: 800 }, at(22, 0)).state, 'yellow');
});

test('protein minimum: behind it is yellow, only when one is set', () => {
  const totals = { calories: 2150, protein_g: 30 };
  assert.equal(trend(totals, at(22, 0)).state, 'green');
  const t = trend(totals, at(22, 0), { proteinMin: 40 });
  assert.equal(t.state, 'yellow');
  assert.equal(t.label, 'Behind on protein');
  // 40 g x 2/3 = 26.7 g expected by 4:30 PM
  assert.equal(trend({ calories: 1500, protein_g: 27 }, at(16, 30), { proteinMin: 40 }).state, 'green');
});

test('several yellow reasons are counted in the label', () => {
  const t = trend({ calories: 100, sodium_mg: 1800 }, at(22, 0), { proteinMin: 40 });
  assert.equal(t.label, 'Sodium close to limit +2');
  assert.equal(t.reasons.length, 3);
});

test('weekly calories: completed days only, newest 7, empty days skipped', () => {
  const s = (day, calories, entryCount = 3) => ({ day, entryCount, totals: { calories } });
  const summaries = [
    s('2026-11-14', 99999), // today: never counted
    s('2026-11-13', 2000), s('2026-11-12', 1800), s('2026-11-11', 0, 0),
    s('2026-11-10', 2200), s('2026-11-09', 2100), s('2026-11-08', 1900), s('2026-11-07', 2000), s('2026-11-06', 2400),
    s('2026-11-05', 100),
  ];
  const week = weeklyCalories(summaries, DAY, 2150);
  assert.equal(week.days, 7);
  assert.equal(week.average, Math.round((2000 + 1800 + 2200 + 2100 + 1900 + 2000 + 2400) / 7));
  assert.equal(week.percent, Math.round((week.average / 2150) * 100));
  assert.equal(weeklyLabel(week), `7-day average: ${week.average} kcal (${week.percent}% of goal)`);
  assert.equal(weeklyLabel(weeklyCalories([s('2026-11-13', 2150)], DAY, 2150)), '1-day average: 2150 kcal (100% of goal)');
  assert.equal(weeklyCalories([], DAY, 2150), null);
  assert.equal(weeklyLabel(null), 'No completed days yet for a weekly average.');
});

test('icons: up arrow, dash, down arrow, dot; only the red one uses red', () => {
  assert.match(trendIconSVG('green'), /M9 3 L16 14/);
  assert.match(trendIconSVG('yellow'), /<rect/);
  assert.match(trendIconSVG('red'), /M9 15 L16 4/);
  assert.match(trendIconSVG('grey'), /<circle/);
  assert.equal(TREND_COLORS.red, DANGER);
  for (const state of ['green', 'yellow', 'grey']) assert.ok(!trendIconSVG(state).includes(DANGER), state);
});
