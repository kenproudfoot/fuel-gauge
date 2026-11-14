// USDA lookup settings: one API key, stored only in this device's IndexedDB.
// The key is masked, never logged and never included in a backup.

import { el, toast } from './dom.js';
import { testUsdaKey, USDA_SIGNUP_URL } from '../usda.js';

export function createUsdaCard({ getSettings, saveSettings }) {
  const current = getSettings().usda || {};
  const apiKey = el('input', {
    class: 'big-input',
    type: 'password',
    value: current.apiKey || '',
    autocapitalize: 'off',
    autocomplete: 'off',
    spellcheck: false,
    placeholder: 'paste your USDA key',
  });
  const status = el('p', { class: 'muted', role: 'status' });

  const save = async () => {
    const config = { apiKey: apiKey.value.trim() };
    await saveSettings({ ...getSettings(), usda: config });
    return config;
  };

  const testButton = el('button', {
    class: 'btn',
    type: 'button',
    text: 'Test USDA key',
    onclick: async () => {
      const config = await save();
      if (!config.apiKey) {
        status.textContent = 'Paste a key first.';
        return;
      }
      testButton.disabled = true;
      status.textContent = 'Testing…';
      const result = await testUsdaKey(config);
      testButton.disabled = false;
      status.textContent = result.message;
    },
  });

  return el(
    'form',
    {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        await save();
        toast('USDA settings saved');
      },
    },
    el('h2', { text: 'USDA lookup' }),
    el('p', {
      class: 'muted',
      text: 'Looks up foods that are not in your list in USDA FoodData Central: the manufacturer’s label values for packaged foods, and USDA’s own data for plain foods, each with a link to the record. Only the food words you enter are sent. With a key here, USDA is searched first and AI only fills what USDA lacks.',
    }),
    el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'USDA API key' }), apiKey),
    el('a', { class: 'muted small-text', href: USDA_SIGNUP_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Get a free key from USDA (it arrives by email)' }),
    status,
    el('div', { class: 'row' }, testButton, el('button', { class: 'btn primary', type: 'submit', text: 'Save' })),
  );
}
