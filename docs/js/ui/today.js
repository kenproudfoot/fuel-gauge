// Today screen: the chart, the carbs line, voice/text logging, today's entries.

import { el, parseNumber, toast, hideToast, onLongPress, deliverFile } from './dom.js';
import { buildDaySummary } from '../history.js';
import { dayImageFile } from './finalize.js';
import { runBackup, backupStatus } from './backupUi.js';
import {
  NUTRIENTS,
  DANGER,
  scaleFood,
  scaleNutrients,
  sumEntries,
  lastLoggedEntry,
  remainingLines,
  nutrientSummary,
  entryBadges,
  formatValue,
  formatCarbs,
  formatCarbTotal,
} from '../nutrients.js';
import { servingsFor, unitsFor, normalizeUnit, formatAmount } from '../units.js';
import { foodDayKey, formatDayKey, timeOfDay, timestampInFoodDay } from '../day.js';
import { renderChartSVG } from '../chart.js';
import { parseInput } from '../parser.js';
import { matchFoods, scoreName } from '../fuzzy.js';
import { createVoice } from './voice.js';
import { isConfigured, lookupFood, parseWithAi, gramsFor } from '../ai.js';
import { createConfirmCard } from './confirmCard.js';
import { usdaConfigured, searchFoods, fetchFood, foodFromFdc, mergeEstimates, gramsFromPortions } from '../usda.js';

const UNDO_MS = 10000;
const PLACEHOLDER = '12 g candied pecans';
const MIC_ICON =
  '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

