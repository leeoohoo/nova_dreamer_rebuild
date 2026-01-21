# ChatOS CLI 替换为 Gemini CLI 的方案与计划

## 目标
- 用 `doc/gemini_cli_no_login` 里的 Gemini CLI 替换 `chatos` 现有 CLI。
- 保留 ChatOS UI 终端管理与状态流转（run/status/control/events）。
- 保持“无登录/仅 API Key”可用，尽量复用 ChatOS 现有配置与密钥存储。

## 现状差异（影响替换的关键点）
- ChatOS CLI
  - 入口：`chatos/src/cli.js` -> `chatos/cli/src/index.js`。
  - UI 对接：`chatos/electron/terminal-manager.js` + `chatos/electron/terminal-manager/dispatch.js`。
  - 状态与控制：`runs.jsonl`、`terminals/<runId>.status.json`、`terminals/<runId>.control.jsonl`、`events.jsonl`。
  - 会话与状态根：`MODEL_CLI_SESSION_ROOT` + `.deepseek_cli/<hostApp>/...`。
  - 模型/密钥来自 admin DB（`<stateDir>/chatos.db.sqlite`）。
- Gemini CLI
  - 入口：`doc/gemini_cli_no_login/packages/cli/index.ts`（bundle 为 `bundle/gemini.js`）。
  - 配置根：`~/.gemini`（可用 `GEMINI_CLI_HOME` 覆盖）。
  - 认证：`GEMINI_API_KEY` + `GEMINI_DEFAULT_AUTH_TYPE` / settings 强制 auth。
  - Node 版本要求 >= 20。

## 推荐方案（分层适配器）
用“桥接层 + 入口替换”的方式：
1) 在 ChatOS 侧新增一个 **Gemini CLI Bridge**，负责：
   - 生成/注入 `MODEL_CLI_RUN_ID` 与 `MODEL_CLI_SESSION_ROOT`。
   - 写 `runs.jsonl`、`terminals/<runId>.status.json`、`events.jsonl`。
   - 读取 `terminals/<runId>.control.jsonl` 并把消息注入 Gemini CLI（或转为 headless 调用）。
2) 将 `chatos` 的 CLI 入口指向该 Bridge；Bridge 再启动 Gemini CLI。
3) 通过环境变量/设置文件把 ChatOS 的密钥和模型选择映射到 Gemini CLI。

## 关键改造点
1) **CLI 入口替换**
   - 新增 `chatos/cli/gemini-bridge.js`（或同等位置），作为新的 CLI 入口。
   - 修改 `chatos/src/cli.js` 或 `chatos/electron/terminal-manager.js` 的 `resolveCliEntrypointPath()` 指向 bridge。

2) **状态/控制文件兼容**
   - 复用 ChatOS 的 sessionRoot 逻辑（`packages/common/state-core/session-root.js`）。
   - 复用 `runs.jsonl` / `status.json` / `control.jsonl` 结构与路径。
   - 在 bridge 中定时更新 status（starting/running/idle/exited）。

3) **认证与配置映射（无登录）**
   - 从 ChatOS admin DB 读取 API Key，写入 `GEMINI_API_KEY`。
   - 在 `GEMINI_CLI_HOME/.gemini/settings.json` 中设置 `security.auth.enforcedType = "gemini-api-key"`，并禁用 OAuth 引导。
   - 统一决定 `GEMINI_CLI_HOME`：
     - 方案 A：指向 ChatOS 的 stateDir（与 UI 同根，便于集中管理）。
     - 方案 B：指向 sessionRoot（项目隔离更强，但多项目切换时会生成多份配置）。

4) **模型映射与 UI 交互**
   - ChatOS 的模型列表与 Gemini CLI 的模型命名不同，需要映射层。
   - 最小可用：在 bridge 中固定 Gemini CLI 默认模型，禁用 ChatOS 模型切换。
   - 进阶：把 ChatOS 管理台的模型选择映射到 Gemini CLI settings（`model` 字段）。

5) **MCP/工具兼容**
   - ChatOS MCP 配置文件（`auth/mcp.config.json`）需转换为 Gemini CLI 的 MCP 配置结构。
   - 初期可只迁移必要的 MCP（例如 filesystem / shell），其他保持禁用或由 Gemini CLI 自身配置管理。

6) **打包与运行时**
   - 构建 Gemini CLI bundle（`doc/gemini_cli_no_login/bundle/gemini.js`）。
   - Desktop 打包时把 bundle 作为资源一起发布；CLI shim 调用该 bundle。
   - Node 版本要求 >= 20（系统 Node 或 Electron 内置 Node 必须满足）。

## 计划与里程碑
### Phase 0：确认需求与可行性（1-2 天）
- 明确需要保留的 ChatOS 功能（子代理/任务/MCP/报告）。
- 决定交互模式：Gemini CLI 交互模式 vs headless 每条调用。
- 确定 `GEMINI_CLI_HOME` 目录策略。

### Phase 1：MVP 替换（2-3 天）
- 实现 Gemini CLI Bridge（只负责启动 + 记录 runs/status）。
- 修改入口与 terminal manager 指向 bridge。
- 通过环境变量注入 `GEMINI_API_KEY` + 固定模型。
- 验证：`chatos chat` 可正常启动 Gemini CLI，UI 能看到终端状态。

### Phase 2：控制桥接（2-4 天）
- 读取 `terminals/<runId>.control.jsonl`，支持 `message` / `stop`。
- 将消息注入 Gemini CLI（优先走 stdin；必要时降级为 headless 调用）。
- 状态同步：在消息发送时更新 status / events。

### Phase 3：配置与模型映射（2-3 天）
- 从 admin DB 拉取 API Key 与默认模型。
- 生成/更新 Gemini CLI settings（`security.auth`、`model`）。
- 如果需要，提供 ChatOS UI 的模型选择映射。

### Phase 4：MCP 与工具兼容（3-5 天）
- 转换 ChatOS MCP 配置到 Gemini CLI 设置。
- 逐项验证 MCP 工具调用与权限控制。

### Phase 5：打包与文档（1-2 天）
- 更新打包脚本，把 Gemini CLI bundle 纳入发布物。
- 更新 README：CLI 启动方式与认证说明。

## 风险与待确认
- **Node 版本差异**：Gemini CLI 要求 Node >= 20，ChatOS 现为 >= 18。
- **功能缺口**：ChatOS 子代理/任务管理等功能可能无法直接迁移。
- **UI 交互注入**：Gemini CLI Ink UI 是否稳定支持外部注入输入，需要验证。
- **配置冲突**：`.gemini` 与 ChatOS 状态根的目录/权限冲突。

## 验收标准
- `chatos chat` 启动 Gemini CLI 且可正常对话。
- UI 能识别 `runId` 并正确显示状态。
- 支持通过 UI 发消息（control.jsonl -> CLI）。
- API Key 无需登录即可工作。
