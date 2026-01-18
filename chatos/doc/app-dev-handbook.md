# ChatOS 应用开发手册（UI Apps / Host API / MCP / Prompts / Models & API Keys）

本手册面向“开发并接入新的应用（UI Apps 插件）”的场景，目标是把 **目录规范**、**契约/协议**、**配置分层**、**MCP/Prompt 暴露机制** 一次性讲清楚，便于你或其他团队成员按统一方式扩展 ChatOS。

> 术语约定：
> - **ChatOS（宿主）**：桌面端 Electron 应用（本仓库的 `chatos`）。
> - **AIDE（核心）**：模型调用/工具/MCP/子代理等核心能力（本仓库的 `aide`）。
> - **UI Apps（小应用）**：通过插件形式注入到桌面端「应用」中心的 app。
> - **MCP**：Model Context Protocol（工具以 `mcp_<server>_*` 形式暴露给模型）。
> - **Prompt**：系统 prompt 模板（存 Admin DB，可注入到会话 system prompt）。

---

## 0. TL;DR（最短接入路径）

1) 复制模板插件：`chatos/ui_apps/template/basic-plugin` → 放到插件目录（见第 2 节）
2) 修改 `plugin.json`：新增你的 app（仅支持 `module`）
3) （可选）加后端：实现 `backend/index.mjs#createUiAppsBackend(ctx)`，前端用 `host.backend.invoke()` 调用
4) （可选）加 AI 暴露：在 app 的 `ai` 里声明 MCP/Prompt（见第 7 节）
5) 打开桌面端 →「应用」页点“刷新”→ 在「Chat → Agents」里选择应用并勾选 MCP/Prompt

---

## 1. 架构与分层（必须理解）

ChatOS 做了两件事：

1) **全局统一配置（Models / API Keys / MCP Servers / Prompts / Settings）**  
   - 存储在一个 Admin DB（SQLite）中；UI 管理台修改后，会同步出文件镜像（方便 CLI/运行时读取）。
   - “应用”不再自带模型配置或 API Keys，只复用全局状态（见第 3 节）。

2) **UI Apps 插件体系**  
   - 宿主扫描插件目录加载 app 清单（`plugin.json`）。
   - 插件可提供：
     - 前端入口（`module`；不支持 `iframe/url`）
     - 可选后端（Electron main 进程执行）
     - 可选 AI 声明（MCP Server / Prompt / 暴露列表）

你写应用时，绝大多数工作就是：**写一个 plugin 文件夹 + 一个 plugin.json +（可选）后端 +（可选）AI 声明**。

---

## 2. 目录规范（非常重要）

### 2.1 会话根与状态目录（所有配置都从这里生效）

- **sessionRoot**（会话根目录）
  - 默认：用户主目录（Home）
  - 覆盖：`MODEL_CLI_SESSION_ROOT=/path/to/root`
- `stateRoot`：用户状态根目录
  - 桌面端/CLI 会把“上次使用的 sessionRoot”记录到 `<stateRoot>/last-session-root.txt`（未设置 env 时会优先读取）
- **stateDir**：`<stateRoot>/<hostApp>`（ChatOS 的 `hostApp=chatos`）
  - 兼容旧路径：若存在 `legacyStateRoot/<hostApp>`，启动时会自动迁移到 `stateDir`

### 2.2 全局配置落盘位置（宿主维护，应用只读取）

- `stateDir/chatos.db.sqlite`：全局 Admin DB（Models / Secrets / MCP Servers / Prompts / Subagents / Settings…）
- 文件镜像（从 Admin DB 同步）：
  - `stateDir/auth/models.yaml`
  - `stateDir/auth/mcp.config.json`
  - `stateDir/auth/system-prompt.yaml`
  - `stateDir/auth/*prompt*.yaml`

原则：

- **Secrets（API Keys）只存 DB**，不会明文同步到 yaml。
- 运行前宿主会把 Secrets 写入 `process.env`（受 `override` 控制），Provider 通过 `apiKeyEnv` 取值。

### 2.3 UI Apps 插件目录（你交付的 app 放哪）

宿主会扫描两个目录：

- **内置/开发目录**：`<projectRoot>/ui_apps/plugins`（本仓库：`chatos/ui_apps/plugins`）
- **用户插件目录**：`<stateDir>/ui_apps/plugins`（`stateDir = <stateRoot>/<hostApp>`）

每个插件一个文件夹，根目录必须包含 `plugin.json`：

```
<pluginsDir>/
  my-plugin/
    plugin.json
    backend/              # 可选
    my-app/               # 你的 app 资源
```

