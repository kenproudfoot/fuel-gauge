// Pure food-day logic. The food day rolls over at 2:00 AM device-local time,
// so an entry at 1:30 AM belongs to the previous calendar day. No DOM.

export const ROLLOVER_HOUR = 2;

function pad(n) {
  return String(n).padStart(2, '0');
}

function keyFromParts(year, monthIndex, day) {
  // Let Date normalize overflow (e.g. day 0 -> last day of the previous month).
  const d = new Date(year, monthIndex, day, 12);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The food day ("YYYY-MM-DD") that a moment belongs to.
 * Works from wall-clock fields, so it stays correct across DST changes.
 */
export function foodDayKey(when = new Date(), rolloverHour = ROLLOVER_HOUR) {
  const d = when instanceof Date ? when : new Date(when);
  const shift = d.getHours() < rolloverHour ? 1 : 0;
  return keyFromParts(d.getFullYear(), d.getMonth(), d.getDate() - shift);
}

/** The food day before / after a given key. */
export function addDays(dayKey, delta) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return keyFromParts(y, m - 1, d + delta);
}

/** [start, end) of a food day as Dates. */
export function foodDayRange(dayKey, rolloverHour = ROLLOVER_HOUR) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return {
    start: new Date(y, m - 1, d, rolloverHour),
    end: new Date(y, m - 1, d + 1, rolloverHour),
  };
}

/** "Fri, Nov 13" */
export function formatDayKey(dayKey, locale) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Local wall-clock time of a moment as "HH:MM" (the format of <input type="time">). */
export function timeOfDay(when) {
  const d = when instanceof Date ? when : new Date(when);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The moment "HH:MM" falls on within a food day, as a timestamp.
 * Times before the rollover hour belong to the tail of the food day, i.e. the
 * next calendar morning. Returns null for unreadable input.
 */
export function timestampInFoodDay(dayKey, hhmm, rolloverHour = ROLLOVER_HOUR) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d + (hours < rolloverHour ? 1 : 0), hours, minutes).getTime();
}
