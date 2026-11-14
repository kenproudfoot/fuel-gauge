// Day-boundary tests run in a fixed zone with DST so results don't depend on the Mac's clock settings.
process.env.TZ = 'America/Los_Angeles';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foodDayKey, foodDayRange, addDays, formatDayKey } from '../docs/js/day.js';

const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

test('test zone is active', () => {
  assert.equal(new Date(Date.UTC(2026, 0, 15, 20)).getHours(), 12);
});

test('daytime entries belong to their calendar day', () => {
  assert.equal(foodDayKey(local(2026, 11, 13, 8, 0)), '2026-11-13');
  assert.equal(foodDayKey(local(2026, 11, 13, 23, 59)), '2026-11-13');
});

test('1:30 AM belongs to the previous day', () => {
  assert.equal(foodDayKey(local(2026, 11, 14, 1, 30)), '2026-11-13');
  assert.equal(foodDayKey(local(2026, 11, 14, 0, 0)), '2026-11-13');
  assert.equal(foodDayKey(local(2026, 11, 14, 1, 59)), '2026-11-13');
});

test('2:00 AM starts the new day', () => {
  assert.equal(foodDayKey(local(2026, 11, 14, 2, 0)), '2026-11-14');
});

test('rollover crosses month and year ends', () => {
  assert.equal(foodDayKey(local(2026, 12, 1, 1, 0)), '2026-11-30');
  assert.equal(foodDayKey(local(2027, 1, 1, 0, 30)), '2026-12-31');
  assert.equal(foodDayKey(local(2028, 3, 1, 1, 0)), '2028-02-29');
});

test('accepts a timestamp as well as a Date', () => {
  assert.equal(foodDayKey(local(2026, 11, 14, 1, 30).getTime()), '2026-11-13');
});

test('spring forward (Mar 8 2026): 2 AM does not exist', () => {
  // 1:59 PST is 09:59 UTC; one minute later the clock reads 3:00 PDT.
  assert.equal(foodDayKey(new Date(Date.UTC(2026, 2, 8, 9, 59))), '2026-03-07');
  assert.equal(foodDayKey(new Date(Date.UTC(2026, 2, 8, 10, 0))), '2026-03-08');
});

test('fall back (Nov 1 2026): 1:30 AM happens twice, both in the previous day', () => {
  assert.equal(foodDayKey(new Date(Date.UTC(2026, 10, 1, 8, 30))), '2026-10-31'); // 1:30 PDT
  assert.equal(foodDayKey(new Date(Date.UTC(2026, 10, 1, 9, 30))), '2026-10-31'); // 1:30 PST
  assert.equal(foodDayKey(new Date(Date.UTC(2026, 10, 1, 10, 0))), '2026-11-01'); // 2:00 PST
});

test('food day range runs 2 AM to 2 AM and matches foodDayKey', () => {
  const { start, end } = foodDayRange('2026-11-13');
  assert.equal(start.getTime(), local(2026, 11, 13, 2).getTime());
  assert.equal(end.getTime(), local(2026, 11, 14, 2).getTime());
  assert.equal(foodDayKey(start), '2026-11-13');
  assert.equal(foodDayKey(new Date(end.getTime() - 1)), '2026-11-13');
  assert.equal(foodDayKey(end), '2026-11-14');
});

test('DST days are 23 and 25 hours long', () => {
  const hours = (key) => {
    const { start, end } = foodDayRange(key);
    return (end - start) / 3600000;
  };
  assert.equal(hours('2026-03-07'), 24); // ends at the 3 AM that replaces 2 AM
  assert.equal(hours('2026-03-08'), 23);
  assert.equal(hours('2026-10-31'), 25);
  assert.equal(hours('2026-11-13'), 24);
});

test('every moment across a DST change maps into its own range', () => {
  for (const startUtc of [Date.UTC(2026, 2, 7, 0), Date.UTC(2026, 9, 31, 0)]) {
    for (let minutes = 0; minutes < 72 * 60; minutes += 15) {
      const when = new Date(startUtc + minutes * 60000);
      const { start, end } = foodDayRange(foodDayKey(when));
      assert.ok(when >= start && when < end, when.toISOString());
    }
  }
});

test('addDays steps across month ends', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
});

test('formatDayKey is readable', () => {
  assert.equal(formatDayKey('2026-11-13', 'en-US'), 'Fri, Nov 13');
});

import { timeOfDay, timestampInFoodDay } from '../docs/js/day.js';

test('timeOfDay gives HH:MM in local time', () => {
  assert.equal(timeOfDay(local(2026, 11, 13, 7, 5)), '07:05');
  assert.equal(timeOfDay(local(2026, 11, 13, 21, 40).getTime()), '21:40');
});

test('a morning time lands on the food day itself', () => {
  assert.equal(timestampInFoodDay('2026-11-13', '07:30'), local(2026, 11, 13, 7, 30).getTime());
  assert.equal(timestampInFoodDay('2026-11-13', '02:00'), local(2026, 11, 13, 2, 0).getTime());
  assert.equal(timestampInFoodDay('2026-11-13', '23:59'), local(2026, 11, 13, 23, 59).getTime());
});

test('a time before 2 AM lands on the next calendar morning, still in the same food day', () => {
  const ts = timestampInFoodDay('2026-11-13', '01:30');
  assert.equal(ts, local(2026, 11, 14, 1, 30).getTime());
  assert.equal(foodDayKey(ts), '2026-11-13');
});

test('every time of day maps back into its food day, including DST days', () => {
  for (const day of ['2026-11-13', '2026-03-07', '2026-03-08', '2026-10-31', '2026-11-01', '2026-12-31']) {
    for (let h = 0; h < 24; h++) {
      const ts = timestampInFoodDay(day, `${String(h).padStart(2, '0')}:15`);
      assert.equal(foodDayKey(ts), day, `${day} ${h}:15`);
    }
  }
});

test('unreadable times return null', () => {
  for (const bad of ['', null, undefined, 'noon', '25:00', '12:75']) {
    assert.equal(timestampInFoodDay('2026-11-13', bad), null);
  }
});
