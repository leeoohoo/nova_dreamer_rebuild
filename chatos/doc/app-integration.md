# ChatOS 应用对接文档（Models/API Keys/MCP/UI Apps）

> 更完整的“目录规范 + 协议 + MCP/Prompt 暴露 + Agent 运行机制”手册见：`chatos/doc/app-dev-handbook.md`

本文档面向“开发并接入新的应用（UI Apps 插件）”的场景，目标是：

- **所有应用复用 ChatOS 的全局 Models 与 API Keys 配置**（应用无需自带模型/密钥配置）。
- 应用可按标准契约暴露 **MCP Server** 与对应的 **Prompt**，并在 Chat Agent 中一键启用。

如果你只想看 UI Apps 插件的规范定义与快速上手，也可以先看：

- `chatos/doc/ui-apps-plugins.md`
- `chatos/doc/ui-apps-dev-guide.md`

---

## 1. 全局配置（对所有应用生效）

ChatOS 把“模型配置（Models）”与“密钥（API Keys / Secrets）”统一存放在同一套全局状态里，所有入口（Chat/CLI/UI Apps）都从这里读取。

### 1.1 会话根与状态目录

- **sessionRoot**：会话根目录
  - 默认：用户主目录（Home）
  - 可通过环境变量覆盖：`MODEL_CLI_SESSION_ROOT=/path/to/root`
- `stateRoot`：用户状态根目录
  - 桌面端/CLI 会把“上次使用的 sessionRoot”记录到 `<stateRoot>/last-session-root.txt`（未设置 env 时会优先读取）
- **stateDir**：`<stateRoot>/<hostApp>`（ChatOS 的 `hostApp=chatos`）
  - 兼容旧路径：若存在 `legacyStateRoot/<hostApp>`，启动时会自动迁移到 `stateDir`

### 1.2 关键文件/数据库

- `stateDir/chatos.db.sqlite`：Admin DB（Models / Secrets / MCP Servers / Prompts / Subagents / Settings 等）
- `stateDir/auth/models.yaml`：Models 的文件镜像（由 Admin DB 同步出来）
- `stateDir/auth/mcp.config.json`：MCP Servers 的文件镜像（由 Admin DB 同步出来）
- `stateDir/auth/system-prompt.yaml`：Prompts 的文件镜像（由 Admin DB 同步出来）
- `stateDir/auth/*prompt*.yaml`：不同场景（主流程/子流程）的 prompt 镜像文件

说明：

- **Secrets（API Keys）只存 Admin DB**，不会明文同步到 yaml 文件里。
- ChatOS 在运行模型调用前，会把 Secrets 按名称写入 `process.env`（受 `override` 规则控制），从而让各 Provider 按 `apiKeyEnv` 读取密钥。

### 1.3 Models（模型配置）

在 UI：`管理台 → Models` 配置。核心字段：

- `name`：模型显示名（也是内部选择模型的“模型名”）
- `provider`：供应商（OpenAI/DeepSeek/Anthropic/…）
- `model`：具体模型名（如 `gpt-4o-mini` / `deepseek-reasoner`）
- `apiKeyEnv`：读取 API Key 的环境变量名（如 `OPENAI_API_KEY` / `DEEPSEEK_API_KEY`）
- `baseUrl`：可选，自定义网关/代理地址
- `tools`：可选，允许的工具列表（含 MCP tools）

### 1.4 API Keys（Secrets）

在 UI：`管理台 → API Keys` 配置。核心字段：

- `name`：环境变量名（必须是合法 env key）
- `value`：密钥值
- `override`：是否覆盖当前进程已有的同名环境变量

应用侧原则：

- **应用不要保存/管理 key**；
- 只要选择模型（modelId/modelName），ChatOS 会通过 `apiKeyEnv` + Secrets 自动完成密钥注入。

---

## 2. UI Apps 插件：应用对接协议（Plugin/App/Entry/Host API）

UI Apps 插件用于把“小应用”注入到 ChatOS 桌面 UI 的「应用」中心。

### 2.1 插件目录（安装位置）

宿主会扫描两个目录：

- **用户插件目录**：`<stateDir>/ui_apps/plugins`（`stateDir = <stateRoot>/<hostApp>`）
- **内置/开发目录**：`<projectRoot>/ui_apps/plugins`

每个插件一个目录，必须包含 `plugin.json`。

### 2.2 plugin.json（接口/契约）

最重要的字段：

- `id`：pluginId（建议反向域名，全局唯一）
- `apps[]`：该插件下的应用列表
- `apps[i].entry`：入口类型（仅支持 `module`）
  - `module`：ESM 模块入口，宿主调用 `mount({ container, host, slots })`
