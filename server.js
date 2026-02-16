/**
 * SPC API Server
 * 简单的后端服务，用于同步和数据存储
 * 
 * 使用方法:
 * 1. npm install
 * 2. node server.js
 * 3. 访问 http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'store.json');

// 确保数据目录存在
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 初始化数据文件
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    notes: [],
    tasks: [],
    vault: [],
    settings: {}
  }, null, 2));
}

// 读取数据
function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    return { notes: [], tasks: [], vault: [], settings: {} };
  }
}

// 写入数据
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// CORS 头
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// 解析请求体
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// 简单认证检查 (可配置)
function checkAuth(req) {
  // 简化版本: 不做强制认证
  // 可根据需要添加 token 验证
  return true;
}

// API 路由处理
async function handleApi(req, res) {
  setCorsHeaders(res);
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!checkAuth(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const url = req.url.split('?')[0];
  const method = req.method;
  const data = readData();

  try {
    // ========== 笔记 API ==========
    if (url === '/api/notes' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data.notes || []));
      return;
    }

    if (url === '/api/notes' && method === 'POST') {
      const body = await parseBody(req);
      const note = {
        id: body.id || crypto.randomUUID(),
        ...body,
        updatedAt: Date.now()
      };
      const notes = data.notes || [];
      const idx = notes.findIndex(n => n.id === note.id);
      if (idx >= 0) {
        notes[idx] = { ...notes[idx], ...note };
      } else {
        note.createdAt = note.createdAt || Date.now();
        notes.unshift(note);
      }
      data.notes = notes;
      writeData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(note));
      return;
    }

    if (url.startsWith('/api/notes/') && method === 'DELETE') {
      const id = url.split('/').pop();
      data.notes = (data.notes || []).filter(n => n.id !== id);
      writeData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // ========== 任务 API ==========
    if (url === '/api/tasks' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data.tasks || []));
      return;
    }

    if (url === '/api/tasks' && method === 'POST') {
      const body = await parseBody(req);
      const task = {
        id: body.id || crypto.randomUUID(),
        ...body,
        updatedAt: Date.now()
      };
      const tasks = data.tasks || [];
      const idx = tasks.findIndex(t => t.id === task.id);
      if (idx >= 0) {
        tasks[idx] = { ...tasks[idx], ...task };
      } else {
        task.createdAt = task.createdAt || Date.now();
        tasks.unshift(task);
      }
      data.tasks = tasks;
      writeData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(task));
      return;
    }

    // ========== 保险库 API ==========
    if (url === '/api/vault' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data.vault || []));
      return;
    }

    if (url === '/api/vault' && method === 'POST') {
      const body = await parseBody(req);
      const item = {
        id: body.id || crypto.randomUUID(),
        ...body,
        updatedAt: Date.now()
      };
      const vault = data.vault || [];
      const idx = vault.findIndex(v => v.id === item.id);
      if (idx >= 0) {
        vault[idx] = { ...vault[idx], ...item };
      } else {
        item.createdAt = item.createdAt || Date.now();
        vault.unshift(item);
      }
      data.vault = vault;
      writeData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(item));
      return;
    }

    // ========== 同步 API ==========
    if (url === '/api/sync' && method === 'POST') {
      const body = await parseBody(req);
      // 合并客户端数据到服务端
      if (body.notes) data.notes = body.notes;
      if (body.tasks) data.tasks = body.tasks;
      if (body.vault) data.vault = body.vault;
      writeData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true, 
        timestamp: Date.now(),
        data: { notes: data.notes, tasks: data.tasks, vault: data.vault }
      }));
      return;
    }

    // ========== 导出/导入 ==========
    if (url === '/api/export' && method === 'GET') {
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename=spc-export.json'
      });
      res.end(JSON.stringify(data, null, 2));
      return;
    }

    // 未知路由
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));

  } catch (e) {
    console.error('API Error:', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

// 静态文件服务
function serveStatic(req, res) {
  let filePath = req.url.split('?')[0];
  
  // 默认 index.html
  if (filePath === '/') {
    filePath = '/index.html';
  }

  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  };

  const contentType = contentTypes[ext] || 'text/plain';
  const staticPath = path.join(__dirname, 'public', filePath);

  // 安全检查: 防止目录遍历
  if (!staticPath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(staticPath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // 如果public目录下没有，尝试根目录
        fs.readFile(path.join(__dirname, filePath), (err2, content2) => {
          if (err2) {
            res.writeHead(404);
            res.end('Not found');
          } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content2);
          }
        });
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  const url = req.url || '';
  
  // API 路由
  if (url.startsWith('/api/')) {
    handleApi(req, res);
  } else {
    serveStatic(req, res);
  }
});

// 启动服务器
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║          SPC API Server 已启动                        ║
║  ─────────────────────────────────────────────────── ║
║  本地访问:   http://localhost:${PORT}                    ║
║  API 端点:   http://localhost:${PORT}/api              ║
║  ─────────────────────────────────────────────────── ║
║  数据文件:   ${DATA_FILE}
╚═══════════════════════════════════════════════════════╝
  `);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到 SIGTERM，正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});
