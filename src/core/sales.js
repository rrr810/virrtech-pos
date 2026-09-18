// VirrTech Duka POS — sales numbering and daily reporting (pure logic).

export function formatSaleNumber(n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('Sale number must be a positive integer');
  return `S-${String(n).padStart(5, '0')}`;
}

export function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDayExclusive(date = new Date()) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Aggregate completed sales for one local day.
 * `sales` may include any status; only completed sales count toward gross.
 */
export function dayStats(sales, dayStart = startOfDay()) {
  const dayEnd = endOfDayExclusive(dayStart);
  const inDay = sales.filter(
    (s) => s.status === 'completed' && new Date(s.createdAt) >= dayStart && new Date(s.createdAt) < dayEnd,
  );
  const count = inDay.length;
  const totalKES = inDay.reduce((s, x) => s + x.totalKES, 0);
  const itemsSold = inDay.reduce((s, x) => s + x.lines.reduce((a, l) => a + l.qty, 0), 0);
  const refundedKES = inDay.reduce((s, x) => s + (x.refundTotalKES ?? 0), 0);

  const byMethod = { cash: 0, mpesa: 0, card: 0 };
  for (const s of inDay) byMethod[s.payment.method] += s.totalKES;

  const byHour = Array.from({ length: 24 }, () => 0);
  for (const s of inDay) byHour[new Date(s.createdAt).getHours()] += s.totalKES;

  const topMap = new Map();
  for (const s of inDay) {
    for (const l of s.lines) {
      const e = topMap.get(l.name) ?? { name: l.name, qty: 0, revenueKES: 0 };
      e.qty += l.qty;
      e.revenueKES += l.lineTotalKES;
      topMap.set(l.name, e);
    }
  }
  const topProducts = [...topMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);

  return {
    count,
    totalKES,
    itemsSold,
    refundedKES,
    avgKES: count > 0 ? Math.round(totalKES / count) : 0,
    byMethod,
    byHour,
    topProducts,
  };
}

/** Sales (any status) whose createdAt falls in [from, to). */
export function salesInWindow(sales, from, to) {
  return sales.filter((s) => new Date(s.createdAt) >= from && new Date(s.createdAt) < to);
}

/** Net figure for a sale: gross minus everything refunded so far. */
export function netSaleKES(sale) {
  return sale.totalKES - (sale.refundTotalKES ?? 0);
}
