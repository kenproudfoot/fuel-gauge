// Pure command parser: typed or dictated text -> a structured command. No DOM.
//
//   parseInput('log 12gm of trader joe\'s candied pecans')
//     -> { type: 'log', amount: 12, unit: 'g', unitExplicit: true,
//          food: "trader joe's candied pecans", confident: true }
//
// Other results: { type: 'undo' }, { type: 'remaining' },
// { type: 'delete', query }, { type: 'unknown' }.
// A 'log' result with confident: false has no amount; the caller should ask.

import { normalizeUnit } from './units.js';

const UNIT_WORDS = [
  'grams', 'gram', 'gms', 'gm', 'g',
  'ounces', 'ounce', 'oz',
  'pounds', 'pound', 'lbs', 'lb',
  'cups', 'cup',
  'tablespoons', 'tablespoon', 'tbsps', 'tbsp',
  'teaspoons', 'teaspoon', 'tsps', 'tsp',
  'milliliters', 'milliliter', 'millilitres', 'millilitre', 'ml',
  'slices', 'slice', 'pieces', 'piece', 'servings', 'serving', 'each',
];
const UNIT_RE = new RegExp(`^(${UNIT_WORDS.join('|')})\\b\\.?\\s*`);

const SMALL = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const GLYPHS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
const PARTS = { half: 0.5, quarter: 0.25, third: 1 / 3 };

const PREFIX_RE = /^(?:please\s+)?(?:log|add|record|enter|i\s+just\s+had|i\s+just\s+ate|i\s+had|i\s+ate|i\s+drank|had|ate)\s+/;
const UNDO_RE = /^(?:undo|undo\s+(?:that|last|it|the\s+last\s+(?:entry|one))|scratch\s+that|(?:remove|delete)\s+(?:the\s+|my\s+)?last(?:\s+(?:entry|one|thing|item))?)$/;
const REMAINING_RE = /^(?:what(?:'s|s|\s+is)\s+(?:left|remaining)|what\s+do\s+i\s+have\s+left|how\s+much\s+(?:is\s+|do\s+i\s+have\s+)?left|(?:what's\s+)?remaining|left)$/;
const DELETE_RE = /^(?:delete|remove)\s+(?:the\s+|my\s+|that\s+)?(.+)$/;

function clean(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?,;]+$/, '')
    .trim();
}

/** Read a number written in words ("twenty five", "one hundred") from the start of s. */
function wordNumber(s) {
  const words = s.split(' ');
  let value = null;
  let used = 0;
  const peek = () => words[used];
  if (peek() in TENS) {
    value = TENS[words[used++]];
    if (peek() in SMALL && SMALL[peek()] > 0 && SMALL[peek()] < 10) value += SMALL[words[used++]];
  } else if (peek() in SMALL) {
    value = SMALL[words[used++]];
  } else if (/^(\w+)-(\w+)$/.test(peek() || '')) {
    const [tens, ones] = peek().split('-');
    if (tens in TENS && ones in SMALL && SMALL[ones] < 10) {
      value = TENS[tens] + SMALL[ones];
      used++;
    }
  }
  if (value == null) return null;
  if (peek() === 'hundred') {
    value *= 100;
    used++;
    if (peek() === 'and') used++;
    const rest = wordNumber(words.slice(used).join(' '));
    if (rest && rest.value < 100) {
      value += rest.value;
      used += rest.rest === '' ? words.length - used : words.length - used - rest.rest.split(' ').length;
    } else if (words[used - 1] === 'and') {
      used--;
    }
  }
  return { value, rest: words.slice(used).join(' ') };
}

