// Retakes the README screenshots in screenshots/ with made-up demo data and mocked lookups.
// Usage: npm run serve (in another terminal), then
//   OUT=screenshots FIXTURES=tests/fixtures node tools/readme-shots.mjs
// Needs Google Chrome at the macOS default path and Node 22+ (built-in WebSocket).
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const here = path.dirname(new URL(import.meta.url).pathname);
const profile = path.join(os.tmpdir(), 'fuel-gauge-shots-profile');
rmSync(profile, { recursive: true, force: true });
const PORT = 9333;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--window-size=390,844', 'about:blank',
], { stdio: 'ignore' });
// Never leave a headless Chrome behind, even when a step fails.
process.on('exit', () => chrome.kill());
process.on('uncaughtException', (error) => { console.error(error); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
const problems = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') problems.push('EXCEPTION ' + JSON.stringify(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) problems.push('LOG ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') problems.push('CONSOLE ' + JSON.stringify(msg.params.args.map((a) => a.value || a.description)));
};
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails.exception?.description));
  return r.result.result.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(here, name), Buffer.from(r.result.data, 'base64'));
};
import { readFileSync, mkdirSync } from 'node:fs';
const OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const size = (height) => send('Emulation.setDeviceMetricsOverride', { width: 390, height, deviceScaleFactor: 2, mobile: true });
const snap = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64')); };
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
// A settable clock: 5:00 PM on Nov 14, 2026.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const Real = Date; globalThis.__t = new Real(2026, 10, 14, 17, 0).getTime();
  class FakeDate extends Real { constructor(...a) { super(...(a.length ? a : [globalThis.__t])); } static now() { return globalThis.__t; } }
  globalThis.Date = FakeDate; })();` });
await send('Page.navigate', { url: 'http://localhost:8080/' });
await sleep(1500);
const helpers = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (sel, text) => { const n = [...document.querySelectorAll(sel)].find((x) => !text || x.textContent.includes(text)); if (!n) throw new Error('no ' + sel + ' ' + text); n.click(); };
  const cmd = async (text, ms = 900) => { const i = document.querySelector('.command-input'); i.value = text; i.dispatchEvent(new Event('input', { bubbles: true })); await wait(50); i.form.requestSubmit(); await wait(ms); };
  const hideToast = () => { document.getElementById('toast').hidden = true; };
  const until = async (sel, ms = 8000) => { for (let t = 0; t < ms && !document.querySelector(sel); t += 100) await wait(100); if (!document.querySelector(sel)) throw new Error('timed out waiting for ' + sel); };
  const top = (sel) => window.scrollTo(0, document.querySelector(sel).getBoundingClientRect().top + window.scrollY - 8);
`;
// Demo foods: [name, amount, unit, kcal, protein, Na, K, P, effective carbs]
const foods = [
  ['Oatmeal', 1, 'cup', 166, 6, 9, 164, 180, 20],
  ['Blueberries', 0.5, 'cup', 42, 0.5, 1, 57, 9, 8],
  ['Candied pecans', 12, 'g', 80, 1, 10, 50, 30, 5],
  ['Turkey sandwich', 1, 'each', 420, 18, 700, 300, 200, 40],
  ['Apple', 1, 'each', 95, 0.5, 2, 195, 20, 21],
  ['Rice crackers', 10, 'each', 140, 2, 90, 40, 40, 28],
  ['Banana smoothie', 1, 'each', 520, 8, 150, 350, 150, 70],
  ['White rice', 1, 'cup', 205, 4.3, 2, 55, 68, 44],
  ['Chicken thigh', 3, 'oz', 180, 21, 80, 210, 170, 0],
  ['Butter cookies', 2, 'each', 140, 1.5, 90, 20, 20, 18],
  ['Canned soup', 1, 'cup', 120, 4, 890, 180, 60, 14],
  ['Bagel with cream cheese', 1, 'each', 390, 11, 520, 140, 120, 55],
];
const today = [[7, 20, 0], [7, 20, 1], [10, 30, 2], [12, 15, 3], [12, 15, 4], [15, 0, 5], [16, 40, 6]];
const past = {
  1: [[8, 0, 11], [12, 30, 3], [15, 0, 9], [18, 30, 7], [18, 45, 6], [20, 0, 5], [20, 30, 4], [21, 0, 2]],
  2: [[7, 30, 0], [12, 0, 10], [12, 0, 10], [15, 0, 11], [18, 0, 7], [20, 0, 9], [21, 0, 6]],
  3: [[8, 0, 0], [8, 0, 1], [12, 0, 4], [12, 0, 2], [15, 0, 5], [19, 0, 7], [19, 0, 8], [20, 30, 6], [21, 0, 9]],
  4: [[9, 0, 11], [13, 0, 3], [19, 0, 7], [19, 30, 6], [20, 30, 9], [21, 0, 9]],
  5: [[7, 0, 0], [7, 0, 1], [12, 0, 4], [12, 0, 2], [13, 0, 7], [16, 0, 6], [19, 0, 9], [20, 0, 5], [21, 0, 6]],
};
await evaluate(`
  const db = await new Promise((res) => { const r = indexedDB.open('fuel-gauge'); r.onsuccess = () => res(r.result); });
  const put = (s, rec) => new Promise((res) => { const r = db.transaction(s, 'readwrite').objectStore(s).put(rec); r.onsuccess = res; });
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const foods = ${JSON.stringify(foods)};
  for (const [i, f] of foods.entries()) {
    const [name, amount, unit, calories, protein_g, sodium_mg, potassium_mg, phosphorus_mg, effective_carbs_g] = f;
    await put('foods', { id: 'demo' + i, name, aliases: [], serving_amount: amount, serving_unit: unit, grams_per_serving: null, calories, protein_g, sodium_mg, potassium_mg, phosphorus_mg, effective_carbs_g, phosphate_additives: false, source: 'me', notes: '', createdAt: 1, updatedAt: 1 });
  }
  const days = { 0: ${JSON.stringify(today)}, ...${JSON.stringify(past)} };
  let n = 0;
  for (const [back, list] of Object.entries(days)) for (const [h, m, fi] of list) {
    const d = new Date(2026, 10, 14 - Number(back), h, m);
    const [name, amount, unit, calories, protein_g, sodium_mg, potassium_mg, phosphorus_mg, effective_carbs_g] = foods[fi];
    await put('entries', { id: 'e' + (n++), ts: d.getTime(), createdAt: d.getTime(), day: dayKey(d), foodId: 'demo' + fi, foodName: name, amount, unit, servings: 1,
      nutrients: { calories, protein_g, sodium_mg, potassium_mg, phosphorus_mg, effective_carbs_g }, source: 'me', estimated: false, phosphate_additives: false, deleted: false, history: [] });
  }
  await new Promise((res) => { const r = db.transaction('kv', 'readwrite').objectStore('kv').put(new Date(2026, 10, 13, 21, 0).getTime(), 'meta:lastBackupAt'); r.onsuccess = res; });`);
