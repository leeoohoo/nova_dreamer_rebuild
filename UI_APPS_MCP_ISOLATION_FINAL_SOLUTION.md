# UI Apps MCP 隔离最终解决方案（nova_dreamer 对齐版）

> **文档版本**：v2.0  
> **方案类型**：基于注册中心的完整实施方案  
> **涉及应用**：ChatOS, AIDE, git_app, wsl  
> **创建日期**：2026-01-11

---

## 概述

本仓库的“应用间完全隔离”目标包含两点：

1. **数据隔离**：每个应用只读写自己的 stateDir 与 admin DB（`~/.chatos/<app>/`）。
2. **能力隔离**：默认**不做跨应用授权**；尤其是 **AIDE 永不调用其他应用的 MCP server**。

ChatOS 作为注册中心，只负责：

- 统一收敛各应用的 MCP servers / prompts 元数据（注册）
- 维护授权关系（grant），但默认不授权

---

## 架构图

```
                    ChatOS (注册中心)
   提供注册接口（registerMcpServer, registerPrompt）
   提供查询接口（getMcpServersForApp, getPromptsForApp）
   管理授权关系（哪个应用可以使用哪些能力）
   维护权限表（mcpServerGrants, promptGrants）

   AIDE               git_app               wsl
 (独立应用)           (独立应用)            (独立应用)
```

## 角色定义

| 应用名称 | 应用类型 | 职责描述 |
|---------|---------|---------|
| **ChatOS** | 主平台 / 注册中心 | 提供 GUI 和应用编排，作为 MCP servers 注册中心 |
| **AIDE** | 独立应用 | AI 辅助开发引擎，提供大量 MCP servers 和 prompts |
| **git_app** | 独立应用 | Git 管理工具，提供 Git 相关的 MCP servers 和 prompts |
| **wsl** | 独立应用 | WSL 管理工具，提供 WSL 相关的 MCP servers 和 prompts |

---

## 核心设计

### 注册中心接口（语义不变）

```js
// 注册 MCP Server（提供方 -> ChatOS 注册中心）
await registry.registerMcpServer(providerAppId, serverConfig);

// 注册 Prompt（提供方 -> ChatOS 注册中心）
await registry.registerPrompt(providerAppId, promptConfig);

// 查询授权（消费方从注册中心只拿“被授权的”能力）
await registry.getMcpServersForApp(targetAppId);
await registry.getPromptsForApp(targetAppId);

// 管理授权
await registry.grantMcpServerAccess(appId, serverId);
await registry.revokeMcpServerAccess(appId, serverId);
await registry.hasMcpServerAccess(appId, serverId);
```

### ID 规则（本仓库实现）

为了保证“跨应用唯一”且不依赖各自 DB 的 UUID：

- `registryMcpServers.id = "<provider_app_id>::<provider_server_id>"`
  - `provider_server_id` 取 MCP server 的稳定标识（默认用 `server.name`）
  - UI Apps 的 `server.name` 固定为 `${pluginId}.${appId}`
- `registryPrompts.id = "<provider_app_id>::<provider_prompt_id>"`
  - `provider_prompt_id` 默认用 `prompt.name`
- `mcpServerGrants.server_id / promptGrants.prompt_id` 存储的都是上述 **registry id**

默认策略：**不写入任何 grant**（因此不会产生跨应用可见/可调用）。

---

## 数据存储（本仓库对齐点）

本仓库的 admin DB 使用 `sql.js`，SQLite 物理表固定为：

- `records(table_name TEXT, id TEXT, payload TEXT, created_at TEXT, updated_at TEXT, PRIMARY KEY(table_name,id))`

注册中心“表”是逻辑表（通过 `records.table_name` 区分），位于 **ChatOS 的 admin DB** 中：

- `appRegistrations`
- `registryMcpServers`
- `registryPrompts`
- `mcpServerGrants`
- `promptGrants`

对应实现文件：`chatos/electron/backend/registry-center.js`

---

## 启动/注册流程（npm run ui）

当你运行 `npm run ui`（启动 ChatOS 桌面端）时：

1. ChatOS 初始化自身 admin DB，并初始化注册中心（写入 ChatOS DB 的逻辑表）。
2. ChatOS 启动时自动把以下数据注册到注册中心：
   - ChatOS 自己的 `mcpServers/prompts`
   - 其它应用（`aide/git_app/wsl`）若存在对应 DB，则从各自 DB 同步注册
   - 若 `aide` DB 不存在：从 **AIDE bundled defaults**（`shared/defaults/*`）注册内置 MCP/Prompts
3. UI Apps 扫描时（`uiApps:list`）：
   - 对声明了 `ai.mcp/ai.mcpPrompt` 的插件应用，注册到注册中心
   - 插件可通过 `plugin.json` 的 `providerAppId` 指定其归属应用（本仓库内置 git/wsl 已设置）

关键点：注册 ≠ 授权；默认 grant 为空，因此 AIDE 不会获得其它应用能力。

---

## 代码落点（本仓库）

- 注册中心实现：`chatos/electron/backend/registry-center.js`
- 跨 DB 同步：`chatos/electron/backend/registry-sync.js`
- 启动时 bootstrap：`chatos/electron/main.js`
- UI Apps 扫描时注册：`chatos/electron/ui-apps/index.js`
- manifest 扩展字段：`chatos/electron/ui-apps/schemas.js`（新增 `providerAppId`）
- git/wsl 插件声明归属：`git_app/plugin.json`、`wsl/plugin.json`（以及内置副本）

---

## 打包注意事项（electron-builder）

为保证打包后仍可注册：

1. 需要在打包前把 AIDE runtime embed 到 `chatos/aide/`（见 `npm run aide:embed`）。
2. 需要把 git/wsl UI plugin embed 到 `chatos/ui_apps/plugins/`（见 `npm run git:embed` / `npm run wsl:embed`）。
3. 打包后（asar）：
   - built-in plugins 在 asar 内可读（扫描/读取 prompt 文件 OK）
   - registry 数据始终写入用户目录的 `~/.chatos/chatos/`（不写 asar）

---

## 验收清单（最小可验证项）

- AIDE（`hostApp=aide`）不会看到/调用 `git_app/wsl` 的 MCP servers（默认无授权）。
- ChatOS 启动后，注册中心至少包含：
  - `provider_app_id=aide` 的 `registryMcpServers/registryPrompts`（来自 DB 或 defaults）
  - `provider_app_id=git_app` / `wsl` 的 `registryMcpServers/registryPrompts`（来自 UI plugins）
- `mcpServerGrants` / `promptGrants` 默认为空。

---

**文档结束**

