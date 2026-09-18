// Catches the main remaining runtime-wiring bug class without a browser:
// every element id referenced in src/ — via getElementById, the $() helper
// or root.querySelector('#id') — must exist in index.html (static shell) or
// be created as an id="..." inside some src/ module (runtime markup, e.g.
// modal content). History: a cart badge whose markup was dropped while its
// JS reference stayed broke app boot with "Cannot set properties of null".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const read = (p) => readFileSync(join(root, p), 'utf8');

const htmlIds = new Set([...read('index.html').matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

function srcFiles(dir) {
  const out = [];
  for (const entry of readdirSync(join(root, dir))) {
    const full = join(root, dir, entry);
    if (statSync(full).isDirectory()) out.push(...srcFiles(join(dir, entry)));
    else if (entry.endsWith('.js')) out.push(join(dir, entry));
  }
  return out;
}

// Ids that appear as id="..." anywhere in module source: markup created at
// runtime (modals, receipts, dynamic rows) is allowed to be queried.
const allSrc = srcFiles('src').map((f) => read(f)).join('\n');
const dynamicIds = new Set([...allSrc.matchAll(/id="([^"$]+?)"/g)].map((m) => m[1]));

test('every id referenced in src/ exists in the shell or is created at runtime', () => {
  for (const f of srcFiles('src')) {
    const source = read(f);
    const refs = new Set();
    for (const m of source.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) refs.add(m[1]);
    // $() helper and querySelector accept compound selectors — keep only the leading id.
    for (const m of source.matchAll(/\$\(\s*['"]#([A-Za-z0-9_-]+)/g)) refs.add(m[1]);
    for (const m of source.matchAll(/querySelector(?:All)?\(\s*['"]#([A-Za-z0-9_-]+)/g)) refs.add(m[1]);
    for (const id of refs) {
      assert.ok(
        htmlIds.has(id) || dynamicIds.has(id),
        `${f}: references #${id} — id missing from index.html and never created as id="${id}" in src/`,
      );
    }
  }
});

test('view containers referenced by main.js exist in the shell', () => {
  const main = read('src/main.js');
  for (const view of ['register', 'catalogue', 'sales', 'dashboard', 'settings']) {
    assert.ok(htmlIds.has(`view-${view}`), `missing #view-${view}`);
  }
  assert.ok(main.includes("getElementById('splash')") || main.includes('getElementById("splash")'));
  assert.ok(htmlIds.has('splash'));
});