await send('Page.reload'); await sleep(2500);

// 1. Today, on pace.
await size(1250); await sleep(300);
await evaluate(`${helpers} hideToast(); window.scrollTo(0, 0);`); await snap('today.png');
await size(844); await sleep(300);
// 2. Trend details.
await evaluate(`${helpers} click('.trend'); await wait(500); window.scrollTo(0, document.querySelector('.command').nextElementSibling.getBoundingClientRect().top + window.scrollY - 330);`); await snap('trend-details.png');

// Mocked network for the lookups (fixture data, no real keys).
const fx = (n) => readFileSync(path.join(process.env.FIXTURES, n), 'utf8');
await evaluate(`
  const SEARCH = ${fx('fdc-search.json')}; const OLD = ${fx('fdc-branded-old.json')}; const NEW = ${fx('fdc-branded.json')};
  const real = window.fetch.bind(window);
  const block = (v) => '\\n\\n\u0060\u0060\u0060values\\n' + JSON.stringify(v) + '\\n\u0060\u0060\u0060';
  const SANDWICH = [
    'Here is how that sandwich adds up:',
    '- **Rye bread**, 2 slices (64 g): 166 kcal, P 5.4 g, S 386 mg, K 106 mg, H 80 mg, 27 g carbs after fiber',
    '- **Deli turkey**, 2 oz: 60 kcal, P 10 g, S 560 mg, K 140 mg, H 140 mg. Deli meats usually contain phosphate additives',
    '- **Swiss cheese**, 1 slice (28 g): 106 kcal, P 7.6 g, S 54 mg, K 22 mg, H 160 mg',
    '- **Yellow mustard**, 1 tsp: 3 kcal, S 57 mg',
    '',
    'Totals are from USDA FoodData Central entries for each part. Sodium depends most on the turkey brand, so check its label if you have it.',
  ].join('\\n') + block({ name: 'Turkey & swiss on rye', amount: 1, unit: 'each', calories: 335, protein_g: 23, sodium_mg: 1057, potassium_mg: 275, phosphorus_mg: 384, total_carbs_g: 32.7, fiber_g: 3.9, phosphate_additives: true });
  const CHEDDAR = [
    'A 1 oz (28 g) slice of cheddar has about **129 mg phosphorus** (USDA FoodData Central, cheddar cheese).',
    '- Swiss is higher, about 160 mg a slice',
    '- Fresh mozzarella is lower, about 100 mg per ounce',
    '- Processed American slices often have phosphate additives, which are absorbed more easily',
    '',
    'You have about 360 mg of phosphorus left today, so one slice fits.',
  ].join('\\n') + block({ name: 'Cheddar cheese', amount: 1, unit: 'slice', calories: 113, protein_g: 7, sodium_mg: 180, potassium_mg: 27, phosphorus_mg: 129, total_carbs_g: 0.4, fiber_g: 0, phosphate_additives: false });
  const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.nal.usda.gov/')) { const p = new URL(u); if (p.pathname.endsWith('/foods/search')) return json(SEARCH); return json(p.pathname.endsWith('/752908') ? OLD : NEW); }
    if (u.startsWith('https://api.openai.com/')) {
      const body = JSON.parse(init.body || '{}');
      // Chat replies: prose with a values block, the way the real prompt asks for them.
      if (/assistant inside Fuel Gauge/.test(body.messages[0].content)) {
        const last = JSON.stringify(body.messages.at(-1).content);
        const reply = /cheddar/i.test(last) ? CHEDDAR : SANDWICH;
        await new Promise((r) => setTimeout(r, 150));
        return json({ choices: [{ message: { role: 'assistant', content: reply } }] });
      }
      const reply = { name: 'Thick & Fluffy waffles', serving_amount: 1, serving_unit: 'each', grams_per_serving: 55, calories: 160, protein_g: 3, sodium_mg: 270, potassium_mg: 30, phosphorus_mg: null, total_carbs_g: 22, fiber_g: 0.5, ingredients_visible: true, phosphate_additives: true, notes: '' };
      return json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(reply) } }] });
    }
    return real(url, init);
  };`);