### 2.4（内置应用专用）AI 暴露清单目录（精细度在 AIDE）

如果你的应用属于“内置应用”（即应用源码跟随仓库、由 AIDE/核心团队维护），精细的 MCP/Prompt 暴露清单放在：

- `aide/shared/defaults/ui-apps-expose/<pluginId>__<appId>.yaml`

宿主（ChatOS）只在 `plugin.json` 里保留 **粗粒度开关**：

- `ai.mcpServers: true | false`
- `ai.prompts: true | false`

这样做到：

- chatos（宿主）不承载“精细列表”
- 由应用开发者（在 aide）决定对外暴露哪些能力

---

## 3. 全局 Models / API Keys：应用如何复用（不允许各自维护）

### 3.1 Models（模型配置）

在 UI：`管理台 → Models` 配置。常用字段：

- `provider`、`model`、`baseUrl`、`apiKeyEnv`
- `tools`：允许的工具列表（含 MCP tools）
- `isDefault`：默认模型

### 3.2 API Keys（Secrets）

在 UI：`管理台 → API Keys` 配置：

- `name`：环境变量名（如 `OPENAI_API_KEY` / `DEEPSEEK_API_KEY`）
- `value`：密钥
- `override`：是否覆盖系统环境变量

应用侧规范：

- **应用不得保存/管理 key**（前端、后端都不允许把 key 写到自己的配置文件里）
- 只选择 `modelId` 或 `modelName`，宿主会自动注入 env

### 3.3 应用侧读取全局配置的两种方式

1) **前端（module）直接调宿主 Admin API**
   - `host.admin.models.list()`
   - `host.admin.secrets.list()`（脱敏）
   - `host.admin.state()`（全量快照）

2) **插件后端使用共享 LLM Bridge**
   - 在 `createUiAppsBackend(ctx)` 里使用 `ctx.llm.complete({ input, modelId?, modelName?, systemPrompt?, disableTools? })`
   - 宿主会自动注入 secrets，无需在插件侧处理 key

---

## 4. UI Apps 插件契约：plugin.json（规范）

插件清单文件固定为 `plugin.json`，当前 `manifestVersion=1`。

### 4.1 最小示例

```json
{
  "manifestVersion": 1,
  "id": "com.example.tools",
  "name": "Example Tools",
  "version": "0.1.0",
  "description": "示例插件",
  "backend": { "entry": "backend/index.mjs" },
	  "apps": [
	    {
	      "id": "hello-module",
	      "name": "Hello Module App",
	      "description": "Module 入口示例（直接挂载到宿主 UI）",
	      "entry": { "type": "module", "path": "hello-module/index.mjs" }
	    }
	  ]
	}
```

### 4.2 apps[i].entry（仅支持 module）

- `module`：宿主动态 `import()` ESM 模块，并调用 `mount({ container, host, slots })`
  - `{ "type": "module", "path": "my-app/index.mjs" }`

约束（强制）：

- `entry.path` 必须位于插件目录内（宿主会做路径边界校验）
- `entry.path` 必须是文件（module app）
- `iframe` / `url` 入口在 ChatOS 中不受支持（禁止）

---

## 5. Host API（应用与宿主交互协议）

### 5.1 module 应用入口（推荐）

入口模块需导出：

```js
export function mount({ container, host, slots }) {
  // render UI into container (body)
  // optional: render fixed header into slots.header
  // call host.admin/host.chat/host.backend/host.ui.navigate ...
  // return cleanup
  return () => {};
}
```

布局建议：

- 不要使用 window/body 作为滚动容器；把滚动放到应用内部。
- `slots.header` 用于固定 Header/Tab/菜单导航（不随 body 滚动），把可滚动内容放到 `container`。

`host`（当前实现，建议当作稳定契约使用）：

- `host.context.get()`：返回 `{ pluginId, appId, theme, bridge: { enabled } }`
- `host.registry.list()`：等价于 `uiApps:list`
- `host.admin.state()` / `host.admin.onUpdate(fn)`
- `host.admin.models.list()` / `host.admin.secrets.list()`
- `host.backend.invoke(method, params)`
- `host.uiPrompts.read()` / `host.uiPrompts.onUpdate(fn)`：读取/订阅「交互待办」（UI Prompts）
- `host.uiPrompts.request({ prompt, runId?, requestId? })`：投递一条待用户处理的交互（建议 `prompt.source = ${pluginId}:${appId}`）
- `host.uiPrompts.respond({ requestId, runId?, response })`：写入用户响应（完成该待办）
- `host.uiPrompts.open()` / `close()` / `toggle()`：打开/关闭/切换宿主右下角笑脸「交互待办」面板
- `host.ui.navigate(menu)`
- `host.chat.*`（agents/sessions/messages/send/abort/events）
- `host.theme.get()` / `host.theme.onChange(fn)`

