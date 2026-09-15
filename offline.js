// IndexedDB snapshots, backups and compatibility outbox.
    let offlineDbPromise = null;
    function openOfflineDb() {
      if (!('indexedDB' in window)) return Promise.resolve(null);
      if (!offlineDbPromise) offlineDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(IDB_NAME, IDB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('states')) db.createObjectStore('states');
          if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups');
          if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }).catch(() => null);
      return offlineDbPromise;
    }
    async function offlinePut(storeName, key, value) {
      const db = await openOfflineDb(); if (!db) return;
      await new Promise((resolve, reject) => { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(value, key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
    }
    async function offlineGet(storeName, key) {
      const db = await openOfflineDb(); if (!db) return null;
      return new Promise(resolve => { const tx = db.transaction(storeName, 'readonly'); const request = tx.objectStore(storeName).get(key); request.onsuccess = () => resolve(request.result || null); request.onerror = () => resolve(null); });
    }
    async function clearOfflineOutbox(storeKey, through = 0) {
      const db = await openOfflineDb(); if (!db) return;
      await new Promise((resolve,reject) => {
        const tx = db.transaction('outbox','readwrite');
        tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
        const request=tx.objectStore('outbox').openCursor();
        request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;
          if(cursor.value?.storeKey===storeKey && Number(cursor.value.changedAt || 0)<through) cursor.delete();
          cursor.continue();
        };
      });
    }
    async function latestOfflineBackup(storeKey) {
      const db = await openOfflineDb(); if (!db) return null;
      return new Promise(resolve => { const tx = db.transaction('backups', 'readonly'); const store = tx.objectStore('backups'); const request = store.getAllKeys(); request.onsuccess = () => { const keys = request.result.filter(item => String(item).startsWith(`${storeKey}:`)).sort(); const key = keys[keys.length - 1]; if (!key) return resolve(null); const read = store.get(key); read.onsuccess = () => resolve(read.result || null); read.onerror = () => resolve(null); }; request.onerror = () => resolve(null); });
    }
    function recordEvents(before, after, storeKey, changedAt = Date.now()) {
      const events = [];
      for (const [collection, kind, tombstoneKey] of [['expenses', 'expense', 'expenseTombstones'], ['inventory', 'inventory', 'inventoryTombstones']]) {
        const old = new Map((before?.[collection] || []).map(item => [item.id, item]));
        const next = new Map((after[collection] || []).map(item => [item.id, item]));
        for (const [id, item] of next) {
          if (JSON.stringify(old.get(id)) === JSON.stringify(item)) continue;
          events.push({eventId: uid(), storeKey, changedAt, entityType: kind === 'expense' && (item.kind === 'refund' || Number(item.amount) < 0) ? 'refund' : kind, entityId: id, operation: old.has(id) ? 'update' : 'create', payload: structuredClone(item)});
        }
        for (const [id, item] of old) if (!next.has(id)) events.push({eventId: uid(), storeKey, changedAt, entityType: kind === 'expense' && (item.kind === 'refund' || Number(item.amount) < 0) ? 'refund' : kind, entityId: id, operation: 'delete', payload: {...item, deletedAt: after[tombstoneKey]?.[id] || changedAt}});
      }
      return events;
    }
    let offlineWriteQueue = Promise.resolve();
    function queueOfflineSnapshot(storeKey, snapshot, events = []) {
      const operation = offlineWriteQueue.catch(() => {}).then(async () => {
        const db = await openOfflineDb(); if (!db) throw new Error('离线数据库暂不可用');
        const compact = { ...snapshot, wardrobe: (snapshot.wardrobe || []).map(item => ({ ...item, image: '' })) };
        await new Promise((resolve, reject) => {
          const tx = db.transaction(['states', 'backups', 'outbox'], 'readwrite');
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('离线写入已中止'));
          tx.objectStore('states').put(snapshot, storeKey);
          const backups = tx.objectStore('backups');
          backups.put(compact, `${storeKey}:${Date.now()}:${uid()}`);
          const keys = backups.getAllKeys();
          keys.onsuccess = () => keys.result.filter(key => String(key).startsWith(`${storeKey}:`)).sort().slice(0, -30).forEach(key => backups.delete(key));
          events.forEach(event => tx.objectStore('outbox').add(event));
        });
      });
      offlineWriteQueue = operation;
      // Always attach a rejection handler; primary localStorage save remains valid.
      operation.catch(error => { console.warn('离线副本写入失败', error); if (typeof setSyncStatus === 'function') setSyncStatus('本地已保存，离线副本暂未更新'); });
      return operation;
    }
    async function hydrateOfflineState(storeKey) {
      const saved = await offlineGet('states', storeKey);
      if (!saved || storeKey !== currentStoreKey) return;
      const merged = mergeState(state, saved);
      if (JSON.stringify(merged) === JSON.stringify(state)) return;
      state = merged; if (!persistState()) { setSyncStatus('离线恢复保存失败，原本地数据已保留'); return; } renderAll();
      if (authUser) queueCloudSave();
      setSyncStatus(`已恢复本机离线数据（${wardrobeItems().length} 件衣物）`);
    }

// Existing image database and namespace are retained.
    function inventoryImageKey(id, storeKey = currentStoreKey) { return `${storeKey}:${id}`; }
    function openInventoryImageDb() {
      if (inventoryImageDbPromise) return inventoryImageDbPromise;
      inventoryImageDbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
        const request = indexedDB.open(typeof TEST_IMAGE_DB_NAME === 'string' ? TEST_IMAGE_DB_NAME : 'manmanmai-inventory-images-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('images');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
      });
      return inventoryImageDbPromise;
    }
    async function saveInventoryImage(id, data) {
      const db = await openInventoryImageDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readwrite');
        tx.objectStore('images').put(data, inventoryImageKey(id));
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error('Image save failed'));
      });
      inventoryImageCache.set(id, data);
    }
    async function deleteInventoryImage(id) {
      try {
        const db = await openInventoryImageDb();
        await new Promise((resolve, reject) => {
          const tx = db.transaction('images', 'readwrite');
          tx.objectStore('images').delete(inventoryImageKey(id));
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error('Image delete failed'));
        });
      } finally { inventoryImageCache.delete(id); }
    }
    async function loadInventoryImages() {
      const loadKey = currentStoreKey;
      if (inventoryImageLoadKey === loadKey) return;
      inventoryImageLoadKey = loadKey;
      inventoryImageCache = new Map();
      try {
        const db = await openInventoryImageDb();
        await Promise.all(state.inventory.map(async item => {
          let data = item.image || '';
          if (data) {
            await saveInventoryImage(item.id, data);
            // Keep legacy JSON image until an explicit edit; reads do not mutate business data.
          } else {
            data = await new Promise((resolve, reject) => {
              const tx = db.transaction('images', 'readonly'); const request = tx.objectStore('images').get(inventoryImageKey(item.id));
              request.onsuccess = () => resolve(request.result || ''); request.onerror = () => reject(request.error);
            });
          }
          if (data) inventoryImageCache.set(item.id, data);
        }));
        renderInventory(); renderAttention();
      } catch (error) {
        console.warn('库存照片数据库不可用', error);
      }
    }
    async function clearInventoryImages() {
      const db = await openInventoryImageDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readwrite');
        const store = tx.objectStore('images');
        const request = store.getAllKeys();
        request.onsuccess = () => request.result.filter(key => String(key).startsWith(`${currentStoreKey}:`)).forEach(key => store.delete(key));
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error('Image clear failed'));
      });
      inventoryImageCache.clear();
    }
