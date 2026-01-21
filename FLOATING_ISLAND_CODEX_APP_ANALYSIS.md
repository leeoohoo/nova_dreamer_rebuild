# Floating Island Codex App Configuration Review

## Scope
Review how the Floating Island handles configuring a Codex UI App and identify gaps plus improvements.

## Current behavior (code path summary)
- Floating Island only lets users select land_config at runtime. It does not surface per-app configuration or any Codex-specific handling.
  - UI entry: chatos/packages/common/aide-ui/features/session/FloatingIsland.jsx
  - It blocks dispatch if land_config is missing or invalid, but does not validate app-specific MCP mappings.
- Codex app (or any UI app with MCP) is configured in the Land Config manager, not in Floating Island.
  - Admin UI: chatos/apps/ui/src/features/land-configs/LandConfigsManager.jsx
  - Apps shown here are filtered by app.ai.mcp.url and stored as flow.apps.
- Land config resolution maps apps to MCP servers via server name or tag matching.
  - Core logic: chatos/packages/aide/src/land-config.js
  - flow.apps is converted into selected MCP servers by matching server.name or server.tags against uiapp:pluginId.appId.
  - Missing app-to-server mappings are tracked as missingAppServers but are only logged by CLI.
- Runtime uses the selected land config to filter which MCP servers are available to the main/sub flow.
  - CLI flow: chatos/cli/src/index.js
  - Electron runtime uses the same land_config plus MCP selection pattern before initializing MCP runtime.

## Observed gaps for Codex app in Floating Island
1) No visibility of Codex app selection or status in Floating Island.
   - Users can pick land_config, but cannot see which apps (Codex) are enabled by that config.
2) No UI warning when Codex app has no matching MCP server.
   - missingAppServers is logged in CLI only; UI does not surface this.
3) No quick path to fix config.
   - If Codex app is missing a matching MCP server, user has to manually navigate to Admin > land_configs.
4) No per-app streaming or debug toggle at the UI level.
   - Streaming is handled by MCP runtime, but Floating Island does not expose any Codex-specific controls.

## Improvement ideas
### A) Make app selection visible in Floating Island
- Show a compact summary for the selected land_config:
  - Selected apps (for example Codex), MCP servers, prompts.
  - A warning badge if any app has missing MCP servers.
- Source of truth: land config record plus buildLandConfigSelection output.

### B) Surface missing app MCP mappings
- Bubble missingAppServers into UI via runtime status or admin state.
- Show a warning tag in Floating Island when Codex app is selected but MCP server not resolved.
- Optional: block dispatch when a required UI app MCP is missing.

### C) Add a quick-link to Land Config manager
- Provide a button in Floating Island: Edit land_config -> open Admin land_configs.
- This reduces friction when Codex app needs to be wired.

### D) Optional Codex app diagnostics
- Add a lightweight Test Codex MCP action (similar to DevKit) that runs a dry tools/list and reports status.
- This confirms the MCP server mapping is correct before running.

## Suggested follow-up implementation points
- UI: chatos/packages/common/aide-ui/features/session/FloatingIsland.jsx (display summary plus warnings plus link)
- Backend: expose missingAppServers for current land_config in session payload, or compute in Electron runtime and send via IPC
- Admin UI: optionally show app-to-server mapping status in LandConfigsManager

## Notes
- No Codex-specific logic exists in Floating Island today; it inherits whatever land_config selects.
- Codex app enablement relies on MCP server name or tag matching; this is fragile if server tags are missing.
