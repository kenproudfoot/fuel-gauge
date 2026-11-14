// Tiny DOM helpers. Text always goes in via textContent, never innerHTML.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return node;
}

/** Parse a typed number, accepting a decimal comma. NaN when blank or invalid. */
export function parseNumber(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  return t === '' ? NaN : Number(t);
}

let toastTimer = null;

export function hideToast() {
  clearTimeout(toastTimer);
  document.getElementById('toast').hidden = true;
}

/**
 * Show a short message at the top of the screen.
 * options: { ms = 3000, actionLabel, onAction } adds a button such as "Undo".
 */
export function toast(message, options = {}) {
  const { ms = 3000, actionLabel, onAction } = options;
  const node = document.getElementById('toast');
  node.replaceChildren(el('span', { class: 'toast-text', text: message }));
  if (actionLabel && onAction) {
    node.append(
      el('button', {
        class: 'toast-action',
        type: 'button',
        text: actionLabel,
        onclick: () => {
          hideToast();
          onAction();
        },
      }),
    );
  }
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}

/**
 * Call handler when the node is pressed and held (touch or mouse), or
 * right-clicked, or activated with Enter. Scrolling or moving cancels the hold.
 * The handler receives { held: true } when the finger is still down.
 */
export function onLongPress(node, handler, ms = 500) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  let firedAt = 0;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    node.classList.remove('pressing');
  };
  node.addEventListener('pointerdown', (event) => {
    if (event.button > 0 || event.target.closest('button, a, input, select')) return;
    startX = event.clientX;
    startY = event.clientY;
    node.classList.add('pressing');
    clearTimeout(timer);
    timer = setTimeout(() => {
      cancel();
      firedAt = Date.now();
      handler({ held: true });
    }, ms);
  });
  node.addEventListener('pointermove', (event) => {
    if (timer && Math.hypot(event.clientX - startX, event.clientY - startY) > 10) cancel();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(type, cancel);
  node.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    cancel();
    if (Date.now() - firedAt > 1000) handler({ held: false });
  });
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target === node) handler({ held: false });
  });
}
