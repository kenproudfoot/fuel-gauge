// Keeps the service worker's file list and version in step with the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_VERSION } from '../docs/js/version.js';

const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const sw = readFileSync(path.join(docs, 'sw.js'), 'utf8');

function walk(dir, base = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const rel = base ? `${base}/${item.name}` : item.name;
    if (item.name.startsWith('.')) return [];
    return item.isDirectory() ? walk(path.join(dir, item.name), rel) : [rel];
  });
}

test('service worker version matches the app version', () => {
  assert.equal(/const VERSION = '([^']+)'/.exec(sw)[1], APP_VERSION);
  const pkg = JSON.parse(readFileSync(path.join(docs, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.version, APP_VERSION);
});

test('service worker caches every app file, and nothing that does not exist', () => {
  const listed = [...sw.slice(sw.indexOf('const ASSETS'), sw.indexOf('];')).matchAll(/'([^']+)'/g)]
    .map((m) => m[1])
    .filter((p) => p !== './');
  const onDisk = walk(docs).filter((p) => p !== 'sw.js');
  assert.deepEqual([...listed].sort(), [...onDisk].sort());
});

test('index.html allows scripts only from the app itself', () => {
  const html = readFileSync(path.join(docs, 'index.html'), 'utf8');
  assert.match(html, /Content-Security-Policy[^>]*script-src 'self';/);
  assert.ok(!/<script(?![^>]*\ssrc="js\/)/.test(html), 'no inline or external scripts');
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html.replace(/connect-src[^;"]*/, '')), 'no external URLs');
});
