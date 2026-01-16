# UI Apps MCP 隔离最终解决方案（Legacy v1）

> **文档版本**：v1.0（legacy，已由 v2 取代）  
> **方案类型**：基于注册中心的完整实施方案  
> **涉及应用**：ChatOS, AIDE, git_app, wsl  
> **创建日期**：2026-01-11

---

## 概述

### 问题背景

当前架构存在以下核心问题：

1. **数据库共用**：ChatOS 和 AIDE 共用同一个 Admin DB
2. **权限缺失**：UI Apps 的 MCP servers 没有 app_id 标记，对所有应用可见
3. **架构混乱**：缺少统一的注册中心，各应用直接访问共享数据库

### 解决方案目标

采用**注册中心模式**实现完整的应用隔离和权限管理：

- ✅ ChatOS 作为注册中心和主平台
- ✅ AIDE, git_app, wsl 作为独立应用，向注册中心注册自己的 MCP servers 和 prompts
- ✅ 每个应用从注册中心查询被授权的其他应用的 MCP servers 和 prompts
- ✅ 通过 app_id 和权限表实现严格的隔离

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    ChatOS (注册中心)                         │
│  • 提供注册接口（registerMcpServer, registerPrompt）       │
│  • 提供查询接口（getMcpServersForApp, getPromptsForApp）   │
│  • 管理授权关系（哪个应用可以使用哪些能力）                 │
│  • 维护权限表（mcpServerGrants, promptGrants）              │
└─────────────────────────────────────────────────────────────┘
                               ↕
        ┌──────────────────────┼──────────────────────┐
        ↓                      ↓                      ↓
 ┌──────────┐          ┌──────────┐          ┌──────────┐
 │  AIDE    │          │ git_app  │          │   wsl    │
 │(独立应用) │          │(独立应用)  │          │(独立应用)  │
 └──────────┘          └──────────┘          └──────────┘
```

### 角色定义

| 应用名称 | 应用类型 | 职责描述 |
|---------|---------|---------|
| **ChatOS** | 主平台 / 注册中心 | 提供 GUI 和应用编排，作为 MCP servers 注册中心 |
| **AIDE** | 独立应用 | AI 辅助开发引擎，提供大量 MCP servers 和 prompts |
| **git_app** | 独立应用 | Git 管理工具，提供 Git 相关的 MCP servers 和 prompts |
| **wsl** | 独立应用 | WSL 管理工具，提供 WSL 相关的 MCP servers 和 prompts |

---

## 核心设计

### 注册中心接口

#### 1. 注册接口

```javascript
/**
 * 注册 MCP Server
 * @param {string} appId - 提供者的应用 ID（如 'git_app', 'wsl'）
 * @param {Object} serverConfig - MCP server 配置
 * @returns {Promise<void>}
 */
async registerMcpServer(appId, serverConfig)

/**
 * 注册 Prompt
 * @param {string} appId - 提供者的应用 ID
 * @param {Object} promptConfig - Prompt 配置
 * @returns {Promise<void>}
 */
async registerPrompt(appId, promptConfig)
```

#### 2. 查询接口

```javascript
/**
 * 获取被授权的 MCP Servers
 * @param {string} targetAppId - 目标应用 ID（如 'aide'）
 * @param {string[]} allowedServerIds - 被授权的 server IDs（可选）
 * @returns {Promise<Object[]>}
 */
async getMcpServersForApp(targetAppId, allowedServerIds)

/**
 * 获取被授权的 Prompts
 * @param {string} targetAppId - 目标应用 ID
 * @param {string[]} allowedPromptIds - 被授权的 prompt IDs（可选）
 * @returns {Promise<Object[]>}
 */
async getPromptsForApp(targetAppId, allowedPromptIds)
```

#### 3. 权限管理接口

```javascript
/**
 * 授予应用访问 MCP Server 的权限
 * @param {string} appId - 目标应用 ID
 * @param {string} serverId - MCP server ID
 * @returns {Promise<void>}
 */
async grantMcpServerAccess(appId, serverId)

/**
 * 撤销应用访问 MCP Server 的权限
 * @param {string} appId - 目标应用 ID
 * @param {string} serverId - MCP server ID
 * @returns {Promise<void>}
 */
async revokeMcpServerAccess(appId, serverId)

/**
 * 检查应用是否有访问权限
 * @param {string} appId - 目标应用 ID
 * @param {string} serverId - MCP server ID
 * @returns {Promise<boolean>}
 */
async hasMcpServerAccess(appId, serverId)
```

### 数据模型

#### 数据库表结构

```sql
-- 应用注册表（记录哪些应用已注册到注册中心）
CREATE TABLE IF NOT EXISTS appRegistrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL UNIQUE,
  app_name TEXT NOT NULL,
  app_version TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- MCP Server 授权表（记录哪个应用可以使用哪些 MCP servers）
CREATE TABLE IF NOT EXISTS mcpServerGrants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  UNIQUE(app_id, server_id)
);

-- Prompt 授权表（记录哪个应用可以使用哪些 prompts）
CREATE TABLE IF NOT EXISTS promptGrants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  UNIQUE(app_id, prompt_id)
);

-- 索引（优化查询性能）
CREATE INDEX IF NOT EXISTS idx_mcpServerGrants_app_id ON mcpServerGrants(app_id);
CREATE INDEX IF NOT EXISTS idx_mcpServerGrants_server_id ON mcpServerGrants(server_id);
CREATE INDEX IF NOT EXISTS idx_promptGrants_app_id ON promptGrants(app_id);
CREATE INDEX IF NOT EXISTS idx_promptGrants_prompt_id ON promptGrants(prompt_id);
CREATE INDEX IF NOT EXISTS idx_appRegistrations_app_id ON appRegistrations(app_id);
```

#### 数据模型说明

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `appRegistrations` | 记录已注册的应用 | `app_id`, `app_name`, `app_version` |
| `mcpServerGrants` | 记录 MCP server 访问权限 | `app_id`, `server_id`, `granted_at` |
| `promptGrants` | 记录 Prompt 访问权限 | `app_id`, `prompt_id`, `granted_at` |

### 隔离机制

#### 三层隔离模型

| 隔离维度 | 实现方式 | 验证方法 |
|---------|---------|---------|
| **应用注册隔离** | 每个应用注册时记录到 `appRegistrations` 表 | 查询表中的注册记录 |
| **MCP Server 隔离** | 通过 `mcpServerGrants` 表控制访问权限 | 查询 `getMcpServersForApp()` 返回结果 |
| **Prompt 隔离** | 通过 `promptGrants` 表控制访问权限 | 查询 `getPromptsForApp()` 返回结果 |

#### 权限查询逻辑

```javascript
// 查询 AIDE 被授权的 MCP servers
SELECT ms.*
FROM mcpServers ms
INNER JOIN mcpServerGrants msg 
  ON ms.id = msg.server_id