await evaluate(`${helpers} click('#tabs button', 'Settings'); await wait(500);
  const card = (t) => [...document.querySelectorAll('.card')].find((c) => c.querySelector('h2')?.innerText === t);
  { const c = card('USDA lookup'); c.querySelector('input').value = 'DEMO-KEY'; [...c.querySelectorAll('button')].find((b) => b.innerText === 'Save').click(); await wait(400); }
  { const c = card('AI lookup'); const [url, key, model] = c.querySelectorAll('input.big-input'); key.value = 'demo-key'; model.value = 'demo-model'; [...c.querySelectorAll('button')].find((b) => b.innerText === 'Save').click(); await wait(400); }
  click('#tabs button', 'Today'); await wait(500);`);

// 3. USDA matches, then the confirm card.
await evaluate(`${helpers} hideToast(); await cmd('2 eggo thick and fluffy waffles', 1500); top('.command'); `); await snap('usda-matches.png');
await evaluate(`${helpers} document.querySelector('.food-pick').click(); await wait(1500); top('.confirm');`); await snap('usda-confirm.png');
await evaluate(`${helpers} click('.confirm button', 'Cancel'); await wait(300);`);

// 4. Label photo: a drawn Nutrition Facts panel.
await evaluate(`${helpers}
  const W = 900, H = 1300; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.fillRect(60, 60, W - 120, H - 120);
  g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(60, 60, W - 120, H - 120); g.fillStyle = '#111';
  let y = 150; const L = 90, R = W - 90;
  const rule = (w) => { g.fillRect(L, y, R - L, w); y += w + 46; };
  const row = (a, b, bold = false, size = 38, indent = 0) => { g.font = (bold ? '800 ' : '400 ') + size + 'px Helvetica, Arial, sans-serif'; g.textAlign = 'left'; g.fillText(a, L + indent, y); if (b) { g.textAlign = 'right'; g.font = '800 ' + size + 'px Helvetica, Arial, sans-serif'; g.fillText(b, R, y); } y += size + 18; };
  row('Nutrition Facts', '', true, 86); y += 4; rule(4); row('2 servings per container', '', false, 36); row('Serving size', '2 waffles (70g)', true, 40); rule(22);
  row('Amount per serving', '', true, 30); row('Calories', '160', true, 64); rule(10); g.textAlign = 'right';
  row('', '% Daily Value*', true, 30); rule(2);
  row('Total Fat 6g', '8%', true); rule(2); row('Sodium 270mg', '12%', true); rule(2); row('Total Carbohydrate 22g', '8%', true); rule(2);
  row('Dietary Fiber 0.5g', '2%', false, 38, 40); rule(2); row('Protein 3g', '', true); rule(22);
  row('Calcium 100mg', '8%'); rule(2); row('Potassium 30mg', '0%'); rule(10);
  g.font = '400 26px Helvetica, Arial, sans-serif'; g.textAlign = 'left'; g.fillText('INGREDIENTS: ENRICHED FLOUR, ... SODIUM ACID PYROPHOSPHATE ...', L, y);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); const dt = new DataTransfer(); dt.items.add(new File([blob], 'label.jpg', { type: 'image/jpeg' }));
  const i = document.querySelector('.command-input'); i.value = '2 eggo thick and fluffy waffles'; i.dispatchEvent(new Event('input', { bubbles: true })); await wait(100);
  const input = document.querySelector('.command input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); await wait(2000); hideToast();`);
