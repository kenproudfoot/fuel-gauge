// AI lookup settings: provider, address, API key and model. Everything here is
// stored only in this device's IndexedDB. The key is masked, never logged and
// never included in a backup.

import { el, toast } from './dom.js';
import { PRESETS, testConnection } from '../ai.js';

export function createAiCard({ getSettings, saveSettings }) {
  const current = getSettings().ai || {};
  const preset = el(
    'select',
    { class: 'big-input' },
    PRESETS.map((p) => el('option', { value: p.id, text: p.label, selected: p.id === (current.preset || 'openai') })),
  );
  const baseUrl = el('input', { class: 'big-input', type: 'url', value: current.baseUrl || '', autocapitalize: 'off', autocomplete: 'off', spellcheck: false, placeholder: 'https://…/v1' });
  const apiKey = el('input', { class: 'big-input', type: 'password', value: current.apiKey || '', autocapitalize: 'off', autocomplete: 'off', spellcheck: false, placeholder: 'paste your key' });
  const modelList = el('datalist', { id: 'ai-models' });
  const model = el('input', { class: 'big-input', type: 'text', value: current.model || '', autocapitalize: 'off', autocomplete: 'off', spellcheck: false, placeholder: 'tap Test to load the list' });
  model.setAttribute('list', 'ai-models');
  const modelPicker = el('select', { class: 'big-input', hidden: true, 'aria-label': 'Available models' });
  const status = el('p', { class: 'muted', role: 'status' });

  preset.addEventListener('change', () => {
    const chosen = PRESETS.find((p) => p.id === preset.value);
    if (chosen.id !== 'custom') baseUrl.value = chosen.baseUrl;
    model.value = chosen.model;
    modelPicker.hidden = true;
    status.textContent = '';
  });
  modelPicker.addEventListener('change', () => {
    if (modelPicker.value) model.value = modelPicker.value;
  });

  const read = () => ({ preset: preset.value, baseUrl: baseUrl.value.trim(), apiKey: apiKey.value.trim(), model: model.value.trim() });
  const save = async () => {
    const config = read();
    if (config.baseUrl && !/^https:\/\//i.test(config.baseUrl)) {
      status.textContent = 'The address must start with https://';
      return null;
    }
    await saveSettings({ ...getSettings(), ai: config });
    return config;
  };

  const testButton = el('button', {
    class: 'btn',
    type: 'button',
    text: 'Test AI connection',
    onclick: async () => {
      const config = await save();
      if (!config) return;
      testButton.disabled = true;
      status.textContent = 'Testing…';
      const result = await testConnection(config);
      testButton.disabled = false;
      status.textContent = result.message;
      if (result.models.length) {
        modelList.replaceChildren(...result.models.map((id) => el('option', { value: id })));
        modelPicker.replaceChildren(
          el('option', { value: '', text: `Pick from ${result.models.length} models…` }),
          ...result.models.map((id) => el('option', { value: id, text: id, selected: id === config.model })),
        );
        modelPicker.hidden = false;
      }
    },
  });

  return el(
    'form',
    {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        if (await save()) toast('AI settings saved');
      },
    },
    el('h2', { text: 'AI lookup' }),
    el('p', {
      class: 'muted',
      text: 'Looks up foods that are not in your list, reads label photos, and powers the chat. Only what you enter (food text, photos, chat messages, and in a chat the day\'s totals) is sent to the provider you choose. The key is kept on this phone only and is never put in a backup.',
    }),
    el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Provider' }), preset),
    el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Base URL' }), baseUrl),
    el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'API key' }), apiKey),
    el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Model' }), model, modelList),
    modelPicker,
    status,
    el('div', { class: 'row' }, testButton, el('button', { class: 'btn primary', type: 'submit', text: 'Save' })),
  );
}