WHERE msg.app_id = 'aide'
  AND ms.enabled = 1;
```

---

## 完整实施步骤

### 步骤 1：数据库迁移

#### 1.1 创建迁移脚本

**文件**：`chatos/electron/backend/migrations/001_add_registry_tables.js`

**代码**：

```javascript
/**
 * Migration 001: 添加注册中心表
 * 
 * 创建应用注册表和权限表，支持注册中心模式
 */

export function up(db) {
  // 应用注册表
  db.exec(`
    CREATE TABLE IF NOT EXISTS appRegistrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL UNIQUE,
      app_name TEXT NOT NULL,
      app_version TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // MCP Server 授权表
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcpServerGrants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      UNIQUE(app_id, server_id)
    )
  `);

  // Prompt 授权表
  db.exec(`
    CREATE TABLE IF NOT EXISTS promptGrants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL,
      prompt_id TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      UNIQUE(app_id, prompt_id)
    )
  `);

  // 索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mcpServerGrants_app_id ON mcpServerGrants(app_id);
    CREATE INDEX IF NOT EXISTS idx_mcpServerGrants_server_id ON mcpServerGrants(server_id);
    CREATE INDEX IF NOT EXISTS idx_promptGrants_app_id ON promptGrants(app_id);
    CREATE INDEX IF NOT EXISTS idx_promptGrants_prompt_id ON promptGrants(prompt_id);
    CREATE INDEX IF NOT EXISTS idx_appRegistrations_app_id ON appRegistrations(app_id);
  `);

  console.log('[Migration 001] 注册中心表创建成功');
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_appRegistrations_app_id;
    DROP INDEX IF EXISTS idx_promptGrants_prompt_id;
    DROP INDEX IF EXISTS idx_promptGrants_app_id;
    DROP INDEX IF EXISTS idx_mcpServerGrants_server_id;
    DROP INDEX IF EXISTS idx_mcpServerGrants_app_id;
    DROP TABLE IF EXISTS promptGrants;
    DROP TABLE IF EXISTS mcpServerGrants;
    DROP TABLE IF EXISTS appRegistrations;
  `);

  console.log('[Migration 001] 注册中心表已回滚');
}
```

#### 1.2 执行迁移

**命令**：

```bash
# 在 ChatOS 启动时自动执行迁移
# 迁移逻辑集成到 main.js 的数据库初始化流程中
```

---

### 步骤 2：实现注册中心

#### 2.1 创建注册中心模块

**文件**：`chatos/electron/backend/registry-center.js`

**完整代码**：

```javascript
/**
 * 注册中心 - 统一管理 MCP servers 和 prompts 的注册、授权和查询
 * 
 * 架构说明：
 * - ChatOS 作为注册中心和主平台
 * - AIDE, git_app, wsl 等独立应用将自己的 MCP servers 注册到 ChatOS
 * - 每个应用从注册中心查询被授权的其他应用的 MCP servers
 * - 通过权限表实现严格的隔离
 */

import { getAdminDB } from '../admin-db.js';

export function createRegistryCenter(options = {}) {
  const db = options.db || getAdminDB();
  return new RegistryCenter(db);
}

export class RegistryCenter {
  constructor(db) {
    this.db = db;
  }