---

## 6. 插件后端（可选）：Electron main 进程执行

### 6.1 后端入口规范

`plugin.json`：

```json
{ "backend": { "entry": "backend/index.mjs" } }
```

后端模块导出：

```js
export async function createUiAppsBackend(ctx) {
  return {
    methods: {
      async ping(params) {
        return { ok: true };
      }
    },
    async dispose() {}
  };
}
```

`ctx`（宿主注入）：

- `pluginId` / `pluginDir`
- `dataDir`：`<stateDir>/ui_apps/data/<pluginId>`
- `stateDir` / `sessionRoot` / `projectRoot`
- `llm`：可选（共享模型调用接口）
  - `ctx.llm.complete({ input, modelId?, modelName?, systemPrompt?, disableTools? })`

### 6.2 前端调用后端

- `module`：`await host.backend.invoke('ping', params)`

---

## 7. MCP / Prompt：应用如何“对 ChatOS 暴露能力”

目标：应用声明一次，Chat Agent 就能按“应用维度”选择并启用：

- MCP tools（通过 MCP server）
- Prompt（system prompt 注入）

### 7.1 两种暴露方式

#### 方式 A：应用自带 MCP server + mcpPrompt（推荐给“有专属工具”的应用）

在 `apps[i].ai` 里声明：

- `ai.mcp`：宿主会创建/更新一个 MCP server（serverName 固定为 `${pluginId}.${appId}`）
- `ai.mcpPrompt`：宿主会创建/更新对应的 system prompt（prompt name 固定派生）

示例：

```json
{
  "id": "db-client",
  "name": "数据库客户端",
  "entry": { "type": "module", "path": "db-client/index.mjs" },
  "ai": {
    "mcp": { "entry": "db-client/mcp-server.mjs", "command": "node", "allowMain": true, "allowSub": true },
    "mcpPrompt": { "zh": "db-client/mcp-prompt.zh.md", "en": "db-client/mcp-prompt.en.md" }
  }
}
```

命名规则（宿主自动派生）：

- `MCP serverName`：`${pluginId}.${appId}`
- `Prompt name`：
  - 中文：`mcp_<normalize(serverName)>`
  - 英文：`mcp_<normalize(serverName)>__en`

> normalize：把非 `[a-z0-9_-]` 转成 `_` 并 trim。

#### 方式 B：应用聚合暴露“已有的” MCP servers / Prompts（适合“面板型应用”）

在 `apps[i].ai` 里声明：

- `ai.mcpServers`: `true | false | string[]`
- `ai.prompts`: `true | false | string[]`

语义：

- `false`：禁用
- `true`：启用（是否“全部”由你的精细清单决定；没有清单则默认全部）
- `string[]`：精确列出要暴露的 serverName / prompt name

注意：这是“展示与可选范围”的声明；最终是否启用、启用哪些，仍由 Agent 编辑页对该应用的多选结果决定。

### 7.2（内置应用）精细清单放哪：aide/shared/defaults/ui-apps-expose

内置应用推荐使用“开关 + 默认清单”的两层设计：

1) `chatos/ui_apps/plugins/<plugin>/plugin.json`：只放开关

```json
{ "ai": { "mcpServers": true, "prompts": true } }
```

2) `aide/shared/defaults/ui-apps-expose/<pluginId>__<appId>.yaml`：放精细清单

```yaml
mcpServers:
  - project_files
  - task_manager

prompts:
  - default
  - internal_main
  - mcp_project_files
  - mcp_task_manager
```

文件命名规则：

- `<pluginId>__<appId>.yaml`（全部小写；不合法字符会被 `_` 替换）

### 7.3（第三方/外部插件）精细清单放哪

外部插件可自行选择其一：

1) 直接在 `plugin.json` 里写 `string[]`（最简单）
2) 把 AI 配置抽到插件目录内的 `ai.json/ai.yaml`，并在 `apps[i].ai` 里用 `config` 引用（或直接写成字符串路径）

规范建议：

- “开关”优先放在 `plugin.json`
- “精细列表/长文本 prompt”优先放到独立文件（便于 review 与协作）

### 7.4 MCP Server 开发规范（写自己的 tools 时必读）

如果你的应用需要“专属 tools”（例如数据库查询、系统诊断、内部系统调用），建议给应用自带一个 MCP server（方式 A）。

