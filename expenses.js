// Domain commands mutate only transaction drafts; callers must use transact().
const ExpenseOps = {
  add(draft, record) {
    if (!record.id || draft.expenseTombstones?.[record.id] || draft.expenses.some(x => x.id === record.id)) throw Error('这笔记录已存在');
    const amount = Number(record.amount);
    if (!Number.isFinite(amount) || !amount || Math.abs(amount) > 1e12 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.001) throw Error('金额须大于 0，最多两位小数');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date || '')) throw Error('请选择有效日期');
    if (record.sourceExpenseId && (amount < 0 || record.kind === 'refund')) throw Error('关联退款请使用退货入口');
    draft.expenses.push(structuredClone(record));
    return record.id;
  },
  remove(draft, id) {
    const record = draft.expenses.find(x => x.id === id);
    if (!record) throw Error('记录已删除');
    if (record.kind === 'refund' || Number(record.amount) < 0) return RefundOps.revoke(draft, id, record.qty);
    if (draft.expenses.some(x => x.sourceExpenseId === id && (x.kind === 'refund' || Number(x.amount) < 0))) throw Error('请先撤销关联退货，再删除消费；库存会保留');
    draft.expenses = draft.expenses.filter(x => x.id !== id);
  }
};
