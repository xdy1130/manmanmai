// Add/edit/delete/revoke share these commands and the same storage transaction.
function refundAmount(value, purchase) {
  const text = String(value).trim(); const amount = Number(text);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(amount) || amount <= 0 || amount > Number(purchase.amount)) throw Error('退款金额须大于 0，最多两位小数，且不超过原消费');
  return amount;
}
function refundRecord(draft, id) {
  const refund = draft.expenses.find(x => x.id === id && (Number(x.amount) < 0 || x.kind === 'refund'));
  if (!refund) throw Error('退款记录已处理，请刷新后查看');
  return refund;
}
const RefundOps = {
  add(draft, input) {
    const purchase = draft.expenses.find(x => x.id === input.sourceExpenseId && Number(x.amount) > 0 && x.kind !== 'refund');
    if (!purchase) throw Error('来源消费不存在');
    if (draft.expenses.some(x => x.sourceExpenseId === purchase.id && (Number(x.amount) < 0 || x.kind === 'refund'))) throw Error('每笔消费只允许一条退款，请使用编辑退款');
    const amount = refundAmount(input.amount, purchase); const requestedQty = quantity(input.qty);
    const item = draft.inventory.find(x => x.sourceExpenseId === purchase.id);
    // An exhausted or deleted inventory does not block the monetary refund.
    const deducted = item ? Math.min(quantity(item.qty), requestedQty) : 0;
    if (item) item.qty = quantity((Math.round(item.qty * 1000) - Math.round(deducted * 1000)) / 1000);
    const record = {id: input.id || uid(), name: `${purchase.name || '消费'}退货${input.note ? `（${input.note}）` : ''}`, amount:-amount, kind:'refund', qty:deducted, requestedQty, platform:purchase.platform || '其他', category:purchase.category || '其他', date:purchase.date, refundedAt:input.refundedAt || todayISO(), fromInventory:Boolean(item), sourceInventoryId:item?.id || '', sourceExpenseId:purchase.id};
    if (draft.expenseTombstones?.[record.id] || draft.expenses.some(x => x.id === record.id)) throw Error('退款记录已存在');
    draft.expenses.push(record); purchase.returned = true; purchase.returnedAt = record.refundedAt;
    return record.id;
  },
  edit(draft, id, input) {
    const refund = refundRecord(draft, id); const purchase = draft.expenses.find(x => x.id === refund.sourceExpenseId && Number(x.amount) > 0);
    if (!purchase) throw Error('来源消费不存在');
    const amount = refundAmount(input.amount, purchase); const qty = quantity(input.qty);
    const item = draft.inventory.find(x => x.id === refund.sourceInventoryId);
    if (item && refund.qty == null) throw Error('旧退款缺少扣减数量，请先撤销并确认恢复数量，再重新退货');
    const oldQty = quantity(refund.qty ?? 0); const delta = (Math.round(qty * 1000) - Math.round(oldQty * 1000)) / 1000;
    if (item) {
      if (delta > Number(item.qty)) throw Error('库存不足，请减少退货数量');
      item.qty = quantity((Math.round(Number(item.qty) * 1000) - Math.round(delta * 1000)) / 1000);
    }
    refund.qty = item ? qty : oldQty; // qty is the actual historical deduction, never invented stock.
    refund.requestedQty = qty;
    refund.amount = -amount; refund.date = purchase.date;
    purchase.returned = true;
  },
  revoke(draft, id, legacyQty) {
    const refund = refundRecord(draft, id);
    const item = draft.inventory.find(x => x.id === refund.sourceInventoryId);
    // Legacy records without qty require an explicit amount only when an
    // existing linked inventory can actually be restored. Unlinked refunds
    // have no stock side effect, so revoke with zero is valid.
    const restore = refund.qty == null ? (refund.sourceInventoryId ? quantity(legacyQty) : 0) : quantity(refund.qty);
    if (item) item.qty = quantity((Math.round(Number(item.qty) * 1000) + Math.round(restore * 1000)) / 1000);
    const purchase = draft.expenses.find(x => x.id === refund.sourceExpenseId);
    if (purchase) { purchase.returned = false; delete purchase.returnedAt; }
    draft.expenses = draft.expenses.filter(x => x.id !== id);
    return {restoredQty:item ? restore : 0, missingInventory:Boolean(refund.sourceInventoryId && !item)};
  }
};