await size(1500); await sleep(300); await evaluate(`${helpers} top('.confirm');`);
await snap('label-confirm.png'); await size(844); await sleep(300);
await evaluate(`${helpers} click('.confirm button', 'Cancel'); await wait(300);`);

// 4b. More ways in: the photo choices, the AI chat in Quick entry, and Ask AI.
await evaluate(`${helpers} hideToast(); const i = document.querySelector('.command-input'); i.value = ''; click('.mic[aria-label^="Read"]'); await wait(300); top('.command');`);
await snap('photo-choices.png');
await evaluate(`${helpers} click('.card button', 'Close'); click('.tool', 'Quick entry'); await wait(300); click('.confirm button', 'Describe it to AI'); await wait(200);
  document.querySelector('.chat-box').value = 'turkey and swiss on rye with mustard'; click('.chat-panel button', 'Send'); await until('.chat-values');
  click('.chat-values button', 'Fill in'); await wait(600); hideToast();`);
await size(1700); await sleep(300); await evaluate(`${helpers} top('.confirm');`);
await snap('quick-chat.png'); await size(844); await sleep(300);
await evaluate(`${helpers} click('.confirm button', 'Cancel'); await wait(200); click('.tool', 'Ask AI'); await wait(400);
  document.querySelector('.chat-box').value = 'How much phosphorus is in a slice of cheddar?'; click('.chat-panel button', 'Send'); await until('.chat-values'); window.scrollTo(0, 0);`);
await snap('ask-ai.png');
await evaluate(`${helpers} click('button', '‹ Today'); await wait(400);`);

// 5. A limit over: red.
await evaluate(`${helpers} globalThis.__t = new Date(2026, 10, 14, 17, 30).getTime(); await cmd('2 cups canned soup', 900); hideToast(); window.scrollTo(0, 0);`); await snap('limit-over.png');
await evaluate(`${helpers} await cmd('undo', 700); hideToast();`);

// 6. History and a past day.
await evaluate(`${helpers} click('#tabs button', 'History'); await wait(900); window.scrollTo(0, 0);`); await snap('history.png');
await evaluate(`${helpers} document.querySelector('.day-pick').click(); await wait(900); window.scrollTo(0, 0);`); await snap('history-day.png');
// 7. Foods.
await evaluate(`${helpers} click('#tabs button', 'Foods'); await wait(700); window.scrollTo(0, 0);`); await snap('foods.png');
console.log('PROBLEMS:', problems.length ? problems : 'none');
ws.close(); chrome.kill();