#### 推荐目录结构

把 MCP server 脚本放在插件目录内（随插件交付）：

```
my-plugin/
  plugin.json
  db-client/
    index.mjs
    mcp-server.mjs
    mcp-prompt.zh.md
    mcp-prompt.en.md
```

`plugin.json` 里用 `ai.mcp.entry` 引用相对路径：

```json
{
  "ai": {
    "mcp": { "entry": "db-client/mcp-server.mjs", "command": "node", "allowMain": true, "allowSub": true },
    "mcpPrompt": { "zh": "db-client/mcp-prompt.zh.md", "en": "db-client/mcp-prompt.en.md" }
  }
}
```

宿主会把它转换为可运行的 `cmd://node <absPath> ...`，避免 cwd 造成的相对路径问题。

#### MCP server 最小骨架（Node.js / stdio）

MCP server 进程通过 stdio 与宿主通信（不要输出到 stdout，日志请写 stderr）：

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'my_server', version: '0.1.0' });

// server.tool('tool_name', schema, handler) ...

const transport = new StdioServerTransport();
await server.connect(transport);
```

注意事项（强约束）：

- tools 的最终名字会变成 `mcp_<serverName>_<toolName>`（由宿主注册）；`serverName` 是 MCP server 的 `name`
- 主流程（MAIN）默认只启用 `allowMain=true` 的 server（安全/权限控制）
- 需要访问全局配置（Models/API Keys）的 server 可以直接读环境变量（宿主已注入）

---

## 8. Chat Agent 如何消费应用暴露（你需要知道的运行机制）

### 8.1 Agent 编辑页（UI 行为）

- 先选择应用：`Chat → Agent 管理 → 新增/编辑`
- 对每个已选应用：
  - 勾选 `MCP` / `Prompt`
  - 在多选框里选择该应用暴露的 MCP servers / Prompts

“看不到某个 MCP/Prompt”的唯一原因应该是：**应用没有主动暴露**（或开关关闭）。

### 8.2 保存结构（简化）

```json
{
  "uiApps": [
    {
      "pluginId": "com.example.tools",
      "appId": "db-client",
      "mcp": true,
      "prompt": true,
      "mcpServerIds": ["<admin.mcpServers.id>", "..."],
      "promptIds": ["<admin.prompts.id>", "..."]
    }
  ]
}
```

### 8.3 运行时规则（重要）

- 主流程（MAIN）只会启用 `allowMain=true` 的 MCP server（或少量历史 allowlist）
- `uiApps` 一旦配置，主流程不会“自动注入 MCP usage prompts”，只注入你在 UI 中为应用选择的 prompts
  - 因此如果你希望 prompt 生效，请确保在应用下勾选 Prompt 并选择需要的 prompts（或提供 app 自己的 `ai.mcpPrompt`）

---

## 9. 开发与调试 Checklist

### 9.1 开发 Checklist

- [ ] pluginId 唯一、稳定（建议反向域名）
- [ ] appId 在插件内唯一
- [ ] `entry.path` 存在且在插件目录内
- [ ] （可选）backend.entry 存在且在插件目录内
- [ ] （可选）AI 声明：
  - [ ] 自带 MCP：`ai.mcp.entry` + `ai.mcpPrompt`
  - [ ] 聚合暴露：`ai.mcpServers/prompts` + 精细清单（内置建议放 `aide/shared/defaults/ui-apps-expose`）

### 9.2 常见问题排查

1) **应用在“应用”页看不到**
   - `plugin.json` 是否存在且 JSON 可解析
   - `apps[].entry.path` 是否存在（module 必须是 file）
   - 点“刷新”后查看注册表返回的 `errors[]`（开发模式可打印）

2) **Agent 里选不到应用 / 选不到 MCP/Prompt**
   - 应用 `apps[i].ai` 是否存在
   - `ai.mcpServers/prompts` 开关是否为 `true`
   -（内置）`aide/shared/defaults/ui-apps-expose/<pluginId>__<appId>.yaml` 是否存在、格式是否正确

3) **启用 MCP 但工具没出现在主流程**
   - MCP server 的 `allowMain` 是否为 `true`
   - MCP server 是否 `enabled=true`

---

## 10. 参考实现（建议直接照抄）

- UI Apps 插件模板：`chatos/ui_apps/template/basic-plugin/plugin.json`
- 宿主扫描/同步 AI 贡献：`chatos/electron/ui-apps/index.js`
- Agent 绑定与运行时注入：`aide/electron/chat/runner.js`
- 内置应用精细暴露清单：`aide/shared/defaults/ui-apps-expose/`
