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

export function toast(message, ms = 3000) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, ms);
}
