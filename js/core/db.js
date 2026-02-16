/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SPC Kernel · Layer 1 — 数据引擎 (IndexedDB)               ║
 * ║  ──────────────────────────────────────────────────────────  ║
 * ║  基于 Promise 的 IndexedDB 封装器                            ║
 * ║  替代 localStorage: 异步、无阻塞、无 5MB 限制               ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 存储库 (Object Stores):
 *   - tasks          任务 (keyPath: id)
 *   - notes          笔记 (keyPath: id)
 *   - vault_entries  密码条目 (keyPath: id)
 *   - settings       全局配置 (keyPath: key)
 *
 * 索引:
 *   tasks → status, priority, dueDate, project, createdAt
 *   notes → folder, pinned, updatedAt
 *   vault_entries → group, updatedAt
 */

const SPCDB = (() => {
  'use strict';

  // ─── 常量 ──────────────────────────────
  const DB_NAME    = 'spc_kernel';
  const DB_VERSION = 1;

  /**
   * 存储库定义表
   * 每项: { name, keyPath, autoIncrement, indexes: [{ name, keyPath, options }] }
   */
  const STORE_SCHEMA = [
    {
      name: 'tasks',
      keyPath: 'id',
      indexes: [
        { name: 'by_status',    keyPath: 'status'    },
        { name: 'by_priority',  keyPath: 'priority'  },
        { name: 'by_dueDate',   keyPath: 'dueDate'   },
        { name: 'by_project',   keyPath: 'project'   },
        { name: 'by_createdAt', keyPath: 'createdAt' },
        { name: 'by_updatedAt', keyPath: 'updatedAt' },
        // 复合索引: 按状态+优先级快速查询
        { name: 'by_status_priority', keyPath: ['status', 'priority'] },
      ],
    },
    {
      name: 'notes',
      keyPath: 'id',
      indexes: [
        { name: 'by_folder',    keyPath: 'folder'    },
        { name: 'by_pinned',    keyPath: 'pinned'    },
        { name: 'by_updatedAt', keyPath: 'updatedAt' },
        { name: 'by_createdAt', keyPath: 'createdAt' },
      ],
    },
    {
      name: 'vault_entries',
      keyPath: 'id',
      indexes: [
        { name: 'by_group',     keyPath: 'group'     },
        { name: 'by_updatedAt', keyPath: 'updatedAt' },
        { name: 'by_name',      keyPath: 'name'      },
      ],
    },
    {
      name: 'settings',
      keyPath: 'key',
      indexes: [],
    },
  ];

  /** @type {IDBDatabase|null} 数据库连接单例 */
  let _db = null;


  // ═══════════════════════════════════════
  //  连接管理
  // ═══════════════════════════════════════

  /**
   * 打开数据库连接 (单例模式)
   * 首次调用时创建所有存储库和索引
   * @returns {Promise<IDBDatabase>}
   */
  function open() {
    if (_db) return Promise.resolve(_db);

    return new Promise((resolve, reject) => {
      let request;

      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(new Error(`[SPCDB] IndexedDB 不可用: ${err.message}`));
        return;
      }

      /**
       * 数据库升级 — 创建/更新存储库结构
       * 仅在版本号变化时触发
       */
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        console.log(`[SPCDB] 升级数据库 v${event.oldVersion} → v${DB_VERSION}`);

        for (const schema of STORE_SCHEMA) {
          // 如果存储库已存在则跳过 (幂等)
          if (db.objectStoreNames.contains(schema.name)) continue;

          const store = db.createObjectStore(schema.name, {
            keyPath: schema.keyPath,
            autoIncrement: schema.autoIncrement || false,
          });

          // 创建索引
          for (const idx of schema.indexes) {
            store.createIndex(idx.name, idx.keyPath, idx.options || {});
          }

          console.log(`[SPCDB] 已创建存储库: ${schema.name} (${schema.indexes.length} 个索引)`);
        }
      };

      request.onsuccess = (event) => {
        _db = event.target.result;

        // 监听意外关闭 (如用户在 DevTools 中删除数据库)
        _db.onversionchange = () => {
          _db.close();
          _db = null;
          console.warn('[SPCDB] 数据库版本已变更，连接已关闭');
        };

        _db.onerror = (err) => {
          console.error('[SPCDB] 数据库错误:', err.target.error);
        };

        console.log(`[SPCDB] 数据库已连接 (${STORE_SCHEMA.length} 个存储库)`);
        resolve(_db);
      };

      request.onerror = (event) => {
        reject(new Error(`[SPCDB] 打开数据库失败: ${event.target.error?.message}`));
      };

      request.onblocked = () => {
        console.warn('[SPCDB] 数据库被阻塞 — 请关闭其他使用此数据库的标签页');
      };
    });
  }

  /**
   * 获取事务 + 对象存储
   * @param {string} storeName  存储库名称
   * @param {'readonly'|'readwrite'} mode  事务模式
   * @returns {Promise<{tx: IDBTransaction, store: IDBObjectStore}>}
   */
  async function getStore(storeName, mode = 'readonly') {
    const db = await open();

    if (!db.objectStoreNames.contains(storeName)) {
      throw new Error(`[SPCDB] 存储库 "${storeName}" 不存在`);
    }

    const tx    = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    return { tx, store };
  }

  /**
   * 将 IDBRequest 包装为 Promise
   * @param {IDBRequest} request
   * @returns {Promise<*>}
   */
  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror   = () => reject(request.error);
    });
  }


  // ═══════════════════════════════════════
  //  CRUD 操作
  // ═══════════════════════════════════════

  /**
   * 添加记录 (如果 key 已存在则失败)
   * @param {string} storeName
   * @param {Object} record  必须包含 keyPath 指定的字段
   * @returns {Promise<IDBValidKey>} 返回写入的 key
   */
  async function add(storeName, record) {
    try {
      const { store } = await getStore(storeName, 'readwrite');
      return await promisify(store.add(record));
    } catch (err) {
      console.error(`[SPCDB] add(${storeName}) 失败:`, err);
      throw err;
    }
  }

  /**
   * 添加或更新记录 (upsert)
   * @param {string} storeName
   * @param {Object} record
   * @returns {Promise<IDBValidKey>}
   */
  async function put(storeName, record) {
    try {
      const { store } = await getStore(storeName, 'readwrite');
      return await promisify(store.put(record));
    } catch (err) {
      console.error(`[SPCDB] put(${storeName}) 失败:`, err);
      throw err;
    }
  }

  /**
   * 获取单条记录
   * @param {string} storeName
   * @param {IDBValidKey} key
   * @returns {Promise<Object|undefined>}
   */
  async function get(storeName, key) {
    try {
      const { store } = await getStore(storeName, 'readonly');
      return await promisify(store.get(key));
    } catch (err) {
      console.error(`[SPCDB] get(${storeName}, ${key}) 失败:`, err);
      throw err;
    }
  }

  /**
   * 获取存储库中的全部记录
   * @param {string} storeName
   * @returns {Promise<Object[]>}
   */
  async function getAll(storeName) {
    try {
      const { store } = await getStore(storeName, 'readonly');
      return await promisify(store.getAll());
    } catch (err) {
      console.error(`[SPCDB] getAll(${storeName}) 失败:`, err);
      throw err;
    }
  }

  /**
   * 更新记录 (先读后写，合并字段)
   * @param {string} storeName
   * @param {IDBValidKey} key
   * @param {Object} fields  需要更新的字段 (浅合并)
   * @returns {Promise<Object>}  返回更新后的完整记录
   */
  async function update(storeName, key, fields) {
    try {
      const { store } = await getStore(storeName, 'readwrite');
      const existing = await promisify(store.get(key));

      if (!existing) {
        throw new Error(`[SPCDB] 记录不存在: ${storeName}/${key}`);
      }

      const updated = { ...existing, ...fields };
      await promisify(store.put(updated));
      return updated;
    } catch (err) {
      console.error(`[SPCDB] update(${storeName}, ${key}) 失败:`, err);
      throw err;
    }
  }

  /**
   * 删除单条记录
   * @param {string} storeName
   * @param {IDBValidKey} key
   * @returns {Promise<void>}
   */
  async function remove(storeName, key) {
    try {
      const { store } = await getStore(storeName, 'readwrite');
      return await promisify(store.delete(key));
    } catch (err) {
      console.error(`[SPCDB] remove(${storeName}, ${key}) 失败:`, err);
      throw err;
    }
  }

  /**
   * 清空存储库
   * @param {string} storeName
   * @returns {Promise<void>}
   */
  async function clear(storeName) {
    try {
      const { store } = await getStore(storeName, 'readwrite');
      return await promisify(store.clear());
    } catch (err) {
      console.error(`[SPCDB] clear(${storeName}) 失败:`, err);
      throw err;
    }
  }

  /**
   * 计算存储库中的记录数
   * @param {string} storeName
   * @returns {Promise<number>}
   */
  async function count(storeName) {
    try {
      const { store } = await getStore(storeName, 'readonly');
      return await promisify(store.count());
    } catch (err) {
      console.error(`[SPCDB] count(${storeName}) 失败:`, err);
      throw err;
    }
  }


  // ═══════════════════════════════════════
  //  索引查询
  // ═══════════════════════════════════════

  /**
   * 通过索引获取记录
   * @param {string} storeName
   * @param {string} indexName  索引名称
   * @param {IDBValidKey|IDBKeyRange} query  查询键或范围
   * @returns {Promise<Object[]>}
   */
  async function getByIndex(storeName, indexName, query) {
    try {
      const { store } = await getStore(storeName, 'readonly');
      const index = store.index(indexName);
      return await promisify(index.getAll(query));
    } catch (err) {
      console.error(`[SPCDB] getByIndex(${storeName}, ${indexName}) 失败:`, err);
      throw err;
    }
  }

  /**
   * 通过索引计数
   * @param {string} storeName
   * @param {string} indexName
   * @param {IDBValidKey|IDBKeyRange} query
   * @returns {Promise<number>}
   */
  async function countByIndex(storeName, indexName, query) {
    try {
      const { store } = await getStore(storeName, 'readonly');
      const index = store.index(indexName);
      return await promisify(index.count(query));
    } catch (err) {
      console.error(`[SPCDB] countByIndex(${storeName}, ${indexName}) 失败:`, err);
      throw err;
    }
  }


  // ═══════════════════════════════════════
  //  批量操作
  // ═══════════════════════════════════════

  /**
   * 批量写入 (在单个事务中)
   * @param {string} storeName
   * @param {Object[]} records
   * @returns {Promise<void>}
   */
  async function bulkPut(storeName, records) {
    if (!records || records.length === 0) return;

    try {
      const { tx, store } = await getStore(storeName, 'readwrite');

      for (const record of records) {
        store.put(record);
      }

      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
        tx.onabort    = () => reject(new Error('[SPCDB] 批量写入事务被中止'));
      });
    } catch (err) {
      console.error(`[SPCDB] bulkPut(${storeName}, ${records.length} 条) 失败:`, err);
      throw err;
    }
  }


  // ═══════════════════════════════════════
  //  数据迁移 (localStorage → IndexedDB)
  // ═══════════════════════════════════════

  /**
   * 将 localStorage 中的旧数据迁移到 IndexedDB
   * 迁移成功后标记已完成，避免重复迁移
   * @returns {Promise<{tasks: number, notes: number}>} 迁移记录数
   */
  async function migrateFromLocalStorage() {
    const MIGRATION_FLAG = 'spc_idb_migrated';

    // 已迁移过则跳过
    if (localStorage.getItem(MIGRATION_FLAG) === 'true') {
      return { tasks: 0, notes: 0 };
    }

    let taskCount = 0, noteCount = 0;

    try {
      // 迁移任务
      const tasksRaw = localStorage.getItem('trisync_tasks');
      if (tasksRaw) {
        const tasks = JSON.parse(tasksRaw);
        if (Array.isArray(tasks) && tasks.length > 0) {
          await bulkPut('tasks', tasks);
          taskCount = tasks.length;
          console.log(`[SPCDB] 已迁移 ${taskCount} 条任务`);
        }
      }

      // 迁移笔记
      const notesRaw = localStorage.getItem('trisync_notes');
      if (notesRaw) {
        const notes = JSON.parse(notesRaw);
        if (Array.isArray(notes) && notes.length > 0) {
          await bulkPut('notes', notes);
          noteCount = notes.length;
          console.log(`[SPCDB] 已迁移 ${noteCount} 篇笔记`);
        }
      }

      // 标记迁移完成
      localStorage.setItem(MIGRATION_FLAG, 'true');
      console.log('[SPCDB] localStorage → IndexedDB 迁移完成');

    } catch (err) {
      console.error('[SPCDB] 数据迁移失败:', err);
      // 不标记完成，下次启动时重试
    }

    return { tasks: taskCount, notes: noteCount };
  }


  // ═══════════════════════════════════════
  //  关闭 & 销毁
  // ═══════════════════════════════════════

  /**
   * 关闭数据库连接
   */
  function close() {
    if (_db) {
      _db.close();
      _db = null;
      console.log('[SPCDB] 数据库连接已关闭');
    }
  }

  /**
   * 完全删除数据库 (危险操作)
   * @returns {Promise<void>}
   */
  function destroy() {
    close();
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => { console.log('[SPCDB] 数据库已删除'); resolve(); };
      request.onerror   = () => reject(request.error);
    });
  }


  // ─── 公开 API ─────────────────────────
  return {
    // 连接
    open,
    close,
    destroy,

    // CRUD
    add,
    put,
    get,
    getAll,
    update,
    remove,      // 用 remove 而非 delete (避免保留字)
    clear,
    count,

    // 索引查询
    getByIndex,
    countByIndex,

    // 批量
    bulkPut,

    // 迁移
    migrateFromLocalStorage,

    // 常量
    DB_NAME,
    DB_VERSION,
  };
})();