export function createTodayView(context) {
  const { store, getSettings, goTo } = context;
  let foods = [];
  let entries = [];
  let day = foodDayKey();

  // Fixed skeleton, so re-rendering never takes focus away from the text field.
  const statusRow = el('div', { class: 'status-row' });
  const nudgeBox = el('div');
  const chartBox = el('div', { class: 'chart' });
  const carbsBox = el('div');
  const input = el('input', {
    class: 'big-input command-input',
    type: 'text',
    enterKeyHint: 'go',
    autocapitalize: 'off',
    autocomplete: 'off',
    placeholder: PLACEHOLDER,
    'aria-label': 'What did you eat? Type or dictate, then press Return.',
    oninput: () => showSuggestions(),
  });
  const micButton = el('button', { class: 'mic', type: 'button', 'aria-label': 'Speak' });
  micButton.innerHTML = MIC_ICON; // static markup defined above
  const responseBox = el('div');
  const entriesBox = el('div');
  const sheetHost = el('div');
  const root = el(
    'section',
    { class: 'view' },
    statusRow,
    nudgeBox,
    chartBox,
    carbsBox,
    el(
      'form',
      {
        class: 'command',
        onsubmit: (e) => {
          e.preventDefault();
          handleCommand(input.value);
        },
      },
      input,
      micButton,
    ),
    responseBox,
    entriesBox,
    sheetHost,
  );

  // Voice and typed text go through the same handleCommand pipeline.
  const voice = createVoice({
    onInterim: (text) => (input.value = text),
    onFinal: (text) => {
      input.value = text;
      handleCommand(text);
    },
    onError: (message) => respond(noticeCard(message)),
    onState: (listening) => {
      micButton.classList.toggle('listening', listening);
      micButton.setAttribute('aria-label', listening ? 'Stop listening' : 'Speak');
      input.placeholder = listening ? 'Listening…' : PLACEHOLDER;
    },
  });
  micButton.hidden = !voice.supported;
  micButton.addEventListener('click', () => {
    respond();
    voice.toggle();
  });

  async function refresh() {
    day = foodDayKey();
    [foods, entries] = await Promise.all([store.listFoods(), store.listEntriesForDay(day)]);
    render();
    renderBackupStatus(await backupStatus(context));
  }

  /** Backup age in the status row, and a gentle yellow nudge once it is overdue. */
  function renderBackupStatus(status) {
    statusRow.replaceChildren(
      el('span', { text: `Food day: ${formatDayKey(day)}` }),
      el('button', { class: 'status-link', type: 'button', text: status.label, onclick: () => goTo('settings') }),
    );
    if (!status.due) return nudgeBox.replaceChildren();
    const nudge = el('button', {
      class: 'nudge',
      type: 'button',
      text: `No backup for ${status.days} day${status.days === 1 ? '' : 's'}. Tap to back up.`,
      onclick: async () => {
        nudge.disabled = true;
        try {
          const result = await runBackup(context);
          if (result.saved) toast('Backup saved');
        } catch (error) {
          toast(error.message || 'The backup could not be made.', { ms: 5000 });
        }
        renderBackupStatus(await backupStatus(context));
      },
    });
    nudgeBox.replaceChildren(nudge);
  }

  /** Save today's chart as a PNG stamped and named with the date. */
  async function saveChartImage(button) {
    button.disabled = true;
    try {
      const summary = buildDaySummary(day, entries, getSettings().targets);
      await deliverFile(await dayImageFile(summary, getSettings(), null));
    } catch (error) {
      toast(error.message || 'Could not save the image.');
    }
    button.disabled = false;
  }

  function render() {
    const settings = getSettings();
    const live = entries.filter((e) => !e.deleted);
    const totals = sumEntries(entries);

    if (!statusRow.firstChild) statusRow.replaceChildren(el('span', { text: `Food day: ${formatDayKey(day)}` }));
    // Safe: the SVG is built by our own pure function from numbers and vetted colors.
    chartBox.innerHTML = renderChartSVG(totals, settings.targets, settings.colors, {
      showMealLabels: settings.showMealLabels,
    });
    carbsBox.replaceChildren(
      renderCarbsLine(totals, lastLoggedEntry(entries)),
      el('button', { class: 'status-link save-image', type: 'button', text: 'Save chart image', onclick: (e) => saveChartImage(e.currentTarget) }),
    );
    entriesBox.replaceChildren(renderEntries(live));
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

  // --- command pipeline ---------------------------------------------------

  function respond(...nodes) {
    responseBox.replaceChildren(...nodes.filter(Boolean));
  }

  function clearInput() {
    input.value = '';
    respond();
  }

  function noticeCard(message, ...extra) {
    return el('div', { class: 'card' }, el('p', { text: message }), extra);
  }

  const aiConfig = () => getSettings().ai;
  const usdaConfig = () => getSettings().usda;
  let aiAbort = null;

  /** Show a "working" card with a Cancel button while an AI or USDA request runs. */
  async function withAi(message, work) {
    aiAbort?.abort();
    const controller = new AbortController();
    aiAbort = controller;
    respond(noticeCard(message, el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => controller.abort() })));
    try {
      return await work({ signal: controller.signal });
    } finally {
      if (aiAbort === controller) aiAbort = null;
    }
  }

  async function handleCommand(text) {
    let command = parseInput(text);
    // The local parser comes first. Only when it can't get amount + unit + food,
    // and nothing in my foods matches, is the raw text sent to the AI to parse.
    const stuck =
      command.type === 'unknown' ||
      (command.type === 'log' && !command.confident && matchFoods(command.food, foods).status === 'none');
    if (stuck && String(text).trim() && isConfigured(aiConfig())) {
      try {
        const parsed = await withAi('Working out what that was…', (deps) => parseWithAi(aiConfig(), text, deps));
        if (parsed) command = parsed;
      } catch (error) {
        if (error.kind === 'cancelled') return respond();
        // Fall through with what the local parser had.
      }
      respond();
    }
    if (command.type === 'unknown') {
      respond(noticeCard(`Try something like “${PLACEHOLDER}”, “undo” or “what's left?”`));
    } else if (command.type === 'undo') {
      const last = lastLoggedEntry(entries);
      if (!last) return respond(noticeCard('Nothing to undo today.'));
      clearInput();
      await removeEntry(last, true);
    } else if (command.type === 'remaining') {
      input.value = '';
      showRemaining();
    } else if (command.type === 'delete') {
      await deleteByName(command.query);
    } else {
      const { status, matches } = matchFoods(command.food, foods);
      if (status === 'none') await lookUp(command);
      else if (status === 'choices') showChoices(command, matches, 'Which one?');
      else await logFood(matches[0].food, command);
    }
  }

  /** As you type, offer matching foods; tapping one logs it with the typed amount. */
  function showSuggestions() {
    const command = parseInput(input.value);
    if (command.type !== 'log' || command.food.length < 2) return respond();
    const { matches } = matchFoods(command.food, foods);
    if (matches.length) showChoices(command, matches, null);
    else respond();
  }

  function showChoices(command, matches, heading) {
    respond(
      el(
        'div',
        { class: 'card' },
        heading && el('h2', { text: heading }),
        el(
          'div',
          { class: 'food-list' },
          matches.map(({ food }) =>
            el(
              'button',
              { class: 'food-pick', type: 'button', onclick: () => logFood(food, command) },
              el('span', { class: 'food-name', text: food.name }),
              el('span', {
                class: 'muted',
                text:
                  command.amount == null
                    ? `per ${formatAmount(food.serving_amount, food.serving_unit)}`
                    : formatAmount(command.amount, command.unit),
              }),
            ),
          ),
        ),
      ),
    );
  }

  /** The manual path: always available, needs no network. */
  function showNotFound(command, message) {
    respond(
      noticeCard(
        message || `“${command.food}” isn't in your foods yet.`,
        el('button', {
          class: 'btn primary',
          type: 'button',
          text: 'Enter the values myself',
          onclick: () => goTo('foods', { newName: command.food }),
        }),
        !isConfigured(aiConfig()) &&
          !usdaConfigured(usdaConfig()) &&
          el('button', { class: 'btn', type: 'button', text: 'Set up food lookup', onclick: () => goTo('settings') }),
      ),
    );
  }

  /**
   * Food not in my list: search USDA when a key is set, otherwise ask the AI.
   * Either way a confirm card follows, and nothing is logged without a tap.
   */
  async function lookUp(command) {
    if (usdaConfigured(usdaConfig())) return searchUsda(command);
    if (isConfigured(aiConfig())) return lookUpWithAi(command);
    return showNotFound(command);
  }

  /** Offer matching USDA records to pick from. */
  async function searchUsda(command) {
    const ai = isConfigured(aiConfig());
    let candidates;
    try {
      candidates = await withAi(`Searching USDA for “${command.food}”…`, (deps) => searchFoods(usdaConfig(), command.food, deps));
    } catch (error) {
      if (error.kind === 'cancelled') return respond();
      if (ai) return lookUpWithAi(command, `${error.message} Asking AI instead.`);
      return showNotFound(command, `${error.message} You can enter the values for “${command.food}” yourself.`);
    }
    if (candidates.length === 0) {
      if (ai) return lookUpWithAi(command, 'USDA has no match. Asking AI instead.');
      return showNotFound(command, `USDA has no match for “${command.food}”. You can enter its values yourself.`);
    }
    respond(
      el(
        'div',
        { class: 'card' },
        el('h2', { text: 'USDA matches' }),
        el('p', { class: 'muted', text: 'Pick the one that matches what you ate.' }),
        el(
          'div',
          { class: 'food-list' },
          candidates.map((candidate) =>
            el(
              'button',
              { class: 'food-pick stacked', type: 'button', onclick: () => pickUsda(command, candidate) },
              el('span', { class: 'food-name', text: candidate.title }),
              el('span', { class: 'muted', text: candidate.detail }),
            ),
          ),
        ),
        ai && el('button', { class: 'btn', type: 'button', text: 'None of these: ask AI', onclick: () => lookUpWithAi(command) }),
        el(
          'div',
          { class: 'row' },
          el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => respond() }),
          el('button', { class: 'btn', type: 'button', text: 'Enter values myself', onclick: () => goTo('foods', { newName: command.food }) }),
        ),
      ),
    );
    return responseBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Fetch the chosen USDA record, fill any gaps with AI, and show the confirm card. */
  async function pickUsda(command, candidate) {
    const ai = isConfigured(aiConfig());
    let record;
    try {
      record = await withAi(`Getting USDA values for “${candidate.title}”…`, (deps) => fetchFood(usdaConfig(), candidate.fdcId, deps));
    } catch (error) {
      if (error.kind === 'cancelled') return respond();
      return showNotFound(command, `${error.message} You can enter the values for “${command.food}” yourself.`);
    }
    let lookup = foodFromFdc(record);
    if (!lookup) {
      if (ai) return lookUpWithAi(command, 'That USDA record has no nutrient values. Asking AI instead.');
      return showNotFound(command, `That USDA record has no nutrient values. You can enter the values for “${command.food}” yourself.`);
    }

    // What USDA lacks (often phosphorus) is estimated by AI and marked as such;
    // without AI, or if it fails, those fields stay blank to fill in by hand.
    if (lookup.missing.length && ai) {
      const lacking = NUTRIENTS.filter((n) => lookup.missing.includes(n.key)).map((n) => n.name.toLowerCase()).join(', ');
      const weight = servingsFor(lookup.food, 1, 'g') != null ? 1 / servingsFor(lookup.food, 1, 'g') : null;
      const query = weight
        ? { food: lookup.food.name, amount: Math.round(weight * 10) / 10, unit: 'g' }
        : { food: lookup.food.name, amount: lookup.food.serving_amount, unit: lookup.food.serving_unit };
      try {
        const estimate = await withAi(`USDA has no ${lacking} for this. Asking AI to estimate…`, (deps) => lookupFood(aiConfig(), query, deps));
        lookup = mergeEstimates(lookup, estimate.food);
      } catch {
        // Cancelled or failed: carry on with the USDA values alone.
      }
    }

    // An amount the food's serving can't convert ("1 cup" of a per-100 g food):
    // use USDA's own measures if the record has them, else an AI weight estimate.
    let asked = command;
    let note = null;
    if (command.amount != null && servingsFor(lookup.food, command.amount, command.unit) == null && servingsFor(lookup.food, 1, 'g') != null) {
      const said = formatAmount(command.amount, command.unit);
      const measured = gramsFromPortions(record, command.amount, command.unit);
      if (measured) {
        asked = { ...command, amount: measured, unit: 'g' };
        note = `${said} is ${measured} g by USDA's measure for this food.`;
      } else if (ai) {
        try {
          const estimate = await withAi(`Converting ${said} to grams…`, (deps) =>
            gramsFor(aiConfig(), { food: lookup.food.name, amount: command.amount, unit: command.unit }, deps),
          );
          asked = { ...command, amount: estimate.grams, unit: 'g' };
          note = `AI estimate: ${said} is about ${estimate.grams} g${estimate.notes ? ` (${estimate.notes})` : ''}. Check the values before logging.`;
        } catch {
          // The card will show one serving and say the amount couldn't be converted.
        }
      }
    }
    return showConfirm(lookup, command, asked, note);
  }

  /** Ask the AI for the food. `reason` is shown while it works (e.g. why USDA was skipped). */
  async function lookUpWithAi(command, reason) {
    let lookup;
    try {
      lookup = await withAi([reason, `Looking up “${command.food}”…`].filter(Boolean).join(' '), (deps) => lookupFood(aiConfig(), command, deps));
    } catch (error) {
      if (error.kind === 'cancelled') return respond();
      const offline = error.kind === 'network';
      return showNotFound(
        command,
        offline
          ? `Can't reach the AI right now, so “${command.food}” couldn't be looked up. You can enter its values yourself.`
          : `${error.message} You can enter the values for “${command.food}” yourself.`,
      );
    }
    return showConfirm(lookup, command, command, null);
  }

  /**
   * The confirm card for a looked-up food. `command` is what was said (its food
   * words become an alias); `asked` is the amount to show, which may have been
   * converted to grams.
   */
  function showConfirm(lookup, command, asked, note) {
    const fromUsda = Boolean(lookup.ref);
    respond(
      createConfirmCard({
        lookup,
        command: asked,
        note,
        onCancel: () => respond(),
        onLogSave: async (result) => {
          // Confirmed by me: saved to my foods with where it came from, and what I said as an alias.
          let name = result.name;
          if (foods.some((f) => f.name.trim().toLowerCase() === name.toLowerCase())) name = `${name} (${fromUsda ? 'USDA' : 'AI'})`;
          const alias = command.food.toLowerCase() === name.toLowerCase() ? [] : [command.food];
          const food = await store.putFood({ ...result.food, name, aliases: alias, source: fromUsda ? 'usda-confirmed' : 'ai-confirmed' });
          clearInput();
          await saveNewEntry(food, { ...result, ts: Date.now() });
        },
        onLogOnce: async (result) => {
          // Logged without saving the food: the entry stays marked estimated
          // when any of its values is an AI estimate.
          clearInput();
          await saveNewEntry(
            { id: null, name: result.name, source: fromUsda ? 'usda' : 'ai', phosphate_additives: result.food.phosphate_additives },
            { ...result, ts: Date.now() },
            result.estimated,
          );
        },
      }),
    );
    responseBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function showRemaining() {
    const lines = remainingLines(sumEntries(entries), getSettings().targets);
    respond(
      el(
        'div',
        { class: 'card' },
        el('div', { class: 'card-head' }, el('h2', { text: "What's left today" }), el('button', { class: 'btn small', type: 'button', text: 'Close', onclick: () => respond() })),
        lines.map((line) => {
          const value = el('span', { class: 'remaining-value', text: line.text });
          if (line.danger) value.style.color = DANGER; // an exceeded limit is the one thing shown in red
          return el('div', { class: 'remaining-row' }, el('span', { text: `${line.letter} · ${line.name}` }), value);
        }),
      ),
    );
  }

  /** "delete the pecans": remove today's best-matching entry (most recently logged on a tie). */
  async function deleteByName(query) {
    const candidates = entries
      .filter((e) => !e.deleted)
      .map((entry) => ({ entry, score: scoreName(query, entry.foodName) }))
      .filter((c) => c.score >= 0.55)
      .sort((a, b) => b.score - a.score || (b.entry.createdAt ?? b.entry.ts) - (a.entry.createdAt ?? a.entry.ts));
    if (candidates.length === 0) return respond(noticeCard(`No entry today matches “${query}”.`));
    clearInput();
    await removeEntry(candidates[0].entry, true);
  }

  /** Log a known food from a parsed command. Never needs the network. */
  async function logFood(food, command) {
    if (command.amount == null) {
      clearInput();
      return openLogSheet(food);
    }
    const servings = servingsFor(food, command.amount, command.unit);
    if (servings == null) {
      // Can't convert what was said. Ask the AI for a weight if possible, then
      // always ask me to confirm in the sheet rather than logging a guess.
      const said = formatAmount(command.amount, command.unit);
      const per = formatAmount(food.serving_amount, food.serving_unit);
      clearInput();
      if (isConfigured(aiConfig()) && servingsFor(food, 1, 'g') != null) {
        try {
          const estimate = await withAi(`Converting ${said} of ${food.name} to grams…`, (deps) =>
            gramsFor(aiConfig(), { food: food.name, amount: command.amount, unit: command.unit }, deps),
          );
          respond();
          return openLogSheet(
            food,
            `AI estimate: ${said} is about ${estimate.grams} g${estimate.notes ? ` (${estimate.notes})` : ''}. Check the amount before logging.`,
            { amount: estimate.grams, unit: 'g' },
          );
        } catch (error) {
          respond();
          if (error.kind === 'cancelled') return undefined;
        }
      }
      return openLogSheet(food, `${food.name} is measured per ${per}, so “${said}” can't be converted. Set the amount here.`);
    }
    clearInput();
    await saveNewEntry(food, {
      amount: command.amount,
      unit: command.unit,
      servings,
      nutrients: scaleFood(food, servings),
      ts: Date.now(),
    });
  }

  async function saveNewEntry(food, result, estimated = false) {
    const entry = await store.putEntry({
      ts: result.ts,
      createdAt: Date.now(),
      day,
      foodId: food.id,
      foodName: food.name,
      amount: result.amount,
      unit: result.unit,
      servings: result.servings,
      nutrients: result.nutrients,
      source: food.source,
      estimated,
      phosphate_additives: Boolean(food.phosphate_additives),
      deleted: false,
      history: [],
    });
    await refresh();
    toast(`Logged ${formatAmount(entry.amount, entry.unit)} ${entry.foodName}`, {
      ms: UNDO_MS,
      actionLabel: 'Undo',
      onAction: () => removeEntry(entry, false),
    });
  }

  // --- sheets -------------------------------------------------------------

  function closeSheet() {
    sheetHost.replaceChildren();
  }

  /**
   * Amount + unit + time form shared by logging and editing.
   * compute(amount, unit) returns { servings, nutrients } or null.
   */
  function openEntrySheet({ title, note, amount, units, unit, ts, compute, submitLabel, onSubmit, extra, held }) {
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
      note && el('div', { class: 'notice', text: note }),
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

  function openLogSheet(food, note, start = null) {
    const amountInput = openEntrySheet({
      title: food.name,
      note,
      amount: start?.amount ?? food.serving_amount,
      units: unitsFor(food),
      unit: start?.unit ?? normalizeUnit(food.serving_unit),
      ts: null,
      submitLabel: 'Log',
      compute: (amount, unit) => {
        const servings = servingsFor(food, amount, unit);
        return servings == null ? null : { servings, nutrients: scaleFood(food, servings) };
      },
      onSubmit: async (result) => {
        closeSheet();
        await saveNewEntry(food, result);
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

  function renderBadges(entry) {
    const badges = entryBadges(entry, getSettings().badgeThresholds);
    return badges.length ? el('div', { class: 'badges' }, badges.map((text) => el('span', { class: 'badge', text }))) : null;
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
      card.append(
        el('p', {
          class: 'muted',
          text: foods.length
            ? 'Nothing logged yet today.'
            : 'Nothing logged yet. Your foods list is empty: add or import foods on the Foods screen first.',
        }),
      );
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
        renderBadges(entry),
      );
      onLongPress(row, ({ held }) => openEditSheet(entry, held));
      card.append(row);
    }
    return card;
  }

  return { root, refresh };
}
