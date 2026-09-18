// Builds the locally-bundled barcode decoder (ZXing) into vendor/barcode-decoder.mjs.
// Run: npm run build:vendor  (requires: npm install)

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [join(root, 'scripts/vendor-entry.js')],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  outfile: join(root, 'vendor/barcode-decoder.mjs'),
  legalComments: 'eof',
  logLevel: 'info',
});

console.log('vendor/barcode-decoder.mjs written (commit it; no CDN is ever used at runtime).');