- `backend.entry`：可选，插件后端入口（Electron main 进程执行）
- `apps[i].ai`：可选，声明该应用对 ChatOS 的“AI 贡献”（MCP + Prompt）

完整字段请以 `chatos/doc/ui-apps-plugins.md` 为准。

### 2.3 Host API（应用侧如何复用全局 Models/API Keys）

应用复用模型/密钥有两种推荐方式：

#### 方式 A：直接用宿主 Chat API（前端侧）

适合：你的应用就是一个“聊天增强面板/工作台”，需要与 Chat 页共享 sessions/messages/stream events。

可用能力（节选）：

- `host.admin.models.list()`：读取全局 Models（用于 UI 选择模型）
- `host.admin.secrets.list()`：读取全局 Secrets（仅返回脱敏信息）
- `host.chat.*`：创建 agent/session、发送消息、订阅流式事件

优点：不需要自建模型调用协议；模型、API Keys、MCP tools 都由 ChatOS 统一管理。

#### 方式 B：用插件后端的 `ctx.llm.complete()`（后端侧）

适合：你的应用需要 Node 能力（数据库/SSH/I/O），并希望在后端直接调用模型，但**不想自带 key**。

宿主会给插件后端 `ctx` 注入一个可选对象：

- `ctx.llm.complete({ input, modelId?, modelName?, systemPrompt?, disableTools? })`
- 返回：`{ ok: true, model: "<modelName>", content: "<text>" }`

说明：

- `modelId` 对应 Admin DB 里的 model 记录（Chat Agent 选择的也是 `modelId`）。
- 未提供 `modelId/modelName` 时，将自动使用默认模型。
- 默认 `disableTools=true`（避免插件后端模型调用触发工具链；如需开启可显式传 `disableTools:false`）。

模板已内置示例方法：`ui_apps/template/basic-plugin/backend/index.mjs`（`llmComplete`）。

### 2.4 用户交互待办（UI Prompts / 右下角笑脸）

ChatOS 提供一个全局的「交互待办」队列入口：**右下角浮动笑脸**。

当 AIDE 灵动岛 / 任意应用需要用户确认或输入时，可以把交互请求写入 `stateDir/ui-prompts.jsonl`，用户无需进入对应应用即可在笑脸面板里逐条处理。

推荐对接方式：

- **AI / MCP 场景（推荐）**：使用内置 MCP `ui_prompter`：
  - `mcp_ui_prompter_prompt_key_values`（表单输入）
  - `mcp_ui_prompter_prompt_choices`（单选/多选确认）
- **UI Apps（module）前端场景**：使用 Host API：
  - `host.uiPrompts.request({ prompt, runId?, requestId? })` 投递一条待办（`prompt.kind` 建议用 `kv` / `choice` / `task_confirm` / `file_change_confirm`）
  - `host.uiPrompts.onUpdate(fn)` 订阅队列变化；当出现同 `requestId` 的 `action:"response"` 时表示用户已处理
  - `host.uiPrompts.open()` 可主动打开笑脸面板（可选）

字段约定（建议）：

- `prompt.source`：建议填 `${pluginId}:${appId}`（或你自己的来源标识），用于在队列列表/面板里展示来源。

---

## 3. 应用如何“暴露” MCP Server 与 Prompt 给 ChatOS

目标：你的应用声明一次，就能让 Chat Agent 自动获得：

- 该应用对应的一组 MCP tools（通过 MCP Server 连接）
- 一段“如何使用这些 tools/这个应用”的 system prompt（对齐现有 `mcp_*` 规则）

### 3.1 在 plugin.json 里声明 `apps[i].ai`

示例（节选）：

```json
{
  "id": "hello-module",
  "name": "Hello Module App",
  "entry": { "type": "module", "path": "hello-module/index.mjs" },
  "ai": {
    "mcp": {
      "entry": "hello-module/mcp-server.mjs",
      "command": "node",
      "allowMain": true,
      "allowSub": true,
      "enabled": true
    },
    "mcpPrompt": {
      "title": "Hello Module · MCP Prompt",
      "zh": "hello-module/mcp-prompt.zh.md",
      "en": "hello-module/mcp-prompt.en.md"
    }
  }
}
```

要点：

- 推荐用 `ai.mcp.entry`（相对插件目录），宿主会转换为可运行的 `cmd://node <absPath> ...`；
- `ai.mcpPrompt.zh/en` 支持 path 或内联 content（见 schema）。
- `ai` 也支持直接写成一个相对路径字符串（如 `"db-client/ai.json"`），表示从该文件读取 AI 配置（要求在插件目录内）。

### 3.2 命名规则（宿主自动派生）

