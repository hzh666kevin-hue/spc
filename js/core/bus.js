/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SPC Kernel · Layer 4 — 事件总线 (Pub/Sub)                  ║
 * ║  ──────────────────────────────────────────────────────────  ║
 * ║  单例模式 · 发布/订阅 · 解耦服务层与UI层                    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 用法:
 *   // 服务层发布事件
 *   SPCBus.emit('TASK_CREATED', { task });
 *   SPCBus.emit('VAULT_LOCKED');
 *
 *   // UI 层监听事件
 *   SPCBus.on('TASK_CREATED', (data) => renderTaskList());
 *   const unsub = SPCBus.on('VAULT_LOCKED', () => showLockScreen());
 *   unsub(); // 取消订阅
 *
 * 事件命名规范:
 *   TASK_CREATED, TASK_UPDATED, TASK_DELETED
 *   NOTE_CREATED, NOTE_UPDATED, NOTE_DELETED
 *   VAULT_LOCKED, VAULT_UNLOCKED, VAULT_ENTRY_SAVED
 *   SETTINGS_CHANGED
 *   NAV_CHANGED
 *   SEARCH_QUERY
 *   AUTOLOCK_WARNING, AUTOLOCK_TRIGGERED
 */

const SPCBus = (() => {
  'use strict';

  /**
   * 事件订阅表
   * @type {Map<string, Set<Function>>}
   */
  const _listeners = new Map();

  /**
   * 一次性监听器标记
   * @type {WeakSet<Function>}
   */
  const _onceWrappers = new WeakSet();

  /**
   * 事件历史 (最近 100 条, 用于调试)
   * @type {Array<{event: string, data: *, timestamp: number}>}
   */
  const _history = [];
  const MAX_HISTORY = 100;

  /**
   * 调试模式 (开启后在控制台打印所有事件)
   * @type {boolean}
   */
  let _debug = false;


  // ═══════════════════════════════════════
  //  核心 API
  // ═══════════════════════════════════════

  /**
   * 订阅事件
   *
   * @param {string}   event     事件名
   * @param {Function} callback  回调函数, 接收 (data, event) 两个参数
   * @returns {Function}         取消订阅函数 (调用即解绑)
   *
   * @example
   *   const unsub = SPCBus.on('TASK_CREATED', (task) => {
   *     console.log('新任务:', task.name);
   *   });
   *   // 后续不再需要时:
   *   unsub();
   */
  function on(event, callback) {
    if (typeof callback !== 'function') {
      throw new TypeError(`[SPCBus] on('${event}'): callback 必须是函数`);
    }

    if (!_listeners.has(event)) {
      _listeners.set(event, new Set());
    }

    _listeners.get(event).add(callback);

    // 返回取消订阅函数
    return () => off(event, callback);
  }

  /**
   * 订阅事件 (仅触发一次, 触发后自动移除)
   *
   * @param {string}   event
   * @param {Function} callback
   * @returns {Function}  取消订阅函数
   */
  function once(event, callback) {
    if (typeof callback !== 'function') {
      throw new TypeError(`[SPCBus] once('${event}'): callback 必须是函数`);
    }

    const wrapper = (data, evt) => {
      off(event, wrapper);
      callback(data, evt);
    };

    _onceWrappers.add(wrapper);
    return on(event, wrapper);
  }

  /**
   * 取消订阅
   *
   * @param {string}   event
   * @param {Function} callback  要移除的具体回调
   */
  function off(event, callback) {
    const set = _listeners.get(event);
    if (set) {
      set.delete(callback);
      if (set.size === 0) {
        _listeners.delete(event);
      }
    }
  }

  /**
   * 移除某事件的所有监听器
   *
   * @param {string} [event]  如果不传, 则清除所有事件的所有监听器
   */
  function offAll(event) {
    if (event) {
      _listeners.delete(event);
    } else {
      _listeners.clear();
    }
  }

  /**
   * 发布事件 (同步触发所有订阅者)
   *
   * @param {string} event  事件名
   * @param {*}      [data] 事件携带的数据
   */
  function emit(event, data) {
    // 记录历史
    _history.push({
      event,
      data,
      timestamp: Date.now(),
    });
    if (_history.length > MAX_HISTORY) {
      _history.shift();
    }

    // 调试输出
    if (_debug) {
      console.log(
        `%c[SPCBus] ${event}`,
        'color: #7c3aed; font-weight: bold',
        data !== undefined ? data : '',
      );
    }

    const set = _listeners.get(event);
    if (!set || set.size === 0) return;

    // 遍历所有订阅者
    for (const callback of set) {
      try {
        callback(data, event);
      } catch (err) {
        console.error(`[SPCBus] 事件处理器异常 [${event}]:`, err);
        // 不中断其他监听器的执行
      }
    }
  }

  /**
   * 异步发布事件 (通过 microtask 延迟触发)
   * 适用于需要在当前同步代码执行完毕后触发的场景
   *
   * @param {string} event
   * @param {*}      [data]
   * @returns {Promise<void>}
   */
  function emitAsync(event, data) {
    return Promise.resolve().then(() => emit(event, data));
  }


  // ═══════════════════════════════════════
  //  查询 & 调试
  // ═══════════════════════════════════════

  /**
   * 获取某事件的订阅者数量
   * @param {string} event
   * @returns {number}
   */
  function listenerCount(event) {
    const set = _listeners.get(event);
    return set ? set.size : 0;
  }

  /**
   * 获取所有已注册的事件名列表
   * @returns {string[]}
   */
  function eventNames() {
    return [..._listeners.keys()];
  }

  /**
   * 获取事件历史 (用于调试)
   * @param {number} [limit=20]  返回最近 N 条
   * @returns {Array<{event: string, data: *, timestamp: number}>}
   */
  function history(limit = 20) {
    return _history.slice(-limit);
  }

  /**
   * 打开/关闭调试模式
   * @param {boolean} enabled
   */
  function debug(enabled = true) {
    _debug = enabled;
    console.log(`[SPCBus] 调试模式: ${enabled ? '开启' : '关闭'}`);
  }


  // ═══════════════════════════════════════
  //  事件名常量 (防止拼写错误)
  // ═══════════════════════════════════════

  const Events = Object.freeze({
    // 任务
    TASK_CREATED:      'TASK_CREATED',
    TASK_UPDATED:      'TASK_UPDATED',
    TASK_DELETED:      'TASK_DELETED',
    TASK_STATUS_CHANGED: 'TASK_STATUS_CHANGED',
    TASKS_LOADED:      'TASKS_LOADED',

    // 笔记
    NOTE_CREATED:      'NOTE_CREATED',
    NOTE_UPDATED:      'NOTE_UPDATED',
    NOTE_DELETED:      'NOTE_DELETED',
    NOTES_LOADED:      'NOTES_LOADED',

    // 保险箱
    VAULT_LOCKED:      'VAULT_LOCKED',
    VAULT_UNLOCKED:    'VAULT_UNLOCKED',
    VAULT_ENTRY_SAVED: 'VAULT_ENTRY_SAVED',
    VAULT_ENTRY_DELETED: 'VAULT_ENTRY_DELETED',

    // 导航 & UI
    NAV_CHANGED:       'NAV_CHANGED',
    SEARCH_QUERY:      'SEARCH_QUERY',
    MODAL_OPEN:        'MODAL_OPEN',
    MODAL_CLOSE:       'MODAL_CLOSE',

    // 安全
    AUTOLOCK_WARNING:   'AUTOLOCK_WARNING',
    AUTOLOCK_TRIGGERED: 'AUTOLOCK_TRIGGERED',
    ACTIVITY_RESET:     'ACTIVITY_RESET',

    // 系统
    SETTINGS_CHANGED:  'SETTINGS_CHANGED',
    KERNEL_READY:      'KERNEL_READY',
    DATA_MIGRATED:     'DATA_MIGRATED',
    ERROR:             'ERROR',
  });


  // ─── 公开 API ─────────────────────────
  return {
    on,
    once,
    off,
    offAll,
    emit,
    emitAsync,

    listenerCount,
    eventNames,
    history,
    debug,

    Events,
  };
})();
