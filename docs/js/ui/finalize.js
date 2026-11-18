// Filing past days. There is no background process, so this runs lazily: on
// app open, when the app comes back to the front, and on a timer while open.
// Finalizing a day stores its summary, readable text log and final chart PNG.

import { foodDayKey } from '../day.js';
import { renderChartSVG } from '../chart.js';
import { buildDaySummary, buildDayText, formatLongDay, summaryCarbs, dayFileStem } from '../history.js';
import { svgToPngBlob } from './files.js';

const PNG_WIDTH = 1000;
const PNG_HEIGHT = 1064; // chart plus the date strip

/** The chart of a day as it is saved to an image: the live chart with a date strip on top. */
export function dayImageSvg(summary, settings) {
  return renderChartSVG(summary.totals, summary.targets, settings.colors, {
    showMealLabels: settings.showMealLabels,
    size: PNG_WIDTH,
    caption: { left: formatLongDay(summary.day), right: `Carbs ${summaryCarbs(summary)}` },
  });
}

/** A day's chart as a PNG file named with its date, e.g. "FuelGauge 2026-11-13 Fri.png". */
export async function dayImageFile(summary, settings, storedPng) {
  const blob = storedPng
    ? new Blob([storedPng.bytes], { type: 'image/png' })
    : await svgToPngBlob(dayImageSvg(summary, settings), PNG_WIDTH, PNG_HEIGHT);
  return new File([blob], `${dayFileStem(summary.day)}.png`, { type: 'image/png' });
}

/** File (or re-file, after a past day was changed) one day's summary, text log and chart PNG. */
export async function finalizeDay({ store, getSettings }, day) {
  const settings = getSettings();
  const entries = await store.listEntriesForDay(day);
  const summary = buildDaySummary(day, entries, settings.targets);
  summary.text = buildDayText(summary, entries);
  await store.putSummary(summary);
  try {
    const blob = await svgToPngBlob(dayImageSvg(summary, settings), PNG_WIDTH, PNG_HEIGHT);
    await store.putPng({ day, type: 'image/png', bytes: await blob.arrayBuffer() });
  } catch {
    // The summary and text are saved; the image can be drawn again on demand.
  }
}

let running = null;

/** Finalize every past food day that has entries and no summary yet. Returns how many were filed. */
export function finalizePastDays(context) {
  running ||= (async () => {
    try {
      const today = foodDayKey();
      const days = (await context.store.listEntryDays()).filter((day) => day < today);
      const done = new Set((await context.store.listSummaries()).map((s) => s.day));
      let count = 0;
      for (const day of days) {
        if (done.has(day)) continue;
        await finalizeDay(context, day);
        count++;
      }
      return count;
    } finally {
      running = null;
    }
  })();
  return running;
}
