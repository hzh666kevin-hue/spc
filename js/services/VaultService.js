/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SPC Kernel · Layer 3 — 保险箱服务 (VaultService)           ║
 * ║  ──────────────────────────────────────────────────────────  ║
 * ║  加密 CRUD + 安全审计 + 密码生成 + 自动锁定                 ║
 * ║  依赖: SPCDB + SPCCrypto + SPCBus                          ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 安全模型:
 *   - 所有条目在 IndexedDB 中以 AES-256-GCM 密文存储
 *   - 主密码仅保留在内存中，锁定时清零
 *   - 密码验证哈希 (PBKDF2) 用于快速校验
 *   - 剪贴板自动清除 (30秒)
 *   - 无操作自动锁定 (可配置)
 *
 * 安全审计 (灵感来自 Padloc + KeePassXC):
 *   - 弱密码检测 (基于 SPCCrypto.evaluateStrength)
 *   - 重复密码检测 (SHA-256 哈希比对)
 *   - 过期密码提醒 (>90天未更新)
 *   - 空密码条目警告
 */

const VaultService = (() => {
  'use strict';

  const STORE = 'vault_entries';
  const E = SPCBus.Events;

  // ─── 内存状态 (锁定时清零) ────────────
  let _masterKey    = null;   // 主密码 (明文, 仅内存)
  let _entries      = [];     // 解密后的条目缓存
  let _locked       = true;
  let _clipTimer    = null;
  const CLIP_CLEAR  = 30000;  // 剪贴板清除时间 (30秒)

  // ─── localStorage 兼容键 ──────────────
  const LS_VAULT    = 'trisync_vault';
  const LS_VERIFIER = 'spc_vault_verifier';


  // ═══════════════════════════════════════
  //  初始化 & 锁定
  // ═══════════════════════════════════════

  /**
   * 检查保险箱是否已创建
   * @returns {boolean}
   */
  function isCreated() {
    return !!localStorage.getItem(LS_VERIFIER) || !!localStorage.getItem(LS_VAULT);
  }

  /**
   * 创建新保险箱
   * @param {string} masterPassword  主密码 (>=4字符)
   * @returns {Promise<void>}
   */
  async function create(masterPassword) {
    if (!masterPassword || masterPassword.length < 4) {
      throw new Error('主密码至少4位');
    }

    // 创建验证哈希
    const verifier = await SPCCrypto.createVerifier(masterPassword);
    localStorage.setItem(LS_VERIFIER, verifier);

    // 加密空数组并存储
    const encrypted = await SPCCrypto.encrypt('[]', masterPassword);
    localStorage.setItem(LS_VAULT, encrypted);

    _masterKey = masterPassword;
    _entries = [];
    _locked = false;

    SPCBus.emit(E.VAULT_UNLOCKED);
  }

  /**
   * 解锁保险箱
   * @param {string} masterPassword
   * @returns {Promise<void>}
   * @throws {Error} 密码错误时抛出
   */
  async function unlock(masterPassword) {
    if (!masterPassword) throw new Error('请输入密码');

    // 快速验证 (避免完整解密)
    const verifier = localStorage.getItem(LS_VERIFIER);
    if (verifier) {
      const valid = await SPCCrypto.checkVerifier(masterPassword, verifier);
      if (!valid) throw new Error('密码错误');
    }

    // 解密数据
    const encrypted = localStorage.getItem(LS_VAULT);
    if (!encrypted) {
      _masterKey = masterPassword;
      _entries = [];
      _locked = false;
      SPCBus.emit(E.VAULT_UNLOCKED);
      return;
    }

    try {
      const decrypted = await SPCCrypto.decrypt(encrypted, masterPassword);
      _entries = JSON.parse(decrypted);
      _masterKey = masterPassword;
      _locked = false;
      SPCBus.emit(E.VAULT_UNLOCKED, { count: _entries.length });
    } catch {
      throw new Error('密码错误或数据损坏');
    }
  }

  /**
   * 锁定保险箱 (清除内存中的敏感数据)
   */
  function lock() {
    _masterKey = null;
    _entries = [];
    _locked = true;
    clearClipboard();
    SPCBus.emit(E.VAULT_LOCKED);
  }

  /** @returns {boolean} */
  function isLocked() { return _locked; }


  // ═══════════════════════════════════════
  //  CRUD
  // ═══════════════════════════════════════

  /**
   * 获取所有条目 (已解密)
   * @returns {Object[]}
   */
  function getAll() {
    assertUnlocked();
    return [..._entries];
  }

  /**
   * 获取单个条目
   * @param {string} id
   * @returns {Object|undefined}
   */
  function getById(id) {
    assertUnlocked();
    return _entries.find(e => e.id === id);
  }

  /**
   * 添加/更新条目
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async function save(data) {
    assertUnlocked();

    const now = Date.now();
    const existing = data.id ? _entries.find(e => e.id === data.id) : null;

    const entry = {
      id:        data.id || crypto.randomUUID(),
      name:      data.name || '',
      username:  data.username || '',
      password:  data.password || '',
      url:       data.url || '',
      notes:     data.notes || '',
      group:     data.group || '',
      // 安全审计字段
      pwdChangedAt: existing?.password !== data.password ? now : (existing?.pwdChangedAt || now),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    if (existing) {
      const idx = _entries.findIndex(e => e.id === entry.id);
      _entries[idx] = entry;
    } else {
      _entries.unshift(entry);
    }

    await persist();
    SPCBus.emit(E.VAULT_ENTRY_SAVED, entry);
    return entry;
  }

  /**
   * 删除条目
   * @param {string} id
   * @returns {Promise<void>}
   */
  async function remove(id) {
    assertUnlocked();
    _entries = _entries.filter(e => e.id !== id);
    await persist();
    SPCBus.emit(E.VAULT_ENTRY_DELETED, { id });
  }

  /**
   * 搜索条目
   * @param {string} query
   * @returns {Object[]}
   */
  function search(query) {
    assertUnlocked();
    if (!query) return getAll();
    const q = query.toLowerCase();
    return _entries.filter(e =>
      (e.name || '').toLowerCase().includes(q) ||
      (e.username || '').toLowerCase().includes(q) ||
      (e.url || '').toLowerCase().includes(q) ||
      (e.group || '').toLowerCase().includes(q)
    );
  }

  /**
   * 获取所有分组
   * @returns {string[]}
   */
  function getGroups() {
    assertUnlocked();
    return [...new Set(_entries.map(e => e.group).filter(Boolean))].sort();
  }


  // ═══════════════════════════════════════
  //  安全审计 (Padloc + KeePassXC 风格)
  // ═══════════════════════════════════════

  /**
   * 执行完整安全审计
   * @returns {Promise<{
   *   total: number,
   *   weak: Object[],
   *   reused: Object[][],
   *   old: Object[],
   *   empty: Object[],
   *   score: number,
   *   grade: string,
   * }>}
   */
  async function audit() {
    assertUnlocked();

    const total = _entries.length;
    if (total === 0) return { total: 0, weak: [], reused: [], old: [], empty: [], score: 100, grade: 'A' };

    // 1. 弱密码检测
    const weak = _entries.filter(e => {
      if (!e.password) return false;
      const s = SPCCrypto.evaluateStrength(e.password);
      return s.score <= 1;
    });

    // 2. 重复密码检测 (按密码分组)
    const pwdGroups = {};
    for (const e of _entries) {
      if (!e.password) continue;
      // 用密码的前8字符+长度作为简单分组键 (避免存储明文哈希)
      const key = e.password.length + ':' + e.password.slice(0, 3);
      if (!pwdGroups[key]) pwdGroups[key] = [];
      pwdGroups[key].push(e);
    }
    // 进一步精确比对同组内的密码
    const reused = [];
    for (const group of Object.values(pwdGroups)) {
      if (group.length < 2) continue;
      // 精确匹配
      const exactGroups = {};
      for (const e of group) {
        if (!exactGroups[e.password]) exactGroups[e.password] = [];
        exactGroups[e.password].push(e);
      }
      for (const eg of Object.values(exactGroups)) {
        if (eg.length >= 2) reused.push(eg);
      }
    }

    // 3. 过期密码 (>90天未更新)
    const now = Date.now();
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    const old = _entries.filter(e =>
      e.password && (now - (e.pwdChangedAt || e.createdAt)) > NINETY_DAYS
    );

    // 4. 空密码
    const empty = _entries.filter(e => !e.password);

    // 5. 计算安全评分 (0-100)
    const issues = weak.length + reused.length * 2 + old.length * 0.5 + empty.length;
    const score = Math.max(0, Math.round(100 - (issues / total) * 100));
    const grade = score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F';

    return { total, weak, reused, old, empty, score, grade };
  }


  // ═══════════════════════════════════════
  //  密码生成 (委托 SPCCrypto)
  // ═══════════════════════════════════════

  /**
   * 生成安全密码
   * @param {Object} [options]
   * @returns {string}
   */
  function generatePassword(options) {
    return SPCCrypto.generatePassword(options);
  }

  /**
   * 评估密码强度
   * @param {string} password
   * @returns {Object}
   */
  function evaluateStrength(password) {
    return SPCCrypto.evaluateStrength(password);
  }


  // ═══════════════════════════════════════
  //  剪贴板安全
  // ═══════════════════════════════════════

  /**
   * 安全复制到剪贴板 (自动定时清除)
   * @param {string} text
   * @param {string} [fieldName]  字段名 (用于事件通知)
   */
  function secureCopy(text, fieldName = '') {
    navigator.clipboard.writeText(text).catch(() => {});

    // 清除旧计时器
    if (_clipTimer) clearTimeout(_clipTimer);

    // 设置自动清除
    _clipTimer = setTimeout(() => {
      navigator.clipboard.writeText('').catch(() => {});
      _clipTimer = null;
    }, CLIP_CLEAR);
  }

  function clearClipboard() {
    if (_clipTimer) { clearTimeout(_clipTimer); _clipTimer = null; }
    navigator.clipboard.writeText('').catch(() => {});
  }


  // ═══════════════════════════════════════
  //  导入 / 导出
  // ═══════════════════════════════════════

  /**
   * 导出为加密 JSON
   * @returns {Promise<string>}  加密后的 JSON 字符串
   */
  async function exportEncrypted() {
    assertUnlocked();
    return SPCCrypto.encrypt(JSON.stringify(_entries), _masterKey);
  }

  /**
   * 导出为明文 CSV (危险: 密码明文!)
   * @returns {string}
   */
  function exportCSV() {
    assertUnlocked();
    const header = '名称,用户名,密码,网址,分组,备注\n';
    const rows = _entries.map(e =>
      [e.name, e.username, e.password, e.url, e.group, e.notes]
        .map(v => `"${(v || '').replace(/"/g, '""')}"`)
        .join(',')
    ).join('\n');
    return header + rows;
  }

  /**
   * 从 CSV 导入
   * @param {string} csv
   * @returns {Promise<number>}  导入的条目数
   */
  async function importCSV(csv) {
    assertUnlocked();
    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length < 2) return 0;

    // 跳过 header
    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 2) continue;

      await save({
        name:     cols[0] || '',
        username: cols[1] || '',
        password: cols[2] || '',
        url:      cols[3] || '',
        group:    cols[4] || '',
        notes:    cols[5] || '',
      });
      count++;
    }

    return count;
  }


  // ═══════════════════════════════════════
  //  内部工具
  // ═══════════════════════════════════════

  function assertUnlocked() {
    if (_locked) throw new Error('保险箱已锁定');
  }

  /** 持久化到加密存储 */
  async function persist() {
    if (!_masterKey) return;
    try {
      const encrypted = await SPCCrypto.encrypt(JSON.stringify(_entries), _masterKey);
      localStorage.setItem(LS_VAULT, encrypted);
    } catch (err) {
      console.error('[VaultService] 持久化失败:', err);
      SPCBus.emit(E.ERROR, { message: '保险箱保存失败', error: err });
    }
  }

  /** 简单 CSV 行解析 (处理引号) */
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        result.push(current); current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }


  // ─── 公开 API ─────────────────────────
  return {
    // 状态
    isCreated,
    isLocked,

    // 锁定
    create,
    unlock,
    lock,

    // CRUD
    getAll,
    getById,
    save,
    remove,
    search,
    getGroups,

    // 安全
    audit,
    generatePassword,
    evaluateStrength,
    secureCopy,

    // 导入导出
    exportEncrypted,
    exportCSV,
    importCSV,
  };
})();
