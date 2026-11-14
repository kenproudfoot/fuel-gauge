// App shell: boots storage, builds the screens, handles the tab bar.

import { store } from './store.js';
import { mergeSettings } from './nutrients.js';
import { el } from './ui/dom.js';
import { createTodayView } from './ui/today.js';
import { createFoodsView } from './ui/foods.js';
import { createSettingsView } from './ui/settings.js';
import { createHistoryView } from './ui/history.js';
import { finalizePastDays } from './ui/finalize.js';
import { foodDayKey } from './day.js';

const main = document.getElementById('main');
const tabs = document.getElementById('tabs');

let settings = mergeSettings(null);
let storageInfo = { persisted: null };
let views = {};
let current = 'today';

async function goTo(name, params) {
  current = name;
  for (const button of tabs.querySelectorAll('button')) {
    button.setAttribute('aria-current', button.dataset.view === name ? 'page' : 'false');
  }
  main.replaceChildren(views[name].root);
  window.scrollTo(0, 0);
  await views[name].refresh(params);
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
    history: createHistoryView(context),
    foods: createFoodsView(context),
    settings: createSettingsView(context),
  };

  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-view]');
    if (button) goTo(button.dataset.view);
  });

  // There is no background process: past days are filed whenever the app is
  // opened, comes back to the front, or sits open across the 2 AM rollover.
  let shownDay = foodDayKey();
  const catchUp = async () => {
    const day = foodDayKey();
    const rolledOver = day !== shownDay;
    shownDay = day;
    const filed = await finalizePastDays(context).catch(() => 0);
    if ((rolledOver || filed > 0) && (current === 'today' || current === 'history')) await views[current].refresh();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (current === 'today') views.today.refresh();
    catchUp();
  });
  setInterval(catchUp, 60000);

  await goTo('today');
  catchUp();
}

/**
 * Offline support and updates. A new version downloads in the background and
 * waits; nothing changes until the banner is tapped.
 */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Skipped on a dev machine so edits show up on reload; add ?sw=1 to test it locally.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (local && !new URLSearchParams(location.search).has('sw')) return;

  const banner = document.getElementById('update-banner');
  try {
    const registration = await navigator.serviceWorker.register('sw.js');
    const offer = (worker) => {
      // No controller means this is the first install, not an update.
      if (!worker || !navigator.serviceWorker.controller) return;
      banner.hidden = false;
      banner.onclick = () => {
        banner.disabled = true;
        worker.postMessage('SKIP_WAITING');
      };
    };
    offer(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') offer(worker);
      });
    });

    let reloading = false;
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });

    // A Home Screen app can stay open for days; look for updates whenever it comes back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  } catch {
    // Offline support is a bonus; the app still works without it.
  }
}

boot();
registerServiceWorker();