  /**
   * 注册应用
   * @param {string} appId - 应用 ID
   * @param {Object} appInfo - 应用信息
   * @returns {Promise<Object>}
   */
  async registerApp(appId, appInfo = {}) {
    const now = Date.now();
    const appName = String(appInfo.name || appId).trim();
    const appVersion = String(appInfo.version || '').trim() || null;

    const stmt = this.db.prepare(`
      INSERT INTO appRegistrations (app_id, app_name, app_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(app_id) DO UPDATE SET
        app_name = excluded.app_name,
        app_version = excluded.app_version,
        updated_at = excluded.updated_at
    `);

    stmt.run(appId, appName, appVersion, now, now);

    return {
      app_id: appId,
      app_name: appName,
      app_version: appVersion,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * 检查应用是否已注册
   * @param {string} appId - 应用 ID
   * @returns {Promise<boolean>}
   */
  async isAppRegistered(appId) {
    const stmt = this.db.prepare('SELECT 1 FROM appRegistrations WHERE app_id = ?');
    const row = stmt.get(appId);
    return !!row;
  }

  /**
   * 注册 MCP Server
   * @param {string} providerAppId - 提供者的应用 ID（如 'git_app', 'wsl'）
   * @param {Object} serverConfig - MCP server 配置
   * @returns {Promise<Object>}
   */
  async registerMcpServer(providerAppId, serverConfig = {}) {
    const now = Date.now();
    const serverId = String(serverConfig.id || '').trim();
    const serverName = String(serverConfig.name || serverId).trim();
    const serverUrl = String(serverConfig.url || '').trim();
    const description = String(serverConfig.description || '').trim();
    const tags = Array.isArray(serverConfig.tags) ? serverConfig.tags : [];
    const enabled = typeof serverConfig.enabled === 'boolean' ? serverConfig.enabled : true;
    const allowMain = typeof serverConfig.allowMain === 'boolean' ? serverConfig.allowMain : true;
    const allowSub = typeof serverConfig.allowSub === 'boolean' ? serverConfig.allowSub : true;

    if (!serverId) {
      throw new Error('MCP server id is required');
    }

    // 确保 providerAppId 已注册
    const isProviderRegistered = await this.isAppRegistered(providerAppId);
    if (!isProviderRegistered) {
      await this.registerApp(providerAppId, { name: providerAppId });
    }

    // 插入或更新 MCP server（使用 app_id 标记提供者）
    const stmt = this.db.prepare(`
      INSERT INTO mcpServers (id, name, url, description, tags, app_id, enabled, allowMain, allowSub, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        url = excluded.url,
        description = excluded.description,
        tags = excluded.tags,
        app_id = excluded.app_id,
        enabled = excluded.enabled,
        allowMain = excluded.allowMain,
        allowSub = excluded.allowSub,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      serverId,
      serverName,
      serverUrl,
      description,
      JSON.stringify(tags),
      providerAppId,
      enabled ? 1 : 0,
      allowMain ? 1 : 0,
      allowSub ? 1 : 0,
      now,
      now
    );

    return {
      id: serverId,
      name: serverName,
      url: serverUrl,
      description,
      tags,
      app_id: providerAppId,
      enabled,
      allowMain,
      allowSub,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * 注册 Prompt
   * @param {string} providerAppId - 提供者的应用 ID
   * @param {Object} promptConfig - Prompt 配置
   * @returns {Promise<Object>}
   */
  async registerPrompt(providerAppId, promptConfig = {}) {
    const now = Date.now();
    const promptId = String(promptConfig.id || '').trim();
    const promptName = String(promptConfig.name || promptId).trim();
    const title = String(promptConfig.title || '').trim();
    const type = String(promptConfig.type || 'system').trim();
    const content = String(promptConfig.content || '').trim();
    const tags = Array.isArray(promptConfig.tags) ? promptConfig.tags : [];
    const allowMain = typeof promptConfig.allowMain === 'boolean' ? promptConfig.allowMain : true;
    const allowSub = typeof promptConfig.allowSub === 'boolean' ? promptConfig.allowSub : true;

    if (!promptId) {
      throw new Error('Prompt id is required');
    }

    // 确保 providerAppId 已注册
    const isProviderRegistered = await this.isAppRegistered(providerAppId);
    if (!isProviderRegistered) {
      await this.registerApp(providerAppId, { name: providerAppId });
    }

    // 插入或更新 Prompt
    const stmt = this.db.prepare(`
      INSERT INTO prompts (id, name, title, type, content, app_id, tags, allowMain, allowSub, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        title = excluded.title,
        type = excluded.type,
        content = excluded.content,
        app_id = excluded.app_id,
        tags = excluded.tags,
        allowMain = excluded.allowMain,
        allowSub = excluded.allowSub,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      promptId,
      promptName,
      title,
      type,
      content,
      providerAppId,
      JSON.stringify(tags),
      allowMain ? 1 : 0,
      allowSub ? 1 : 0,
      now,
      now
    );

    return {
      id: promptId,
      name: promptName,
      title,
      type,
      content,
      app_id: providerAppId,
      tags,
      allowMain,
      allowSub,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * 授予应用访问 MCP Server 的权限
   * @param {string} appId - 目标应用 ID
   * @param {string} serverId - MCP server ID
   * @returns {Promise<Object>}
   */
  async grantMcpServerAccess(appId, serverId) {
    const now = Date.now();

    // 确保 appId 已注册
    const isAppRegistered = await this.isAppRegistered(appId);
    if (!isAppRegistered) {
      await this.registerApp(appId, { name: appId });
    }

    // 授予权限
    const stmt = this.db.prepare(`
      INSERT INTO mcpServerGrants (app_id, server_id, granted_at)
      VALUES (?, ?, ?)
      ON CONFLICT(app_id, server_id) DO UPDATE SET
        granted_at = excluded.granted_at
    `);

    stmt.run(appId, serverId, now);

    return {
      app_id: appId,
      server_id: serverId,
      granted_at: now,
    };
  }

  /**
   * 批量授予 MCP Server 访问权限
   * @param {string} appId - 目标应用 ID
   * @param {string[]} serverIds - MCP server IDs
   * @returns {Promise<Object[]>}
   */
  async grantMcpServerAccessBatch(appId, serverIds = []) {
    const results = [];
    for (const serverId of serverIds) {
      const result = await this.grantMcpServerAccess(appId, serverId);
      results.push(result);
    }
    return results;
  }

  /**
   * 撤销应用访问 MCP Server 的权限
   * @param {string} appId - 目标应用 ID
   * @param {string} serverId - MCP server ID
   * @returns {Promise<boolean>}
   */
  async revokeMcpServerAccess(appId, serverId) {
    const stmt = this.db.prepare(`
      DELETE FROM mcpServerGrants
      WHERE app_id = ? AND server_id = ?
    `);

    const result = stmt.run(appId, serverId);
    return result.changes > 0;
  }

  /**
   * 检查应用是否有访问 MCP Server 的权限
   * @param {string} appId - 目标应用 ID
   * @param {string} serverId - MCP server ID
   * @returns {Promise<boolean>}
   */
  async hasMcpServerAccess(appId, serverId) {
    const stmt = this.db.prepare(`
      SELECT 1 FROM mcpServerGrants
      WHERE app_id = ? AND server_id = ?
    `);

    const row = stmt.get(appId, serverId);
    return !!row;
  }

  /**
   * 获取被授权的 MCP Servers
   * @param {string} targetAppId - 目标应用 ID
   * @param {string[]} allowedServerIds - 被授权的 server IDs（可选，用于进一步过滤）
   * @returns {Promise<Object[]>}
   */
  async getMcpServersForApp(targetAppId, allowedServerIds = null) {
    let sql = `
      SELECT ms.*
      FROM mcpServers ms
      INNER JOIN mcpServerGrants msg 
        ON ms.id = msg.server_id
      WHERE msg.app_id = ?
        AND ms.enabled = 1
    `;

    const params = [targetAppId];

    // 如果指定了 allowedServerIds，添加过滤条件
    if (allowedServerIds && allowedServerIds.length > 0) {
      sql += ` AND ms.id IN (${allowedServerIds.map(() => '?').join(',')})`;
      params.push(...allowedServerIds);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);

    return rows.map((row) => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      enabled: Boolean(row.enabled),
      allowMain: Boolean(row.allowMain),
      allowSub: Boolean(row.allowSub),
    }));
  }

  /**
   * 获取所有已注册的 MCP Servers（用于管理员查看）
   * @param {string} providerAppId - 提供者应用 ID（可选）
   * @returns {Promise<Object[]>}
   */
  async listAllMcpServers(providerAppId = null) {
    let sql = 'SELECT * FROM mcpServers WHERE 1=1';
    const params = [];

    if (providerAppId) {
      sql += ' AND app_id = ?';
      params.push(providerAppId);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);

    return rows.map((row) => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      enabled: Boolean(row.enabled),
      allowMain: Boolean(row.allowMain),
      allowSub: Boolean(row.allowSub),
    }));
  }

  /**
   * 获取所有已注册的 Prompts（用于管理员查看）
   * @param {string} providerAppId - 提供者应用 ID（可选）
   * @returns {Promise<Object[]>}
   */
  async listAllPrompts(providerAppId = null) {
    let sql = 'SELECT * FROM prompts WHERE 1=1';
    const params = [];

    if (providerAppId) {
      sql += ' AND app_id = ?';
      params.push(providerAppId);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);

    return rows.map((row) => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      allowMain: Boolean(row.allowMain),
      allowSub: Boolean(row.allowSub),
    }));
  }

  /**
   * 获取应用的 MCP Server 权限列表
   * @param {string} appId - 应用 ID
   * @returns {Promise<Object[]>}
   */
  async getMcpServerGrantsForApp(appId) {
    const stmt = this.db.prepare(`
      SELECT msg.*, ms.name as server_name, ms.url as server_url
      FROM mcpServerGrants msg
      INNER JOIN mcpServers ms ON msg.server_id = ms.id
      WHERE msg.app_id = ?
    `);

    const rows = stmt.all(appId);
    return rows.map((row) => ({
      app_id: row.app_id,
      server_id: row.server_id,
      server_name: row.server_name,
      server_url: row.server_url,
      granted_at: row.granted_at,
    }));
  }

  /**
   * 获取所有已注册的应用
   * @returns {Promise<Object[]>}
   */
  async listApps() {
    const stmt = this.db.prepare('SELECT * FROM appRegistrations ORDER BY created_at DESC');
    return stmt.all();
  }
}

