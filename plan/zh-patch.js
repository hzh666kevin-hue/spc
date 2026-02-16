/**
 * SPC Plan — Angular 运行时汉化补丁
 * ====================================
 * 使用 MutationObserver 监听 DOM 变化，实时将英文文本替换为中文。
 * 适用于 Super Productivity 等 Angular 编译后的应用。
 *
 * 引入方式: 在 plan/index.html 的 </body> 前添加:
 *   <script src="zh-patch.js"></script>
 */

(function() {
  'use strict';

  // ═══════════════════════════════════════
  //  汉化字典 (基于 Super Productivity)
  // ═══════════════════════════════════════

  const DICT = {
    // ─── 导航 & 菜单 ────────────────────
    'Inbox':                    '收件箱',
    'Today':                    '今天',
    'Scheduled':                '已安排',
    'Backlog':                  '待办池',
    'Settings':                 '设置',
    'Projects':                 '项目',
    'Tags':                     '标签',
    'Archive':                  '归档',

    // ─── 任务操作 ────────────────────────
    'Add task':                 '添加任务',
    'Add Task':                 '添加任务',
    'Add a task':               '添加任务',
    'Add Sub Task':             '添加子任务',
    'Add sub task':             '添加子任务',
    'Delete Task':              '删除任务',
    'Delete task':              '删除任务',
    'Edit Task':                '编辑任务',
    'Edit task':                '编辑任务',
    'Done':                     '已完成',
    'Mark as done':             '标记为已完成',
    'Mark as undone':           '标记为未完成',
    'Move to today':            '移到今天',
    'Move to backlog':          '移到待办池',
    'Move to project':          '移到项目',
    'Start tracking':           '开始计时',
    'Stop tracking':            '停止计时',
    'Toggle tracking':          '切换计时',
    'Track time':               '时间追踪',

    // ─── 状态 ────────────────────────────
    'Todo':                     '待办',
    'In Progress':              '进行中',
    'In progress':              '进行中',
    'Completed':                '已完成',
    'Open':                     '打开',
    'Closed':                   '已关闭',
    'Overdue':                  '已逾期',

    // ─── 优先级 ──────────────────────────
    'Priority':                 '优先级',
    'High':                     '高',
    'Medium':                   '中',
    'Low':                      '低',
    'Urgent':                   '紧急',
    'None':                     '无',
    'No priority':              '无优先级',

    // ─── 时间 ────────────────────────────
    'Due date':                 '截止日期',
    'Due Date':                 '截止日期',
    'Start date':               '开始日期',
    'No due date':              '无截止日期',
    'Reminder':                 '提醒',
    'Reminders':                '提醒',
    'Set reminder':             '设置提醒',
    'Set due date':             '设置截止日期',
    'Today':                    '今天',
    'Tomorrow':                 '明天',
    'Yesterday':                '昨天',
    'This week':                '本周',
    'Next week':                '下周',
    'This month':               '本月',
    'Next month':               '下月',

    // ─── 计时器 & 番茄钟 ────────────────
    'Pomodoro':                 '番茄钟',
    'Focus':                    '专注',
    'Break':                    '休息',
    'Short Break':              '短休息',
    'Long Break':               '长休息',
    'Start':                    '开始',
    'Pause':                    '暂停',
    'Resume':                   '继续',
    'Stop':                     '停止',
    'Reset':                    '重置',
    'Skip':                     '跳过',
    'Round':                    '轮次',
    'Rounds':                   '轮次',
    'Work':                     '工作',
    'Take a break':             '休息一下',
    'Time Tracking':            '时间追踪',
    'Time tracking':            '时间追踪',
    'Time spent':               '已用时间',
    'Time Spent':               '已用时间',
    'Estimated time':           '预估时间',
    'Total time':               '总时间',

    // ─── 项目 ────────────────────────────
    'Project':                  '项目',
    'Create project':           '创建项目',
    'Create Project':           '创建项目',
    'Project name':             '项目名称',
    'All projects':             '全部项目',
    'No project':               '无项目',

    // ─── 标签 ────────────────────────────
    'Tag':                      '标签',
    'Add tag':                  '添加标签',
    'Add Tag':                  '添加标签',
    'Create tag':               '创建标签',
    'Create Tag':               '创建标签',
    'No tags':                  '无标签',

    // ─── 视图 ────────────────────────────
    'Board':                    '看板',
    'Board View':               '看板视图',
    'List':                     '列表',
    'List View':                '列表视图',
    'Calendar':                 '日历',
    'Calendar View':            '日历视图',
    'Timeline':                 '时间线',
    'Kanban':                   '看板',

    // ─── 通用 ────────────────────────────
    'Save':                     '保存',
    'Cancel':                   '取消',
    'Delete':                   '删除',
    'Edit':                     '编辑',
    'Close':                    '关闭',
    'OK':                       '确定',
    'Yes':                      '是',
    'No':                       '否',
    'Confirm':                  '确认',
    'Search':                   '搜索',
    'Search...':                '搜索...',
    'Filter':                   '筛选',
    'Sort':                     '排序',
    'Sort by':                  '排序方式',
    'Group by':                 '分组方式',
    'Name':                     '名称',
    'Title':                    '标题',
    'Description':              '描述',
    'Notes':                    '备注',
    'Note':                     '笔记',
    'Add note':                 '添加笔记',
    'Add notes':                '添加备注',
    'Attachment':               '附件',
    'Attachments':              '附件',
    'Add attachment':           '添加附件',
    'Import':                   '导入',
    'Export':                   '导出',
    'Loading':                  '加载中',
    'Loading...':               '加载中...',
    'No results':               '无结果',
    'No data':                  '暂无数据',
    'Empty':                    '空',

    // ─── 设置页面 ────────────────────────
    'General':                  '通用',
    'Appearance':               '外观',
    'Language':                 '语言',
    'Theme':                    '主题',
    'Dark':                     '深色',
    'Light':                    '浅色',
    'System':                   '跟随系统',
    'Sync':                     '同步',
    'Backup':                   '备份',
    'About':                    '关于',
    'Version':                  '版本',
    'Help':                     '帮助',
    'Keyboard shortcuts':       '快捷键',
    'Keyboard Shortcuts':       '快捷键',

    // ─── 评估 & 统计 ────────────────────
    'Evaluation':               '评估',
    'Daily Summary':            '每日总结',
    'Weekly Summary':           '每周总结',
    'Productivity':             '生产力',
    'Statistics':               '统计',
    'Tasks completed':          '已完成任务',
    'Tasks created':            '已创建任务',

    // ─── 集成 ────────────────────────────
    'Integrations':             '集成',
    'GitHub':                   'GitHub',
    'Jira':                     'Jira',
    'GitLab':                   'GitLab',

    // ─── 对话框 ──────────────────────────
    'Are you sure?':            '确定要执行此操作吗？',
    'This cannot be undone':    '此操作不可撤销',
    'Discard changes?':         '放弃更改？',
    'Unsaved changes':          '未保存的更改',
  };

  // 按长度降序排列键，确保长字符串优先匹配
  const sortedKeys = Object.keys(DICT).sort((a, b) => b.length - a.length);

  // ═══════════════════════════════════════
  //  文本替换引擎
  // ═══════════════════════════════════════

  // 需要跳过的元素
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'SVG', 'MATH']);

  function translateTextNode(node) {
    if (!node.nodeValue) return;
    let text = node.nodeValue;
    let changed = false;

    for (const key of sortedKeys) {
      if (text.includes(key)) {
        text = text.split(key).join(DICT[key]);
        changed = true;
      }
    }

    if (changed) {
      node.nodeValue = text;
    }
  }

  function translateElement(el) {
    if (!el || SKIP_TAGS.has(el.tagName)) return;

    // 处理 placeholder
    if (el.placeholder) {
      for (const key of sortedKeys) {
        if (el.placeholder.includes(key)) {
          el.placeholder = el.placeholder.split(key).join(DICT[key]);
        }
      }
    }

    // 处理 title
    if (el.title) {
      for (const key of sortedKeys) {
        if (el.title.includes(key)) {
          el.title = el.title.split(key).join(DICT[key]);
        }
      }
    }

    // 处理 aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      for (const key of sortedKeys) {
        if (ariaLabel.includes(key)) {
          el.setAttribute('aria-label', ariaLabel.split(key).join(DICT[key]));
        }
      }
    }
  }

  function walkAndTranslate(root) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE && SKIP_TAGS.has(node.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        translateTextNode(node);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        translateElement(node);
      }
    }
  }

  // ═══════════════════════════════════════
  //  MutationObserver 监听器
  // ═══════════════════════════════════════

  let debounceTimer = null;

  function onMutation(mutations) {
    // 去抖: 批量处理 DOM 变化
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
              translateTextNode(node);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              walkAndTranslate(node);
            }
          });
        } else if (mutation.type === 'characterData') {
          translateTextNode(mutation.target);
        }
      }
    }, 80);
  }

  // ═══════════════════════════════════════
  //  启动
  // ═══════════════════════════════════════

  function start() {
    // 初始全量翻译
    walkAndTranslate(document.body);

    // 启动观察器
    const observer = new MutationObserver(onMutation);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    console.log('[SPC] 汉化补丁已激活 · 字典条目:', sortedKeys.length);
  }

  // 等待 DOM 就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    // Angular 应用可能延迟渲染，等待一下
    setTimeout(start, 500);
    // 再次扫描以捕获延迟加载的内容
    setTimeout(() => walkAndTranslate(document.body), 2000);
    setTimeout(() => walkAndTranslate(document.body), 5000);
  }
})();
