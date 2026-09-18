// Catches the main remaining runtime-wiring bug class without a browser:
// every element id referenced via getElementById in src/ must exist in
// index.html (shell ids) or be created dynamically by the same module.

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

test('every getElementById target exists in the shell or is created by that module', () => {
  for (const f of srcFiles('src')) {
    const source = read(f);
    const refs = [...source.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    for (const id of refs) {
      const createdDynamically = source.includes(`id="${id}"`);
      assert.ok(
        htmlIds.has(id) || createdDynamically,
        `${f}: getElementById('${id}') — id missing from index.html and not created in this module`,
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
