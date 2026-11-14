// Pure fuzzy matching of a spoken food name against names and aliases. No DOM.

const STRONG = 0.8; // good enough to log without asking...
const CLEAR_LEAD = 0.1; // ...if it also beats the runner-up by this much
const CANDIDATE = 0.55; // worth offering as a choice

function singular(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ches|shes|sses|xes|oes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Lowercase words without punctuation, plurals folded ("Joe's Pecans" -> ["joes", "pecan"]). */
export function tokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singular);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** How alike two words are, 0..1: exact, a prefix, or a near miss (typo / mis-heard). */
function wordScore(a, b) {
  if (a === b) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return 0.9;
  if (short.length < 4) return 0;
  const similarity = 1 - levenshtein(a, b) / long.length;
  return similarity >= 0.75 ? similarity * 0.9 : 0;
}

/** Share of the words in `from` that have a counterpart in `to`, weighted by closeness. */
function coverage(from, to) {
  if (from.length === 0) return 0;
  let total = 0;
  for (const word of from) total += Math.max(0, ...to.map((other) => wordScore(word, other)));
  return total / from.length;
}

/** Similarity of a spoken phrase to one candidate name, 0..1. */
export function scoreName(query, name) {
  const q = tokens(query);
  const n = tokens(name);
  if (q.length === 0 || n.length === 0) return 0;
  if (q.join(' ') === n.join(' ')) return 1;
  const queryCovered = coverage(q, n); // did everything I said appear in the name?
  const nameCovered = coverage(n, q); // did I say everything in the name?
  // Extra words on either side (a brand, an adjective) cost a little, not a lot.
  return 0.7 * Math.max(queryCovered, nameCovered) + 0.3 * Math.min(queryCovered, nameCovered);
}

/** Best score of a food across its name and aliases. */
export function scoreFood(query, food) {
  return Math.max(scoreName(query, food.name), ...(food.aliases || []).map((alias) => scoreName(query, alias)));
}

/**
 * Match a phrase against foods.
 *   status 'strong'  -> matches[0] is the one; log it
 *   status 'choices' -> several close; let the user pick
 *   status 'none'    -> nothing close
 */
export function matchFoods(query, foods, limit = 5) {
  const matches = foods
    .map((food) => ({ food, score: scoreFood(query, food) }))
    .filter((m) => m.score >= CANDIDATE)
    .sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name))
    .slice(0, limit);
  if (matches.length === 0) return { status: 'none', matches };
  const [best, second] = matches;
  const strong = best.score >= STRONG && (!second || best.score - second.score >= CLEAR_LEAD);
  return { status: strong ? 'strong' : 'choices', matches };
}
