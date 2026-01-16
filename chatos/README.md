
# chatos — Overview

简体中文在后半部分；更详细的分语言指南：`README.en.md` / `README.zh.md`

## Overview
Enhanced fork of `model-cli-js` with:
- Sub-agent marketplace (Python / Spring Boot / React) + `invoke_sub_agent`
- Task tracking MCP tools
- Shell MCP with built-in sessions for long-running commands
- UI prompt MCP (`ui_prompter`) to ask the user for structured inputs/decisions via the Electron floating island
- Live correction while running (auto inject) via the Electron floating island
- Auto config/session reports (HTML)
- Automatic summary + history pruning
- English-only plugin metadata; main prompt = orchestrator-only

## Quick Start
```bash
npm install
node src/cli.js chat           # start CLI (prints report paths)
# Alt (npx): npx --yes -p @leeoohoo/chatos chatos chat   # ensure ~/.npm perms are ok
# After npm install -g @leeoohoo/chatos: chatos chat    # shorter global binary
# UI (prebuilt dist) via Electron: chatosui
# If you installed the desktop app, you can install a terminal command from the UI (macOS/Linux: `chatos`, Windows: `chatos-desktop`) and run the CLI without a system Node.js.
# 指定共享会话根（CLI+UI 共用）：MODEL_CLI_SESSION_ROOT=/path/to/workspace chatos chat
```

Desktop packaging (macOS/Windows): `npm run desktop:dist` (outputs to `dist_desktop/`). CI workflow: `.github/workflows/desktop-build.yml`.

Common in-chat commands:
- `/sub marketplace` | `/sub install <id>` | `/sub agents` | `/sub run <agent> <task> [--skills ...]`
- `/prompt` (view/override system prompt)
- `/tool [id]` (show latest tool outputs)
- `/reset` (clear session)

## Tooling & Permissions
- **Main agent tools**: `invoke_sub_agent`, `get_current_time`, `mcp_project_files_*`, `mcp_subagent_router_*`, `mcp_task_manager_*` (no shell by default; other MCP servers are sub-agent-only unless enabled for main).
- **Sub-agents**: all registered tools (filesystem, shell, sessions, tasks, etc.).
- Shell MCP: `mcp_shell_tasks_run_shell_command` (short), `mcp_shell_tasks_session_run`, `mcp_shell_tasks_session_capture_output`.

## Sub-Agents
- Plugins live in the AIDE engine: `subagents/plugins/*`, listed in `subagents/marketplace.json` (desktop installs default to `~/.deepseek_cli/chatos/aide`).
- Each plugin: `plugin.json` + `agents/*.md` (prompts) + `skills/*.md` (instructions).
- `invoke_sub_agent` injects task-tracking rules (add/update/complete) into sub-agent prompts automatically.

## Reports
- `config-report.html`: models, MCP servers, prompts, installed sub-agents.
- `session-report.html`: chat (full width with Markdown), task list, tool history in drawers.
- Electron UI (IPC, no HTTP): `npm run ui` builds React dashboard; live session panel renders `session-report.html`, config panel reads YAML/JSON/tasks. UI prompt MCP: `mcp_ui_prompter_prompt_key_values`, `mcp_ui_prompter_prompt_choices`.

## Auto Summary & Pruning
- Threshold (approx tokens) default 60000 or `MODEL_CLI_SUMMARY_TOKENS`.
- On trigger, history becomes: system prompt + latest summary + current user message (main and sub-agents).

## Config Paths
- Models: `~/.deepseek_cli/chatos/auth/models.yaml`
- Main prompts:
  - `~/.deepseek_cli/chatos/auth/system-prompt.yaml` (`internal_main`, built-in read-only)
  - `~/.deepseek_cli/chatos/auth/system-default-prompt.yaml` (`default`, built-in read-only)
  - `~/.deepseek_cli/chatos/auth/system-user-prompt.yaml` (`user_prompt`, editable)
- Sub-agent prompts:
  - `~/.deepseek_cli/chatos/auth/subagent-system-prompt.yaml` (`internal_subagent`, built-in read-only)
  - `~/.deepseek_cli/chatos/auth/subagent-user-prompt.yaml` (`subagent_user_prompt`, editable)
- MCP servers: `~/.deepseek_cli/chatos/auth/mcp.config.json`
- Admin DB (models/MCP/prompts/tasks): `~/.deepseek_cli/chatos/chatos.db.sqlite`
- Sub-agent install state: `~/.deepseek_cli/chatos/subagents.json`

## Troubleshooting
- Permission errors writing reports: fix `~/.deepseek_cli/chatos` ownership.
- Missing tool: main agent intentionally disallows shell; use sub-agent or add prefix to whitelist.
- Long commands timing out: use session tools.
- MCP tool timeout (~60s) errors (e.g., `mcp_subagent_router_run_sub_agent`): default MCP request timeout is now 10m (max total 20m); override via `MODEL_CLI_MCP_TIMEOUT_MS` / `MODEL_CLI_MCP_MAX_TIMEOUT_MS` if needed.
- History too long: relies on auto-prune or `/reset`.
- Windows garbled Unicode output: run `chcp 65001` (UTF-8 code page) before starting; the CLI also tries to switch to UTF-8 at startup (disable via `MODEL_CLI_DISABLE_WIN_UTF8=1`).

## 中文概览
本仓库在 `model-cli-js` 基础上增强：
- 子代理市场（Python / Spring Boot / React），`invoke_sub_agent` 自动委派
- 任务管理 MCP 工具
- Shell MCP 内置会话，适合长命令
- 启动自动生成配置/会话 HTML 报告
- 自动总结并裁剪历史
- 插件元数据英文化，主 prompt 仅负责编排

快速开始：
```bash
npm install
node src/cli.js chat
```
常用指令：`/sub marketplace`、`/sub install <id>`、`/sub agents`、`/sub run <agent> <任务> [--skills ...]`、`/prompt`、`/summary`、`/tool`、`/reset`

工具权限：
- 主代理：`invoke_sub_agent`、`get_current_time`、`mcp_project_files_*`、`mcp_subagent_router_*`、`mcp_task_manager_*`（默认不含 shell；其它 MCP 默认仅子代理可用）
- 子代理：全部工具；Shell 提供 `run_shell_command`、`session_run`、`session_capture_output`

自动总结：超过阈值（默认 60000 估算 token 或 `MODEL_CLI_SUMMARY_TOKENS`）后，历史裁剪为「系统 prompt + 最新总结 + 当前用户消息」，子代理同样适用。
自动总结 prompt：`~/.deepseek_cli/chatos/auth/summary-prompt.yaml`（支持 `{{history}}`；可用 `/summary prompt` 查看）。

配置位置：`~/.deepseek_cli/chatos/auth/models.yaml`、`~/.deepseek_cli/chatos/auth/system-*-prompt.yaml`、`~/.deepseek_cli/chatos/auth/subagent-*-prompt.yaml`、`~/.deepseek_cli/chatos/auth/mcp.config.json`、`~/.deepseek_cli/chatos/chatos.db.sqlite`、`~/.deepseek_cli/chatos/subagents.json`

更多细节与完整指南请看 `README.en.md` / `README.zh.md`。   

## License
MIT (same as upstream). See `LICENSE`.
