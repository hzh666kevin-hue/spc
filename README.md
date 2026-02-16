# SPC — 安全生产力中枢

一个功能强大的本地优先生产力工具，支持密码管理、任务规划和笔记功能。

## 功能特性

### 🔐 保险箱
- AES-256-GCM 加密存储
- 密码生成器
- 安全审计
- 文件夹分类管理

### 📋 时间规划 (已升级!)
- 看板视图 & 列表视图
- 番茄钟计时器
- WSJF 优先级排序 (艾森豪威尔矩阵)
- **重复任务** (每天/每周/每月)
- **预计时间** 跟踪
- **标签系统**
- 项目管理
- 任务计时器
- 数据分析

### 📝 笔记 (已升级!)
- Markdown 支持 (完整工具栏)
- Wiki 链接 [[标题]]
- **版本历史** (侧边面板)
- **双向链接 / 反向链接**
- **文件夹层级**
- 标签系统
- 分屏编辑 (编辑+预览)

### 🏠 主仪表盘
- 统计概览
- 任务进度追踪
- 快速操作
- 智能快速添加 (NLP)

## 快速开始

### ⚠️ 重要: 必须使用 HTTP 服务器

由于应用使用 iframe 加载子模块，**不能直接双击 index.html 打开**，必须使用 HTTP 服务器：

#### 方法 1: 双击启动 (推荐)
```bash
# 双击运行此文件
启动本地服务器.bat
```

#### 方法 2: Python
```bash
cd "D:\dujiatool\SPC 1.0"
python -m http.server 8080
```
然后打开 http://localhost:8080

#### 方法 3: Node.js
```bash
cd "D:\dujiatool\SPC 1.0"
npm install
npm start
```
然后打开 http://localhost:3000

### 服务器部署 (公网访问)

#### 1. 安装 Node.js
从 https://nodejs.org 下载安装 LTS 版本

#### 2. 启动服务器
```bash
cd "D:\dujiatool\SPC 1.0"
npm install
npm start
```

#### 3. 配置端口映射
- **局域网**: 在路由器上映射端口 3000
- **公网**: 使用 DDNS 或云服务器

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/notes` | 获取所有笔记 |
| POST | `/api/notes` | 创建/更新笔记 |
| GET | `/api/tasks` | 获取所有任务 |
| POST | `/api/tasks` | 创建/更新任务 |
| GET | `/api/vault` | 获取保险库 |
| POST | `/api/vault` | 创建/更新保险库项 |
| POST | `/api/sync` | 同步所有数据 |
| GET | `/api/export` | 导出数据 |

### Docker 部署

```bash
# 构建镜像
docker build -t spc .

# 运行容器
docker run -d -p 3000:3000 -v spc-data:/app/data spc
```

## 项目结构

```
SPC 1.0/
├── index.html          # 主入口
├── server.js           # Node.js API 服务器
├── package.json        # 依赖配置
├── manifest.json       # PWA 清单
├── sw.js              # Service Worker (离线支持)
├── 启动本地服务器.bat  # Windows 一键启动
├── css/
│   └── design-system.css
├── js/
│   ├── core/           # 核心模块
│   │   ├── db.js       # IndexedDB 封装
│   │   ├── crypto.js   # 加密模块
│   │   └── bus.js      # 事件总线
│   └── services/       # 服务层
│       ├── TaskService.js
│       ├── VaultService.js
│       ├── NoteService.js
│       └── SyncService.js
├── safe/               # 保险箱模块
├── plan/               # 时间规划模块 (已升级!)
└── note/               # 笔记模块 (已升级!)
```

## 笔记模块新增功能

### 版本历史
点击侧边栏图标可查看笔记的历史版本，支持一键恢复

### 反向链接
查看哪些笔记链接到了当前笔记，方便知识关联

### 文件夹管理
支持创建文件夹来组织笔记

### 分屏编辑
同时查看编辑区和预览区，提高写作效率

## 时间规划模块新增功能

### 重复任务
- 完成任务后自动创建下一个周期的任务
- 支持: 每天、每周、每月

### 预计时间
- 为每个任务设定预计完成时间
- 表格中显示实际耗时 / 预计时间

### 标签
- 用逗号分隔添加多个标签
- 表格中显示标签预览

## 隐私说明

🔒 **数据完全本地存储**
- 所有数据存储在浏览器 IndexedDB 中
- 加密密钥仅存在于内存中
- 使用服务器时，数据会保存在 server/data/store.json

## 浏览器支持

- Chrome 80+
- Firefox 75+
- Safari 14+
- Edge 80+

## 技术栈

- Tailwind CSS (CDN)
- IndexedDB (本地存储)
- Web Crypto API (AES-256-GCM)
- PBKDF2 (密钥派生)
- PWA (离线支持)
- Node.js (后端服务)

---

**版本**: v2.0 | **更新时间**: 2026-02-16
