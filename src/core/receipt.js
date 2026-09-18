// VirrTech Duka POS — 80 mm receipt layout (pure logic, plain text lines).
//
// An 80 mm thermal roll prints roughly 42 characters per line at the
// standard 203 dpi dot matrix. Lines are returned as plain strings so the
// same layout works on screen, in print CSS and for future EPR printers.

import { plainKES } from './money.js';

export const RECEIPT_WIDTH = 42;

function rule(ch = '-') {
  return ch.repeat(RECEIPT_WIDTH);
}

function center(text, width = RECEIPT_WIDTH) {
  const t = String(text);
  if (t.length >= width) return t.slice(0, width);
  const left = Math.floor((width - t.length) / 2);
  return ' '.repeat(left) + t;
}

function padRow(left, right, width = RECEIPT_WIDTH) {
  const l = String(left);
  const r = String(right);
  const gap = Math.max(1, width - l.length - r.length);
  if (l.length + r.length >= width) return (l + ' ' + r).slice(0, width);
  return l + ' '.repeat(gap) + r;
}

function splitLong(word, width) {
  const parts = [];
  let w = word;
  while (w.length > width) {
    parts.push(w.slice(0, width));
    w = w.slice(width);
  }
  parts.push(w);
  return parts;
}

/** Word-wrap text to exactly `width` characters (hard-breaks long words). */
export function wrapText(text, width = RECEIPT_WIDTH) {
  const out = [];
  let cur = '';
  for (const word of String(text).split(/\s+/)) {
    if (!word) continue;
    for (const piece of splitLong(word, width)) {
      if (cur === '') cur = piece;
      else if (cur.length + 1 + piece.length <= width) cur += ' ' + piece;
      else {
        out.push(cur);
        cur = piece;
      }
    }
  }
  if (cur) out.push(cur);
  return out.length > 0 ? out : [''];
}

const dateTimeFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

const METHOD_LABEL = { cash: 'Cash', mpesa: 'M-Pesa (simulated)', card: 'Card terminal (simulated)' };

/**
 * Build the receipt line array for a completed sale.
 * `shop` = { name, location, phone }.
 */
export function buildReceipt({ shop, sale, width = RECEIPT_WIDTH }) {
  const lines = [];
  const W = width;

  lines.push(center(shop.name, W));
  if (shop.location) lines.push(center(shop.location, W));
  if (shop.phone) lines.push(center(shop.phone, W));
  lines.push(rule('=', W));
  lines.push(center(`Receipt ${sale.number}`, W));
  lines.push(center(dateTimeFmt.format(new Date(sale.createdAt)), W));
  lines.push(rule('=', W));

  for (const l of sale.lines) {
    for (const wl of wrapText(l.name, W)) lines.push(wl);
    lines.push(padRow(`${l.qty} x ${plainKES(l.unitPriceKES)}`, plainKES(l.lineTotalKES), W));
  }
  lines.push(rule('-', W));
  lines.push(padRow('TOTAL', plainKES(sale.totalKES), W));

  const { method, details } = sale.payment;
  if (method === 'cash') {
    lines.push(padRow('Cash received', plainKES(details.tenderedKES), W));
    lines.push(padRow('Change', plainKES(details.changeKES), W));
  } else if (method === 'mpesa') {
    lines.push(center(METHOD_LABEL.mpesa, W));
    if (details.phone) lines.push(center(`Ph: ${details.phone}`, W));
    lines.push(center(`Ref: ${details.ref}`, W));
  } else if (method === 'card') {
    lines.push(center(METHOD_LABEL.card, W));
    lines.push(center(`Ref: ${details.ref}`, W));
  }

  if (sale.refundTotalKES > 0) {
    lines.push(padRow('Refunded so far', plainKES(sale.refundTotalKES), W));
  }

  lines.push(rule('-', W));
  lines.push(center('Amounts in KSh (Kenyan Shillings)', W));
  lines.push(center('*** DEMO PROTOTYPE ***', W));
  lines.push(center('Payments are simulated. This', W));
  lines.push(center('receipt is NOT KRA eTIMS certified.', W));
  lines.push(center('Asante! Thank you for shopping.', W));

  return { lines, text: lines.join('\n') };
}
