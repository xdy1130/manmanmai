// Compatible classic-script module: pure migrations, no persistence.
    // 按明确的账单/库存关联迁移旧退款，不用商品名称猜测购买记录。
    function migrateRefundDates(items = [], inventory = []) {
      const result = items.map(item => ({ ...item }));
      const byExpenseId = new Map(result.map(item => [item.id, item]));
      const byInventoryId = new Map(inventory.map(item => [item.id, item]));
      result.forEach(refund => {
        if (!(Number(refund.amount) < 0 || refund.kind === 'refund')) return;
        const sourceId = refund.sourceExpenseId || byInventoryId.get(refund.sourceInventoryId)?.sourceExpenseId;
        const purchase = byExpenseId.get(sourceId);
        if (!purchase || purchase.kind === 'refund' || Number(purchase.amount) <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(purchase.date)) return;
        if (refund.date !== purchase.date && !refund.refundedAt) refund.refundedAt = refund.date;
        refund.date = purchase.date;
        refund.sourceExpenseId = purchase.id;
        purchase.returned = true;
        if (!purchase.returnedAt && refund.refundedAt) purchase.returnedAt = refund.refundedAt;
      });
      return result;
    }

    function normalizeSavedState(saved) {
        const demoWardrobeIds = new Set(['wardrobe-knit','wardrobe-pants','wardrobe-trench','wardrobe-jeans','wardrobe-tee','wardrobe-loafer','wardrobe-dress','wardrobe-hoodie']);
        const savedWardrobe = Array.isArray(saved?.wardrobe) ? saved.wardrobe : [];
        const isUntouchedDemo = savedWardrobe.length && savedWardrobe.every(item => demoWardrobeIds.has(item?.id)) && !(saved?.wardrobeWearLogs || []).some(log => !String(log.id || '').startsWith('wear-'));
        const inventoryCategoryParents = normalizeInventoryCategoryParents(saved?.inventoryCategoryParents && typeof saved.inventoryCategoryParents === 'object' ? saved.inventoryCategoryParents : {});
        const migratedInventory = Array.isArray(saved?.inventory) ? saved.inventory.map(item => {
          const name = String(item.name || '');
          const category = normalizeInventoryCategoryName(item.category);
          if (!category && /面霜/.test(name)) return { ...item, category: '护肤美妆', subcategory: '面霜' };
          if (!category && /面膜/.test(name)) return { ...item, category: '护肤美妆', subcategory: '面膜' };
          return category === String(item.category || '').trim() ? item : { ...item, category };
        }) : [];
        const normalizedInventory = normalizeInventoryItems(migratedInventory, inventoryCategoryParents);
        const normalizedExpenses = migrateRefundDates(normalizeExpenseCategories(Array.isArray(saved?.expenses) ? saved.expenses : []), normalizedInventory);
        const savedCategories = Array.isArray(saved?.inventoryCategories) ? saved.inventoryCategories.map(normalizeInventoryCategoryName) : [];
        const savedCategoryOrder = Array.isArray(saved?.inventoryCategoryOrder) ? saved.inventoryCategoryOrder.map(normalizeInventoryCategoryName) : [];
        // 历史版本可能同时保存了“分类已删除”和“该分类仍有物品”两种冲突状态。
        // 以实际库存为准，避免右侧有物品分组而侧边导航隐藏对应分类。
        const inventoryDeletedCategories = normalizeInventoryDeletedCategories(Array.isArray(saved?.inventoryDeletedCategories) ? saved.inventoryDeletedCategories : []);
        const inventoryCategoryOrder = inventoryCategoryNames(savedCategoryOrder, categories, savedCategories, Object.keys(inventoryCategoryParents), Object.values(inventoryCategoryParents), normalizedInventory.map(item => item.category)).filter(category => !inventoryDeletedCategories.includes(category));
        return migrateState(saved ? {
          ...defaultState,
          ...saved,
          inventory: normalizedInventory,
          expenses: normalizedExpenses,
          inventoryCategoryOrder,
          inventoryCategoryParents,
          inventoryDeletedCategories,
          inventoryTombstones: saved.inventoryTombstones && typeof saved.inventoryTombstones === 'object' ? saved.inventoryTombstones : {},
          inventoryCategories: inventoryCategoryNames(categories, savedCategories, savedCategoryOrder, inventoryCategoryOrder, Object.keys(inventoryCategoryParents), Object.values(inventoryCategoryParents), normalizedInventory.map(item => item.category)).filter(category => !inventoryDeletedCategories.includes(category)),
          inventoryUnits: Array.isArray(saved.inventoryUnits) && saved.inventoryUnits.length ? saved.inventoryUnits : [...defaultInventoryUnits],
          chatHistory: Array.isArray(saved.chatHistory) ? saved.chatHistory : [],
          chatContext: { ...defaultState.chatContext, ...(saved.chatContext || {}) },
          wardrobe: isUntouchedDemo ? [] : (Array.isArray(saved.wardrobe) ? saved.wardrobe : []),
          wardrobeOutfits: isUntouchedDemo ? [] : (Array.isArray(saved.wardrobeOutfits) ? saved.wardrobeOutfits : []),
          wardrobeWearLogs: isUntouchedDemo ? [] : (Array.isArray(saved.wardrobeWearLogs) ? saved.wardrobeWearLogs : [])
        } : structuredClone(defaultState));
    }

    const SCHEMA_VERSION = 1;
    function migrateState(input) {
      const result = structuredClone(input);
      if (Number(result.schemaVersion || 0) > SCHEMA_VERSION) throw new Error('数据版本高于当前应用，请先更新页面');
      result.schemaVersion = SCHEMA_VERSION;
      result.expenseTombstones = result.expenseTombstones || {};
      result.inventoryTombstones = result.inventoryTombstones || {};
      for (const [entity, tombstones] of [['expenses', result.expenseTombstones], ['inventory', result.inventoryTombstones]]) {
        // Promote record-level deletion markers into root tombstones so an
        // older device cannot resurrect the record during a later merge.
        result[entity] = (result[entity] || []).filter(item => {
          if (item?.deletedAt && item.id && !tombstones[item.id]) tombstones[item.id] = item.deletedAt;
          return !item.deletedAt && !tombstones[item.id];
        }).map(item => ({updatedAt: 0, deletedAt: null, updatedBy: '', ...item}));
      }
      const deletedCategories = new Set(result.inventoryDeletedCategories || []);
      for (const item of [...result.inventory, ...result.expenses]) {
        if (deletedCategories.has(item.category)) { item.category = '其他'; item.subcategory = ''; }
        else if (deletedCategories.has(item.subcategory)) item.subcategory = '';
      }
      for (const key of ['inventoryCategories', 'inventoryCategoryOrder']) if (Array.isArray(result[key])) result[key] = result[key].filter(name => !deletedCategories.has(name));
      if (result.inventoryCategoryParents) result.inventoryCategoryParents = Object.fromEntries(Object.entries(result.inventoryCategoryParents).filter(([child,parent]) => !deletedCategories.has(child) && !deletedCategories.has(parent)));
      result.expenses = migrateRefundDates(result.expenses, result.inventory);
      return result;
    }
