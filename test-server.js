/**
 * SPC API Server - 修复版本
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'store.json');

console.log('SPC Server 启动中...');
console.log('数据文件路径:', DATA_FILE);

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  console.log('创建数据目录...');
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(DATA_FILE)) {
  console.log('初始化数据文件...');
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    notes: [],
    tasks: [],
    vault: [],
    settings: {}
  }, null, 2));
}

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    console.error('读取数据失败:', e);
    return { notes: [], tasks: [], vault: {}, settings: {} };
  }
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('写入数据失败:', e);
  }
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        console.error('JSON解析失败:', e);
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = (req.url || '/').split('?')[0];
  const method = req.method;
  console.log(`${method} ${url}`);

  if (url.startsWith('/api/')) {
    const data = readData();

    try {
      // Notes API
      if (url === '/api/notes' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data.notes || []));
        return;
      }

      if (url === '/api/notes' && method === 'POST') {
        const body = await parseBody(req);
        const note = { id: body.id || crypto.randomUUID(), ...body, updatedAt: Date.now() };
        const notes = data.notes || [];
        const idx = notes.findIndex(n => n.id === note.id);
        if (idx >= 0) { notes[idx] = { ...notes[idx], ...note }; }
        else { note.createdAt = note.createdAt || Date.now(); notes.unshift(note); }
        data.notes = notes;
        writeData(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(note));
        return;
      }

      // Tasks API
      if (url === '/api/tasks' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data.tasks || []));
        return;
      }

      if (url === '/api/tasks' && method === 'POST') {
        const body = await parseBody(req);
        const task = { id: body.id || crypto.randomUUID(), ...body, updatedAt: Date.now() };
        const tasks = data.tasks || [];
        const idx = tasks.findIndex(t => t.id === task.id);
        if (idx >= 0) { tasks[idx] = { ...tasks[idx], ...task }; }
        else { task.createdAt = task.createdAt || Date.now(); tasks.unshift(task); }
        data.tasks = tasks;
        writeData(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(task));
        return;
      }

      // Vault API
      if (url === '/api/vault' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data.vault || []));
        return;
      }

      if (url === '/api/vault' && method === 'POST') {
        const body = await parseBody(req);
        const item = { id: body.id || crypto.randomUUID(), ...body, updatedAt: Date.now() };
        const vault = data.vault || [];
        const idx = vault.findIndex(v => v.id === item.id);
        if (idx >= 0) { vault[idx] = { ...vault[idx], ...item }; }
        else { item.createdAt = item.createdAt || Date.now(); vault.unshift(item); }
        data.vault = vault;
        writeData(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(item));
        return;
      }

      // Sync API - POST
      if (url === '/api/sync' && method === 'POST') {
        const body = await parseBody(req);
        console.log('同步请求:', body);
        
        if (body.encrypted && body.data) {
          data.encryptedData = body.data;
          data.isEncrypted = true;
        } else {
          if (body.data) {
            if (body.data.notes) data.notes = body.data.notes;
            if (body.data.tasks) data.tasks = body.data.tasks;
            if (body.data.vault) data.vault = body.data.vault;
          }
          data.isEncrypted = false;
        }
        writeData(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, timestamp: Date.now() }));
        return;
      }

      // Sync API - GET
      if (url === '/api/sync' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (data.isEncrypted && data.encryptedData) {
          res.end(JSON.stringify({ encrypted: true, data: data.encryptedData }));
        } else {
          res.end(JSON.stringify({ encrypted: false, data: { notes: data.notes, tasks: data.tasks, vault: data.vault } }));
        }
        return;
      }

      // Export API
      if (url === '/api/export' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename=spc-export.json' });
        res.end(JSON.stringify(data, null, 2));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));

    } catch (e) {
      console.error('API Error:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error', message: e.message }));
    }
    return;
  }

  // Static files
  let filePath = url === '/' ? '/index.html' : url;
  const ext = path.extname(filePath);
  const contentTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };
  const contentType = contentTypes[ext] || 'text/plain';

  const pathsToTry = [path.join(__dirname, 'public', filePath), path.join(__dirname, filePath)];
  let fileContent = null;
  for (const p of pathsToTry) { if (fs.existsSync(p)) { fileContent = fs.readFileSync(p); break; } }

  if (fileContent) {
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fileContent);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\nSPC API Server 已启动\n访问: http://localhost:${PORT}\nAPI: http://localhost:${PORT}/api\n`);
});
