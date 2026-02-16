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

console.log('SPC Server 启动中...');
console.log('数据文件路径:', DATA_FILE);

// 确保数据目录存在
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  console.log('创建数据目录...');
  fs.mkdirSync(dataDir, { recursive: true });
}

// 初始化数据文件
if (!fs.existsSync(DATA_FILE)) {
  console.log('初始化数据文件...');
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
    console.error('读取数据失败:', e);
    return { notes: [], tasks: [], vault: [], settings: {} };
  }
}

// 写入数据
function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('写入数据失败:', e);
  }
}

// CORS 头
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// 解析请求体
function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        if (body) {
          resolve(JSON.parse(body));
        } else {
          resolve({});
        }
      } catch (e) {
        console.error('JSON解析失败:', e, 'body:', body);
        resolve({});
      }
    });
    req.on('error', (e) => {
      console.error('请求体读取失败:', e);
      resolve({});
    });
  });
}

// 获取静态文件
function getStaticFile(filePath) {
  const pathsToTry = [
    path.join(__dirname, 'public', filePath),
    path.join(__dirname, filePath)
  ];
  
  for (const tryPath of pathsToTry) {
    if (fs.existsSync(tryPath)) {
      try {
        return fs.readFileSync(tryPath);
      } catch (e) {
        // 继续尝试下一个路径
      }
    }
  }
  return null;
}

// API 路由处理
const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);
  
  // 处理 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = (req.url || '/').split('?')[0];
  const method = req.method;
  
  console.log(`${method} ${url}`);

  // API 路由
  if (url.startsWith('/api/')) {
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
      // POST: 接收客户端数据 (支持加密)
      if (url === '/api/sync' && method === 'POST') {
        const body = await parseBody(req);
        console.log('同步请求:', body);
        
        // 支持加密数据 (零知识同步)
        if (body.encrypted && body.data) {
          // 服务器只存储密文，不解密
          data.encryptedData = body.data;
          data.isEncrypted = true;
        } else {
          // 兼容旧版明文同步
          if (body.notes) data.notes = body.notes;
          if (body.tasks) data.tasks = body.tasks;
          if (body.vault) data.vault = body.vault;
          data.isEncrypted = false;
        }
        writeData(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          timestamp: Date.now()
        }));
        return;
      }
      
      // GET: 获取同步数据
      if (url === '/api/sync' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // 返回加密状态和加密数据 (如果有)
        if (data.isEncrypted && data.encryptedData) {
          res.end(JSON.stringify({ 
            encrypted: true, 
            data: data.encryptedData 
          }));
        } else {
          // 兼容旧版明文数据
          res.end(JSON.stringify({ 
            encrypted: false, 
            data: { notes: data.notes, tasks: data.tasks, vault: data.vault }
          }));
        }
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
      res.end(JSON.stringify({ error: 'Internal server error', message: e.message }));
    }
    return;
  }

  // 静态文件服务
  let filePath = url;
  
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
  
  const fileContent = getStaticFile(filePath);

  if (fileContent) {
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fileContent);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// 获取局域网IP
function getLocalIpAddress() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// 启动服务器
server.listen(PORT, () => {
  const localIp = getLocalIpAddress();
  console.log(`
╔═══════════════════════════════════════════════════════╗
║          SPC API Server 已启动                        ║
║  ─────────────────────────────────────────────────── ║
║  💻 本地访问:   http://localhost:${PORT}                    ║
║  📱 局域网访问: http://${localIp}:${PORT}                 ║
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
