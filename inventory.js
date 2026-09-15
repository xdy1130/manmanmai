// Inventory quantities use thousandths to avoid floating-point drift.
function quantity(value) {
  if (value === '' || value == null || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100000 || Math.abs(Number(value) * 1000 - Math.round(Number(value) * 1000)) > 0.00001) throw Error('数量须为 0 至 100000，最多三位小数');
  return Math.round(Number(value) * 1000) / 1000;
}
const InventoryOps = {
  upsert(draft, record) {
    const item = {...record, qty:quantity(record.qty)};
    if (!item.id || draft.inventoryTombstones?.[item.id]) throw Error('库存记录已删除，请重新添加');
    if (item.sourceExpenseId) {
      const purchase = draft.expenses.find(x => x.id === item.sourceExpenseId);
      if (!purchase || Number(purchase.amount) <= 0 || purchase.kind === 'refund') throw Error('来源消费不存在');
      if (draft.expenses.some(x => x.sourceExpenseId === purchase.id && (Number(x.amount) < 0 || x.kind === 'refund'))) throw Error('退货期间暂停入库，请先撤销退货');
      if (draft.inventory.some(x => x.id !== item.id && x.sourceExpenseId === item.sourceExpenseId)) throw Error('这笔消费已经加入库存');
    }
    const index = draft.inventory.findIndex(x => x.id === item.id);
    if (index < 0) draft.inventory.push(item); else draft.inventory[index] = item;
    draft.inventoryUnits = [...new Set([...(draft.inventoryUnits || []), item.unit || '件'])];
    return item.id;
  },
  adjust(draft, id, delta) {
    const item = draft.inventory.find(x => x.id === id); if (!item) throw Error('库存记录不存在');
    if (!Number.isFinite(Number(delta))) throw Error('数量无效');
    item.qty = quantity(Math.max(0, (Math.round(Number(item.qty) * 1000) + Math.round(Number(delta) * 1000)) / 1000));
  },
  remove(draft, id) {
    if (!draft.inventory.some(x => x.id === id)) throw Error('库存记录已删除');
    draft.inventory = draft.inventory.filter(x => x.id !== id);
  },
  removeImage(draft, id) { const item = draft.inventory.find(x => x.id === id); if (item) item.image = ''; }
};
