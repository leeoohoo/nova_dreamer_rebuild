# ChatOS App Scaffold

Reusable scaffold for building ChatOS UI apps that integrate MCP tools with async task flow.

## Highlights
- MCP server template (stdio, no external deps) with async task ack flow.
- Task manager with queue, status tracking, timeouts, and retry hooks.
- State manager with persistence for sessions + tasks.
- UI prompts helper for writing `ui-prompts.jsonl` result entries.
- Vue UI skeleton with session status indicators.
- Sandbox runner to validate the MCP async flow end-to-end.

## Async MCP Flow (taskId + ui-prompts)
1. Host injects `taskId` into `_meta` when calling MCP tools.
2. MCP server ACKs immediately and enqueues the task.
3. Task completion writes a `ui_prompt` request entry (kind=`result`) to `ui-prompts.jsonl`.
4. Host polls `ui-prompts.jsonl`, detects completion, and finishes the tool call.

## Project Layout
- `src/`: app entrypoints, MCP server, backend, and shared libs.
- `src/lib/`: async-task manager, state manager, ui-prompts helper, utilities.
- `src/ui/`: Vue UI components (session list + status indicator).
- `sandbox/`: mock host, MCP test server, and test runner.
- `templates/`: starter templates for new apps.
- `scripts/`: build and dev helpers.

## Quick Start
1. Copy this folder as your app workspace.
2. Update `plugin.json` IDs and app metadata.
3. Run `node scripts/build.mjs` to populate `dist/`.
4. Package the plugin root (with `plugin.json` + `dist/`).
5. Run `node sandbox/test-runner.mjs` to validate the async flow.

## Build Notes
- `mcp-server.mjs` uses only Node built-ins (no `node_modules`).
- UI entrypoints import Vue SFCs and need bundling if you target production.
- Update build tooling as needed (Vite/Rollup/esbuild).

## Customization Checklist
- Update tool definitions in `src/mcp-server.mjs`.
- Configure async tool names + taskId key in `plugin.json` (`ai.mcp.callMeta`).
- Adjust UI prompt formatting in `src/lib/ui-prompts.mjs`.
- Add session/task display logic in `src/ui/App.vue`.

## License
MIT (replace if needed).
