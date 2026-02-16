/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SPC Kernel · Layer 3 — 任务服务 (TaskService)              ║
 * ║  ──────────────────────────────────────────────────────────  ║
 * ║  业务逻辑: NLP 解析、CRUD、排序、统计                        ║
 * ║  依赖: SPCDB (数据层) + SPCBus (事件层)                     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 职责:
 *   1. NLP 智能解析 — 从自然语言提取时间/标签/优先级
 *   2. 任务 CRUD — 通过 IndexedDB 持久化
 *   3. 排序算法 — 加权最短作业优先 (WSJF)
 *   4. 统计分析 — 完成率、逾期数、项目分布
 *   5. 事件通知 — 每次变更通过 SPCBus 广播
 */

const TaskService = (() => {
  'use strict';

  const STORE = 'tasks';
  const E = SPCBus.Events;


  // ═══════════════════════════════════════
  //  NLP 智能解析器
  // ═══════════════════════════════════════

  /**
   * 从自然语言文本中解析任务信息
   *
   * 支持语法:
   *   时间: "今天", "明天", "后天", "大后天"
   *         "下周一"~"下周日"
   *         "X月X号/日"
   *         "下午3点", "上午10点"
   *   标签: "#工作", "#个人", "#学习"
   *   优先级: "!高", "!紧急", "!中", "!低"
   *   项目: 从第一个标签自动推断
   *
   * @param {string} input  用户输入的原始文本
   * @returns {{
   *   name: string,
   *   dueDate: string,
   *   dueTime: string,
   *   tags: string[],
   *   priority: 'high'|'medium'|'low',
   *   project: string,
   *   raw: string,
   * }}
   *
   * @example
   *   parseNLP("明天下午3点开会 #工作 !高")
   *   → { name: "开会", dueDate: "2026-02-16", dueTime: "15:00",
   *       tags: ["工作"], priority: "high", project: "工作" }
   */
  function parseNLP(input) {
    let text = (input || '').trim();
    const result = {
      name:     '',
      dueDate:  '',
      dueTime:  '',
      tags:     [],
      priority: 'medium',
      project:  '',
      raw:      text,
    };

    if (!text) return result;

    // ─── 1. 提取标签 (#xxx) ───
    const tagRegex = /#([\u4e00-\u9fa5a-zA-Z0-9_\-]+)/g;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(text)) !== null) {
      result.tags.push(tagMatch[1]);
    }
    text = text.replace(tagRegex, '').trim();

    // ─── 2. 提取优先级 (!xxx) ───
    const priorityMap = {
      '!高': 'high', '!紧急': 'high', '!重要': 'high', '!urgent': 'high',
      '!中': 'medium', '!普通': 'medium', '!normal': 'medium',
      '!低': 'low', '!low': 'low',
    };
    for (const [pattern, level] of Object.entries(priorityMap)) {
      if (text.includes(pattern)) {
        result.priority = level;
        text = text.replace(pattern, '').trim();
        break;
      }
    }

    // ─── 3. 提取日期 ───
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 相对日期: 今天/明天/后天/大后天
    const relativeMap = { '今天': 0, '明天': 1, '后天': 2, '大后天': 3 };
    for (const [keyword, offset] of Object.entries(relativeMap)) {
      if (text.includes(keyword)) {
        const d = new Date(today);
        d.setDate(d.getDate() + offset);
        result.dueDate = formatDate(d);
        text = text.replace(keyword, '').trim();
        break;
      }
    }

    // "下周X"
    if (!result.dueDate) {
      const weekMatch = text.match(/下周([一二三四五六日天])/);
      if (weekMatch) {
        const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
        const target = dayMap[weekMatch[1]];
        const current = now.getDay();
        let diff = target - current;
        if (diff <= 0) diff += 7;
        diff += 7; // 保证是"下"周
        if (diff > 14) diff -= 7;

        const d = new Date(today);
        d.setDate(d.getDate() + diff);
        result.dueDate = formatDate(d);
        text = text.replace(weekMatch[0], '').trim();
      }
    }

    // "X月X号/日"
    if (!result.dueDate) {
      const mdMatch = text.match(/(\d{1,2})月(\d{1,2})[号日]/);
      if (mdMatch) {
        const d = new Date(now.getFullYear(), parseInt(mdMatch[1]) - 1, parseInt(mdMatch[2]));
        if (d < today) d.setFullYear(d.getFullYear() + 1); // 过期日期推到明年
        result.dueDate = formatDate(d);
        text = text.replace(mdMatch[0], '').trim();
      }
    }

    // ─── 4. 提取时间 ───
    const timeMatch = text.match(/(上午|下午|晚上|早上)?\s*(\d{1,2})[点时:：](\d{0,2})?/);
    if (timeMatch) {
      let hour = parseInt(timeMatch[2]);
      const minute = timeMatch[3] ? parseInt(timeMatch[3]) : 0;
      const period = timeMatch[1];

      // 转 24 小时制
      if (period === '下午' || period === '晚上') {
        if (hour < 12) hour += 12;
      } else if (period === '上午' || period === '早上') {
        if (hour === 12) hour = 0;
      }

      result.dueTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

      // 如果没有日期，默认今天
      if (!result.dueDate) result.dueDate = formatDate(today);
      text = text.replace(timeMatch[0], '').trim();
    }

    // ─── 5. 清理任务名 ───
    result.name = text.replace(/\s{2,}/g, ' ').trim();
    result.project = result.tags[0] || '';

    return result;
  }

  /**
   * 判断输入是否包含 NLP 信号 (用于显示预览)
   * @param {string} input
   * @returns {boolean}
   */
  function hasNLPSignals(input) {
    if (!input) return false;
    return /#[\u4e00-\u9fa5a-zA-Z]/.test(input)
      || /![高中低紧急重要]/.test(input)
      || /今天|明天|后天|下周|月\d+[号日]/.test(input)
      || /[上下]午|晚上|早上|\d+[点时]/.test(input);
  }


  // ═══════════════════════════════════════
  //  CRUD 操作
  // ═══════════════════════════════════════

  /**
   * 创建任务
   * @param {Object} data  任务数据 (至少包含 name)
   * @returns {Promise<Object>}  创建后的完整任务对象
   */
  async function create(data) {
    const now  = Date.now();
    const task = {
      id:          data.id || crypto.randomUUID(),
      name:        data.name || '',
      description: data.description || '',
      status:      data.status || 'todo',
      priority:    data.priority || 'medium',
      project:     data.project || '',
      tags:        data.tags || [],
      dueDate:     data.dueDate || '',
      dueTime:     data.dueTime || '',
      timeSpent:   data.timeSpent || 0,
      subtasks:    data.subtasks || [],
      createdAt:   data.createdAt || now,
      updatedAt:   now,
    };

    await SPCDB.put(STORE, task);
    SPCBus.emit(E.TASK_CREATED, task);

    // 同步写入 localStorage (向下兼容子模块 iframe)
    syncToLocalStorage();

    return task;
  }

  /**
   * 从 NLP 输入创建任务
   * @param {string} input  自然语言文本
   * @returns {Promise<Object>}
   */
  async function createFromNLP(input) {
    const parsed = parseNLP(input);
    return create(parsed);
  }

  /**
   * 获取所有任务
   * @returns {Promise<Object[]>}
   */
  async function getAll() {
    try {
      return await SPCDB.getAll(STORE);
    } catch {
      // IndexedDB 不可用时回退到 localStorage
      return JSON.parse(localStorage.getItem('trisync_tasks') || '[]');
    }
  }

  /**
   * 获取单个任务
   * @param {string} id
   * @returns {Promise<Object|undefined>}
   */
  async function getById(id) {
    return SPCDB.get(STORE, id);
  }

  /**
   * 更新任务字段
   * @param {string} id
   * @param {Object} fields
   * @returns {Promise<Object>}
   */
  async function update(id, fields) {
    const updated = await SPCDB.update(STORE, id, {
      ...fields,
      updatedAt: Date.now(),
    });

    SPCBus.emit(E.TASK_UPDATED, updated);
    syncToLocalStorage();
    return updated;
  }

  /**
   * 切换任务状态 (todo → doing → done → todo)
   * @param {string} id
   * @returns {Promise<Object>}
   */
  async function cycleStatus(id) {
    const task = await getById(id);
    if (!task) throw new Error(`任务不存在: ${id}`);

    const next = { todo: 'doing', doing: 'done', done: 'todo' };
    const updated = await update(id, { status: next[task.status] || 'todo' });

    SPCBus.emit(E.TASK_STATUS_CHANGED, updated);
    return updated;
  }

  /**
   * 删除任务
   * @param {string} id
   * @returns {Promise<void>}
   */
  async function remove(id) {
    await SPCDB.remove(STORE, id);
    SPCBus.emit(E.TASK_DELETED, { id });
    syncToLocalStorage();
  }


  // ═══════════════════════════════════════
  //  排序算法
  // ═══════════════════════════════════════

  /**
   * 加权最短作业优先排序 (WSJF)
   *
   * 权重公式:
   *   score = (urgency × 3 + priority × 2 + age × 1) / estimatedEffort
   *
   * urgency:  截止日期越近分越高 (逾期=10, 今天=8, 3天内=6, 7天内=4, 其他=1)
   * priority: high=10, medium=5, low=2
   * age:      创建时间越久分越高 (天数, 上限30)
   * effort:   默认1 (未来可由用户估算)
   *
   * @param {Object[]} tasks
   * @returns {Object[]}  排序后的任务数组 (得分最高在前)
   */
  function sortByWSJF(tasks) {
    const now = new Date();
    const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    return [...tasks].sort((a, b) => {
      return wsjfScore(b, todayMs, now) - wsjfScore(a, todayMs, now);
    });
  }

  function wsjfScore(task, todayMs, now) {
    // 已完成的排到最后
    if (task.status === 'done') return -1;

    // 紧急度
    let urgency = 1;
    if (task.dueDate) {
      const dueMs = new Date(task.dueDate + 'T00:00:00').getTime();
      const diffDays = Math.floor((dueMs - todayMs) / 86400000);
      if (diffDays < 0)       urgency = 10;  // 逾期
      else if (diffDays === 0) urgency = 8;   // 今天
      else if (diffDays <= 3)  urgency = 6;   // 3天内
      else if (diffDays <= 7)  urgency = 4;   // 一周内
      else                     urgency = 2;
    }

    // 优先级
    const prioScore = { high: 10, medium: 5, low: 2 }[task.priority] || 5;

    // 年龄 (创建至今的天数, 上限30)
    const ageDays = Math.min(30, Math.floor((now.getTime() - (task.createdAt || 0)) / 86400000));

    // WSJF 公式
    return (urgency * 3 + prioScore * 2 + ageDays) / 1; // effort 默认 1
  }


  // ═══════════════════════════════════════
  //  查询 & 过滤
  // ═══════════════════════════════════════

  /**
   * 按状态获取任务
   * @param {'todo'|'doing'|'done'} status
   * @returns {Promise<Object[]>}
   */
  async function getByStatus(status) {
    try {
      return await SPCDB.getByIndex(STORE, 'by_status', status);
    } catch {
      const all = await getAll();
      return all.filter(t => t.status === status);
    }
  }

  /**
   * 按项目获取任务
   * @param {string} project
   * @returns {Promise<Object[]>}
   */
  async function getByProject(project) {
    try {
      return await SPCDB.getByIndex(STORE, 'by_project', project);
    } catch {
      const all = await getAll();
      return all.filter(t => t.project === project);
    }
  }

  /**
   * 搜索任务 (名称 + 描述模糊匹配)
   * @param {string} query
   * @returns {Promise<Object[]>}
   */
  async function search(query) {
    if (!query) return getAll();
    const q = query.toLowerCase();
    const all = await getAll();
    return all.filter(t =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.project || '').toLowerCase().includes(q)
    );
  }


  // ═══════════════════════════════════════
  //  统计分析
  // ═══════════════════════════════════════

  /**
   * 获取任务统计数据
   * @returns {Promise<Object>}
   */
  async function getStats() {
    const all = await getAll();
    const now = new Date();
    const todayStr = formatDate(now);

    const total   = all.length;
    const done    = all.filter(t => t.status === 'done').length;
    const doing   = all.filter(t => t.status === 'doing').length;
    const todo    = total - done - doing;
    const overdue = all.filter(t =>
      t.status !== 'done' && t.dueDate && t.dueDate < todayStr
    ).length;

    const projects = [...new Set(all.map(t => t.project).filter(Boolean))].sort();

    return {
      total, done, doing, todo, overdue, projects,
      completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }


  // ═══════════════════════════════════════
  //  工具函数
  // ═══════════════════════════════════════

  function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * 同步到 localStorage (兼容 iframe 子模块)
   */
  async function syncToLocalStorage() {
    try {
      const all = await getAll();
      localStorage.setItem('trisync_tasks', JSON.stringify(all));
    } catch { /* silent */ }
  }


  // ─── 公开 API ─────────────────────────
  return {
    // NLP
    parseNLP,
    hasNLPSignals,

    // CRUD
    create,
    createFromNLP,
    getAll,
    getById,
    update,
    cycleStatus,
    remove,

    // 查询
    getByStatus,
    getByProject,
    search,

    // 排序
    sortByWSJF,

    // 统计
    getStats,
  };
})();