// 导出单例
let registryCenterInstance = null;

export function getRegistryCenter() {
  if (!registryCenterInstance) {
    registryCenterInstance = createRegistryCenter();
  }
  return registryCenterInstance;
}

export default getRegistryCenter();
```

---

### 步骤 3：修改应用启动逻辑

#### 3.1 修改 ui-apps/index.js

**文件**：`chatos/electron/ui-apps/index.js`

**修改位置**：第 797-1016 行的 `#syncAiContributes()` 方法

**修改内容**：在同步 MCP servers 时注册到注册中心（所有应用都这么做）

```javascript
// 在文件顶部添加导入
import { getRegistryCenter } from '../backend/registry-center.js';

// 修改 #syncAiContributes 方法
#syncAiContributes(pluginsInternal, errors) {
  const services = this.adminServices;
  if (!services?.mcpServers || !services?.prompts) return false;

  const now = () => new Date().toISOString();
  const uniqStrings = (list) => {
    const out = [];
    const seen = new Set();
    (Array.isArray(list) ? list : []).forEach((item) => {
      const v = String(item || '').trim();
      if (!v || seen.has(v)) return;
      seen.add(v);
      out.push(v);
    });
    return out;
  };

  const normalizePromptNameKey = (name) => String(name || '').trim().toLowerCase();
  const normalizeServerKey = (name) => String(name || '').trim().toLowerCase();

  const existingServers = services.mcpServers.list ? services.mcpServers.list() : [];
  const serverByName = new Map(
    (Array.isArray(existingServers) ? existingServers : [])
      .filter((srv) => srv?.name)
      .map((srv) => [normalizeServerKey(srv.name), srv])
  );

  const existingPrompts = services.prompts.list ? services.prompts.list() : [];
  const promptByName = new Map(
    (Array.isArray(existingPrompts) ? existingPrompts : [])
      .filter((p) => p?.name)
      .map((p) => [normalizePromptNameKey(p.name), p])
  );

  const resolvePathWithinPlugin = (pluginDir, rel, label) => {
    const relPath = typeof rel === 'string' ? rel.trim() : '';
    if (!relPath) return null;
    const resolved = path.resolve(pluginDir, rel);
    const relative = path.relative(pluginDir, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${label} must be within plugin directory`);
    }
    return resolved;
  };

  const readPromptSource = (pluginDir, source, label) => {
    if (!source) return '';
    const content = typeof source?.content === 'string' ? source.content : '';
    if (content && content.trim()) return content.trim();
    const relPath = typeof source?.path === 'string' ? source.path : '';
    if (!relPath) return '';
    const resolved = resolvePathWithinPlugin(pluginDir, relPath, label);
    if (!resolved) return '';
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      throw new Error(`${label} must be a file: ${relPath}`);
    }
    if (stat.size > this.maxPromptBytes) {
      throw new Error(`${label} too large (${stat.size} bytes): ${relPath}`);
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    return String(raw || '').trim();
  };

  let changed = false;

  // 获取注册中心实例
  const registry = getRegistryCenter();

  pluginsInternal.forEach((plugin) => {
    const pluginId = typeof plugin?.id === 'string' ? plugin.id.trim() : '';
    const pluginDir = typeof plugin?.pluginDir === 'string' ? plugin.pluginDir : '';
    if (!pluginId || !pluginDir) return;
    
    (Array.isArray(plugin?.apps) ? plugin.apps : []).forEach((app) => {
      const appId = typeof app?.id === 'string' ? app.id.trim() : '';
      if (!appId) return;
      const ai = app?.ai && typeof app.ai === 'object' ? app.ai : null;
      if (!ai) return;

      const mcp = ai?.mcp && typeof ai.mcp === 'object' ? ai.mcp : null;
      if (mcp?.name && mcp?.url) {
        const desiredTags = uniqStrings([
          ...(Array.isArray(mcp.tags) ? mcp.tags : []),
          'uiapp',
          `uiapp:${pluginId}`,
          `uiapp:${pluginId}:${appId}`,
          `uiapp:${pluginId}.${appId}`,
        ]).sort((a, b) => a.localeCompare(b));
        const desired = {
          name: String(mcp.name || '').trim(),
          url: String(mcp.url || '').trim(),
          description: String(mcp.description || '').trim(),
          tags: desiredTags,
          enabled: typeof mcp.enabled === 'boolean' ? mcp.enabled : true,
          allowMain: typeof mcp.allowMain === 'boolean' ? mcp.allowMain : true,
          allowSub: typeof mcp.allowSub === 'boolean' ? mcp.allowSub : true,
          auth: mcp.auth || undefined,
          updatedAt: now(),
        };

        const key = normalizeServerKey(desired.name);
        const existing = serverByName.get(key) || null;
        if (!existing) {
          try {
            const created = services.mcpServers.create(desired);
            serverByName.set(key, created);
            changed = true;

            // ✅ 注册到注册中心（使用实际的 app_id）
            try {
              registry.registerMcpServer(pluginId, {
                id: created.id,
                name: created.name,
                url: created.url,
                description: created.description,
                tags: created.tags,
                enabled: created.enabled,
                allowMain: created.allowMain,
                allowSub: created.allowSub,
              });
            } catch (err) {
              // 注册中心失败不影响主流程
              console.error(`[Registry] Failed to register MCP server ${created.name}:`, err);
            }
          } catch (err) {
            errors.push({
              dir: pluginDir,
              source: 'ai.mcp',
              message: `Failed to create MCP server "${desired.name}": ${err?.message || String(err)}`,
            });
          }
        } else {
          const patch = {};
          if (existing.url !== desired.url) patch.url = desired.url;
          if ((existing.description || '') !== (desired.description || '')) patch.description = desired.description || '';
          const existingTags = Array.isArray(existing.tags) ? existing.tags.slice().sort() : [];
          const nextTags = Array.isArray(desired.tags) ? desired.tags.slice().sort() : [];
          if (JSON.stringify(existingTags) !== JSON.stringify(nextTags)) patch.tags = desired.tags;
          if (existing.enabled !== desired.enabled) patch.enabled = desired.enabled;
          if (existing.allowMain !== desired.allowMain) patch.allowMain = desired.allowMain;
          if (existing.allowSub !== desired.allowSub) patch.allowSub = desired.allowSub;
          const existingAuth = existing.auth || undefined;
          const nextAuth = desired.auth || undefined;
          if (JSON.stringify(existingAuth || null) !== JSON.stringify(nextAuth || null)) patch.auth = nextAuth || undefined;

          if (Object.keys(patch).length > 0) {
            try {
              const updated = services.mcpServers.update(existing.id, patch);
              serverByName.set(key, updated);
              changed = true;

              // ✅ 更新注册中心（使用实际的 app_id）
              try {
                registry.registerMcpServer(pluginId, {
                  id: updated.id,
                  name: updated.name,
                  url: updated.url,
                  description: updated.description,
                  tags: updated.tags,
                  enabled: updated.enabled,
                  allowMain: updated.allowMain,
                  allowSub: updated.allowSub,
                });
              } catch (err) {
                console.error(`[Registry] Failed to update MCP server ${updated.name}:`, err);
              }
            } catch (err) {
              errors.push({
                dir: pluginDir,
                source: 'ai.mcp',
                message: `Failed to update MCP server "${desired.name}": ${err?.message || String(err)}`,
              });
            }
          }
        }
      }

      const prompt = ai?.mcpPrompt && typeof ai.mcpPrompt === 'object' ? ai.mcpPrompt : null;
      const promptNames = prompt?.names && typeof prompt.names === 'object' ? prompt.names : null;
      if (prompt && promptNames) {
        const title =
          typeof prompt.title === 'string' && prompt.title.trim()
            ? prompt.title.trim()
            : `${app?.name || appId} MCP Prompt`;

        const variants = [
          { lang: 'zh', name: promptNames.zh, source: prompt.zh, label: 'ai.mcpPrompt.zh' },
          { lang: 'en', name: promptNames.en, source: prompt.en, label: 'ai.mcpPrompt.en' },
        ].filter((v) => v?.source && v?.name);

        variants.forEach((variant) => {
          let content = '';
          try {
            content = readPromptSource(pluginDir, variant.source, variant.label);
          } catch (err) {
            errors.push({
              dir: pluginDir,
              source: 'ai.mcpPrompt',
              message: `Failed to read ${variant.label} for "${pluginId}:${appId}": ${err?.message || String(err)}`,
            });
            return;
          }
          if (!content) return;

          const desired = {
            name: String(variant.name || '').trim(),
            title,
            type: 'system',
            content,
            allowMain: true,
            allowSub: true,
            updatedAt: now(),
          };
          const key = normalizePromptNameKey(desired.name);
          const existing = promptByName.get(key) || null;
          if (!existing) {
            try {
              const created = services.prompts.create(desired);
              promptByName.set(key, created);
              changed = true;
            } catch (err) {
              errors.push({
                dir: pluginDir,
                source: 'ai.mcpPrompt',
                message: `Failed to create Prompt "${desired.name}": ${err?.message || String(err)}`,
              });
            }
            return;
          }

          const patch = {};
          if ((existing.title || '') !== (desired.title || '')) patch.title = desired.title || '';
          if ((existing.type || '') !== desired.type) patch.type = desired.type;
          if ((existing.content || '') !== desired.content) patch.content = desired.content;
          if (existing.allowMain !== desired.allowMain) patch.allowMain = desired.allowMain;
          if (existing.allowSub !== desired.allowSub) patch.allowSub = desired.allowSub;

          if (Object.keys(patch).length > 0) {
            try {
              const updated = services.prompts.update(existing.id, patch);
              promptByName.set(key, updated);
              changed = true;
            } catch (err) {
              errors.push({
                dir: pluginDir,
                source: 'ai.mcpPrompt',
                message: `Failed to update Prompt "${desired.name}": ${err?.message || String(err)}`,
              });
            }
          }
        });
      }
    });
  });

  return changed;
}
```

---

### 步骤 4：修改 AIDE 启动逻辑

#### 4.1 修改 src/cli.js

**文件**：`chatos/src/cli.js`

**修改内容**：添加从注册中心查询授权 MCP servers 的逻辑

```javascript
#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { resolveAideFileUrl, resolveAidePath } from './aide-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// ✅ 设置应用 ID 为 'aide'（不使用 'chatos'）
process.env.MODEL_CLI_HOST_APP = 'aide';

