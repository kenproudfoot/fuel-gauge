// A chat with the configured AI: message bubbles, a text box, and an optional
// image (attached, or pasted). Used beside the confirm card, in Quick entry and
// on the Chat screen. When a reply carries values, its bubble gets a button
// that hands them to `onValues`; nothing is logged from here.

import { el } from './dom.js';
import { photoToDataUrl } from './files.js';
import { askChat, valuesSummary } from '../chat.js';

const IMAGE_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="1.8" fill="currentColor"/><path d="M4 17l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

/** The first image file in a paste or drop, if any. */
export function imageFromClipboard(data) {
  for (const item of data?.items || []) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return [...(data?.files || [])].find((f) => f.type.startsWith('image/')) || null;
}

/** "**bold**" inside a line, as text nodes and <strong>; never innerHTML. */
function inline(line) {
  return line.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) => (/^\*\*[^*]+\*\*$/.test(part) ? el('strong', { text: part.slice(2, -2) }) : part));
}

/** Plain prose with "- " bullets and paragraphs. */
export function renderProse(text) {
  const nodes = [];
  let list = null;
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.trim();
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      list ||= el('ul', { class: 'chat-list' });
      list.append(el('li', {}, inline(bullet[1].replace(/^#+\s*/, ''))));
      continue;
    }
    if (list) nodes.push(list);
    list = null;
    if (line) nodes.push(el('p', {}, inline(line.replace(/^#+\s*/, ''))));
  }
  if (list) nodes.push(list);
  return nodes;
}

/**
 * options:
 *   getConfig()        the AI settings
 *   systemPrompt()     (may be async) the system prompt, rebuilt on every send
 *   placeholder        text box hint
 *   hint               shown above the box while the chat is empty
 *   valuesLabel        button label on a reply with values ("Fill in these values")
 *   onValues(values)   called when that button is tapped
 *   first              { text, image } sent straight away
 */
export function createChatPanel({ getConfig, systemPrompt, placeholder = 'Ask about a food…', hint, valuesLabel, onValues, first }) {
  const history = []; // what the model sees
  let attached = null; // data: URL of an image waiting to be sent
  let abort = null;

  const log = el('div', { class: 'chat-log', 'aria-live': 'polite' });
  const hintLine = hint ? el('p', { class: 'muted small-text', text: hint }) : null;
  const box = el('textarea', { class: 'big-input chat-box', rows: 2, placeholder, autocapitalize: 'sentences', 'aria-label': 'Message' });
  const thumb = el('div', { class: 'chat-attach', hidden: true });
  const fileInput = el('input', { class: 'visually-hidden', type: 'file', accept: 'image/*', tabIndex: -1, 'aria-hidden': 'true' });
  const imageButton = el('button', { class: 'btn chat-icon', type: 'button', 'aria-label': 'Add a photo', onclick: () => fileInput.click() });
  imageButton.innerHTML = IMAGE_ICON; // static markup defined above
  const sendButton = el('button', { class: 'btn primary', type: 'button', text: 'Send', onclick: () => send(box.value, attached) });

  async function attach(file) {
    if (!file) return;
    try {
      setAttached(await photoToDataUrl(file));
    } catch {
      bubble('note', 'That image could not be opened.');
    }
  }
  function setAttached(dataUrl) {
    attached = dataUrl;
    thumb.hidden = !dataUrl;
    thumb.replaceChildren(
      ...(dataUrl
        ? [el('img', { src: dataUrl, alt: 'Photo to send' }), el('button', { class: 'btn small', type: 'button', text: 'Remove', onclick: () => setAttached(null) })]
        : []),
    );
  }
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    attach(file);
  });
  box.addEventListener('paste', (event) => {
    const file = imageFromClipboard(event.clipboardData);
    if (!file) return; // ordinary text paste
    event.preventDefault();
    attach(file);
  });
  // On a Mac, Return sends and Shift-Return starts a new line. On a phone Return is a new line.
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && matchMedia('(pointer: fine)').matches) {
      event.preventDefault();
      send(box.value, attached);
    }
  });

  function bubble(kind, ...children) {
    const node = el('div', { class: `chat-msg ${kind}` }, children);
    log.append(node);
    if (hintLine) hintLine.hidden = true;
    requestAnimationFrame(() => node.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    return node;
  }

  function replyBubble({ text, values }) {
    const button =
      values && onValues
        ? el('button', {
            class: 'btn small',
            type: 'button',
            text: valuesLabel || 'Use these values',
            onclick: () => onValues(values),
          })
        : null;
    return bubble(
      'ai',
      renderProse(text || (values ? 'Here are the values.' : '')),
      values && el('div', { class: 'chat-values' }, values.name && el('strong', { text: values.name }), el('div', { class: 'small-text', text: valuesSummary(values) }), button),
    );
  }

  async function send(text, image) {
    const words = String(text || '').trim();
    if (!words && !image) return;
    if (abort) return;
    const content = image ? [{ type: 'text', text: words || 'What is this, and what are its values?' }, { type: 'image_url', image_url: { url: image } }] : words;
    history.push({ role: 'user', content });
    bubble('me', image && el('img', { class: 'chat-photo', src: image, alt: 'Your photo' }), words && el('p', { text: words }));
    box.value = '';
    setAttached(null);

    const controller = new AbortController();
    abort = controller;
    sendButton.disabled = true;
    const waiting = bubble('ai pending', el('p', { class: 'muted', text: 'Thinking…' }), el('button', { class: 'btn small', type: 'button', text: 'Cancel', onclick: () => controller.abort() }));
    try {
      const reply = await askChat(getConfig(), await systemPrompt(), history, { signal: controller.signal });
      waiting.remove();
      history.push({ role: 'assistant', content: reply.raw });
      replyBubble(reply);
    } catch (error) {
      waiting.remove();
      // Take the message back, so it can be sent again as it was.
      history.pop();
      log.lastElementChild?.remove();
      box.value = words;
      if (image) setAttached(image);
      if (error.kind !== 'cancelled') bubble('note', error.message || 'The AI could not be reached.');
    } finally {
      abort = null;
      sendButton.disabled = false;
    }
  }

  // Not a <form>: the panel often sits inside the confirm card, which is one.
  const form = el('div', { class: 'chat-form' }, thumb, box, el('div', { class: 'chat-actions' }, imageButton, fileInput, sendButton));
  const root = el('div', { class: 'chat-panel' }, log, hintLine, form);

  function reset() {
    abort?.abort();
    history.length = 0;
    log.replaceChildren();
    if (hintLine) hintLine.hidden = false;
    box.value = '';
    setAttached(null);
  }

  if (first) queueMicrotask(() => send(first.text, first.image));
  return { root, reset, send, focus: () => box.focus() };
}
