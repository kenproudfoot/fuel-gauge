// Backup, date-range export and restore. The phone holds the only copy of the
// data, so one tap must produce a complete zip that can be saved to Files.

import { el, toast, deliverFile } from './dom.js';
import { mergeSettings } from '../nutrients.js';
import { foodDayKey, foodDayRange, addDays } from '../day.js';
import {
  buildBackupFiles,
  parseBackupFiles,
  planRestore,
  relinkEntries,
  describeRestore,
  inRange,
  backupFileName,
  backupAgeLabel,
  backupDue,
  daysSince,
} from '../backup.js';
import { finalizePastDays } from './finalize.js';
import { zipFiles, readZip } from './files.js';

/** Build the zip and hand it to the share sheet. A range makes it an export, not a backup. */
export async function runBackup(context, range = null) {
  const { store, getSettings } = context;
  await finalizePastDays(context);
  let [entries, summaries, foods] = await Promise.all([store.listAllEntries(), store.listSummaries(), store.listFoods()]);
  if (range) {
    entries = inRange(entries, range.from, range.to);
    summaries = inRange(summaries, range.from, range.to);
  }
  const files = buildBackupFiles({ entries, summaries, foods, settings: getSettings() });
  for (const summary of summaries) {
    const png = await store.getPng(summary.day);
    if (png) files[`history/${summary.day}.png`] = png.bytes;
  }
  const file = new File([await zipFiles(files)], backupFileName(foodDayKey(), range), { type: 'application/zip' });
  const outcome = await deliverFile(file);
  const saved = outcome === 'shared' || outcome === 'downloaded';
  if (saved && !range) await store.setMeta('lastBackupAt', Date.now());
  return { saved, entries: entries.length };
}

/** What the status row shows, and whether it is time to nudge. */
export async function backupStatus({ store, getSettings }) {
  const lastBackupAt = await store.getMeta('lastBackupAt');
  const firstDay = (await store.listEntryDays())[0];
  const firstEntryAt = firstDay ? foodDayRange(firstDay).start.getTime() : null;
  const nudgeDays = getSettings().backupNudgeDays;
  return {
    label: backupAgeLabel(lastBackupAt),
    due: backupDue({ lastBackupAt, firstEntryAt, nudgeDays }),
    days: daysSince(lastBackupAt || firstEntryAt),
  };
}

/** The Backup card on the Settings screen. */
export function createBackupCard(context) {
  const { store, getSettings, saveSettings } = context;
  const card = el('div', { class: 'card' });

  async function renderMain() {
    const status = await backupStatus(context);
    const today = foodDayKey();
    const from = el('input', { class: 'big-input', type: 'date', value: addDays(today, -6), 'aria-label': 'From' });
    const to = el('input', { class: 'big-input', type: 'date', value: today, 'aria-label': 'To' });
    const busy = async (button, work) => {
      button.disabled = true;
      try {
        await work();
      } catch (error) {
        toast(error.message || 'That did not work. Nothing was changed.', { ms: 5000 });
      }
      button.disabled = false;
    };

    const backupButton = el('button', {
      class: 'btn primary',
      type: 'button',
      text: 'Back up now',
      onclick: () =>
        busy(backupButton, async () => {
          const result = await runBackup(context);
          if (result.saved) {
            toast('Backup saved');
            await renderMain();
          }
        }),
    });
    const exportButton = el('button', {
      class: 'btn',
      type: 'button',
      text: 'Export these dates',
      onclick: () =>
        busy(exportButton, async () => {
          if (!from.value || !to.value || from.value > to.value) return toast('Pick a From date on or before the To date.');
          const result = await runBackup(context, { from: from.value, to: to.value });
          if (result.saved) toast(`Exported ${result.entries} entr${result.entries === 1 ? 'y' : 'ies'}`);
        }),
    });

    card.replaceChildren(
      el('h2', { text: 'Backup' }),
      el('p', { class: 'muted', text: `${status.label}. Your data exists only on this phone, so save a backup to Files or iCloud Drive regularly.` }),
      backupButton,
      el('h3', { text: 'Export a date range' }),
      el('div', { class: 'row' }, el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'From' }), from), el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'To' }), to)),
      exportButton,
      el('h3', { text: 'Restore' }),
      el(
        'label',
        { class: 'btn file-btn' },
        'Restore from a backup zip',
        el('input', {
          class: 'visually-hidden',
          type: 'file',
          accept: '.zip,application/zip',
          onchange: async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
              await renderRestore(file);
            } catch {
              renderProblem('That file could not be read as a zip.');
            }
          },
        }),
      ),
      el('p', { class: 'muted small-text', text: 'Restoring only adds what is missing. Nothing on this phone is overwritten or duplicated.' }),
    );
  }

  function renderProblem(message) {
    card.replaceChildren(
      el('h2', { text: 'Restore' }),
      el('div', { class: 'notice', text: message }),
      el('button', { class: 'btn', type: 'button', text: 'Back', onclick: renderMain }),
    );
  }

  async function renderRestore(file) {
    const { texts, binaries } = await readZip(file);
    const backup = parseBackupFiles(texts);
    if (backup.error) return renderProblem(backup.error);

    const [entries, summaries, foods] = await Promise.all([store.listAllEntries(), store.listSummaries(), store.listFoods()]);
    const plan = planRestore(
      { entryIds: new Set(entries.map((e) => e.id)), summaryDays: new Set(summaries.map((s) => s.day)), foods },
      backup,
    );
    const withSettings = el('input', { type: 'checkbox', checked: Boolean(backup.settings) && entries.length === 0 });
    const confirm = el('button', {
      class: 'btn primary',
      type: 'button',
      text: 'Restore',
      onclick: async () => {
        confirm.disabled = true;
        for (const food of plan.foods) await store.putFood(food);
        await store.putMany('entries', relinkEntries(plan.entries, await store.listFoods()));
        await store.putMany('summaries', plan.summaries);
        for (const summary of plan.summaries) {
          const bytes = binaries[`history/${summary.day}.png`];
          if (bytes) await store.putPng({ day: summary.day, type: 'image/png', bytes });
        }
        if (withSettings.checked && backup.settings) {
          // Anything secret stays as it is on this phone; backups never carry it.
          await saveSettings(mergeSettings({ ...backup.settings, ai: getSettings().ai }));
        }
        await finalizePastDays(context);
        toast(`Restored: ${describeRestore(plan).replace(' to add', '')}`, { ms: 5000 });
        await renderMain();
      },
    });
    card.replaceChildren(
      el('h2', { text: 'Restore' }),
      el('p', { class: 'muted', text: file.name }),
      el('p', { class: 'import-summary', text: describeRestore(plan) }),
      backup.skippedEntries > 0 && el('div', { class: 'notice', text: `${backup.skippedEntries} unreadable row(s) in entries.csv will be skipped.` }),
      backup.settings && el('label', { class: 'check' }, withSettings, el('span', { text: 'Also restore targets, colors and other settings' })),
      el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: renderMain }), confirm),
    );
  }

  renderMain();
  return card;
}