// ✅ 从注册中心查询被授权的 MCP servers（如果注册中心可用）
async function loadAuthorizedMcpServersFromRegistry() {
  try {
    // 动态导入注册中心模块（仅在 ChatOS 环境中可用）
    const registryModule = await import('../electron/backend/registry-center.js').catch(() => null);
    if (!registryModule || !registryModule.getRegistryCenter) {
      console.log('[Registry] 注册中心不可用，跳过授权查询');
      return [];
    }

    const registry = registryModule.getRegistryCenter();
    const authorizedServers = await registry.getMcpServersForApp('aide');
    console.log(`[Registry] 从注册中心加载了 ${authorizedServers.length} 个被授权的 MCP servers`);
    return authorizedServers;
  } catch (err) {
    console.error('[Registry] 从注册中心加载授权失败:', err.message);
    return [];
  }
}

// 加载入口点
const srcEntrypoint = resolveAidePath({
  projectRoot,
  relativePath: 'src/cli.js',
  purpose: 'CLI entrypoint',
});
const distEntrypoint = resolveAidePath({
  projectRoot,
  relativePath: 'dist/cli.js',
  purpose: 'CLI entrypoint',
});
const entryUrl = fs.existsSync(srcEntrypoint)
? pathToFileURL(srcEntrypoint).href
: fs.existsSync(distEntrypoint)
  ? pathToFileURL(distEntrypoint).href
  : resolveAideFileUrl({
      projectRoot,
      relativePath: 'src/cli.js',
      purpose: 'CLI entrypoint',
    });

// 启动应用
await import(entryUrl);
```

#### 4.2 修改 mcp-service.js（可选，增强隔离）

**文件**：`aide/shared/data/services/mcp-service.js`

**修改内容**：增强权限过滤逻辑，结合注册中心的授权

```javascript
import { BaseService } from './base-service.js';
import { mcpServerSchema } from '../schema.js';
import { getHostApp } from '../../host-app.js';

export class McpService extends BaseService {
  constructor(db) {
    super(db, 'mcpServers', mcpServerSchema);
    this.appId = getHostApp() || 'aide';
    this.#maybeBackfillAppId();
    this.#authorizedServersCache = null;
  }

