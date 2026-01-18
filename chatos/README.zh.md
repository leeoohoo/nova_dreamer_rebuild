# chatos 子代理增强版（中文指南）

English version: `README.en.md`

## 本分支的增强点
- **子代理市场**：AIDE 引擎内置 `subagents/marketplace.json` 可安装插件，默认提供 Python / Spring Boot / React 三套插件（代理 + 技能）。
- **主代理只做编排**：主代理仅能用委派/任务工具；子代理获得全部 MCP 工具（文件、Shell、任务、子代理路由等）。
- **任务追踪**：`invoke_sub_agent` 每次都会在子代理系统提示中注入任务规则，要求先用 `mcp_task_manager_add_task` 记录任务，进展用 `update_task`，完成时必须用 `complete_task` 携带“完成明细”备注。
- **配置/会话报告**：启动自动生成 `config-report.html`（模型、MCP、Prompt、子代理）和 `session-report.html`（消息、任务、工具历史，左右抽屉 + 全宽聊天，支持 Markdown）。
- **UI 交互询问**：新增 `ui_prompter` MCP，可在 Electron UI 浮动岛弹出表单/选择项（`mcp_ui_prompter_prompt_key_values` / `mcp_ui_prompter_prompt_choices`），收集用户输入并返回给 AI。
- **终端回退确认**：任务创建确认/文件变更确认/表单选择等拦截项在纯终端也可用；若 UI 与终端同时可用，任意一端先确认即继续（另一端会自动消失）。
- **运行中纠正**：Electron 灵动岛支持一键“纠正”；系统会自动判断当前正在运行的是主流程还是子流程（`subagent_router` worker），并把纠正注入到对应流程里。
- **长跑命令**：Shell MCP 提供 `session_run` / `session_capture_output`，避免长命令超时。
- **自动总结与裁剪**：主会话和子代理会在过长时将历史裁剪为「系统 prompt + 最新总结 + 当前轮用户消息」。
- **插件信息英文化**：所有插件 manifest 描述已改为英文。

## 安装
```bash
npm install
```

## 运行
```bash
node src/cli.js chat
# 或 npx --yes -p @leeoohoo/chatos chatos chat（需确保 ~/.npm 权限正常）
```

启动会打印：
- `Config snapshot written to: .../config-report.html`
- `Session report will update at: .../session-report.html`

## 桌面应用打包（macOS/Windows）
本项目包含 Electron UI（`chatosui`），可用 `electron-builder` 打包成独立桌面应用（macOS Intel/Apple Silicon + Windows x64）：

```bash
npm run desktop:dist
# 产物输出到 dist_desktop/
```

备注（从 GitHub 下载的 macOS 安装包）：未签名/未公证的 App 可能会被 Gatekeeper 拦截并提示“已损坏”。本仓库的 Release 工作流会在推送 tag 时对 macOS `dmg/zip` 做签名 + 公证，需要配置这些 GitHub Secrets：
- `DEV_ID_APP_CERT_P12_BASE64`, `DEV_ID_APP_CERT_PASSWORD`（Developer ID Application 证书导出的 `.p12`）
- `ASC_APPLE_ID`, `ASC_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`（公证）

## 桌面 App：AIDE 引擎（默认内置）
桌面 App 的聊天/CLI 能力依赖 AIDE 引擎：

- **内置版（推荐）**：本仓库的 `npm run desktop:dist` 会在打包前自动执行 `npm run aide:embed`，把 AIDE 引擎（release dist）与内置应用一起打进安装包，首次启动开箱即用。
- 引擎源码与 ChatOS 同仓，目录为 `./src/engine`（无需外部 embed root）。
- **外部引擎安装/替换已禁用**：桌面端锁定使用内置 AIDE，引擎不会再从外部目录/zip 导入。

## 桌面 App：导入应用包（通用）
如需安装其它应用（UI Apps 插件）：打开桌面 App → `应用` → 点击 `导入应用包` → 选择插件目录或 `.zip`。
- 插件包需包含 `plugin.json`（位于包根目录，或包根目录下一层目录）。

## 桌面 App 安装后在终端使用 CLI（无需 Node）
桌面 App 自带 Electron/Node 运行时；安装桌面 App 后，即使系统没装 Node，也可以在终端运行 CLI。

推荐方式（最省事）：
- 打开桌面 App → `管理台` → `设置` → `终端命令（无需 Node）` → 点击“安装/更新”（macOS/Linux：`chatos`，Windows：`chatos-desktop`）
- 重新打开一个终端窗口，然后运行 UI 显示的命令（例如 `chatos chat` 或 `chatos-desktop chat`）

备用方式（不安装命令，直接跑）：
- macOS：`ELECTRON_RUN_AS_NODE=1 "<App>/Contents/MacOS/chatosui" "<App>/Contents/Resources/app.asar/src/cli.js" chat`
- Windows：`set ELECTRON_RUN_AS_NODE=1 && "<App>\\chatosui.exe" "<App>\\resources\\app.asar\\src\\cli.js" chat`

CI 构建：`.github/workflows/desktop-build.yml`（支持 `workflow_dispatch`；推送 `v*` tag 会构建并创建 GitHub Release 附件）。

