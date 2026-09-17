// Read-only bill periods and historical trend aggregation; money uses integer cents.
    function monthKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
    function expenseTotal(filter) { return expenseTotals(state.expenses.filter(filter)).net; }
    function monthSpent() { const key = monthKey(); return expenseTotal(e => e.date.startsWith(key)); }
    function localDate(iso) { const [year, month, day] = String(iso || todayISO()).split('-').map(Number); return new Date(year, month - 1, day); }
    function historyRange(period, anchorISO) {
      const anchor = localDate(anchorISO); let start = new Date(anchor); let end = new Date(anchor);
      if (period === 'today') { /* same day */ }
      if (period === 'week') { const offset = (anchor.getDay() + 6) % 7; start.setDate(anchor.getDate() - offset); end = new Date(start); end.setDate(start.getDate() + 6); }
      if (period === 'month') { start.setDate(1); end = new Date(start.getFullYear(), start.getMonth() + 1, 0); }
      if (period === 'prevMonth') { start = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1); end = new Date(anchor.getFullYear(), anchor.getMonth(), 0); }
      if (period === 'custom') { const s = localDate(byId('historyStartDate')?.value || anchorISO); const e = localDate(byId('historyEndDate')?.value || anchorISO); start = s <= e ? s : e; end = s <= e ? e : s; }
      return { start, end };
    }
    function historyLabel(period, range) {
      const format = d => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
      const prefix = period === 'today' ? '今天' : period === 'week' ? '本周' : period === 'month' ? '本月' : period === 'prevMonth' ? '上月' : '自定义';
      return `${prefix}统计：${format(range.start)}${period === 'today' || (range.start.getTime() === range.end.getTime()) ? '' : `至${format(range.end)}`}`;
    }
    function historyChartBuckets(period, expenses, range) {
      const valid = expenses.filter(item => !item.deletedAt && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(Number(item.amount)) && (!range || (localDate(item.date) >= range.start && localDate(item.date) <= range.end)));
      if (!valid.length && !range) return [];
      const bucketKey = date => {
        if (period === 'day') return dateISO(date);
        if (period === 'week') { const monday = new Date(date); monday.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return dateISO(monday); }
        if (period === 'month') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (period === 'quarter') return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
        return String(date.getFullYear());
      };
      const bucketLabel = date => {
        if (period === 'day') return `${date.getMonth() + 1}/${date.getDate()}`;
        if (period === 'week') return isoWeekLabel(date);
        if (period === 'month') return `${date.getFullYear()}年${date.getMonth() + 1}月`;
        if (period === 'quarter') return `${date.getFullYear()}年Q${Math.floor(date.getMonth() / 3) + 1}`;
        return `${date.getFullYear()}年`;
      };
      const totals = new Map(); const dates = valid.map(item => localDate(item.date)).sort((a, b) => a - b); const first = new Date(range ? range.start : dates[0]); const last = new Date(range ? range.end : dates[dates.length - 1]);
      const normalize = date => {
        if (period === 'week') { date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); date.setHours(0, 0, 0, 0); }
        if (period === 'month') date.setDate(1);
        if (period === 'quarter') { date.setMonth(Math.floor(date.getMonth() / 3) * 3, 1); }
        if (period === 'year') date.setMonth(0, 1);
        return date;
      };
      valid.forEach(item => { const date = localDate(item.date); const key = bucketKey(date); totals.set(key, (totals.get(key) || 0) + Math.round(Number(item.amount) * 100)); });
      let cursor = normalize(first); const end = normalize(last); const buckets = [];
      while (cursor <= end) {
        const key = bucketKey(cursor); buckets.push({ label: bucketLabel(cursor), value: (totals.get(key) || 0) / 100, date: new Date(cursor) });
        if (period === 'day') cursor.setDate(cursor.getDate() + 1); else if (period === 'week') cursor.setDate(cursor.getDate() + 7); else if (period === 'month') cursor.setMonth(cursor.getMonth() + 1); else if (period === 'quarter') cursor.setMonth(cursor.getMonth() + 3); else cursor.setFullYear(cursor.getFullYear() + 1);
      }
      return buckets;
    }
    function isoWeekLabel(date) {
      const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())); const day = utc.getUTCDay() || 7;
      utc.setUTCDate(utc.getUTCDate() + 4 - day);
      const year = utc.getUTCFullYear(); const yearStart = new Date(Date.UTC(year, 0, 1)); const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
      return `${year}WK${String(week).padStart(2, '0')}`;
    }

function filterExpenses(expenses, range) {
  return expenses.filter(item => !item.deletedAt && localDate(item.date) >= range.start && localDate(item.date) <= range.end).sort((a,b) => b.date.localeCompare(a.date));
}
function expenseTotals(expenses) {
  let purchase = 0, refund = 0;
  for (const item of expenses) {
    if (item.deletedAt) continue;
    const cents = Math.round(Number(item.amount) * 100);
    if (!Number.isFinite(cents)) continue;
    if (cents > 0) purchase += cents; else refund -= cents;
  }
  return {purchase: purchase / 100, refund: refund / 100, net: (purchase - refund) / 100};
}
