/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SPC Kernel · Layer 3 — 同步服务 (SyncService)              ║
 * ║  ──────────────────────────────────────────────────────────  ║
 * ║  全量导出 + 增量导入 + 自动备份 + 数据统计                   ║
 * ║  依赖: SPCDB + SPCCrypto + SPCBus + TaskService             ║
 * ║        + NoteService + VaultService                         ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 创意来源:
 *   - Joplin: 全量加密导出
 *   - KeePassXC: 数据库文件(.kdbx)概念
 *   - Super Productivity: 自动备份 + 版本管理
 *
 * 导出格式 (.spc):
 *   {
 *     version: "1.0",
 *     exportedAt: timestamp,
 *     encrypted: false,
 *     data: {
 *       tasks: [...],
 *       notes: [...],
 *       settings: {...},
 *     }
 *   }
 *
 * 加密导出格式 (.spc.enc):
 *   AES-256-GCM 加密的 JSON
 */

const SyncService = (() => {
  'use strict';

  const FORMAT_VERSION = '1.0';
  const E = SPCBus.Events;


  // ═══════════════════════════════════════
  //  全量导出
  // ═══════════════════════════════════════

  /**
   * 导出全部数据为 JSON
   * @returns {Promise<Object>}  导出包
   */
  async function exportAll() {
    const tasks    = await TaskService.getAll();
    const notes    = await NoteService.getAll();

    const bundle = {
      version:    FORMAT_VERSION,
      app:        'SPC 安全生产力中枢',
      exportedAt: Date.now(),
      exportDate: new Date().toISOString(),
      encrypted:  false,
      stats: {
        tasks:  tasks.length,
        notes:  notes.length,
      },
      data: {
        tasks,
        notes,
        settings: collectSettings(),
      },
    };

    return bundle;
  }

  /**
   * 导出并下载为 .spc 文件
   * @returns {Promise<void>}
   */
  async function downloadExport() {
    const bundle = await exportAll();
    const json   = JSON.stringify(bundle, null, 2);
    const date   = new Date().toISOString().slice(0, 10);
    download(json, `SPC-备份-${date}.spc.json`, 'application/json');
    SPCBus.emit('EXPORT_COMPLETED', bundle.stats);
  }

  /**
   * 导出加密备份
   * @param {string} password  加密密码
   * @returns {Promise<void>}
   */
  async function downloadEncryptedExport(password) {
    if (!password) throw new Error('请提供加密密码');

    const bundle = await exportAll();
    bundle.encrypted = true;

    const json      = JSON.stringify(bundle);
    const encrypted = await SPCCrypto.encrypt(json, password);
    const date      = new Date().toISOString().slice(0, 10);
    download(encrypted, `SPC-加密备份-${date}.spc.enc`, 'application/octet-stream');
    SPCBus.emit('EXPORT_COMPLETED', { ...bundle.stats, encrypted: true });
  }


  // ═══════════════════════════════════════
  //  导入
  // ═══════════════════════════════════════

  /**
   * 从文件导入数据
   * @param {File} file
   * @param {string} [password]  如果是加密文件需要密码
   * @returns {Promise<{tasks: number, notes: number}>}
   */
  async function importFromFile(file, password) {
    const text = await readFile(file);

    let bundle;

    // 判断是否是加密文件
    if (file.name.endsWith('.enc') || !text.startsWith('{')) {
      if (!password) throw new Error('这是加密备份，请提供密码');
      const decrypted = await SPCCrypto.decrypt(text, password);
      bundle = JSON.parse(decrypted);
    } else {
      bundle = JSON.parse(text);
    }

    // 验证格式
    if (!bundle.data) throw new Error('无效的备份文件格式');

    return importBundle(bundle);
  }

  /**
   * 导入数据包
   * @param {Object} bundle
   * @returns {Promise<{tasks: number, notes: number}>}
   */
  async function importBundle(bundle) {
    let taskCount = 0, noteCount = 0;

    // 导入任务
    if (bundle.data.tasks && Array.isArray(bundle.data.tasks)) {
      for (const task of bundle.data.tasks) {
        try {
          await TaskService.create(task);
          taskCount++;
        } catch { /* skip duplicates */ }
      }
    }

    // 导入笔记
    if (bundle.data.notes && Array.isArray(bundle.data.notes)) {
      for (const note of bundle.data.notes) {
        try {
          await NoteService.create(note);
          noteCount++;
        } catch { /* skip duplicates */ }
      }
    }

    // 导入设置
    if (bundle.data.settings) {
      for (const [key, value] of Object.entries(bundle.data.settings)) {
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    }

    SPCBus.emit('IMPORT_COMPLETED', { tasks: taskCount, notes: noteCount });
    return { tasks: taskCount, notes: noteCount };
  }


  // ═══════════════════════════════════════
  //  自动备份
  // ═══════════════════════════════════════

  /**
   * 保存自动备份到 localStorage (最近3份)
   * @returns {Promise<void>}
   */
  async function autoBackup() {
    try {
      const bundle = await exportAll();
      const json   = JSON.stringify(bundle);

      // 读取现有备份列表
      const backups = JSON.parse(localStorage.getItem('spc_autobackups') || '[]');

      backups.push({
        timestamp: Date.now(),
        size:      json.length,
        stats:     bundle.stats,
      });

      // 保留最近3份
      while (backups.length > 3) backups.shift();

      // 存储备份元数据
      localStorage.setItem('spc_autobackups', JSON.stringify(backups));

      // 存储最新备份数据 (覆盖)
      localStorage.setItem('spc_autobackup_latest', json);

      console.log(`[SyncService] 自动备份完成 (${(json.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error('[SyncService] 自动备份失败:', err);
    }
  }

  /**
   * 获取自动备份列表
   * @returns {Array<{timestamp: number, size: number, stats: Object}>}
   */
  function getAutoBackups() {
    return JSON.parse(localStorage.getItem('spc_autobackups') || '[]');
  }

  /**
   * 从最近的自动备份恢复
   * @returns {Promise<{tasks: number, notes: number}>}
   */
  async function restoreFromAutoBackup() {
    const json = localStorage.getItem('spc_autobackup_latest');
    if (!json) throw new Error('没有可用的自动备份');

    const bundle = JSON.parse(json);
    return importBundle(bundle);
  }


  // ═══════════════════════════════════════
  //  全局统计
  // ═══════════════════════════════════════

  /**
   * 获取跨模块综合统计
   * @returns {Promise<Object>}
   */
  async function getGlobalStats() {
    const taskStats = await TaskService.getStats();
    const noteStats = await NoteService.getStats();

    const hasVault = VaultService.isCreated();
    let vaultCount = 0;
    let vaultAudit = null;

    if (hasVault && !VaultService.isLocked()) {
      vaultCount = VaultService.getAll().length;
      try { vaultAudit = await VaultService.audit(); } catch {}
    }

    return {
      tasks:   taskStats,
      notes:   noteStats,
      vault:   { count: vaultCount, locked: VaultService.isLocked(), audit: vaultAudit },
      storage: getStorageUsage(),
      uptime:  Date.now() - (window._spcBootTime || Date.now()),
    };
  }

  /**
   * 获取存储使用情况
   * @returns {Object}
   */
  function getStorageUsage() {
    let totalBytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      totalBytes += (key.length + (localStorage.getItem(key) || '').length) * 2; // UTF-16
    }
    return {
      used:     totalBytes,
      usedKB:   (totalBytes / 1024).toFixed(1),
      usedMB:   (totalBytes / 1048576).toFixed(2),
      limit:    '5 MB (localStorage)',
    };
  }


  // ═══════════════════════════════════════
  //  工具函数
  // ═══════════════════════════════════════

  function collectSettings() {
    const settings = {};
    const prefixes = ['spc_', 'trisync_'];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (prefixes.some(p => key.startsWith(p)) && !key.includes('vault') && !key.includes('backup')) {
        settings[key] = localStorage.getItem(key);
      }
    }
    return settings;
  }

  function download(content, filename, type) {
    const blob = new Blob([content], { type });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  }


  // ─── 公开 API ─────────────────────────
  return {
    // 导出
    exportAll,
    downloadExport,
    downloadEncryptedExport,

    // 导入
    importFromFile,
    importBundle,

    // 自动备份
    autoBackup,
    getAutoBackups,
    restoreFromAutoBackup,

    // 统计
    getGlobalStats,
    getStorageUsage,
  };
})();
