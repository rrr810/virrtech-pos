// VirrTech Duka POS — money handling.
// All amounts are stored as integer Kenyan Shilling (KES) minor units.
// KES has no practical sub-unit, so one unit equals one shilling (KSh).

const FMT = new Intl.NumberFormat('en-KE');
export const MAX_KES = 1_000_000_000;

export function isMoney(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_KES;
}

export function assertMoney(value, label = 'amount') {
  if (!isMoney(value)) {
    throw new TypeError(`${label} must be a whole number of shillings between 0 and ${MAX_KES}, got ${String(value)}`);
  }
  return value;
}

/** Format an integer KES amount for display, e.g. 1250 -> "KSh 1,250". */
export function formatKES(value) {
  assertMoney(value, 'value');
  return `KSh ${FMT.format(value)}`;
}

/** Plain grouped number for compact contexts (receipt lines). */
export function plainKES(value) {
  assertMoney(value, 'value');
  return FMT.format(value);
}

/**
 * Parse cashier input such as "1,250", "ksh 500" or " 200 " into integer KES.
 * Returns { ok, value } or { ok: false, error }.
 */
export function parseKESInput(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Enter an amount.' };
  const cleaned = raw.replace(/ksh|kes/gi, '').replace(/[,_\s]/g, '').trim();
  if (cleaned === '') return { ok: false, error: 'Enter an amount.' };
  if (!/^\d+$/.test(cleaned)) return { ok: false, error: 'Amount must be a whole number of shillings.' };
  const value = Number(cleaned);
  if (!Number.isSafeInteger(value) || value > MAX_KES) return { ok: false, error: 'Amount is too large.' };
  return { ok: true, value };
}
