// VirrTech Duka POS — static wiring tests (no browser needed).
// Catches broken asset references: every file referenced from index.html,
// the manifest, the service worker and the module graph must exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const read = (p) => readFileSync(join(root, p), 'utf8');

test('index.html references exist on disk and are relative (subpath-safe)', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 5, 'expected several asset references');
  for (const ref of refs) {
    if (ref.startsWith('http') || ref.startsWith('#') || ref.startsWith('data:')) continue;
    assert.ok(!ref.startsWith('/'), `absolute path breaks Pages subpath deploy: ${ref}`);
    const path = ref.startsWith('/') ? ref.slice(1) : ref;
    assert.ok(existsSync(join(root, path)), `missing asset referenced by index.html: ${ref}`);
  }
});

test('manifest icons and start_url exist (relative for subpath deploys)', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.name, 'VirrTech Duka POS');
  assert.equal(manifest.start_url, './', 'start_url must stay relative so Pages subpaths work');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.icons.length >= 3);
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'));
  assert.ok(sizes.includes('512x512'));
  const maskable = manifest.icons.find((i) => i.purpose === 'maskable');
  assert.ok(maskable, 'manifest needs a maskable icon');
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith('/'), `icon src must be relative: ${icon.src}`);
    assert.ok(existsSync(join(root, icon.src)), `missing icon: ${icon.src}`);
  }
});

test('generated PNGs are valid (signature + dimensions)', () => {
  for (const [file, size] of [
    ['icons/icon-180.png', 180],
    ['icons/icon-192.png', 192],
    ['icons/icon-512.png', 512],
    ['icons/maskable-512.png', 512],
  ]) {
    const buf = readFileSync(join(root, file));
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${file}: bad signature`);
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    assert.equal(w, size, `${file}: width ${w} != ${size}`);
    assert.equal(h, size, `${file}: height ${h} != ${size}`);
    assert.ok(buf.length > 500, `${file}: suspiciously small`);
  }
});

test('service worker precache list matches the module graph on disk', () => {
  const sw = read('sw.js');
  const block = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
  assert.ok(block, 'ASSETS array not found in sw.js');
  const assets = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(assets.length >= 30, 'expected a full precache list');
  assert.ok(assets.includes('./'), 'precache must include the app root');
  for (const a of assets) {
    // Relative-only so the same build works at / and /virrtech-pos/.
    assert.ok(a.startsWith('./'), `sw asset must be relative to the sw scope: ${a}`);
    if (a === './') continue;
    assert.ok(existsSync(join(root, a.slice(2))), `sw.js precaches missing file: ${a}`);
  }
  // Every src module must be precached, or offline mode serves stale code.
  const jsModules = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir))) {
      const full = join(dir, entry);
      if (statSync(join(root, full)).isDirectory()) walk(full);
      else if (entry.endsWith('.js')) jsModules.push(`./${full.replace(/\\/g, '/')}`);
    }
  };
  walk('src');
  for (const m of jsModules) {
    assert.ok(assets.includes(m), `sw.js must precache module: ${m}`);
  }
});

test('all relative ES module imports inside src/ resolve', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir))) {
      const full = join(root, dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(join(dir, entry));
      else if (entry.endsWith('.js')) files.push(join(dir, entry));
    }
  };
  walk('src');
  assert.ok(files.length >= 20, 'expected the full src tree');
  for (const f of files) {
    const source = read(f);
    const specifiers = [
      ...source.matchAll(/from\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]);
    for (const spec of specifiers) {
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(join(root, f)), spec);
      assert.ok(existsSync(target), `${f}: unresolved import ${spec}`);
    }
  }
});

test('vendored decoder is present, local and committed (no CDN)', () => {
  const p = 'vendor/barcode-decoder.mjs';
  assert.ok(existsSync(join(root, p)), 'vendor/barcode-decoder.mjs must be committed');
  const source = read(p);
  assert.ok(source.length > 100_000, 'bundle looks too small to be ZXing');
  assert.ok(!/https?:\/\/[a-z0-9.-]+\.(js|mjs|json)/i.test(source.slice(0, 2000)), 'no external CDN imports at bundle head');
  // The scanner engine must import the relative bundle, not a URL.
  const engine = read('src/scanner/engine.js');
  assert.match(engine, /import\('\.\.\/\.\.\/vendor\/barcode-decoder\.mjs'\)/);
  assert.ok(!/https?:\/\/.*zxing/i.test(engine), 'engine must not load ZXing from a CDN');
});

test('no secrets or credentials anywhere in the repo', () => {
  const files = [];
  const walk = (dir) => {
    if (dir.split('/').some((p) => p === 'node_modules' || p === '.git')) return;
    for (const entry of readdirSync(join(root, dir))) {
      const full = join(root, dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(join(dir, entry));
      else if (/\.(js|mjs|json|html|css|webmanifest|md|txt|svg)$/i.test(entry)) files.push(join(dir, entry));
    }
  };
  walk('.');
  assert.ok(files.length > 20);
  const patterns = [
    /ghp_[A-Za-z0-9]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /sk-[A-Za-z0-9]{20,}/,
    /Bearer\s+[A-Za-z0-9._-]{20,}/i,
    /password\s*[:=]\s*['"][^'"]{6,}['"]/i,
    /private[_-]?key/i,
  ];
  for (const f of files) {
    const content = read(f);
    for (const re of patterns) {
      assert.ok(!re.test(content), `possible secret pattern in ${f}`);
    }
  }
  assert.ok(!existsSync(join(root, '.env')) && !existsSync(join(root, '.env.example')), 'no .env files: this app has no secrets by design');
});