## 聊天内常用指令
- `/sub marketplace` 查看插件
- `/sub install <id>` 安装插件
- `/sub agents` 查看已装代理 + 技能
- `/sub run <agent_id> <任务> [--skills skill1,skill2]` 手动运行子代理
- `/prompt` 查看/覆盖系统 prompt
- `/summary` 查看自动总结状态/强制总结（`/summary now`）
- `/tool [id]` 查看最近工具输出

## MCP 工具（主 vs 子）
- 主代理白名单：`invoke_sub_agent`、`get_current_time`、`mcp_project_files_*`、`mcp_subagent_router_*`、`mcp_task_manager_*`（默认不允许 shell；其它 MCP 默认仅子代理可用）。
- 子代理：继承全部已注册工具（文件、shell、sessions、task_manager、subagent_router 等）。

## MCP 服务配置
- `stateDir`：每个应用的状态根目录（默认 `~/.deepseek_cli/<hostApp>`，旧 `~/.chatos/<hostApp>` 自动迁移）
- 配置文件：`<stateDir>/auth/mcp.config.json`
- 聊天内管理：`/mcp`（查看）、`/mcp_set`（编辑）、`/mcp_tools`（为当前模型启用工具）
- 内置：`chrome_devtools`（默认禁用、仅子代理可用）。如需浏览器自动化/调试，请在 UI（Admin → MCP Server 管理）里启用。
- 端点格式：
  - Stdio（本地拉起）：`cmd://node /abs/path/server.js ...` 或直接填命令行 `npx -y <pkg> ...`
  - HTTP：`http(s)://host/path`（Streamable HTTP；旧版 SSE 服务会自动回退）
  - WebSocket：`ws(s)://host/path`

### Shell MCP 长命令
- `mcp_shell_tasks_run_shell_command` 适合短时命令。
- `mcp_shell_tasks_session_run` 启动/复用会话跑长流程。
- `mcp_shell_tasks_session_capture_output` 查看会话输出。

## 总结与裁剪
- 阈值（粗估 token）：默认 60000，可用 `MODEL_CLI_SUMMARY_TOKENS` 调整。
- 触发后历史被裁剪为：系统 prompt + 最新总结 + 当前轮用户消息。
- 子代理也使用同样模式裁剪。
- 自动总结 prompt：`<stateDir>/auth/summary-prompt.yaml`（支持 `{{history}}`；可用 `/summary prompt` 查看当前内容）。

## 目录结构
下列路径以 AIDE 引擎根目录为基准（默认在 `<stateDir>/aide`）：
```
src/engine/src/           # CLI Core、聊天循环、prompt、MCP runtime
src/engine/subagents/     # 子代理管理、marketplace、插件（python / spring-boot / frontend-react）
src/engine/mcp_servers/   # Shell（含会话工具）等 MCP 服务器
README.en.md / README.zh.md
```

## 自定义系统 Prompt
- 主程序 prompts：
  - `<stateDir>/auth/system-prompt.yaml`（`internal_main`，内置只读）
  - `<stateDir>/auth/system-default-prompt.yaml`（`default`，内置只读）
  - `<stateDir>/auth/system-user-prompt.yaml`（`user_prompt`，可编辑）
- 子代理 prompts：
  - `<stateDir>/auth/subagent-system-prompt.yaml`（`internal_subagent`，内置只读）
  - `<stateDir>/auth/subagent-user-prompt.yaml`（`subagent_user_prompt`，可编辑）

## 环境与调试
- 推荐：在桌面 App 管理台 → `API Keys` 配置 `DEEPSEEK_API_KEY`（写入 `<stateDir>/chatos.db.sqlite`，CLI 启动时自动注入进程环境）。
- 模型调用只从 UI 管理台保存的 `API Keys` 读取密钥；不再读取系统/终端环境变量。
- 请求日志：`MODEL_CLI_LOG_REQUEST=1`
- 模型重试：`MODEL_CLI_RETRY=<n>`
- MCP 超时可调：`MODEL_CLI_MCP_TIMEOUT_MS`（默认 600000）/ `MODEL_CLI_MCP_MAX_TIMEOUT_MS`（默认 1200000，最大 30 分钟）

## 常见问题
- **报告写入权限**：修复 `<stateDir>` 权限或在可写环境运行。
- **工具未注册**：主代理仅允许任务/子代理工具，shell 工具需在子代理内使用。
- **`mcp_*` 请求超时**：长耗时 MCP 工具（子代理、shell）现默认 10 分钟，仍提前被取消可提升上述环境变量。
- **长命令超时**：改用 `session_run` + `session_capture_output`。
- **历史过长**：依靠自动裁剪，或 `/reset` 重开会话。
- **终端确认未弹出/一直等待**：终端回退需要可用 TTY（macOS/Linux 为 `/dev/tty`）；可设 `MODEL_CLI_PROMPT_BACKEND=file` 强制只走 UI（写入 `ui-prompts.jsonl`），或设 `MODEL_CLI_PROMPT_BACKEND=tty` 强制只走终端；也可用 `MODEL_CLI_DISABLE_TTY_PROMPTS=1` 禁用终端回退。
- **Windows 终端中文乱码**：通常是终端代码页不是 UTF-8（65001）。可先执行 `chcp 65001` 再运行；CLI 也会尝试在启动时临时切到 UTF-8（如需关闭可设 `MODEL_CLI_DISABLE_WIN_UTF8=1`）。

## License
MIT（同上游）。见 `LICENSE`。
