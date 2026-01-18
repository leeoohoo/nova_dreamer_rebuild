# chatos CLI with Sub-Agents (Fork)

English guide. For Chinese see `README.zh.md`.

## What this fork adds
- **Sub-agent marketplace**: install plugins from the AIDE engine `subagents/marketplace.json` (desktop installs default to `~/.deepseek_cli/chatos/aide`). Default plugins: Python, Spring Boot, React.
- **Orchestrator prompt**: main agent delegates only; sub-agents get full tool access (filesystem, shell, tasks, etc.).
- **Task tracking**: `invoke_sub_agent` injects a rule to log tasks via `mcp_task_manager_*` (add/update/complete with a completion note) on every sub-agent call.
- **Config/session reports**: auto-write `config-report.html` (models/MCP/prompts/sub-agents) and `session-report.html` (messages, tasks, tool history). Session report uses drawers for tasks/tools and full-width chat with Markdown render.
- **UI interactive prompts**: built-in MCP server `ui_prompter` can ask the user for structured inputs/decisions via the Electron floating island (`mcp_ui_prompter_prompt_key_values` / `mcp_ui_prompter_prompt_choices`).
- **Live correction while running**: the Electron floating island has a single “Correct” action; it auto-detects whether the main flow or a `subagent_router` worker is currently running and injects the correction accordingly.
- **Long-running commands**: MCP shell server includes `session_run` / `session_capture_output` for processes that shouldn’t time out.
- **Automatic summary & pruning**: main and sub-agent sessions, when too long, are trimmed to `system prompt + latest summary + current user turn`.
- **English plugin metadata**: all sub-agent manifests are in English.

## Install
```bash
npm install
```

## Run
```bash
node src/cli.js chat
# or npx --yes -p @leeoohoo/chatos chatos chat (ensure ~/.npm perms are OK)
```

Startup prints:
- `Config snapshot written to: .../config-report.html`
- `Session report will update at: .../session-report.html`

## Desktop packaging (macOS/Windows)
This repo includes an Electron UI (`chatosui`). You can package a standalone desktop app (macOS Intel/Apple Silicon + Windows x64) via `electron-builder`:

```bash
npm run desktop:dist
# outputs to dist_desktop/
```

Note (macOS downloads from GitHub): unsigned apps may be blocked by Gatekeeper and show “damaged”. The release workflow signs + notarizes macOS `dmg/zip` on tag builds, and expects these GitHub Secrets:
- `DEV_ID_APP_CERT_P12_BASE64`, `DEV_ID_APP_CERT_PASSWORD` (Developer ID Application cert exported as `.p12`)
- `ASC_APPLE_ID`, `ASC_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (notarization)

## Desktop app: AIDE engine (bundled by default)
The desktop app’s chat/CLI capabilities depend on the AIDE engine:

- **Bundled (recommended)**: `npm run desktop:dist` runs `npm run aide:embed` before packaging, so the release AIDE runtime + built-in apps ship inside the installer and work out-of-the-box.
- Engine sources live in this repo at `./src/engine` (no external embed root required).
- **External engine install/override is disabled**: the desktop build is locked to the bundled AIDE engine and will not import an external dir/zip.

## Desktop app: import app packages (generic)
To install other apps (UI Apps plugins): open the desktop app → `Apps` → click `Import app package` → choose a plugin directory or `.zip`.
- The package must include `plugin.json` (at the package root, or one directory below it).

## Use the CLI without installing Node (via the desktop app)
The packaged desktop app ships with its own Electron/Node runtime. After installing the desktop app, you can run the CLI in a terminal even if Node is not installed system-wide.

Recommended (easy):
- Open the desktop app → `Admin` → `Settings` → `Terminal command (no Node)` → click “Install/Update” (macOS/Linux: `chatos`, Windows: `chatos-desktop`)
- Reopen your terminal, then run the shown command (e.g. `chatos chat` or `chatos-desktop chat`)

Fallback (no command install, run directly):
- macOS: `ELECTRON_RUN_AS_NODE=1 "<App>/Contents/MacOS/chatosui" "<App>/Contents/Resources/app.asar/src/cli.js" chat`
- Windows: `set ELECTRON_RUN_AS_NODE=1 && "<App>\\chatosui.exe" "<App>\\resources\\app.asar\\src\\cli.js" chat`

CI: `.github/workflows/desktop-build.yml` (supports `workflow_dispatch`; pushing a `v*` tag will build and attach artifacts to a GitHub Release).

## Key commands in chat
- `/sub marketplace` — list plugins
- `/sub install <id>` — install plugin
- `/sub agents` — list installed agents + skills
- `/sub run <agent_id> <task> [--skills skill1,skill2]` — run a sub-agent manually
- `/prompt` — view/override system prompt
- `/summary` — inspect/force auto summary (`/summary now`)
- `/tool [id]` — show latest tool outputs

## MCP tools (main vs sub-agent)
- Main agent tool whitelist: `invoke_sub_agent`, `get_current_time`, `mcp_project_files_*`, `mcp_subagent_router_*`, `mcp_task_manager_*` (other MCP servers are sub-agent-only unless enabled for main).
- Sub-agents: all registered tools (filesystem, shell, sessions, task_manager, subagent_router, etc.).

## MCP server configuration
- File: `~/.deepseek_cli/chatos/auth/mcp.config.json`
- In chat: `/mcp` (show), `/mcp_set` (edit), `/mcp_tools` (enable tools per model)
- Built-in: `chrome_devtools` (disabled by default, sub-agent-only). Enable it in the UI (Admin → MCP Server 管理) if you want browser automation/debugging.
- Endpoint formats:
  - Stdio (spawn): `cmd://node /abs/path/server.js ...` or plain `npx -y <pkg> ...`
  - HTTP: `http(s)://host/path` (Streamable HTTP; falls back to SSE for legacy servers)
  - WebSocket: `ws(s)://host/path`

