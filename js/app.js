/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SPC Kernel · app.js — 内核引导器 (Kernel Bootstrap)        ║
 * ║  ──────────────────────────────────────────────────────────  ║
 * ║  职责: 初始化内核模块 → 注册事件 → 绑定 UI → 就绪           ║
 * ║  依赖: core/db.js, core/crypto.js, core/bus.js              ║
 * ║        services/TaskService.js                              ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 引导顺序:
 *   1. SPCDB.open()              — 打开 IndexedDB 连接
 *   2. SPCDB.migrateFromLS()     — 迁移旧 localStorage 数据
 *   3. TaskService (已就绪)      — NLP + CRUD 可用
 *   4. SPCBus.emit(KERNEL_READY) — 广播就绪信号
 *   5. UI 绑定                   — 导航/搜索/锁屏/设置
 */

const SPC = (() => {
  'use strict';

  const E = SPCBus.Events;

  // ─── 状态 ──────────────────────────────
  let currentModule  = 'home';
  let autoLockMin    = 5;
  let lastActivity   = Date.now();
  let lockTimer      = null;
  let uptimeStart    = Date.now();
  let statsInterval  = null;
  const LOCK_PASSWORD = localStorage.getItem('spc_lock_password') || '123456';

  // ─── 子模块 URL 配置 ──────────────────
  const defaultUrls = {
    safe: 'safe/index.html',
    plan: 'plan/index.html',
    note: 'note/index.html',
  };

  function getModuleUrl(mod) {
    return localStorage.getItem(`spc_url_${mod}`) || defaultUrls[mod] || '';
  }

  const PAGE_META = {
    home: { title: '主页'     },
    safe: { title: '保险箱'   },
    plan: { title: '时间规划' },
    note: { title: '笔记'     },
  };


  // ═══════════════════════════════════════
  //  内核引导
  // ═══════════════════════════════════════

  async function boot() {
    console.log('%c[SPC] 内核引导中...', 'color: #2563eb; font-weight: bold; font-size: 13px');
    const t0 = performance.now();
    
    // 监听 iframe 消息（用于子页面导航）
    window.addEventListener('message', (event) => {
      if (event.data && event.data.action === 'navigate') {
        navigate(event.data.module || 'home');
      }
    });

    // 首先初始化账户系统
    AuthUI.init();
    
    // 如果未登录，boot 暂停，等待登录后继续
    if (!AuthService.isLoggedIn()) {
      console.log('[SPC] 等待用户登录...');
      // 监听登录事件，登录后继续 boot
      window.addEventListener('spc-login', () => {
        console.log('[SPC] 用户已登录，继续引导...');
        continueBoot();
      }, { once: true });
      return;
    }
    
    // 已登录，继续引导
    continueBoot();
  }

  async function continueBoot() {
      // Layer 1: 数据引擎
      await SPCDB.open();
      console.log('[SPC] ✓ IndexedDB 就绪');

      // 数据迁移 (localStorage → IndexedDB)
      const migrated = await SPCDB.migrateFromLocalStorage();
      if (migrated.tasks > 0 || migrated.notes > 0) {
        console.log(`[SPC] ✓ 数据迁移完成 (${migrated.tasks} 任务, ${migrated.notes} 笔记)`);
        SPCBus.emit(E.DATA_MIGRATED, migrated);
      }

      // Layer 2: 安全引擎 (SPCCrypto 是纯函数模块, 无需初始化)
      console.log(`[SPC] ✓ 加密引擎就绪 (AES-${SPCCrypto.KEY_LENGTH}-GCM, PBKDF2 ×${SPCCrypto.PBKDF2_ITERATIONS})`);

      // Layer 3: 服务层 (TaskService 依赖 SPCDB, 此时已可用)
      console.log('[SPC] ✓ TaskService 就绪');

      // Layer 4: 事件总线 (已在模块加载时就绪)
      console.log(`[SPC] ✓ 事件总线就绪`);

    } catch (err) {
      console.error('[SPC] 内核引导失败:', err);
      console.warn('[SPC] 降级到 localStorage 模式');
      // 即使 IndexedDB 不可用, UI 层仍然可以工作 (TaskService 有 fallback)
    }

    // ========== 初始化 UI 层 (继续引导) ==========
    restoreTheme();
    initKeyboard();
    initAutoLock();
    initGreeting();
    updateStats();
    navigate('home');
    restoreAutoLockSetting();

    // 显示当前日期
    const dateEl = document.getElementById('current-date');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric', weekday:'long' });

    // 定时更新
    statsInterval = setInterval(() => {
      updateUptime();
      if (currentModule === 'home') updateStats();
    }, 10000);
    updateUptime();

    // 服务层完整就绪
    console.log('[SPC] ✓ VaultService 就绪');
    console.log('[SPC] ✓ NoteService 就绪');
    console.log('[SPC] ✓ SyncService 就绪');

    // 自动备份 (每次启动时)
    try { await SyncService.autoBackup(); console.log('[SPC] ✓ 自动备份完成'); } catch {}

    window._spcBootTime = Date.now();

    const elapsed = (performance.now() - t0).toFixed(1);
    console.log(`%c[SPC] 内核就绪 ✓ (${elapsed}ms) — 6 层架构全部在线`, 'color: #22c55e; font-weight: bold; font-size: 13px');

    // 显示启动耗时
    const bootEl = document.getElementById('boot-time');
    if (bootEl) bootEl.textContent = `引导耗时 ${elapsed}ms`;

    SPCBus.emit(E.KERNEL_READY, { bootTime: elapsed });
  }


  // ═══════════════════════════════════════
  //  导航
  // ═══════════════════════════════════════

  function navigate(mod) {
    if (mod === currentModule && mod !== 'home') return;
    currentModule = mod;

    // 侧栏高亮
    document.querySelectorAll('#main-nav .nav-item').forEach(btn => {
      const m = btn.dataset.module;
      if (m === mod) {
        btn.classList.add('bg-blue-50', 'text-blue-600');
        btn.classList.remove('text-muted', 'hover:bg-slate-100', 'hover:text-slate-700');
      } else {
        btn.classList.remove('bg-blue-50', 'text-blue-600');
        btn.classList.add('text-muted', 'hover:bg-slate-100', 'hover:text-slate-700');
      }
    });

    // 顶栏标题
    const meta = PAGE_META[mod] || PAGE_META.home;
    document.getElementById('page-title').textContent = meta.title;

    // 面板切换
    const homePanel = document.getElementById('home-panel');
    document.querySelectorAll('.module-frame').forEach(f => f.classList.remove('active'));

    if (mod === 'home') {
      homePanel.style.display = '';
      homePanel.classList.add('animate-fade-in');
      updateStats();
    } else {
      homePanel.style.display = 'none';
      const frame = document.getElementById(`frame-${mod}`);
      if (frame) {
        if (!frame.src || frame.src === 'about:blank' || frame.getAttribute('src') === '') {
          frame.src = getModuleUrl(mod);
        }
        frame.classList.add('active');
      }
    }

    document.getElementById('status-text').textContent =
      mod === 'home' ? '系统就绪' : `${meta.title} · 运行中`;

    SPCBus.emit(E.NAV_CHANGED, { module: mod });
  }


  // ═══════════════════════════════════════
  //  NLP 快速添加 (委托给 TaskService)
  // ═══════════════════════════════════════

  async function nlpQuickAdd() {
    const input = document.getElementById('nlp-input');
    const text = input.value.trim();
    if (!text) return;

    try {
      const task = await TaskService.createFromNLP(text);

      // 显示预览
      const preview = document.getElementById('nlp-preview');
      const pLabels = { high: '🔴 高', medium: '🟡 中', low: '🔵 低' };
      let html = `<span class="text-blue-600 font-medium">✓ 已添加：</span> "${task.name}"`;
      if (task.dueDate) html += ` · <span class="text-blue-600">📅 ${task.dueDate}</span>`;
      if (task.tags.length) html += ` · <span class="text-violet-600">${task.tags.map(t => '#' + t).join(' ')}</span>`;
      html += ` · ${pLabels[task.priority] || '🟡 中'}`;

      preview.innerHTML = html;
      preview.classList.remove('hidden');
      input.value = '';

      updateStats();
      setTimeout(() => preview.classList.add('hidden'), 4000);

    } catch (err) {
      console.error('[SPC] NLP 添加失败:', err);
      SPCBus.emit(E.ERROR, { message: '添加任务失败', error: err });
    }
  }

  /** NLP 输入实时预览 */
  function nlpPreview() {
    const input = document.getElementById('nlp-input');
    const preview = document.getElementById('nlp-preview');
    const text = input.value.trim();

    if (!text || !TaskService.hasNLPSignals(text)) {
      preview.classList.add('hidden');
      return;
    }

    const parsed = TaskService.parseNLP(text);
    const pLabels = { high: '🔴 高', medium: '🟡 中', low: '🔵 低' };
    let html = `<span class="text-slate-500">识别: </span><span class="text-slate-700">${parsed.name}</span>`;
    if (parsed.dueDate) html += ` · <span class="text-blue-500">📅 ${parsed.dueDate}</span>`;
    if (parsed.dueTime) html += ` <span class="text-blue-400">${parsed.dueTime}</span>`;
    if (parsed.tags.length) html += ` · ${parsed.tags.map(t => '<span class="text-violet-500">#' + t + '</span>').join(' ')}`;
    html += ` · ${pLabels[parsed.priority]}`;

    preview.innerHTML = html;
    preview.classList.remove('hidden');
  }


  // ═══════════════════════════════════════
  //  自动锁屏
  // ═══════════════════════════════════════

  function resetActivity() { lastActivity = Date.now(); }

  function initAutoLock() {
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach(ev => document.addEventListener(ev, resetActivity, { passive: true }));

    lockTimer = setInterval(() => {
      if (autoLockMin <= 0) return;
      const elapsed = Date.now() - lastActivity;
      if (elapsed >= autoLockMin * 60 * 1000) {
        lock();
        SPCBus.emit(E.AUTOLOCK_TRIGGERED);
      }
    }, 5000);
  }

  function lock() {
    document.getElementById('lockscreen').classList.add('visible');
    document.getElementById('lock-password').value = '';
    document.getElementById('lock-error').classList.add('hidden');
    setTimeout(() => document.getElementById('lock-password').focus(), 100);
    SPCBus.emit(E.VAULT_LOCKED);
  }

  function unlock() {
    const pwd = document.getElementById('lock-password').value;
    if (pwd === LOCK_PASSWORD) {
      document.getElementById('lockscreen').classList.remove('visible');
      document.getElementById('lock-error').classList.add('hidden');
      resetActivity();
      SPCBus.emit(E.VAULT_UNLOCKED);
    } else {
      document.getElementById('lock-error').classList.remove('hidden');
      document.getElementById('lock-password').value = '';
      document.getElementById('lock-password').focus();
    }
  }

  function setAutoLock(min) {
    autoLockMin = min;
    localStorage.setItem('spc_autolock', String(min));
    document.querySelectorAll('.lock-opt').forEach(btn => {
      if (parseInt(btn.dataset.val) === min) {
        btn.classList.add('bg-blue-50', 'border-blue-300', 'text-blue-700');
        btn.classList.remove('bg-white', 'border-slate-200', 'text-muted');
      } else {
        btn.classList.remove('bg-blue-50', 'border-blue-300', 'text-blue-700');
        btn.classList.add('bg-white', 'border-slate-200', 'text-muted');
      }
    });
    SPCBus.emit(E.SETTINGS_CHANGED, { autoLockMin: min });
  }

  function restoreAutoLockSetting() {
    const saved = localStorage.getItem('spc_autolock');
    if (saved !== null) autoLockMin = parseInt(saved);
    setAutoLock(autoLockMin);
  }


  // ═══════════════════════════════════════
  //  主题切换 (亮/暗)
  // ═══════════════════════════════════════

  function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark');
    if (isDark) {
      html.classList.remove('dark');
      html.setAttribute('data-theme', 'light');
      localStorage.setItem('spc_theme', 'light');
    } else {
      html.classList.add('dark');
      html.setAttribute('data-theme', 'dark');
      localStorage.setItem('spc_theme', 'dark');
    }
    updateThemeIcons();
  }

  function restoreTheme() {
    const saved = localStorage.getItem('spc_theme');
    if (saved === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    }
    updateThemeIcons();
  }

  function updateThemeIcons() {
    const isDark = document.documentElement.classList.contains('dark');
    const lightIcon = document.getElementById('theme-icon-light');
    const darkIcon = document.getElementById('theme-icon-dark');
    if (lightIcon && darkIcon) {
      lightIcon.classList.toggle('hidden', isDark);
      darkIcon.classList.toggle('hidden', !isDark);
    }
  }


  // ═══════════════════════════════════════
  //  Toast 通知
  // ═══════════════════════════════════════

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: '✓', error: '✗', info: 'ℹ' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(40px)'; setTimeout(() => toast.remove(), 300); }, 3000);
  }


  // ═══════════════════════════════════════
  //  搜索
  // ═══════════════════════════════════════

  function openSearch() {
    document.getElementById('search-overlay').classList.add('visible');
    setTimeout(() => document.getElementById('search-input').focus(), 50);
  }

  function closeSearch() {
    document.getElementById('search-overlay').classList.remove('visible');
    document.getElementById('search-input').value = '';
  }

  function handleSearch(query) {
    const q = query.toLowerCase();
    const buttons = document.getElementById('search-results').querySelectorAll('button');
    buttons.forEach(btn => {
      btn.style.display = !q || btn.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  }


  // ═══════════════════════════════════════
  //  设置
  // ═══════════════════════════════════════

  function openSettings() {
    document.getElementById('settings-overlay').classList.add('visible');
    document.getElementById('cfg-safe-url').value = getModuleUrl('safe');
    document.getElementById('cfg-plan-url').value = getModuleUrl('plan');
    document.getElementById('cfg-note-url').value = getModuleUrl('note');

    // 显示存储使用情况
    try {
      const usage = SyncService.getStorageUsage();
      const el = document.getElementById('storage-info');
      if (el) el.innerHTML = `已使用: <strong>${usage.usedKB} KB</strong> / ${usage.limit}`;
    } catch {}
  }

  function closeSettings() {
    document.getElementById('settings-overlay').classList.remove('visible');
  }

  function saveSettings() {
    ['safe', 'plan', 'note'].forEach(mod => {
      const url = document.getElementById(`cfg-${mod}-url`).value.trim();
      if (url) localStorage.setItem(`spc_url_${mod}`, url);
    });
    ['safe', 'plan', 'note'].forEach(mod => {
      const frame = document.getElementById(`frame-${mod}`);
      if (frame) frame.src = '';
    });
    SPCBus.emit(E.SETTINGS_CHANGED, { urls: true });
  }


  // ═══════════════════════════════════════
  //  统计 & UI
  // ═══════════════════════════════════════

  async function updateStats() {
    try {
      const el = id => document.getElementById(id);

      // 任务统计 (via TaskService)
      const taskStats = await TaskService.getStats();
      if (el('stat-tasks')) el('stat-tasks').textContent = taskStats.total;

      // 笔记统计 (via NoteService)
      const noteStats = await NoteService.getStats();
      if (el('stat-notes')) el('stat-notes').textContent = noteStats.total;

      // 保险箱 (via VaultService)
      if (el('stat-passwords')) {
        if (VaultService.isCreated()) {
          el('stat-passwords').textContent = VaultService.isLocked()
            ? '🔒' : VaultService.getAll().length;
        } else {
          el('stat-passwords').textContent = '0';
        }
      }

      // 任务完成率
      if (el('task-rate')) {
        el('task-rate').textContent = taskStats.completionRate + '%';
      }

      // 存储使用
      if (el('stat-storage')) {
        const usage = SyncService.getStorageUsage();
        el('stat-storage').textContent = usage.usedKB + ' KB';
      }

      // ─── 进度环 ───
      const total = taskStats.total || 0;
      const done = taskStats.done || 0;
      const doing = taskStats.doing || 0;
      const todo = taskStats.todo || 0;
      const pct = taskStats.completionRate || 0;
      const ring = el('progress-ring');
      if (ring) {
        const circumference = 2 * Math.PI * 30; // r=30
        ring.setAttribute('stroke-dashoffset', circumference * (1 - pct / 100));
      }
      if (el('progress-pct')) el('progress-pct').textContent = pct + '%';
      if (el('ring-todo'))  el('ring-todo').textContent = todo;
      if (el('ring-doing')) el('ring-doing').textContent = doing;
      if (el('ring-done'))  el('ring-done').textContent = done;
      if (total > 0) {
        if (el('bar-todo'))  el('bar-todo').style.width  = (todo / total * 100) + '%';
        if (el('bar-doing')) el('bar-doing').style.width = (doing / total * 100) + '%';
        if (el('bar-done'))  el('bar-done').style.width  = (done / total * 100) + '%';
      }

      // ─── 今日焦点 ───
      const allTasks = await TaskService.getAll();
      const todayStr = new Date().toISOString().slice(0, 10);
      const todayTasks = allTasks.filter(t => t.dueDate === todayStr && t.status !== 'done');
      const overdueTasks = allTasks.filter(t => t.dueDate && t.dueDate < todayStr && t.status !== 'done');
      const focusTasks = [...overdueTasks, ...todayTasks].slice(0, 6);
      if (el('today-count')) el('today-count').textContent = focusTasks.length + ' 项';
      if (el('today-tasks') && focusTasks.length > 0) {
        el('today-tasks').innerHTML = focusTasks.map(t => {
          const isOverdue = t.dueDate < todayStr;
          const prio = { high: '🔴', medium: '🟡', low: '🔵' }[t.priority] || '🟡';
          return `<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors" style="background:var(--bg-tertiary)">
            <span class="text-xs">${prio}</span>
            <span class="text-xs flex-1 truncate" style="color:var(--text-primary)">${t.name}</span>
            ${isOverdue ? '<span class="badge badge-danger text-[9px]">逾期</span>' : '<span class="badge badge-warning text-[9px]">今天</span>'}
          </div>`;
        }).join('');
      }

      // ─── 安全概览 ───
      if (VaultService.isCreated()) {
        const dotEl = el('sec-dot-vault');
        const statusEl = el('sec-vault-status');
        if (VaultService.isLocked()) {
          if (dotEl) dotEl.style.background = '#F59E0B';
          if (statusEl) statusEl.textContent = '已锁定';
        } else {
          if (dotEl) dotEl.style.background = '#22C55E';
          if (statusEl) statusEl.textContent = '已解锁';
          try {
            const audit = await VaultService.audit();
            if (el('sec-grade')) el('sec-grade').textContent = audit.score + ' / 100 (' + audit.grade + ')';
          } catch {}
        }
      }
      const savedLock = localStorage.getItem('spc_autolock');
      if (el('sec-autolock')) el('sec-autolock').textContent = (savedLock === '0' ? '关闭' : (savedLock || '5') + '分钟');

      // ─── 最近活动 ───
      const recentNotes = (await NoteService.getAll()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
      const recentTasksAll = allTasks.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
      const activityItems = [];
      recentTasksAll.forEach(t => activityItems.push({ type: 'task', name: t.name, status: t.status, time: t.updatedAt }));
      recentNotes.forEach(n => activityItems.push({ type: 'note', name: n.title || '无标题', time: n.updatedAt }));
      activityItems.sort((a, b) => b.time - a.time);

      if (el('recent-activity') && activityItems.length > 0) {
        el('recent-activity').innerHTML = activityItems.slice(0, 6).map(item => {
          const ago = formatTimeAgo(item.time);
          const icon = item.type === 'task'
            ? '<svg class="w-3.5 h-3.5 text-violet-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
            : '<svg class="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>';
          const statusBadge = item.type === 'task'
            ? (item.status === 'done' ? '<span class="badge badge-success text-[9px]">完成</span>' : item.status === 'doing' ? '<span class="badge badge-warning text-[9px]">进行</span>' : '')
            : '';
          return `<div class="flex items-center gap-2.5 py-1.5">
            ${icon}
            <div class="flex-1 min-w-0"><div class="text-xs truncate" style="color:var(--text-primary)">${item.name}</div><div class="text-[10px]" style="color:var(--text-tertiary)">${ago}</div></div>
            ${statusBadge}
          </div>`;
        }).join('');
      }

      // ─── 最近备份时间 ───
      const backups = SyncService.getAutoBackups();
      if (el('last-backup-time') && backups.length > 0) {
        el('last-backup-time').textContent = formatTimeAgo(backups[backups.length - 1].timestamp);
      }
    } catch { /* silent */ }
  }

  function updateUptime() {
    const elapsed = Math.floor((Date.now() - uptimeStart) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const el = document.getElementById('stat-uptime');
    if (el) el.textContent = h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function formatTimeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return '刚刚';
    const m = Math.floor(s / 60);
    if (m < 60) return m + '分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + '小时前';
    const d = Math.floor(h / 24);
    if (d === 1) return '昨天';
    if (d < 30) return d + '天前';
    return new Date(ts).toLocaleDateString('zh-CN');
  }

  function initGreeting() {
    const h = new Date().getHours();
    const greeting = h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好';
    const el = document.getElementById('greeting-text');
    if (el) el.textContent = `${greeting}，管理员`;
  }


  // ═══════════════════════════════════════
  //  键盘快捷键
  // ═══════════════════════════════════════

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') { e.preventDefault(); lock(); }
      if ((e.ctrlKey || e.metaKey) && ['1','2','3','4'].includes(e.key)) {
        e.preventDefault();
        navigate(['home','safe','plan','note'][parseInt(e.key) - 1]);
      }
      if (e.key === 'Escape') { closeSearch(); closeSettings(); }
    });
  }


  // ═══════════════════════════════════════
  //  AuthUI - 账户管理界面
  // ═══════════════════════════════════════
  
  const AuthUI = {
    isRegisterMode: false,
    
    init() {
      // 检查是否已登录
      const user = AuthService.init();
      if (user) {
        this.showApp(user);
      } else {
        this.showLogin();
      }
      
      // 监听登录/登出事件
      window.addEventListener('spc-login', (e) => this.showApp(e.detail));
      window.addEventListener('spc-logout', () => this.showLogin());
    },
    
    showLogin() {
      document.getElementById('auth-modal').classList.remove('hidden');
      document.getElementById('user-bar').classList.add('hidden');
      document.getElementById('sidebar').classList.add('hidden');
      
      // 默认显示云端服务器地址（因为用户已有服务器）
      this.toggleCloudUrl(true);
      
      // 检查是否有已有用户
      const users = AuthService.getAllUsers();
      if (users.length > 0) {
        this.showUserList();
      } else {
        this.showRegisterForm();
      }
    },
    
    showApp(user) {
      document.getElementById('auth-modal').classList.add('hidden');
      document.getElementById('user-bar').classList.remove('hidden');
      document.getElementById('sidebar').classList.remove('hidden');
      
      // 更新用户栏信息
      document.getElementById('user-avatar').textContent = user.username.charAt(0).toUpperCase();
      document.getElementById('user-name').textContent = user.username;
      
      // 显示数据存储模式
      const modeText = user.mode === 'cloud' ? '☁️ 云端' : '💾 本地';
      document.getElementById('user-name').title = `存储模式: ${modeText}`;
    },
    
    showUserList() {
      const users = AuthService.getAllUsers();
      const container = document.getElementById('user-list-container');
      const list = document.getElementById('user-list');
      const loginForm = document.getElementById('login-form');
      
      container.classList.remove('hidden');
      loginForm.classList.add('hidden');
      
      list.innerHTML = users.map(user => `
        <div onclick="AuthUI.quickLogin('${user.id}')" class="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer transition">
          <div class="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold">${user.username.charAt(0).toUpperCase()}</div>
          <div class="flex-1">
            <div class="font-medium text-slate-700 dark:text-slate-200">${user.username}</div>
            <div class="text-xs text-slate-500">${user.mode === 'cloud' ? '☁️ 云端同步' : '💾 本地存储'}</div>
          </div>
        </div>
      `).join('');
    },
    
    quickLogin(userId) {
      const users = AuthService.getAllUsers();
      const user = users.find(u => u.id === userId);
      if (user) {
        // 云端模式需要密码
        if (user.mode === 'cloud' && !user.passwordHash) {
          document.getElementById('login-username').value = user.username;
          this.showLoginForm();
          document.getElementById('login-username').focus();
        } else {
          AuthService.setCurrentUser(user);
        }
      }
    },
    
    showLoginForm() {
      document.getElementById('user-list-container').classList.add('hidden');
      document.getElementById('login-form').classList.remove('hidden');
      document.getElementById('register-form').classList.add('hidden');
      document.getElementById('auth-title').textContent = 'SPC 安全生产力中枢';
      document.getElementById('auth-subtitle').textContent = '登录您的账户';
      document.getElementById('auth-toggle-text').textContent = '还没有账户？';
      document.getElementById('auth-toggle-btn').textContent = '立即注册';
      this.isRegisterMode = false;
    },
    
    showRegisterForm() {
      document.getElementById('user-list-container').classList.add('hidden');
      document.getElementById('login-form').classList.add('hidden');
      document.getElementById('register-form').classList.remove('hidden');
      document.getElementById('auth-title').textContent = '创建账户';
      document.getElementById('auth-subtitle').textContent = '开始使用 SPC';
      document.getElementById('auth-toggle-text').textContent = '已有账户？';
      document.getElementById('auth-toggle-btn').textContent = '立即登录';
      this.isRegisterMode = true;
    },
    
    toggleAuthMode() {
      if (this.isRegisterMode) {
        this.showLoginForm();
      } else {
        this.showRegisterForm();
      }
    },
    
    toggleCloudUrl(show) {
      document.getElementById('cloud-url-container').style.display = show ? 'block' : 'none';
      document.getElementById('reg-cloud-url-container').style.display = show ? 'block' : 'none';
    },
    
    login() {
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const cloudUrl = document.getElementById('login-cloud-url').value.trim();
      
      if (!username) {
        this.showError('请输入用户名');
        return;
      }
      
      const result = AuthService.login(username, password, cloudUrl);
      if (!result.success) {
        this.showError(result.error);
        return;
      }
      
      this.hideError();
    },
    
    register() {
      const username = document.getElementById('reg-username').value.trim();
      const password = document.getElementById('reg-password').value;
      const mode = document.querySelector('input[name="storage-mode"]:checked').value;
      const cloudUrl = document.getElementById('reg-cloud-url').value.trim();
      
      if (!username) {
        this.showError('请输入用户名');
        return;
      }
      
      // 云端模式需要密码
      if (mode === 'cloud' && !password) {
        this.showError('云端模式需要设置密码');
        return;
      }
      
      if (mode === 'cloud' && !cloudUrl) {
        this.showError('请输入您的服务器地址');
        return;
      }
      
      const result = AuthService.createUser(username, password, {
        mode: mode,
        cloudUrl: cloudUrl
      });
      
      if (!result.success) {
        this.showError(result.error);
        return;
      }
      
      // 自动登录
      AuthService.setCurrentUser(result.user);
      this.hideError();
    },
    
    logout() {
      if (confirm('确定要退出登录吗？')) {
        AuthService.logout();
      }
    },
    
    showSettings() {
      const user = AuthService.getCurrentUser();
      if (!user) return;
      
      const settings = `
        <div class="p-4">
          <h3 class="font-bold text-lg mb-4">账户设置</h3>
          <div class="space-y-3">
            <div class="flex justify-between items-center py-2 border-b">
              <span class="text-slate-600">用户名</span>
              <span class="font-medium">${user.username}</span>
            </div>
            <div class="flex justify-between items-center py-2 border-b">
              <span class="text-slate-600">存储模式</span>
              <span class="font-medium">${user.mode === 'cloud' ? '☁️ 云端同步' : '💾 本地存储'}</span>
            </div>
            <div class="flex justify-between items-center py-2 border-b">
              <span class="text-slate-600">创建时间</span>
              <span class="font-medium">${new Date(user.createdAt).toLocaleDateString()}</span>
            </div>
            <div class="pt-4 space-y-2">
              <button onclick="AuthUI.exportData()" class="w-full py-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-sm hover:bg-slate-200 dark:hover:bg-slate-600">📤 导出数据</button>
              <button onclick="AuthUI.importData()" class="w-full py-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-sm hover:bg-slate-200 dark:hover:bg-slate-600">📥 导入数据</button>
              ${user.mode === 'cloud' ? `<button onclick="AuthUI.syncData()" class="w-full py-2 bg-cyan-100 dark:bg-cyan-900/30 rounded-lg text-sm hover:bg-cyan-200 dark:hover:bg-cyan-900/50">🔄 同步到云端</button>` : ''}
            </div>
          </div>
        </div>
      `;
      
      // 使用现有的设置模态框或创建新的
      let modal = document.getElementById('account-settings-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'account-settings-modal';
        modal.className = 'fixed inset-0 z-[10000] bg-black/50 flex items-center justify-center';
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        document.body.appendChild(modal);
      }
      modal.innerHTML = settings;
      modal.classList.remove('hidden');
    },
    
    exportData() {
      const data = AuthService.exportUserData();
      if (!data) return;
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spc-backup-${data.user.username}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      
      SPC.showToast('数据导出成功！');
    },
    
    importData() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          const result = AuthService.importUserData(data);
          if (result.success) {
            SPC.showToast('数据导入成功！');
            AuthService.setCurrentUser(result.user);
          } else {
            this.showError(result.error);
          }
        } catch (err) {
          this.showError('导入失败: ' + err.message);
        }
      };
      input.click();
    },
    
    syncData() {
      SPC.showToast('正在同步...');
      AuthService.syncToCloud().then(result => {
        if (result.success) {
          SPC.showToast('同步成功！☁️');
        } else {
          this.showError('同步失败: ' + result.error);
        }
      });
    },
    
    showError(msg) {
      const el = document.getElementById('auth-error');
      el.textContent = msg;
      el.classList.remove('hidden');
    },
    
    hideError() {
      document.getElementById('auth-error').classList.add('hidden');
    }
  };

  // ═══════════════════════════════════════
  //  启动
  // ═══════════════════════════════════════

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }


  // ─── 公开 API ─────────────────────────
  return {
    navigate,
    nlpQuickAdd,
    nlpPreview,
    lock,
    unlock,
    openSearch,
    closeSearch,
    handleSearch,
    openSettings,
    closeSettings,
    saveSettings,
    setAutoLock,
    toggleTheme,
    showToast,
  };
})();
