# AIDE

Standalone npm package (CLI + Electron UI).

## Install
```bash
npm i -g @leeoohoo/aide
```

## CLI
```bash
aide chat
```

## UI
```bash
aideui
```

## Dev
```bash
npm install
npm run ui
```

## ChatOS Desktop: AIDE Engine Package (.zip)
ChatOS desktop can install the AIDE engine from a directory or a `.zip` (Apps → 安装 AIDE 引擎). To build a minimal `.zip` (no `node_modules`):

```bash
node scripts/pack-chatos-engine.js
```

Output: `dist_engine/aide-engine-<version>.zip`

## MCP: Island Chat Server (stdio)
This repo includes an MCP server that lets you send messages into an AIDE run via the Electron UI “灵动岛” channel, while streaming the run event log back via MCP notifications.

```bash
node mcp_servers/aide-island-chat-server.js --name aide_island_chat
```

- Tool: `island_chat` (`text`, optional `run_id`, `cwd`, `force`, `timeout_ms`, plus runtime toggles like `confirm_main_task_create`, `ui_terminal_mode`)
- Tool: `list_sessions` (returns known `run_id` list + status)
- Tool: `get_session_summary` (`run_id`, returns latest summary from the event log)
- Prompt: `aide_island_chat` (MCP prompt; optional arg `language`: `zh` | `en`)
- Streaming: emitted as MCP `notifications/message` (structured JSON), tied to the active request.

Note: In this workspace `aide/node_modules` may be a symlink to `../deepseek_cli/node_modules` to share dependencies; for a standalone checkout just run `npm install` inside `aide/`.

## MCP: Code Maintainer Server (stdio)
Read/write codebase safely within a `--root`, with extra utilities beyond `filesystem-server.js`.

```bash
node mcp_servers/code-maintainer-server.js --root . --write --name code_maintainer
```

- Base tools: `list_directory`, `read_file`, `search_text`, `write_file`, `edit_file`, `delete_path`, `apply_patch`
- Extra tools: `read_file_raw`, `read_file_range`, `stat_path`, `move_path`, `copy_path`

## MCP: LSP Bridge Server (stdio)
Bridge to local Language Servers (LSP) to get semantic features (hover/definition/completion/diagnostics) for many mainstream languages.

```bash
node mcp_servers/lsp-bridge-server.js --root . --name lsp_bridge
```

- Config: pass `--config <path>` or create `.deepseek_cli/lsp-servers.json` (see `mcp_servers/lsp-servers.example.json`).
- Note: you must install the language servers yourself (e.g. `typescript-language-server`, `pyright-langserver`, `gopls`, `rust-analyzer`, `clangd`).

## Publish
```bash
npm publish
```
