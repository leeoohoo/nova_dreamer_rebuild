# Dynamic MCP workdir plan

## Current behavior (why workdir feels stale)
- UI app scanning sets a default `callMeta.workdir` from plugin/data/project/session roots at scan time.
  - `electron/ui-apps/ai.js:81`
- MCP tools merge `callMeta` once at registration time, so the workdir is effectively fixed for the life of the MCP runtime.
  - `packages/aide/src/mcp/runtime.js:584`
- Chat runtime computes `workspaceRoot` per run (agent first, then session), but UI app `callMeta.workdir` overrides it.
  - `electron/chat/runner.js:559`

## Desired precedence
1) Floating island override (if explicitly configured for the current call).
2) Agent `workspaceRoot`.
3) Session `workspaceRoot`.
4) Fallback to app cwd.

## Proposed changes
1) Remove static UI app workdir defaults
   - Drop the default `workdir` in `buildUiAppCallMeta` so only explicit plugin configs define it.
     - `electron/ui-apps/ai.js:81`
   - When syncing UI app MCP servers into Admin DB, do not persist default `callMeta.workdir`.
     - `electron/ui-apps/ai.js:328`

2) Compute workdir per tool call (not at registration time)
   - Move `buildCallMeta` into the tool handler so workdir can be resolved dynamically on each call.
     - `packages/aide/src/mcp/runtime.js:584`
   - Add a helper to resolve workdir from `toolContext` (floating island override) and then fallback to runtime workspace root.

3) Propagate workdir context through the tool call stack
   - Pass effective workdir from chat runner into chat options.
     - `electron/chat/runner.js:559`
     - `packages/aide/src/chat-loop.js:479`
   - Include `workdir` in `toolContext` when calling `target.handler`.
     - `packages/aide/src/client.js:149`

4) Add floating island override plumbing
   - Persist a runtime setting for floating island cwd (e.g., `uiPromptWorkdir`).
     - `packages/common/admin-data/schema.js:267`
     - `packages/common/admin-data/services/settings-service.js:39`
   - When user picks/clears cwd in FloatingIsland, save it via existing `admin:settings:save`.
     - `packages/common/aide-ui/features/session/FloatingIsland.jsx:19`
   - In chat runner, if a floating island override is present for the current call, prefer it over agent/session roots.
     - `electron/chat/runner.js:559`

## Validation checklist
- Switching agents with different `workspaceRoot` updates codex app MCP workdir immediately.
- Clearing agent `workspaceRoot` falls back to session `workspaceRoot`.
- Setting floating island cwd overrides both agent and session for the current call.
- Explicit plugin-provided `callMeta.workdir` still takes precedence when configured.