对于每个 app，宿主会派生出：

- **MCP serverName**：`${pluginId}.${appId}`
- **Prompt name**：
  - 中文：`mcp_<normalize(serverName)>`
  - 英文：`mcp_<normalize(serverName)>__en`

其中 `normalize()` 会把非 `[a-z0-9_-]` 的字符转换为 `_` 并做 trim。

### 3.3 “怎么体现/怎么生效”

当你把插件放进插件目录并在 UI「应用」页点击“刷新”后：

1) 宿主扫描插件并解析 `plugin.json`
2) 若发现 `apps[i].ai`：
   - 自动同步到 Admin DB：
     - `mcpServers`（你会在 `管理台 → MCP Servers` 看到 `${pluginId}.${appId}`）
     - `prompts`（你会在 `管理台 → Prompts` 看到 `mcp_*` 的 prompt）
3) 在 `Chat → Agents` 创建/编辑 agent 时：
   - 先选择应用（`应用（可选暴露 MCP / Prompt）`）
   - 再为“每个已选应用”分别勾选 MCP/Prompt，并用多选框选择要挂载的 MCP servers / Prompts
4) 运行该 agent 时：
   - ChatOS 会把对应 MCP server 加入可用工具集合
   - 同时把对应 `mcp_*` prompt 注入 system prompt（随 agent 生效）

补充说明（当前 Agent UI 行为）：

- **MCP/Prompt 选择是“按应用维度”保存的**，每个 app 都可以选择多条 `mcpServers` / `prompts`。
- 多选框只会展示**该应用主动暴露**的 MCP Servers / Prompts。
  - 默认：应用通过 `ai.mcp` / `ai.mcpPrompt` 声明自己的 server/prompt（宿主会同步到 Admin DB）。
  - 可选：应用也可以“聚合暴露”现有的全局资源（不新增 server/prompt），通过：
    - `ai.mcpServers: true | false | string[]`（`true` 表示开启暴露；数组表示按 serverName 精确暴露；`false` 表示禁用）
    - `ai.prompts: true | false | string[]`（`true` 表示开启暴露；数组表示按 prompt name 精确暴露；`false` 表示禁用）
    - 项目内置场景（应用代码在 `aide`）：可把“精确暴露清单”放到 `aide/shared/defaults/ui-apps-expose/<pluginId>__<appId>.yaml`，此时 `plugin.json` 只需要写 `true/false` 开关。
- **主聊天（main）只会启用 `allowMain=true` 的 MCP server**（或少量历史内置 allowlist）；如果你选择了 `allowMain=false` 的 server，它会被运行时过滤掉（工具不会出现在主流程里）。

Agent 保存的关键数据结构（节选）：

```json
{
  "uiApps": [
    {
      "pluginId": "com.example.tools",
      "appId": "db-client-v2",
      "mcp": true,
      "prompt": true,
      "mcpServerIds": ["<admin.mcpServers.id>", "..."],
      "promptIds": ["<admin.prompts.id>", "..."]
    }
  ]
}
```

运行时合并规则（简化）：

- `uiApps[i].mcp === true`：
  - 若 `mcpServerIds` 非空：直接使用这些 server；
  - 否则：按 `${pluginId}.${appId}` 自动匹配同名 MCP server（若存在）。
- `uiApps[i].prompt === true`：
  - 若 `promptIds` 非空：直接注入这些 prompt；
  - 否则：按 `mcp_<normalize(${pluginId}.${appId})>[__en]` 自动匹配并注入（若存在）。

---

## 4. 推荐的接入流程（Checklist）

1) 先在 `管理台 → Models / API Keys` 配好全局模型与密钥
2) 从模板创建插件：`ui_apps/template/basic-plugin`
3) 决定入口：仅支持 `module`
4) 如应用需要 Node 能力：
   - 配 `backend.entry`
   - 在后端用 `ctx.llm.complete()` 复用全局模型/密钥
5) 如应用要给 Chat Agent 提供 tools/prompt：
   - 在 app 的 `ai` 里声明 `mcp` + `mcpPrompt`
6) UI「应用」页刷新 → `Chat → Agents` 里选择应用 → 开跑

---

## 5. 相关实现位置（便于你继续扩展）

- 插件扫描/同步 AI 贡献：`chatos/electron/ui-apps/index.js`
- Host API（module）：`chatos/apps/ui/src/features/apps/AppsPluginView.jsx`
- Chat Agent 绑定 UI Apps（派生 MCP/Prompt）：`aide/electron/chat/runner.js`
- Admin 数据结构：`common/admin-data/schema.js`（`aide/shared/data/schema.js` 为兼容 re-export）
