/**
 * SPC 认证与用户管理系统
 * 支持本地模式和云端同步模式
 */

const AuthService = {
  // 当前登录用户
  currentUser: null,
  
  // 存储键前缀
  STORAGE_PREFIX: 'spc_user_',
  
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
      lastLogin: null
    };
    
    // 如果是云端模式，保存加密的密码用于验证
    if (options.mode === 'cloud' && password) {
      user.passwordHash = this.hashPassword(password, userId);
    }
    
    users.push(user);
    this.saveAllUsers(users);
    
    // 初始化用户数据存储
    this.initUserData(userId);
    
    return { success: true, user: user };
  },
  
  // 用户登录
  login(username, password, cloudUrl = null) {
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
      
      // 获取所有数据
      const data = {
        notes: this.getData('notes') || [],
        tasks: this.getData('tasks') || [],
        vault: this.getData('vault') || []
      };
      
      // 发送到云端
      const response = await fetch(cloudUrl + '/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
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
      
      // 从云端获取数据
      const [notesRes, tasksRes, vaultRes] = await Promise.all([
        fetch(cloudUrl + '/api/notes'),
        fetch(cloudUrl + '/api/tasks'),
        fetch(cloudUrl + '/api/vault')
      ]);
      
      const notes = await notesRes.json();
      const tasks = await tasksRes.json();
      const vault = await vaultRes.json();
      
      // 保存到本地
      this.setData('notes', notes);
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
