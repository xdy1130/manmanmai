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
    function validTrendExpense(item) {
      return !item.deletedAt && /^\d{4}-\d{2}-\d{2}$/.test(item.date || '') && dateISO(localDate(item.date)) === item.date && Number.isFinite(Number(item.amount));
    }
    function isTrendPurchase(item) { return validTrendExpense(item) && item.kind !== 'refund' && Number(item.amount) > 0; }
    function trendTotals(expenses) {
      let purchase = 0, refund = 0;
      for (const item of expenses.filter(validTrendExpense)) {
        const cents = Math.round(Number(item.amount) * 100);
        if (isTrendPurchase(item)) purchase += cents;
        else if (item.kind === 'refund' || cents < 0) refund += Math.abs(cents);
      }
      return { purchase: purchase / 100, refund: refund / 100, net: (purchase - refund) / 100 };
    }
    function trendRange(period, anchorISO = todayISO(), expenses = state.expenses, custom = {}) {
      const end = localDate(anchorISO);
      let start = new Date(end.getFullYear(), end.getMonth() - (period === 'sixMonths' ? 5 : 11), 1);
      if (period === 'all') {
        const dates = expenses.filter(validTrendExpense).map(item => item.date).filter(date => date <= anchorISO).sort();
        start = dates.length ? localDate(dates[0]) : new Date(end.getFullYear(), end.getMonth(), 1);
      }
      if (period === 'custom') return {start: localDate(custom.start), end: localDate(custom.end)};
      return {start, end};
    }
    function trendDateLabel(range) { return `${dateISO(range.start)} 至 ${dateISO(range.end)}`; }
    function trendComparison(current, previous) {
      const delta = (Math.round(current * 100) - Math.round(previous * 100)) / 100;
      return {current, previous, delta, percent: previous > 0 ? delta / previous * 100 : null,
        status: previous === 0 ? (current === 0 ? '均无消费' : '新增消费') : delta === 0 ? '持平' : delta > 0 ? '增加' : '减少'};
    }
    function monthlyTrendComparisons(expenses, anchorISO = todayISO()) {
      const today = localDate(anchorISO), year = today.getFullYear(), month = today.getMonth();
      const current = {start: new Date(year, month, 1), end: today};
      const previous = {start: new Date(year, month - 1, 1), end: new Date(year, month - 1, Math.min(today.getDate(), new Date(year, month, 0).getDate()))};
      const lastMonth = {start: new Date(year, month - 1, 1), end: new Date(year, month, 0)};
      const beforeLast = {start: new Date(year, month - 2, 1), end: new Date(year, month - 1, 0)};
      const compare = (a, b) => ({...trendComparison(trendTotals(filterExpenses(expenses, a)).purchase, trendTotals(filterExpenses(expenses, b)).purchase), range: a, baseRange: b});
      return {toDate: compare(current, previous), complete: compare(lastMonth, beforeLast)};
    }
    function historyChartBuckets(period, expenses, range, anchorISO = todayISO()) {
      const valid = expenses.filter(validTrendExpense);
      if (!valid.length && !range) return [];
      if (!['day', 'week', 'month'].includes(period)) return [];
      const dates = valid.map(item => item.date).sort();
      const start = range ? new Date(range.start) : localDate(dates[0]);
      const end = range ? new Date(range.end) : localDate(dates[dates.length - 1]);
      const normalize = date => {
        const result = new Date(date);
        if (period === 'week') result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
        if (period === 'month') result.setDate(1);
        return result;
      };
      const advance = date => {
        const result = new Date(date);
        if (period === 'month') result.setMonth(result.getMonth() + 1);
        else result.setDate(result.getDate() + (period === 'week' ? 7 : 1));
        return result;
      };
      const totals = new Map();
      valid.filter(item => localDate(item.date) >= start && localDate(item.date) <= end).forEach(item => {
        const key = dateISO(normalize(localDate(item.date)));
        if (!totals.has(key)) totals.set(key, {purchase: 0, refund: 0});
        const total = totals.get(key), cents = Math.round(Number(item.amount) * 100);
        if (isTrendPurchase(item)) total.purchase += cents;
        else if (item.kind === 'refund' || cents < 0) total.refund += Math.abs(cents);
      });
      const buckets = [], today = localDate(anchorISO);
      for (let cursor = normalize(start); cursor <= end; cursor = advance(cursor)) {
        const naturalEnd = advance(cursor); naturalEnd.setDate(naturalEnd.getDate() - 1);
        const bucketStart = new Date(Math.max(start, cursor)), bucketEnd = new Date(Math.min(end, naturalEnd));
        const partial = bucketStart > cursor || bucketEnd < naturalEnd;
        const ongoing = period !== 'day' && cursor <= today && naturalEnd >= today;
        const label = period === 'month' ? `${cursor.getFullYear()}年${cursor.getMonth() + 1}月` : period === 'week' ? isoWeekLabel(cursor) : dateISO(cursor);
        const status = [ongoing ? '进行中' : '', partial ? '不完整周期' : ''].filter(Boolean).join(' · ');
        const total = totals.get(dateISO(cursor)) || {purchase: 0, refund: 0};
        buckets.push({label, displayLabel: status ? `${label}（${status}）` : label, status, partial, ongoing,
          value: total.purchase / 100, refund: total.refund / 100, net: (total.purchase - total.refund) / 100,
          date: new Date(cursor), start: bucketStart, end: bucketEnd});
      }
      return buckets;
    }
    function trendBucketExpenses(expenses, bucket) {
      return filterExpenses(expenses.filter(validTrendExpense), bucket).sort((a, b) => Number(isTrendPurchase(b)) - Number(isTrendPurchase(a)) || Math.abs(Number(b.amount)) - Math.abs(Number(a.amount)) || b.date.localeCompare(a.date));
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
