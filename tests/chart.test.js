import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartLayout, renderChartSVG } from '../docs/js/chart.js';
import { DEFAULT_SETTINGS, DANGER } from '../docs/js/nutrients.js';

const targets = DEFAULT_SETTINGS.targets;
const colors = DEFAULT_SETTINGS.colors;
const zero = { calories: 0, protein_g: 0, sodium_mg: 0, potassium_mg: 0, phosphorus_mg: 0 };
const reference = { calories: 1180, protein_g: 25.4, sodium_mg: 482, potassium_mg: 643, phosphorus_mg: 210 };

const bar = (layout, key) => layout.bars.find((b) => b.key === key);

test('five equal-width columns in the order C P S K H', () => {
  const layout = chartLayout(reference, targets, colors);
  assert.equal(layout.bars.map((b) => b.letter).join(''), 'CPSKH');
  const widths = new Set(layout.bars.map((b) => b.w.toFixed(6)));
  assert.equal(widths.size, 1);
  for (let i = 1; i < layout.bars.length; i++) {
    const gap = layout.bars[i].x - (layout.bars[i - 1].x + layout.bars[i - 1].w);
    assert.ok(Math.abs(gap - 6) < 1e-9, 'thin gap between columns');
  }
});

test('calories 1075 / 2150 is exactly 50% of the column height', () => {
  const layout = chartLayout({ ...zero, calories: 1075 }, targets, colors);
  const c = bar(layout, 'calories');
  assert.equal(c.h, c.column.h * 0.5);
  assert.equal(c.y + c.h, c.column.y + c.column.h, 'bar rises from the bottom');
});

test('each bar is scaled to its own target', () => {
  const layout = chartLayout(
    { calories: 537.5, protein_g: 27.5, sodium_mg: 1500, potassium_mg: 2000, phosphorus_mg: 80 },
    targets,
    colors,
  );
  assert.deepEqual(layout.bars.map((b) => b.fill), [0.25, 0.5, 0.75, 1, 0.1]);
  for (const b of layout.bars) assert.ok(Math.abs(b.h - b.fill * b.column.h) < 1e-9);
});

test('changing a target rescales only that bar', () => {
  const layout = chartLayout(reference, { ...targets, calories: 2360 }, colors);
  assert.equal(bar(layout, 'calories').fill, 0.5);
  assert.equal(bar(layout, 'sodium_mg').fill, 482 / 2000);
});

test('zero and missing totals give empty bars', () => {
  for (const totals of [zero, {}, undefined]) {
    const layout = chartLayout(totals, targets, colors);
    for (const b of layout.bars) assert.equal(b.h, 0);
  }
  assert.ok(!renderChartSVG(zero, targets, colors).includes('class="bar"'));
});

test('a limit over target clamps at 100% and turns red, label shows the true value', () => {
  const layout = chartLayout({ ...zero, sodium_mg: 2705 }, targets, colors);
  const s = bar(layout, 'sodium_mg');
  assert.equal(s.h, s.column.h);
  assert.equal(s.color, DANGER);
  assert.equal(s.label.text, '2705 mg');
});

test('every limit nutrient goes red when over, and only those', () => {
  const over = { calories: 100, protein_g: 56, sodium_mg: 2001, potassium_mg: 2001, phosphorus_mg: 801 };
  const layout = chartLayout(over, targets, colors);
  assert.deepEqual(layout.bars.map((b) => b.color === DANGER), [false, true, true, true, true]);
});

test('a limit exactly at target is full height but not red', () => {
  const s = bar(chartLayout({ ...zero, sodium_mg: 2000 }, targets, colors), 'sodium_mg');
  assert.equal(s.h, s.column.h);
  assert.equal(s.color, colors.sodium_mg);
});

test('calories over target clamp, stay magenta and get a goal mark; never red', () => {
  const layout = chartLayout({ ...zero, calories: 2600 }, targets, colors);
  const c = bar(layout, 'calories');
  assert.equal(c.h, c.column.h);
  assert.equal(c.color, colors.calories);
  assert.equal(c.goalMet, true);
  const svg = renderChartSVG({ ...zero, calories: 2600 }, targets, colors);
  assert.ok(svg.includes('>goal</text>'));
  assert.ok(!svg.includes(DANGER));
});

test('no goal mark below the calorie target', () => {
  assert.ok(!renderChartSVG(reference, targets, colors).includes('>goal</text>'));
});

test('red never appears unless a limit is exceeded', () => {
  assert.ok(!renderChartSVG(reference, targets, colors).toUpperCase().includes('FF2D2D'));
  assert.ok(renderChartSVG({ ...zero, phosphorus_mg: 900 }, targets, colors).includes(DANGER));
});

