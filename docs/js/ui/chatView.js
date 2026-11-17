// Chat screen: talk to the AI about food without logging anything. An answer
// with values gets a "Log this…" button, which opens Quick entry on Today with
// those values filled in to check. The conversation lasts until "New chat" or
// the app is closed; it is never stored.

import { el } from './dom.js';
import { createChatPanel } from './chatPanel.js';
import { isConfigured } from '../ai.js';
import { generalChatPrompt, todayContext } from '../chat.js';
import { sumEntries } from '../nutrients.js';
import { foodDayKey } from '../day.js';

export function createChatView(context) {
  const { store, getSettings, goTo } = context;
  const aiConfig = () => getSettings().ai;

  const panel = createChatPanel({
    getConfig: aiConfig,
    systemPrompt: async () => {
      // Today's totals, so "can I fit this in?" has an answer.
      const entries = await store.listEntriesForDay(foodDayKey()).catch(() => []);
      return generalChatPrompt(todayContext(sumEntries(entries), getSettings().targets));
    },
    placeholder: 'Ask about a food…',
    hint: 'Ask anything about a food: what is in it, how two compare, whether it fits today. Nothing is logged unless you tap “Log this…” on an answer and then confirm it.',
    valuesLabel: 'Log this…',
    onValues: (values) => goTo('today', { quickEntry: values }),
  });

  const notSetUp = el(
    'div',
    { class: 'card' },
    el('p', { text: 'Chat uses AI lookup, which is not set up yet.' }),
    el('button', { class: 'btn', type: 'button', text: 'Set up AI lookup', onclick: () => goTo('settings') }),
  );

  const root = el(
    'section',
    { class: 'view chat-view' },
    el(
      'div',
      { class: 'card-head chat-head' },
      el('button', { class: 'btn small', type: 'button', text: '‹ Today', onclick: () => goTo('today') }),
      el('h2', { text: 'Ask AI' }),
      el('button', { class: 'btn small', type: 'button', text: 'New chat', onclick: () => panel.reset() }),
    ),
    notSetUp,
    el('div', { class: 'card' }, panel.root),
  );

  async function refresh() {
    const ready = isConfigured(aiConfig());
    notSetUp.hidden = ready;
    panel.root.parentElement.hidden = !ready;
  }

  return { root, refresh };
}
