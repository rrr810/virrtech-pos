// VirrTech Duka POS — camera barcode scanning engine.
//
// Strategy:
//   1. Request the REAR camera (facingMode: environment).
//   2. Prefer the native browser BarcodeDetector (frames never leave the device).
//   3. Fall back to the locally-bundled ZXing decoder (no CDN).
//   4. On any failure, surface a clear message and keep manual entry available.
//   5. close() always stops every MediaStream track and the video source.

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const ZXING_HINTS = { ean_13: true, ean_8: true, upc_a: true, upc_e: true, code_128: true };
const SCAN_INTERVAL_MS = 180;
const DUP_WINDOW_MS = 2500;

function describeCameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera permission was denied. Allow camera access in your browser settings, or use manual entry below.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this device. Use manual entry below.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is busy in another app. Close it and try again, or use manual entry below.';
    case 'OverconstrainedError':
      return 'This device has no rear camera. Try the front camera from settings, or use manual entry below.';
    default:
      return 'The camera could not be started. Use manual entry below.';
  }
}

/**
 * Start scanning into a <video> element.
 * @param {object} opts
 * @param {HTMLVideoElement} opts.video
 * @param {(code: string) => void} opts.onResult   recognised barcode raw value
 * @param {(msg: string) => void} [opts.onStatus]  human-readable status line
 * @param {(err: Error) => void} [opts.onCameraError] camera unavailable message
 * @returns {Promise<{ close: () => void }>}
 */
export async function startScanner({ video, onResult, onStatus, onCameraError }) {
  onStatus?.('Starting camera…');
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    onCameraError?.('Camera scanning is not supported in this browser. Use manual entry below.');
    return { close: () => {} };
  }
  if (!isSecureContext) {
    onCameraError?.('Camera scanning requires HTTPS (or localhost). Use manual entry below.');
    return { close: () => {} };
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (err) {
    onCameraError?.(describeCameraError(err));
    return { close: () => {} };
  }

  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    /* autoplay with muted+playsinline is allowed; ignore rejection noise */
  }

  let closed = false;
  let timer = null;
  let zxingReader = null;
  let zxingControls = null;
  let detector = null;
  let nativeFormats = [];

  // 1) Native BarcodeDetector, if the browser offers the formats we need.
  if (typeof globalThis.BarcodeDetector !== 'undefined') {
    try {
      const supported = await globalThis.BarcodeDetector.getSupportedFormats?.() ?? [];
      nativeFormats = NATIVE_FORMATS.filter((f) => supported.includes(f));
      if (nativeFormats.length > 0) {
        detector = new globalThis.BarcodeDetector({ formats: nativeFormats });
        onStatus?.(`Scanning with native detector (${nativeFormats.join(', ')})…`);
      }
    } catch {
      detector = null;
    }
  }

  // 2) Locally bundled ZXing fallback (imported lazily so native-only
  //    devices never pay for the fallback bytes).
  if (!detector) {
    try {
      const mod = await import('../../vendor/barcode-decoder.mjs');
      zxingReader = new mod.BrowserMultiFormatReader({ ...ZXING_HINTS }, undefined);
      zxingControls = zxingReader.decodeFromVideoDevice(undefined, video, (result) => {
        if (result && !closed) emit(result.getText());
      });
      onStatus?.('Scanning with bundled ZXing decoder…');
    } catch {
      onCameraError?.('No barcode decoder is available in this browser. Use manual entry below.');
      close();
      return { close: () => {} };
    }
  }

  let lastCode = '';
  let lastAt = 0;
  function emit(code) {
    const now = Date.now();
    if (code === lastCode && now - lastAt < DUP_WINDOW_MS) return;
    lastCode = code;
    lastAt = now;
    onResult(code);
  }

  if (detector) {
    timer = setInterval(async () => {
      if (closed || video.readyState < 2) return;
      try {
        const results = await detector.detect(video);
        if (results.length > 0) emit(results[0].rawValue);
      } catch {
        /* frame decode errors are normal while the camera warms up */
      }
    }, SCAN_INTERVAL_MS);
  }

  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    try {
      zxingControls?.stop();
    } catch {
      /* already stopped */
    }
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* track already stopped */
      }
    }
    video.srcObject = null;
  }

  return { close };
}