### Shell MCP (long commands)
- `mcp_shell_tasks_run_shell_command` — short/finite commands.
- `mcp_shell_tasks_session_run` — start/reuse a long-running session.
- `mcp_shell_tasks_session_capture_output` — fetch recent session output.

## Summary behavior
- Threshold (approx tokens): default 60000 or `MODEL_CLI_SUMMARY_TOKENS`.
- When triggered, history is pruned to: system prompt + latest summary + current user message.
- Sub-agents also prune with same pattern.
- Summary prompt file: `~/.deepseek_cli/chatos/auth/summary-prompt.yaml` (supports `{{history}}`; use `/summary prompt` to view).

## Structure
Paths are relative to the AIDE engine root (desktop installs default to `~/.deepseek_cli/chatos/aide`):
```
src/engine/src/           # CLI core, chat loop, prompts, MCP runtime
src/engine/subagents/     # marketplace + plugins (python, spring-boot, frontend-react)
src/engine/mcp_servers/   # shell server with session tools, others unchanged
README.en.md / README.zh.md
```

## Customize system prompt
- Main prompts:
  - `~/.deepseek_cli/chatos/auth/system-prompt.yaml` (`internal_main`, built-in read-only)
  - `~/.deepseek_cli/chatos/auth/system-default-prompt.yaml` (`default`, built-in read-only)
  - `~/.deepseek_cli/chatos/auth/system-user-prompt.yaml` (`user_prompt`, editable)
- Sub-agent prompts:
  - `~/.deepseek_cli/chatos/auth/subagent-system-prompt.yaml` (`internal_subagent`, built-in read-only)
  - `~/.deepseek_cli/chatos/auth/subagent-user-prompt.yaml` (`subagent_user_prompt`, editable)

## Environment hints
- Recommended: set `DEEPSEEK_API_KEY` in the Desktop UI (Admin → API Keys). It is stored in `~/.deepseek_cli/chatos/chatos.db.sqlite`.
- Model API keys are resolved from the UI-managed secrets only (Admin → API Keys); shell/system env vars are ignored for model calls.
- For request logging: `MODEL_CLI_LOG_REQUEST=1`.
- For retries: `MODEL_CLI_RETRY=<n>`.
- MCP tool timeout override: `MODEL_CLI_MCP_TIMEOUT_MS` (default 600000) / `MODEL_CLI_MCP_MAX_TIMEOUT_MS` (default 1200000, max 30m).

## Troubleshooting
- **Permission errors writing reports**: fix `~/.deepseek_cli/chatos` ownership (`chown -R $(whoami) ~/.deepseek_cli/chatos`) or run in a writable env.
- **Tool not registered**: ensure main agent tool whitelist has the MCP prefix you expect (shell tools are intentionally blocked on main).
- **`mcp_*` request timed out**: long MCP tools (sub-agents, shell) now allow 10m by default; bump via the env vars above if a task still cancels early.
- **Long commands timing out**: use `session_run` + `session_capture_output`.
- **History too long**: rely on auto-prune or `/reset` to start fresh.
- **Windows “stdin closed” / can’t type**: reopen a new terminal and retry; try `cmd /c "chatos-desktop chat"` (legacy desktop installs used `chatos`); set `MODEL_CLI_FORCE_CONSOLE_STDIN=1` to force console stdin; if you want the UI to be the only message source, set `MODEL_CLI_DISABLE_CONSOLE_STDIN=1` or use headless UI terminals (`MODEL_CLI_UI_TERMINAL_MODE=headless`).
- **Windows garbled Unicode output**: your console code page is likely not UTF-8 (65001). Run `chcp 65001` before starting; the CLI also tries to switch to UTF-8 at startup (disable via `MODEL_CLI_DISABLE_WIN_UTF8=1`).

## License
MIT (same as upstream). See `LICENSE`.
