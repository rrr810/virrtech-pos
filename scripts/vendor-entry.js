// Bundle entry for the locally-vendored ZXing barcode decoder.
// The output (public/vendor/barcode-decoder.mjs) is committed so the app
// needs no build step or CDN to run. License: Apache-2.0 (ZXing-js).
export { BrowserMultiFormatReader } from '@zxing/browser';