  #normalizeAppId(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  #isUiAppServer(record) {
    const tags = Array.isArray(record?.tags) ? record.tags : [];
    return tags
      .map((tag) => String(tag || '').trim().toLowerCase())
      .filter(Boolean)
      .some((tag) => tag === 'uiapp' || tag.startsWith('uiapp:'));
  }

  #maybeBackfillAppId() {
    const host = this.#normalizeAppId(this.appId);
    if (!host) return;
    const all = this.db.list(this.tableName) || [];
    all.forEach((record) => {
      const id = record?.id;
      if (!id) return;
      const current = this.#normalizeAppId(record?.app_id);
      if (current) return;

      // Heuristic migration for legacy records with no app_id:
      // - UI Apps servers (tagged with uiapp) always belong to ChatOS host
      // - ChatOS claims all remaining legacy servers
      // - other hosts only claim locked/builtin servers (avoid stealing legacy user config from ChatOS)
      let next = '';
      if (this.#isUiAppServer(record)) {
        next = 'chatos';
      } else if (host === 'chatos') {
        next = 'chatos';
      } else if (record?.locked === true) {
        next = host;
      } else {
        return;
      }
      try {
        this.db.update(this.tableName, id, { app_id: next });
      } catch {
        // ignore migration errors
      }
    });
  }

  /**
   * 从注册中心加载授权的服务器列表
   */
  async #loadAuthorizedServers() {
    if (this.appId === 'chatos') {
      // ChatOS 可以看到所有属于它的服务器
      return null;
    }

    try {
      // 尝试从注册中心加载授权列表
      const registryModule = await import('../../../../../chatos/electron/backend/registry-center.js').catch(() => null);
      if (!registryModule || !registryModule.getRegistryCenter) {
        return null;
      }

      const registry = registryModule.getRegistryCenter();
      const authorizedServers = await registry.getMcpServersForApp(this.appId);
      const authorizedIds = new Set(authorizedServers.map(s => s.id));
      return authorizedIds;
    } catch (err) {
      console.error('[McpService] 从注册中心加载授权失败:', err.message);
      return null;
    }
  }

  normalizeName(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  #matchesApp(record) {
    const host = this.#normalizeAppId(this.appId);
    if (!host) return true;
    
    // UI Apps 暴露的 MCP servers 只应在 ChatOS(host=chatos) 里可见/可用；
    // AIDE 等独立 host 只使用内置/用户自定义的 MCP，不接纳 UIApp 的 MCP 列表。
    if (host !== 'chatos' && this.#isUiAppServer(record)) {
      return false;
    }
    
    const appId = this.#normalizeAppId(record?.app_id);
    return appId === host;
  }

  /**
   * 检查是否在授权列表中（如果注册中心可用）
   */
  #isAuthorized(record) {
    // 如果没有授权缓存，返回 true（兼容旧逻辑）
    if (!this.#authorizedServersCache) {
      return true;
    }
    
    // 如果在授权列表中，返回 true
    return this.#authorizedServersCache.has(record.id);
  }

  async list() {
    // 如果不是 ChatOS，尝试从注册中心加载授权列表
    if (this.appId !== 'chatos' && !this.#authorizedServersCache) {
      this.#authorizedServersCache = await this.#loadAuthorizedServers();
    }

    return (super.list() || []).filter((record) => {
      const matchesApp = this.#matchesApp(record);
      const isAuthorized = this.#isAuthorized(record);
      return matchesApp && isAuthorized;
    });
  }

  async get(id) {
    const record = super.get(id);
    if (!record) return null;
    
    const matchesApp = this.#matchesApp(record);
    if (!matchesApp) return null;
    
    // 如果不是 ChatOS，检查授权
    if (this.appId !== 'chatos') {
      const isAuthorized = this.#isAuthorized(record);
      if (!isAuthorized) return null;
    }
    
    return record;
  }

  create(payload) {
    const normalized = payload && typeof payload === 'object' ? { ...payload } : {};
    normalized.app_id = this.appId;
    return super.create(normalized);
  }

  update(id, payload) {
    const existing = super.get(id);
    if (!existing) return null;
    if (!this.#matchesApp(existing)) {
      throw new Error('MCP Server 不属于当前应用');
    }
    if (existing?.locked) {
      const keys = payload && typeof payload === 'object' ? Object.keys(payload) : [];
      const allowedKeys = new Set(['allowMain', 'allowSub', 'enabled']);
      const disallowed = keys.filter((key) => !allowedKeys.has(key));
      const hasAllowedUpdate = keys.some((key) => allowedKeys.has(key));
      if (disallowed.length > 0 || !hasAllowedUpdate) {
        throw new Error('该 MCP Server 为内置配置，仅允许调整启用状态或主/子流程可用开关');
      }
    }
    if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'app_id')) {
      throw new Error('禁止修改 MCP Server 的 app_id');
    }
    return super.update(id, payload);
  }

  remove(id) {
    const existing = super.get(id);
    if (!existing) return false;
    if (!this.#matchesApp(existing)) {
      throw new Error('MCP Server 不属于当前应用');
    }
    if (existing?.locked) {
      throw new Error('该 MCP Server 为内置配置，禁止删除');
    }
    return super.remove(id);
  }
}
```

---

### 步骤 5：清理现有错误数据

#### 5.1 创建清理脚本

**文件**：`scripts/cleanup-legacy-mcp-isolation.js`

**完整代码**：

```javascript
/**
 * 清理脚本：移除应用 MCP servers 中没有 app_id 的旧数据
 * 
 * 使用方式：
 *   node scripts/cleanup-legacy-mcp-isolation.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

function cleanupLegacyMcpIsolation() {
  const stateDir = path.join(os.homedir(), '.config', 'deepseek_cli');
  const dbPath = path.join(stateDir, 'chatos.db.sqlite');
  const markerFile = path.join(stateDir, '.cleanup-legacy-mcp-isolation-done');
  
  console.log('[Cleanup] 开始清理旧的 MCP 隔离数据...');
  console.log(`[Cleanup] 数据库路径: ${dbPath}`);

  // 检查是否已经执行过清理
  if (require('fs').existsSync(markerFile)) {
    const markerTime = require('fs').readFileSync(markerFile, 'utf8');
    console.log(`[Cleanup] 已于 ${new Date(Number(markerTime)).toISOString()} 执行过清理，跳过`);
    return;
  }

  // 检查数据库是否存在
  if (!require('fs').existsSync(dbPath)) {
    console.log('[Cleanup] 数据库不存在，无需清理');
    return;
  }

  const db = new Database(dbPath);
  
  try {
    // 查询没有 app_id 的应用 MCP servers
    const stmt = db.prepare(`
      SELECT id, name, tags 
      FROM mcpServers 
      WHERE (app_id IS NULL OR app_id = '') 
        AND (tags LIKE '%uiapp%')
    `);
    
    const rows = stmt.all();
    console.log(`[Cleanup] 找到 ${rows.length} 个需要清理的 MCP servers`);

    if (rows.length === 0) {
      console.log('[Cleanup] 没有需要清理的数据');
      return;
    }

    // 显示即将删除的 servers
    rows.forEach((row, index) => {
      console.log(`[Cleanup] ${index + 1}. ${row.name} (id: ${row.id})`);
    });

    // 询问确认
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('[Cleanup] 是否确认删除这些 MCP servers? (yes/no): ', (answer) => {
      rl.close();
      
      if (answer.toLowerCase() !== 'yes') {
        console.log('[Cleanup] 用户取消操作');
        db.close();
        return;
      }

      // 执行删除
      const deleteStmt = db.prepare(`
        DELETE FROM mcpServers 
        WHERE (app_id IS NULL OR app_id = '') 
          AND (tags LIKE '%uiapp%')
      `);
      
      const result = deleteStmt.run();
      console.log(`[Cleanup] 已删除 ${result.changes} 个 MCP servers`);

      // 写入标记文件
      require('fs').writeFileSync(markerFile, Date.now().toString());
      console.log('[Cleanup] 清理完成，已写入标记文件');
      
      db.close();
    });
  } catch (error) {
    console.error('[Cleanup] 清理失败:', error);
    db.close();
    process.exit(1);
  }
}

// 执行清理
cleanupLegacyMcpIsolation();
```

#### 5.2 执行清理

**命令**：

```bash
node scripts/cleanup-legacy-mcp-isolation.js
```

---

### 步骤 6：验证测试

#### 6.1 数据库验证

**SQL 查询**：

```sql
-- 验证注册中心表是否存在
SELECT name FROM sqlite_master 
WHERE type='table' 
  AND name IN ('appRegistrations', 'mcpServerGrants', 'promptGrants');

-- 验证应用 MCP servers 的 app_id
SELECT id, name, app_id, tags 
FROM mcpServers 
WHERE name LIKE '%git%' OR name LIKE '%wsl%';

-- 验证权限表
SELECT * FROM mcpServerGrants;

-- 验证应用注册表
SELECT * FROM appRegistrations;
```

**预期结果**：
- `appRegistrations` 表中至少有 'chatos', 'git_app', 'wsl' 的记录
- 应用 MCP servers 的 `app_id` 为对应的 'git_app', 'wsl' 等
- `mcpServerGrants` 表为空（初始状态下）

#### 6.2 功能验证

**测试 1：ChatOS 能看到应用 MCP servers**

```javascript
// 在 ChatOS 中执行（process.env.MODEL_CLI_HOST_APP = 'chatos'）
const services = getAdminServices();
const servers = services.mcpServers.list();

const appServers = servers.filter(s => 
  s.name.includes('git') || s.name.includes('wsl')
);

console.log('应用 servers in ChatOS:', appServers);
// 预期输出: 包含 git/wsl MCP servers
```

**测试 2：AIDE 看不到其他应用 MCP servers（默认，除非授权）**

```javascript
// 在 AIDE 中执行（process.env.MODEL_CLI_HOST_APP = 'aide'）
const services = getAdminServices();
const servers = services.mcpServers.list();

const appServers = servers.filter(s => 
  s.name.includes('git') || s.name.includes('wsl')
);

console.log('其他应用 servers in AIDE:', appServers);
// 预期输出: []
```

**测试 3：授权后 AIDE 可以看到其他应用的 MCP servers**

```javascript
// 1. 授予 AIDE 访问权限
const registry = getRegistryCenter();
await registry.grantMcpServerAccess('aide', 'git-app.git-manager');

// 2. 在 AIDE 中验证
const services = getAdminServices();
const servers = await services.mcpServers.list();

const gitServer = servers.find(s => s.name === 'git-app.git-manager');
console.log('Git server in AIDE:', gitServer);
// 预期输出: git-app.git-server 对象
```

#### 6.3 端到端测试

**测试脚本**：`scripts/test-registry-isolation.js`

```javascript
/**
 * 端到端测试：验证注册中心隔离功能
 */

