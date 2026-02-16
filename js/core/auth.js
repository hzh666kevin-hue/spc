/**
 * SPC 认证与用户管理系统
 * 支持本地模式和云端同步模式
 * 支持零知识加密云同步
 */

const AuthService = {
  // 当前登录用户
  currentUser: null,
  
  // 存储键前缀
  STORAGE_PREFIX: 'spc_user_',
  
  // 同步加密密钥 (临时存储在内存中)
  _syncKey: null,
  
  // 初始化
  init() {
    this.loadCurrentUser();
    return this.currentUser;
  },
  
  // 获取所有本地用户
  getAllUsers() {
    const users = localStorage.getItem('spc_all_users');
    return users ? JSON.parse(users) : [];
  },
  
  // 保存用户列表
  saveAllUsers(users) {
    localStorage.setItem('spc_all_users', JSON.stringify(users));
  },
  
  // 创建新用户
  createUser(username, password, options = {}) {
    const users = this.getAllUsers();
    
    // 检查用户名是否已存在
    if (users.find(u => u.username === username)) {
      return { success: false, error: '用户名已存在' };
    }
    
    // 生成用户ID
    const userId = this.generateId();
    
    // 创建用户对象
    const user = {
      id: userId,
      username: username,
      createdAt: Date.now(),
      mode: options.mode || 'local', // 'local' 或 'cloud'
      cloudUrl: options.cloudUrl || '',
      hasSyncPassword: !!options.syncPassword, // 是否设置了同步密码
      lastLogin: null
    };
    
    // 如果是云端模式，保存加密的密码用于验证
    if (options.mode === 'cloud' && password) {
      user.passwordHash = this.hashPassword(password, userId);
    }
    
    // 如果提供了同步密码，设置加密密钥
    if (options.mode === 'cloud' && options.syncPassword) {
      this.setSyncKey(options.syncPassword);
    }
    
    users.push(user);
    this.saveAllUsers(users);
    
    // 初始化用户数据存储
    this.initUserData(userId);
    
    return { success: true, user: user };
  },
  
  // 用户登录
  login(username, password, cloudUrl = null, syncPassword = null) {
    const users = this.getAllUsers();
    const user = users.find(u => u.username === username);
    
    if (!user) {
      return { success: false, error: '用户不存在' };
    }
    
    // 如果是云端模式，验证密码
    if (user.mode === 'cloud' && password) {
      const hash = this.hashPassword(password, user.id);
      if (hash !== user.passwordHash) {
        return { success: false, error: '密码错误' };
      }
    }
    
    // 更新最后登录时间
    user.lastLogin = Date.now();
    if (cloudUrl) {
      user.cloudUrl = cloudUrl;
    }
    this.saveAllUsers(users);
    
    // 设置当前用户
    this.setCurrentUser(user);
    
    // 如果是云端模式且提供了同步密码，设置加密密钥
    if (user.mode === 'cloud' && syncPassword) {
      this.setSyncKey(syncPassword);
    }
    
    return { success: true, user: user };
  },
  
  // 退出登录
  logout() {
    this.currentUser = null;
    localStorage.removeItem('spc_current_user');
    
    // 触发事件
    window.dispatchEvent(new CustomEvent('spc-logout'));
  },
  
  // 获取当前用户
  getCurrentUser() {
    return this.currentUser;
  },
  
  // 设置当前用户
  setCurrentUser(user) {
    this.currentUser = user;
    localStorage.setItem('spc_current_user', JSON.stringify(user));
    
    // 触发登录事件
    window.dispatchEvent(new CustomEvent('spc-login', { detail: user }));
  },
  
  // 从本地加载当前用户
  loadCurrentUser() {
    const userData = localStorage.getItem('spc_current_user');
    if (userData) {
      this.currentUser = JSON.parse(userData);
    }
    return this.currentUser;
  },
  
  // 初始化用户数据存储
  initUserData(userId) {
    const prefix = this.STORAGE_PREFIX + userId + '_';
    
    // 初始化各模块数据
    localStorage.setItem(prefix + 'notes', JSON.stringify([]));
    localStorage.setItem(prefix + 'tasks', JSON.stringify([]));
    localStorage.setItem(prefix + 'vault', JSON.stringify([]));
    localStorage.setItem(prefix + 'settings', JSON.stringify({
      theme: 'light',
      sidebarCollapsed: false
    }));
  },
  
  // 获取当前用户的数据前缀
  getDataPrefix() {
    if (!this.currentUser) return null;
    return this.STORAGE_PREFIX + this.currentUser.id + '_';
  },
  
  // 用户数据操作
  getData(key) {
    const prefix = this.getDataPrefix();
    if (!prefix) return null;
    
    const data = localStorage.getItem(prefix + key);
    return data ? JSON.parse(data) : null;
  },
  
  setData(key, value) {
    const prefix = this.getDataPrefix();
    if (!prefix) return false;
    
    localStorage.setItem(prefix + key, JSON.stringify(value));
    return true;
  },
  
  // 删除用户
  deleteUser(userId) {
    const users = this.getAllUsers();
    const filtered = users.filter(u => u.id !== userId);
    this.saveAllUsers(filtered);
    
    // 清除用户数据
    const prefix = this.STORAGE_PREFIX + userId + '_';
    localStorage.removeItem(prefix + 'notes');
    localStorage.removeItem(prefix + 'tasks');
    localStorage.removeItem(prefix + 'vault');
    localStorage.removeItem(prefix + 'settings');
    
    // 如果删除的是当前用户，清除当前登录
    if (this.currentUser && this.currentUser.id === userId) {
      this.logout();
    }
    
    return { success: true };
  },
  
  // 更新用户设置
  updateUser(userId, updates) {
    const users = this.getAllUsers();
    const idx = users.findIndex(u => u.id === userId);
    
    if (idx === -1) {
      return { success: false, error: '用户不存在' };
    }
    
    users[idx] = { ...users[idx], ...updates };
    this.saveAllUsers(users);
    
    // 如果是当前用户，更新当前用户数据
    if (this.currentUser && this.currentUser.id === userId) {
      this.currentUser = users[idx];
      localStorage.setItem('spc_current_user', JSON.stringify(users[idx]));
    }
    
    return { success: true, user: users[idx] };
  },
  
  // 生成唯一ID
  generateId() {
    return 'user_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  },
  
  // 密码哈希 (简单实现，生产环境应使用更安全的方式)
  hashPassword(password, salt) {
    let hash = 0;
    const str = password + salt + 'SPC_SALT_2026';
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  },
  
  // 检查是否已登录
  isLoggedIn() {
    return this.currentUser !== null;
  },
  
  // 设置同步加密密钥 (从用户的同步密码派生)
  async setSyncKey(password) {
    if (!password) {
      this._syncKey = null;
      return;
    }
    // 使用 PBKDF2 派生加密密钥
    const salt = this.currentUser?.id ? 
      await this._hashString(this.currentUser.id) : 'SPC_SALT_2026';
    this._syncKey = await this._deriveKey(password, salt);
  },
  
  // 简单的字符串哈希 (用于 salt)
  async _hashString(str) {
    const msgBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
  },
  
  // 从密码派生加密密钥
  async _deriveKey(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode(salt),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },
  
  // 加密数据 (用于云同步)
  async _encryptData(data) {
    if (!this._syncKey) throw new Error('未设置同步密钥');
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      this._syncKey,
      encoder.encode(JSON.stringify(data))
    );
    // 返回: base64(iv + encrypted)
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
  },
  
  // 解密数据 (用于云同步)
  async _decryptData(encryptedBundle) {
    if (!this._syncKey) throw new Error('未设置同步密钥');
    const decoder = new TextDecoder();
    const combined = Uint8Array.from(atob(encryptedBundle), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      this._syncKey,
      encrypted
    );
    return JSON.parse(decoder.decode(decrypted));
  },
  
  // 云端同步相关
  async syncToCloud() {
    if (!this.currentUser || this.currentUser.mode !== 'cloud') {
      return { success: false, error: '未启用云同步' };
    }
    
    try {
      const cloudUrl = this.currentUser.cloudUrl;
      if (!cloudUrl) {
        return { success: false, error: '未配置云端服务器' };
      }
      
      // 检查是否设置了同步密钥
      if (!this._syncKey) {
        return { success: false, error: '请先设置同步密码' };
      }
      
      // 获取所有数据
      const data = {
        notes: this.getData('notes') || [],
        tasks: this.getData('tasks') || [],
        vault: this.getData('vault') || []
      };
      
      // 🔐 加密后再发送到云端 (零知识加密)
      const encryptedData = await this._encryptData(data);
      
      // 发送到云端
      const response = await fetch(cloudUrl + '/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encrypted: true, data: encryptedData })
      });
      
      if (response.ok) {
        return { success: true };
      } else {
        throw new Error('同步失败');
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
  
  async syncFromCloud() {
    if (!this.currentUser || this.currentUser.mode !== 'cloud') {
      return { success: false, error: '未启用云同步' };
    }
    
    try {
      const cloudUrl = this.currentUser.cloudUrl;
      if (!cloudUrl) {
        return { success: false, error: '未配置云端服务器' };
      }
      
      // 检查是否设置了同步密钥
      if (!this._syncKey) {
        return { success: false, error: '请先设置同步密码' };
      }
      
      // 从云端获取加密数据
      const response = await fetch(cloudUrl + '/api/sync');
      const result = await response.json();
      
      if (!result.encrypted || !result.data) {
        return { success: false, error: '服务器数据格式不正确' };
      }
      
      // 🔐 解密数据
      const data = await this._decryptData(result.data);
      
      // 保存到本地
      this.setData('notes', data.notes || []);
      this.setData('tasks', data.tasks || []);
      this.setData('vault', data.vault || []);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
      this.setData('tasks', tasks);
      this.setData('vault', vault);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
  
  // 导出用户数据
  exportUserData() {
    if (!this.currentUser) return null;
    
    return {
      user: this.currentUser,
      notes: this.getData('notes') || [],
      tasks: this.getData('tasks') || [],
      vault: this.getData('vault') || [],
      settings: this.getData('settings') || {},
      exportedAt: Date.now()
    };
  },
  
  // 导入用户数据
  importUserData(data) {
    if (!data || !data.user) {
      return { success: false, error: '无效的数据' };
    }
    
    // 创建新用户
    const result = this.createUser(
      data.user.username + '_imported',
      '',
      { mode: 'local' }
    );
    
    if (!result.success) {
      return result;
    }
    
    // 导入数据
    const prefix = this.STORAGE_PREFIX + result.user.id + '_';
    localStorage.setItem(prefix + 'notes', JSON.stringify(data.notes || []));
    localStorage.setItem(prefix + 'tasks', JSON.stringify(data.tasks || []));
    localStorage.setItem(prefix + 'vault', JSON.stringify(data.vault || []));
    localStorage.setItem(prefix + 'settings', JSON.stringify(data.settings || {}));
    
    return { success: true, user: result.user };
  }
};

// 导出到全局
window.AuthService = AuthService;