/** Read an amount from the start of s. Returns { value, rest } or null. */
function readAmount(s) {
  let m;
  // "1 1/2", "1/2"
  if ((m = /^(\d+)\s+(\d+)\s*\/\s*(\d+)\b\s*/.exec(s)) && Number(m[3]) > 0) {
    return { value: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: s.slice(m[0].length) };
  }
  if ((m = /^(\d+)\s*\/\s*(\d+)\b\s*/.exec(s)) && Number(m[2]) > 0) {
    return { value: Number(m[1]) / Number(m[2]), rest: s.slice(m[0].length) };
  }
  // "12", "1.5", "1,5", "1½", ".5"
  if ((m = /^(\d+(?:[.,]\d+)?|\.\d+)\s*([½¼¾⅓⅔])?\s*/.exec(s))) {
    const value = Number(m[1].replace(',', '.')) + (m[2] ? GLYPHS[m[2]] : 0);
    return andPart({ value, rest: s.slice(m[0].length) });
  }
  if ((m = /^([½¼¾⅓⅔])\s*/.exec(s))) return { value: GLYPHS[m[1]], rest: s.slice(m[0].length) };

  // "half a", "half of a", "half"
  if ((m = /^half(?:\s+of)?(?:\s+an?)?\b\s*/.exec(s))) return { value: 0.5, rest: s.slice(m[0].length) };
  // "three quarters of a", "two thirds"
  if ((m = /^(two|three)\s+(quarters|thirds)(?:\s+of)?(?:\s+an?)?\b\s*/.exec(s))) {
    const part = m[2] === 'quarters' ? 0.25 : 1 / 3;
    return { value: SMALL[m[1]] * part, rest: s.slice(m[0].length) };
  }
  // "a half", "a quarter of a", "one third", "quarter"
  if ((m = /^(?:(?:a|an|one)\s+)?(half|quarter|third)(?:\s+of)?(?:\s+an?)?\b\s*/.exec(s))) {
    return { value: PARTS[m[1]], rest: s.slice(m[0].length) };
  }
  if ((m = /^(?:a\s+)?couple(?:\s+of)?\b\s*/.exec(s))) return { value: 2, rest: s.slice(m[0].length) };
  if ((m = /^(?:a\s+|one\s+)?dozen\b\s*/.exec(s))) return { value: 12, rest: s.slice(m[0].length) };
  if ((m = /^(?:a|an)\s+hundred\b\s*/.exec(s))) return { value: 100, rest: s.slice(m[0].length) };

  const words = wordNumber(s);
  if (words) return andPart(words);
  if ((m = /^(?:a|an)\s+/.exec(s))) return { value: 1, rest: s.slice(m[0].length), article: true };
  return null;
}

/** "... and a half", "... and three quarters" after a whole number. */
function andPart(amount) {
  let m;
  if ((m = /^and\s+(?:a\s+|one\s+)?(half|quarter|third)\b\s*/.exec(amount.rest))) {
    return { value: amount.value + PARTS[m[1]], rest: amount.rest.slice(m[0].length) };
  }
  if ((m = /^and\s+three\s+quarters\b\s*/.exec(amount.rest))) {
    return { value: amount.value + 0.75, rest: amount.rest.slice(m[0].length) };
  }
  return amount;
}

function tidyFood(text) {
  return text
    .replace(/^of\s+/, '')
    .replace(/^(?:a|an|the|some|my)\s+/, '')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
}

function logResult(amount, unitWord, food) {
  return {
    type: 'log',
    amount: Math.round(amount * 1000) / 1000,
    unit: unitWord ? normalizeUnit(unitWord) : 'each',
    unitExplicit: Boolean(unitWord), // false for a bare count such as "2 eggs"
    food,
    confident: true,
  };
}

/** Parse one line of typed or dictated input. */
export function parseInput(text) {
  const s = clean(text);
  if (!s) return { type: 'unknown' };

  if (UNDO_RE.test(s)) return { type: 'undo' };
  if (REMAINING_RE.test(s)) return { type: 'remaining' };
  const del = DELETE_RE.exec(s);
  if (del) return { type: 'delete', query: tidyFood(del[1]) };

  const body = s.replace(PREFIX_RE, '').trim();
  // A bare command word with nothing after it ("log") is not a food.
  if (!body || /^(?:please|log|add|record|enter)$/.test(body)) return { type: 'unknown' };

  // Leading form: "12 g of pecans", "half a banana", "a cup and a half of rice"
  const amount = readAmount(body);
  if (amount && amount.value > 0) {
    let rest = amount.rest;
    let value = amount.value;
    let unitWord = null;
    const unit = UNIT_RE.exec(rest);
    if (unit) {
      unitWord = unit[1];
      rest = rest.slice(unit[0].length);
      const extra = andPart({ value, rest });
      value = extra.value;
      rest = extra.rest;
    }
    const food = tidyFood(rest);
    if (food) return logResult(value, unitWord, food);
    // An amount with nothing after it ("12 grams") is not a loggable command.
    if (!amount.article) return { type: 'unknown' };
  }

  // Trailing form: "candied pecans 12 grams", "toast, 2 slices"
  const trailing = /^(.+?)[,\s]+(\d+(?:[.,]\d+)?)\s*([a-z]+)$/.exec(body);
  if (trailing && UNIT_WORDS.includes(trailing[3])) {
    const food = tidyFood(trailing[1]);
    if (food) return logResult(Number(trailing[2].replace(',', '.')), trailing[3], food);
  }

  // No amount found: we know the food but must ask how much.
  const food = tidyFood(body);
  if (!food) return { type: 'unknown' };
  return { type: 'log', amount: null, unit: null, unitExplicit: false, food, confident: false };
}