async function testRegistryIsolation() {
  console.log('[Test] 开始端到端测试...');
  
  const registry = getRegistryCenter();
  
  // 测试 1: 注册应用
  console.log('\n[Test] 测试 1: 注册应用');
  await registry.registerApp('test_app', { name: 'Test App', version: '1.0.0' });
  const apps = await registry.listApps();
  console.log('注册的应用:', apps);
  
  // 测试 2: 注册 MCP server
  console.log('\n[Test] 测试 2: 注册 MCP server');
  await registry.registerMcpServer('git_app', {
    id: 'test.server',
    name: 'Test Server',
    url: 'cmd://node test-server.js',
    tags: ['test'],
  });
  
  // 测试 3: 授予权限
  console.log('\n[Test] 测试 3: 授予权限');
  await registry.grantMcpServerAccess('aide', 'test.server');
  
  // 测试 4: 查询授权
  console.log('\n[Test] 测试 4: 查询授权');
  const authorizedServers = await registry.getMcpServersForApp('aide');
  console.log('AIDE 被授权的 servers:', authorizedServers);
  
  // 测试 5: 撤销权限
  console.log('\n[Test] 测试 5: 撤销权限');
  await registry.revokeMcpServerAccess('aide', 'test.server');
  const revokedServers = await registry.getMcpServersForApp('aide');
  console.log('撤销后 AIDE 的 servers:', revokedServers);
  
  console.log('\n[Test] 测试完成!');
}

testRegistryIsolation().catch(console.error);
```

**执行命令**：

```bash
node scripts/test-registry-isolation.js
```

---

## 风险与回滚

### 风险评估

| 风险类型 | 风险等级 | 描述 | 缓解措施 |
|---------|---------|------|---------|
| 数据丢失 | 中等 | 清理脚本可能删除错误的 MCP servers | 1. 执行前备份数据库<br>2. 确认删除条件<br>3. 交互式确认 |
| 向后兼容性 | 低 | 其他应用依赖空的 `app_id` | 检查所有使用 `mcpServers.list()` 的地方 |
| 注册中心故障 | 低 | 注册中心模块加载失败 | 降级到现有隔离逻辑 |
| 权限配置错误 | 低 | 授予权限错误导致权限泄露 | 提供撤销接口，记录审计日志 |

### 回滚方案

#### 回滚步骤

1. **停止所有应用**

```bash
# 停止 ChatOS
# 停止 AIDE
```

2. **回滚数据库**

```bash
# 备份当前数据库
cp ~/.config/chatos/chatos.db.sqlite ~/.config/chatos/chatos.db.sqlite.backup

