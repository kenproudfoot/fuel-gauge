// App shell: boots storage, builds the screens, handles the tab bar.

import { store } from './store.js';
import { mergeSettings } from './nutrients.js';
import { el } from './ui/dom.js';
import { createTodayView } from './ui/today.js';
import { createFoodsView } from './ui/foods.js';
import { createSettingsView } from './ui/settings.js';

const main = document.getElementById('main');
const tabs = document.getElementById('tabs');

let settings = mergeSettings(null);
let storageInfo = { persisted: null };
let views = {};
let current = 'today';

async function goTo(name) {
  current = name;
  for (const button of tabs.querySelectorAll('button')) {
    button.setAttribute('aria-current', button.dataset.view === name ? 'page' : 'false');
  }
  main.replaceChildren(views[name].root);
  window.scrollTo(0, 0);
  await views[name].refresh();
}

async function boot() {
  try {
    storageInfo = await store.init();
    settings = mergeSettings(await store.getSettings());
  } catch (error) {
    main.replaceChildren(
      el(
        'div',
        { class: 'card' },
        el('h2', { text: 'Storage is unavailable' }),
        el('p', {
          class: 'muted',
          text: 'Fuel Gauge could not open its on-device storage. Private Browsing blocks it; open the app in a normal Safari tab or from the Home Screen.',
        }),
        el('p', { class: 'muted', text: String(error?.message || error) }),
      ),
    );
    return;
  }

  const context = {
    store,
    goTo,
    getSettings: () => settings,
    saveSettings: async (next) => {
      await store.saveSettings(next);
      settings = next;
    },
    storageInfo: () => storageInfo,
  };
  views = {
    today: createTodayView(context),
    foods: createFoodsView(context),
    settings: createSettingsView(context),
  };

  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-view]');
    if (button) goTo(button.dataset.view);
  });

  // Coming back to the app may have crossed the 2 AM rollover.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && current === 'today') views.today.refresh();
  });

  await goTo('today');
}

boot();
