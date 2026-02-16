/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SPC Kernel · Layer 3 — 笔记服务 (NoteService)              ║
 * ║  ──────────────────────────────────────────────────────────  ║
 * ║  CRUD + 全文搜索 + Wiki链接 + 标签 + 版本历史               ║
 * ║  依赖: SPCDB + SPCBus                                      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 创意来源:
 *   - Trilium: 层级笔记 + 双向链接 + 版本历史
 *   - SiYuan:  Wiki链接 [[title]] + 标签系统
 *   - Joplin:  全文搜索 + 导出
 *   - Notion:  简洁排版 + 斜杠命令
 */

const NoteService = (() => {
  'use strict';

  const STORE = 'notes';
  const E = SPCBus.Events;
  const MAX_VERSIONS = 20;  // 每篇笔记最多保留20个版本


  // ═══════════════════════════════════════
  //  CRUD
  // ═══════════════════════════════════════

  /**
   * 创建笔记
   * @param {Object} [data]
   * @returns {Promise<Object>}
   */
  async function create(data = {}) {
    const now = Date.now();
    const note = {
      id:        data.id || crypto.randomUUID(),
      title:     data.title || '',
      content:   data.content || '',
      folder:    data.folder || '',
      tags:      data.tags || [],
      pinned:    data.pinned || false,
      versions:  [],            // 版本历史
      links:     [],            // Wiki 链接目标
      backlinks: [],            // 被链接的来源
      wordCount: 0,
      charCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    updateCounts(note);

    try {
      await SPCDB.put(STORE, note);
    } catch {
      // 降级到 localStorage
      const notes = loadFromLS();
      notes.unshift(note);
      saveToLS(notes);
    }

    syncToLS();
    SPCBus.emit(E.NOTE_CREATED, note);
    return note;
  }

  /**
   * 获取所有笔记
   * @returns {Promise<Object[]>}
   */
  async function getAll() {
    try {
      const notes = await SPCDB.getAll(STORE);
      return notes.length > 0 ? notes : loadFromLS();
    } catch {
      return loadFromLS();
    }
  }

  /**
   * 获取单个笔记
   * @param {string} id
   * @returns {Promise<Object|undefined>}
   */
  async function getById(id) {
    try {
      return await SPCDB.get(STORE, id);
    } catch {
      return loadFromLS().find(n => n.id === id);
    }
  }

  /**
   * 更新笔记
   * @param {string} id
   * @param {Object} fields
   * @param {boolean} [saveVersion=false]  是否保存版本快照
   * @returns {Promise<Object>}
   */
  async function update(id, fields, saveVersion = false) {
    const existing = await getById(id);
    if (!existing) throw new Error(`笔记不存在: ${id}`);

    // 版本历史 (内容变化时保存)
    if (saveVersion && existing.content !== fields.content) {
      const versions = existing.versions || [];
      versions.push({
        content:   existing.content,
        title:     existing.title,
        timestamp: existing.updatedAt,
      });
      // 限制版本数量
      while (versions.length > MAX_VERSIONS) versions.shift();
      fields.versions = versions;
    }

    const updated = {
      ...existing,
      ...fields,
      updatedAt: Date.now(),
    };

    updateCounts(updated);
    updateWikiLinks(updated);

    try {
      await SPCDB.put(STORE, updated);
    } catch {
      const notes = loadFromLS();
      const idx = notes.findIndex(n => n.id === id);
      if (idx >= 0) notes[idx] = updated;
      saveToLS(notes);
    }

    syncToLS();
    SPCBus.emit(E.NOTE_UPDATED, updated);
    return updated;
  }

  /**
   * 删除笔记
   * @param {string} id
   * @returns {Promise<void>}
   */
  async function remove(id) {
    try {
      await SPCDB.remove(STORE, id);
    } catch {
      const notes = loadFromLS().filter(n => n.id !== id);
      saveToLS(notes);
    }

    syncToLS();
    SPCBus.emit(E.NOTE_DELETED, { id });
  }


  // ═══════════════════════════════════════
  //  搜索
  // ═══════════════════════════════════════

  /**
   * 全文搜索 (标题 + 内容 + 标签)
   * @param {string} query
   * @returns {Promise<Object[]>}  匹配的笔记 (按相关度排序)
   */
  async function search(query) {
    if (!query) return getAll();
    const q = query.toLowerCase();
    const all = await getAll();

    return all
      .map(n => {
        let relevance = 0;
        const title   = (n.title || '').toLowerCase();
        const content = (n.content || '').toLowerCase();
        const tags    = (n.tags || []).join(' ').toLowerCase();

        // 标题匹配权重最高
        if (title.includes(q)) relevance += 10;
        // 标签匹配
        if (tags.includes(q)) relevance += 5;
        // 内容匹配
        if (content.includes(q)) {
          relevance += 3;
          // 出现次数加分
          const occurrences = content.split(q).length - 1;
          relevance += Math.min(occurrences, 5);
        }

        return { ...n, _relevance: relevance };
      })
      .filter(n => n._relevance > 0)
      .sort((a, b) => b._relevance - a._relevance);
  }


  // ═══════════════════════════════════════
  //  Wiki 链接 ([[title]])
  // ═══════════════════════════════════════

  /**
   * 解析内容中的 Wiki 链接
   * @param {string} content
   * @returns {string[]}  链接目标标题列表
   */
  function parseWikiLinks(content) {
    const regex = /\[\[([^\]]+)\]\]/g;
    const links = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
      links.push(match[1].trim());
    }
    return [...new Set(links)];
  }

  /**
   * 导航到 Wiki 链接目标 (如不存在则创建)
   * @param {string} title  链接标题
   * @returns {Promise<Object>}  目标笔记
   */
  async function resolveWikiLink(title) {
    const all = await getAll();
    const target = all.find(n =>
      (n.title || '').toLowerCase() === title.toLowerCase()
    );

    if (target) return target;

    // 自动创建新笔记
    return create({ title });
  }

  /**
   * 获取反向链接 (哪些笔记链接到了指定笔记)
   * @param {string} title
   * @returns {Promise<Object[]>}
   */
  async function getBacklinks(title) {
    const all = await getAll();
    return all.filter(n => {
      const links = parseWikiLinks(n.content || '');
      return links.some(l => l.toLowerCase() === title.toLowerCase());
    });
  }

  /** 更新笔记的链接字段 */
  function updateWikiLinks(note) {
    note.links = parseWikiLinks(note.content || '');
  }


  // ═══════════════════════════════════════
  //  标签
  // ═══════════════════════════════════════

  /**
   * 获取所有使用中的标签及其计数
   * @returns {Promise<Array<{name: string, count: number}>>}
   */
  async function getAllTags() {
    const all = await getAll();
    const tagMap = {};
    for (const n of all) {
      for (const tag of (n.tags || [])) {
        tagMap[tag] = (tagMap[tag] || 0) + 1;
      }
    }
    return Object.entries(tagMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * 按标签获取笔记
   * @param {string} tag
   * @returns {Promise<Object[]>}
   */
  async function getByTag(tag) {
    const all = await getAll();
    return all.filter(n => (n.tags || []).includes(tag));
  }


  // ═══════════════════════════════════════
  //  版本历史
  // ═══════════════════════════════════════

  /**
   * 获取笔记的版本历史
   * @param {string} id
   * @returns {Promise<Array<{content: string, title: string, timestamp: number}>>}
   */
  async function getVersions(id) {
    const note = await getById(id);
    return note?.versions || [];
  }

  /**
   * 恢复到指定版本
   * @param {string} id
   * @param {number} versionIndex
   * @returns {Promise<Object>}
   */
  async function restoreVersion(id, versionIndex) {
    const note = await getById(id);
    if (!note) throw new Error('笔记不存在');

    const versions = note.versions || [];
    if (versionIndex < 0 || versionIndex >= versions.length) {
      throw new Error('版本索引无效');
    }

    const version = versions[versionIndex];
    return update(id, {
      title:   version.title,
      content: version.content,
    }, true); // 保存当前内容为新版本
  }


  // ═══════════════════════════════════════
  //  统计
  // ═══════════════════════════════════════

  /**
   * 获取笔记统计
   * @returns {Promise<Object>}
   */
  async function getStats() {
    const all = await getAll();
    const totalWords = all.reduce((sum, n) => sum + (n.wordCount || 0), 0);
    const totalChars = all.reduce((sum, n) => sum + (n.charCount || 0), 0);
    const folders = [...new Set(all.map(n => n.folder).filter(Boolean))];
    const tags = await getAllTags();

    return {
      total:      all.length,
      pinned:     all.filter(n => n.pinned).length,
      totalWords,
      totalChars,
      folders:    folders.length,
      tags:       tags.length,
      recentlyModified: all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5),
    };
  }


  // ═══════════════════════════════════════
  //  导入 / 导出
  // ═══════════════════════════════════════

  /**
   * 导出为 JSON
   * @returns {Promise<string>}
   */
  async function exportJSON() {
    const all = await getAll();
    return JSON.stringify(all, null, 2);
  }

  /**
   * 从 JSON 导入
   * @param {string} json
   * @returns {Promise<number>}  导入的笔记数
   */
  async function importJSON(json) {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) throw new Error('无效的 JSON 格式');

    let count = 0;
    const existing = await getAll();

    for (const n of arr) {
      if (!n.id) continue;
      const idx = existing.findIndex(e => e.id === n.id);
      if (idx >= 0) {
        await update(n.id, n);
      } else {
        await create(n);
      }
      count++;
    }

    return count;
  }

  /**
   * 导出单篇笔记为 Markdown 文件
   * @param {string} id
   * @returns {Promise<{filename: string, content: string}>}
   */
  async function exportAsMarkdown(id) {
    const note = await getById(id);
    if (!note) throw new Error('笔记不存在');

    const filename = (note.title || 'untitled').replace(/[/\\?%*:|"<>]/g, '-') + '.md';
    const header = `# ${note.title || '无标题'}\n\n`;
    const tags = (note.tags || []).length > 0
      ? `> 标签: ${note.tags.map(t => `#${t}`).join(' ')}\n\n`
      : '';
    const content = header + tags + (note.content || '');

    return { filename, content };
  }


  // ═══════════════════════════════════════
  //  内部工具
  // ═══════════════════════════════════════

  function updateCounts(note) {
    const text = note.content || '';
    note.charCount = text.replace(/\s+/g, '').length;
    note.wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  }

  function loadFromLS() {
    try {
      return JSON.parse(localStorage.getItem('trisync_notes') || '[]')
        .map(n => ({ ...n, tags: n.tags || [], pinned: n.pinned || false, versions: n.versions || [] }));
    } catch { return []; }
  }

  function saveToLS(notes) {
    localStorage.setItem('trisync_notes', JSON.stringify(notes));
  }

  async function syncToLS() {
    try {
      const all = await getAll();
      saveToLS(all);
    } catch { /* silent */ }
  }


  // ─── 公开 API ─────────────────────────
  return {
    // CRUD
    create,
    getAll,
    getById,
    update,
    remove,

    // 搜索
    search,

    // Wiki 链接
    parseWikiLinks,
    resolveWikiLink,
    getBacklinks,

    // 标签
    getAllTags,
    getByTag,

    // 版本历史
    getVersions,
    restoreVersion,

    // 统计
    getStats,

    // 导入导出
    exportJSON,
    importJSON,
    exportAsMarkdown,
  };
})();