# 删除注册中心表（保留原有数据）
sqlite3 ~/.config/chatos/chatos.db.sqlite <<EOF
DROP INDEX IF EXISTS idx_appRegistrations_app_id;
DROP INDEX IF EXISTS idx_promptGrants_prompt_id;
DROP INDEX IF EXISTS idx_promptGrants_app_id;
DROP INDEX IF EXISTS idx_mcpServerGrants_server_id;
DROP INDEX IF EXISTS idx_mcpServerGrants_app_id;
DROP TABLE IF EXISTS promptGrants;
DROP TABLE IF EXISTS mcpServerGrants;
DROP TABLE IF EXISTS appRegistrations;
EOF
```

3. **删除新增文件**

```bash
# 删除注册中心模块
rm chatos/electron/backend/registry-center.js

# 删除迁移脚本
rm chatos/electron/backend/migrations/001_add_registry_tables.js

# 删除清理脚本
rm scripts/cleanup-legacy-mcp-isolation.js

# 删除测试脚本
rm scripts/test-registry-isolation.js
```

4. **恢复修改的文件**

```bash
# 恢复 ui-apps/index.js
git checkout chatos/electron/ui-apps/index.js

# 恢复 src/cli.js
git checkout chatos/src/cli.js

# 恢复 mcp-service.js
git checkout aide/shared/data/services/mcp-service.js
```

5. **清理标记文件**

```bash
rm ~/.config/chatos/.cleanup-legacy-mcp-isolation-done
```

6. **重启应用**

```bash
# 重启 ChatOS
# 重启 AIDE
```

#### 验证回滚

```sql
-- 验证注册中心表已删除
SELECT name FROM sqlite_master 
WHERE type='table' 
  AND name IN ('appRegistrations', 'mcpServerGrants', 'promptGrants');

-- 预期结果: 空列表
```

---

## 附录

### A. 文件清单

#### 新增文件

| 文件路径 | 描述 |
|---------|------|
| `chatos/electron/backend/registry-center.js` | 注册中心实现 |
| `chatos/electron/backend/migrations/001_add_registry_tables.js` | 数据库迁移脚本 |
| `scripts/cleanup-legacy-mcp-isolation.js` | 清理旧数据的脚本 |
| `scripts/test-registry-isolation.js` | 端到端测试脚本 |
| `UI_APPS_MCP_ISOLATION_FINAL_SOLUTION.md` | 本文档 |

#### 修改文件

| 文件路径 | 修改内容 |
|---------|---------|
| `chatos/electron/ui-apps/index.js` | 在 `#syncAiContributes()` 中添加注册中心调用 |
| `chatos/src/cli.js` | 设置 `MODEL_CLI_HOST_APP='aide'` 并添加注册中心查询 |
| `aide/shared/data/services/mcp-service.js` | 增强权限过滤逻辑（可选） |

### B. API 文档

#### 注册中心 API

```javascript
// 获取注册中心实例
const registry = getRegistryCenter();

// 注册应用
await registry.registerApp(appId, appInfo);

// 注册 MCP server
await registry.registerMcpServer(providerAppId, serverConfig);

// 注册 Prompt
await registry.registerPrompt(providerAppId, promptConfig);

// 授予权限
await registry.grantMcpServerAccess(appId, serverId);

// 撤销权限
await registry.revokeMcpServerAccess(appId, serverId);

// 检查权限
const hasAccess = await registry.hasMcpServerAccess(appId, serverId);

// 查询授权的 MCP servers
const servers = await registry.getMcpServersForApp(appId, allowedServerIds);

// 查询所有 MCP servers
const allServers = await registry.listAllMcpServers(providerAppId);

// 查询所有 Prompts
const allPrompts = await registry.listAllPrompts(providerAppId);

// 查询应用的权限列表
const grants = await registry.getMcpServerGrantsForApp(appId);

// 列出所有已注册的应用
const apps = await registry.listApps();
```

### C. 故障排查

#### 问题 1：注册中心表未创建

**现象**：`Error: no such table: appRegistrations`

**原因**：数据库迁移未执行

**解决**：

```sql
-- 手动执行迁移
sqlite3 ~/.config/chatos/chatos.db.sqlite <<EOF
CREATE TABLE IF NOT EXISTS appRegistrations (...);
CREATE TABLE IF NOT EXISTS mcpServerGrants (...);
CREATE TABLE IF NOT EXISTS promptGrants (...);
-- ... 其他表和索引
EOF
```

#### 问题 2：应用 MCP servers 仍然对 AIDE 可见

**现象**：AIDE 能看到 git/wsl MCP servers

**原因**：
1. 清理脚本未执行
2. `app_id` 未正确设置
3. 权限表中存在授权记录

**解决**：

```sql
-- 检查 app_id
SELECT id, name, app_id, tags FROM mcpServers WHERE name LIKE '%git%' OR name LIKE '%wsl%';

-- 检查权限表
SELECT * FROM mcpServerGrants WHERE app_id = 'aide';

-- 如果有授权记录，删除
DELETE FROM mcpServerGrants WHERE app_id = 'aide';
```

#### 问题 3：注册中心模块加载失败

**现象**：`Error: Cannot find module './registry-center.js'`

**原因**：文件路径错误

**解决**：
检查导入路径是否正确，确保 `registry-center.js` 在 `chatos/electron/backend/` 目录下。

---

## 总结

本方案实现了完整的注册中心模式，确保：

- ✅ **清晰的架构边界**：ChatOS 作为注册中心，AIDE、git_app、wsl 等独立应用作为提供者和消费者
- ✅ **严格的权限控制**：通过权限表实现细粒度的访问控制
- ✅ **可逆的回滚机制**：提供完整的回滚步骤，降低风险
- ✅ **完善的验证测试**：提供数据库验证、功能验证、端到端测试

**实施要点**：
1. 先执行数据库迁移，创建注册中心表
2. 实现注册中心模块，提供完整的 CRUD API
3. 修改应用同步逻辑，注册到注册中心
4. 修改 AIDE 启动逻辑，从注册中心查询授权
5. 清理旧数据，确保数据一致性
6. 执行完整测试，验证隔离效果

**下一步建议**：
1. 在测试环境完整实施并验证
2. 记录性能指标（查询延迟、内存占用等）
3. 根据实际使用情况优化权限管理界面
4. 考虑实现权限继承和分组管理

---

**文档结束**