test('labels carry units and sit just above the bar', () => {
  const layout = chartLayout(reference, targets, colors);
  assert.deepEqual(layout.bars.map((b) => b.label.text), ['1180 kcal', '25.4 g', '482 mg', '643 mg', '210 mg']);
  for (const b of layout.bars.slice(0, 2)) {
    assert.equal(b.label.inside, false);
    assert.ok(b.label.y < b.y && b.y - b.label.y < 20, b.key);
  }
});

test('letters sit in a strip at the very bottom, and bars never reach into it', () => {
  for (const totals of [zero, reference, { calories: 9999, protein_g: 999, sodium_mg: 9999, potassium_mg: 9999, phosphorus_mg: 9999 }]) {
    const layout = chartLayout(totals, targets, colors);
    for (const b of layout.bars) {
      const cell = b.letterCell;
      assert.ok(b.y + b.h <= cell.y, `${b.key} bar ends above the letter strip`);
      assert.ok(b.column.y + b.column.h <= cell.y, 'graphing area ends above the letter strip');
      assert.ok(b.letterPos.y > cell.y && b.letterPos.y < cell.y + cell.h, 'letter is inside its strip');
      assert.ok(Math.abs(cell.y + cell.h - (layout.height - 6)) < 1e-9, 'strip is at the very bottom');
    }
  }
});

test('labels stay readable above the letter strip when a bar is near 0%', () => {
  for (const value of [0, 1, 20, 100]) {
    const c = bar(chartLayout({ ...zero, calories: value }, targets, colors), 'calories');
    assert.equal(c.label.inside, false);
    assert.ok(c.label.y < c.letterCell.y, `label above the strip at ${value}`);
    assert.ok(c.label.y <= c.y, 'label above the bar top');
  }
});

test('labels stay inside the column when a bar is near 100%', () => {
  for (const value of [1900, 1990, 2000, 2400]) {
    const s = bar(chartLayout({ ...zero, sodium_mg: value }, targets, colors), 'sodium_mg');
    assert.ok(s.label.y - s.label.size >= s.column.y, `label top inside column at ${value}`);
    if (s.label.inside) assert.ok(s.label.pill, 'inside labels get a dark backing');
  }
  assert.equal(bar(chartLayout({ ...zero, sodium_mg: 2000 }, targets, colors), 'sodium_mg').label.inside, true);
});

test('labels fit their column even with long values', () => {
  const layout = chartLayout({ ...reference, calories: 12345, sodium_mg: 12345 }, targets, colors);
  for (const b of layout.bars) {
    assert.ok(b.label.text.length * 0.56 * b.label.size <= b.w - 16 + 1e-9, b.key);
  }
  assert.equal(new Set(layout.bars.map((b) => b.label.size)).size, 1, 'one label size for all bars');
});

test('dotted lines at one third and two thirds of the column height', () => {
  const layout = chartLayout(reference, targets, colors);
  const bottom = layout.colTop + layout.colH;
  assert.ok(Math.abs(bottom - layout.lines[0] - (layout.colH * 2) / 3) < 1e-9);
  assert.ok(Math.abs(bottom - layout.lines[1] - layout.colH / 3) < 1e-9);
  assert.equal(renderChartSVG(reference, targets, colors).match(/<line /g).length, 2);
});

test('B / L / D labels can be hidden', () => {
  const shown = renderChartSVG(reference, targets, colors);
  const hidden = renderChartSVG(reference, targets, colors, { showMealLabels: false });
  for (const letter of ['B', 'L', 'D']) {
    assert.ok(shown.includes(`>${letter}</text>`));
    assert.ok(!hidden.includes(`>${letter}</text>`));
  }
});

test('custom colors are used, and unsafe color strings fall back to defaults', () => {
  const svg = renderChartSVG(reference, targets, { ...colors, sodium_mg: '#123456' });
  assert.ok(svg.includes('fill="#123456"'));
  const bad = renderChartSVG(reference, targets, { ...colors, sodium_mg: '"/><script>x</script>' });
  assert.ok(!bad.includes('script'));
  assert.ok(bad.includes(`fill="${colors.sodium_mg}"`));
});

test('output is a standalone SVG with no styles or external references', () => {
  const svg = renderChartSVG(reference, targets, colors, { size: 600 });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(svg.includes('width="600" height="600"'));
  assert.ok(!/style=|<style|href|url\(/.test(svg));
  assert.equal(svg.match(/class="bar"/g).length, 5);
});
