// Settings screen: targets and bar colors. Saved in IndexedDB on this device.

import { el, parseNumber, toast } from './dom.js';
import { NUTRIENTS, DEFAULT_SETTINGS, mergeSettings } from '../nutrients.js';
import { APP_VERSION } from '../version.js';

export function createSettingsView({ getSettings, saveSettings, storageInfo }) {
  const root = el('section', { class: 'view' });

  async function refresh() {
    render(getSettings());
  }

  function render(settings) {
    const targetInputs = {};
    const colorInputs = {};
    for (const n of NUTRIENTS) {
      targetInputs[n.key] = el('input', {
        class: 'big-input',
        type: 'text',
        inputMode: 'decimal',
        value: String(settings.targets[n.key]),
        'aria-label': `${n.name} target`,
      });
      colorInputs[n.key] = el('input', {
        class: 'color-input',
        type: 'color',
        value: settings.colors[n.key],
        'aria-label': `${n.name} color`,
      });
    }
    const proteinMin = el('input', {
      class: 'big-input',
      type: 'text',
      inputMode: 'decimal',
      value: settings.proteinMin == null ? '' : String(settings.proteinMin),
      placeholder: 'not set',
    });
    const errorBox = el('div', { class: 'notice', hidden: true });

    const save = async (e) => {
      e.preventDefault();
      const errors = [];
      const next = mergeSettings(settings);
      for (const n of NUTRIENTS) {
        const value = parseNumber(targetInputs[n.key].value);
        if (!(value > 0)) errors.push(`${n.name} target must be more than 0.`);
        next.targets[n.key] = value;
        next.colors[n.key] = colorInputs[n.key].value;
      }
      if (proteinMin.value.trim() === '') {
        next.proteinMin = null;
      } else {
        const min = parseNumber(proteinMin.value);
        if (!(min > 0)) errors.push('Protein minimum must be more than 0, or blank.');
        else if (min >= next.targets.protein_g) errors.push('Protein minimum must be below the protein limit.');
        next.proteinMin = min;
      }
      if (errors.length) {
        errorBox.replaceChildren(...errors.map((message) => el('div', { text: message })));
        errorBox.hidden = false;
        return;
      }
      await saveSettings(next);
      toast('Settings saved');
      render(next);
    };

    const info = storageInfo();
    root.replaceChildren(
      el(
        'form',
        { class: 'card', onsubmit: save },
        el('h2', { text: 'Daily targets & colors' }),
        NUTRIENTS.map((n) =>
          el(
            'div',
            { class: 'target-row' },
            el(
              'label',
              { class: 'field' },
              el('span', {
                class: 'field-label',
                text: `${n.letter} · ${n.name} (${n.unit}) · ${n.type === 'goal' ? 'goal' : 'limit'}`,
              }),
              targetInputs[n.key],
            ),
            colorInputs[n.key],
          ),
        ),
        el(
          'label',
          { class: 'field' },
          el('span', { class: 'field-label', text: 'Protein minimum (g), optional' }),
          proteinMin,
        ),
        errorBox,
        el('button', { class: 'btn primary', type: 'submit', text: 'Save settings' }),
        el('button', {
          class: 'btn',
          type: 'button',
          text: 'Reset targets & colors to defaults',
          onclick: async () => {
            const next = mergeSettings({
              ...settings,
              targets: { ...DEFAULT_SETTINGS.targets },
              colors: { ...DEFAULT_SETTINGS.colors },
              proteinMin: null,
            });
            await saveSettings(next);
            toast('Defaults restored');
            render(next);
          },
        }),
      ),
      el(
        'div',
        { class: 'card' },
        el('h2', { text: 'About' }),
        el('p', { class: 'muted', text: `Fuel Gauge ${APP_VERSION}` }),
        el('p', {
          class: 'muted',
          text:
            info.persisted === true
              ? 'Storage: protected. The browser will not clear your data on its own.'
              : 'Storage: not yet protected. Add the app to your Home Screen and open it from there.',
        }),
        el('p', { class: 'muted', text: 'All data stays on this device.' }),
      ),
    );
  }

  return { root, refresh };
}
