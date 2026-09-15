// Compatible classic-script module: local persistence and account storage boundaries.
const committedSnapshots = new Map();
function loadState(storageKey = currentStoreKey) {
  const raw = localStorage.getItem(storageKey);
  let parsed;
  try { parsed = JSON.parse(raw); } catch (error) {
    throw new Error('本地数据格式异常，已保留原数据，请先导出检查');
  }
  const loaded = normalizeSavedState(parsed);
  committedSnapshots.set(storageKey, structuredClone(loaded));
  return loaded;
}
    function persistState() {
      try {
        state = stampChanges(committedSnapshots.get(currentStoreKey), migrateState(state));
        localStorage.setItem(currentStoreKey, JSON.stringify(state));
        queueOfflineSnapshot(currentStoreKey, structuredClone(state), recordEvents(committedSnapshots.get(currentStoreKey), state, currentStoreKey));
        committedSnapshots.set(currentStoreKey, structuredClone(state));
        lastPersistError = null;
        return true;
      } catch (error) {
        const committed = committedSnapshots.get(currentStoreKey);
        if (committed) state = structuredClone(committed);
        lastPersistError = error;
        console.error('保存本地数据失败', error);
        return false;
      }
    }
    function accountStoreKey(user) { return `${STORE_KEY}:account:${user.id}`; }
    function activateAccountState(user) {
      if (!user?.id) return;
      const nextKey = accountStoreKey(user);
      const hasAccountCache = Boolean(localStorage.getItem(nextKey));
      const migrationOwner = localStorage.getItem(ACCOUNT_SCOPE_MARKER);
      const legacyState = localStorage.getItem(LEGACY_STATE_KEY);
      if (!hasAccountCache && !migrationOwner) {
        let migrationSnapshot = currentStoreKey === STORE_KEY && hasPersonalData(state) ? state : null;
        if (!migrationSnapshot && legacyState) {
          try { migrationSnapshot = JSON.parse(legacyState); } catch { migrationSnapshot = null; }
        }
        if (migrationSnapshot && hasPersonalData(migrationSnapshot)) {
          localStorage.setItem(nextKey, JSON.stringify(migrationSnapshot));
          if (legacyState) localStorage.removeItem(LEGACY_STATE_KEY);
          localStorage.setItem(ACCOUNT_SCOPE_MARKER, user.id);
          localStorage.setItem(STORE_KEY, JSON.stringify(structuredClone(defaultState)));
        }
      }
      currentStoreKey = nextKey;
      state = loadState(nextKey);
      hydrateOfflineState(nextKey);
      inventoryImageLoadKey = '';
      inventoryImageCache = new Map();
      authUser = user;
    }
    function activateGuestState() {
      if (currentStoreKey === STORE_KEY && !localStorage.getItem(ACCOUNT_SCOPE_MARKER) && hasPersonalData(state)) localStorage.setItem(LEGACY_STATE_KEY, JSON.stringify(state));
      currentStoreKey = STORE_KEY;
      state = loadState(STORE_KEY);
      hydrateOfflineState(STORE_KEY);
      inventoryImageLoadKey = '';
      inventoryImageCache = new Map();
      authUser = null;
      pendingDecision = null;
      pendingChatEntries = [];
    }
    function prepareGuestBootState() {
      currentStoreKey = STORE_KEY;
      if (localStorage.getItem(ACCOUNT_SCOPE_MARKER)) {
        state = structuredClone(defaultState);
        return;
      }
      const legacyState = localStorage.getItem(LEGACY_STATE_KEY);
      if (!hasPersonalData(state) && legacyState) {
        try {
          state = { ...defaultState, ...JSON.parse(legacyState) };
          persistState();
          localStorage.removeItem(LEGACY_STATE_KEY);
        } catch { /* Keep the current default state when an old backup is malformed. */ }
      }
    }
    function saveState() {
      if (!persistState()) return false;
      renderAll();
      queueCloudSave();
      return true;
    }

// One synchronous commit for each business operation. No draft escapes before save.
function transact(command) {
  const before = state;
  const draft = structuredClone(before);
  try {
    const result = command(draft);
    validateBusinessState(draft);
    state = draft;
    if (!persistState()) { state = before; return {ok:false, error:lastPersistError}; }
    try { renderAll(); queueCloudSave(); } catch (error) { console.error("数据已保存，界面更新失败", error); }
    return {ok:true, value:result};
  } catch (error) {
    state = before; lastPersistError = error;
    return {ok:false, error};
  }
}
function validateBusinessState(snapshot) {
  const seen = new Set();
  for (const item of snapshot.inventory || []) quantity(item.qty);
  for (const item of snapshot.expenses || []) {
    if (!item.sourceExpenseId || !(item.kind === 'refund' || Number(item.amount) < 0)) continue;
    if (seen.has(item.sourceExpenseId)) throw Error('同一消费存在多条退款，请先确认历史冲突');
    seen.add(item.sourceExpenseId);
  }
}
function stampChanges(before, next) {
  const now = Date.now();
  next.recordTombstones = {...(next.recordTombstones || {})};
  for (const [collection, tombstoneKey] of [['expenses','expenseTombstones'],['inventory','inventoryTombstones']]) {
    const old = new Map((before?.[collection] || []).map(x => [x.id,x]));
    const ids = new Set(next[collection].map(x => x.id));
    next[tombstoneKey] = {...(next[tombstoneKey] || {})};
    for (const record of next[collection]) if (JSON.stringify(old.get(record.id)) !== JSON.stringify(record)) {
      record.updatedAt = Math.max(now, Number(old.get(record.id)?.updatedAt || 0) + 1);
      record.updatedBy = DEVICE_ID; record.deletedAt = null;
    }
    for (const [id, record] of old) if (!ids.has(id)) {
      next[tombstoneKey][id] = Math.max(now, Number(next[tombstoneKey][id] || 0));
      next.recordTombstones[`${collection}:${id}`] = {...record, deletedAt:next[tombstoneKey][id], updatedAt:next[tombstoneKey][id], updatedBy:DEVICE_ID};
    }
  }
  return next;
}
function getPreference(key) { return localStorage.getItem(key); }
function setPreference(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch { showToast('设置暂未保存，请检查本地存储空间'); return false; }
}
function importBackup(data) {
  const migrated = normalizeSavedState(data);
  return transact(draft => Object.assign(draft, mergeState(draft, migrated)));
}

function mergeEntityRecords(local = [], remote = [], tombstones = {}) {
  const records = new Map();
  const rank = item => [String(Number(item.updatedAt || 0)).padStart(20, '0'), String(item.updatedBy || ''), JSON.stringify(item)].join('|');
  for (const item of [...local, ...remote]) {
    if (!item?.id || item.deletedAt || tombstones[item.id]) continue;
    const existing = records.get(item.id);
    if (!existing || rank(item) > rank(existing)) records.set(item.id, item);
  }
  return [...records.values()].sort((a,b) => String(a.id).localeCompare(String(b.id)));
}
