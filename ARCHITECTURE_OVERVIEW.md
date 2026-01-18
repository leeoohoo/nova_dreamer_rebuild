# Nova Dreamer / ChatOS Architecture Overview

This document is a concise, code‑oriented map of the system. It focuses on responsibilities, data flow, and key entry points.

## 1) Components and Responsibilities

| Component | Responsibility | Primary location |
|---|---|---|
| **ChatOS (Host)** | Desktop shell, UI, admin panel, plugin loading, registry, config application | `chatos/electron/`, `chatos/apps/ui/` |
| **AIDE (Engine)** | Model runtime, tools/MCP, sub‑agents, core CLI behaviors | `chatos/src/engine/` |
| **UI Apps (Plugins)** | Embedded apps loaded by host; may provide MCP/Prompts | `chatos/ui_apps/` (built‑ins), user plugins under stateDir |
| **DevKit** | Scaffold, validate, run plugin sandbox | `chatos-uiapps-devkit/` |
| **State Core** | Paths, migration, state/db utilities | `chatos/src/common/state-core/` |
| **Admin Data** | Admin DB + services + sync to mirrors | `chatos/src/common/admin-data/` |

## 2) Runtime Entry Points

- **Electron desktop app**: `chatos/electron/main.js`
  - Loads Admin DB, UI, registry, UI Apps manager, config applier.
- **CLI**: `chatos/src/cli.js`
  - Uses engine config source, admin data, MCP servers.
- **Engine runtime**: `chatos/src/engine/src/*`
  - MCP runtime, tools, sub‑agents, prompts, config source.
- **DevKit sandbox**: `chatos-uiapps-devkit/src/sandbox/server.js`
  - Runs plugin UI with Host API mocks.

## 3) State and Storage (Single Source of Truth)

**State root/dir**: `stateRoot` is the per-user state root; `stateDir = <stateRoot>/<hostApp>`

- **Admin DB** (source of truth): `<stateDir>/<hostApp>.db.sqlite`
- **File mirrors** (synced from DB): `<stateDir>/auth/*.yaml`, `<stateDir>/auth/mcp.config.json`
- **Runtime logs / events**: `<stateDir>/*.jsonl`
- **UI Apps**:
  - Plugins: `<stateDir>/ui_apps/plugins`
  - Data: `<stateDir>/ui_apps/data/<pluginId>`

Note: file/dir names are centralized in `STATE_FILE_NAMES` / `STATE_DIR_NAMES` and resolved via helpers in `state-core/state-paths.js` (avoid hardcoded strings in code).

Compatibility: legacy `legacyStateRoot/<hostApp>/` is auto‑migrated on startup.

## 4) Core Data Flows (Simplified)

### A) Startup (Host)
1. Resolve `sessionRoot` and `stateDir` (auto‑migrate legacy paths).
2. Open Admin DB and services.
3. Sync Admin DB → file mirrors.
4. Initialize UI, registry, and UI Apps manager.

### B) Admin Config Changes
1. UI writes to Admin DB via IPC.
2. Admin services broadcast snapshot.
3. Mirrors are synced to YAML/JSON files.

### C) UI Apps Loading
1. Host scans built‑in + user plugin directories.
2. `plugin.json` is validated (schema + path boundary).
3. App list is exposed to UI and Agent selection.
4. Optional AI contribution sync (MCP/Prompts) is gated by env.

### D) Agent Tool Invocation
1. Agent selects tools (MCP/Prompts) from Admin DB + UI Apps exposure.
2. MCP runtime loads and executes tools.
3. Results are recorded in runtime logs.

## 5) Boundary Rules (High Level)

- **Admin DB is the source of truth**; YAML/JSON are mirrors.
- **Plugins only write to their own `dataDir`**.
- **Path boundaries** are enforced for all plugin‑provided paths.
- **Host app ownership** is strict: each app writes only to its own `stateDir`.

## 6) Where to Look in Code (Practical Index)

- State paths + migration: `chatos/src/common/state-core/state-paths.js`
- Session root marker: `chatos/src/common/state-core/session-root.js`
- Admin DB services: `chatos/src/common/admin-data/`
- Host bootstrap: `chatos/electron/main.js`
- UI Apps manager: `chatos/electron/ui-apps/index.js`
- UI Apps schema: `chatos/electron/ui-apps/schemas.js`
- Engine config source: `chatos/src/engine/src/config-source.js`
- MCP runtime: `chatos/src/engine/src/mcp/runtime.js`
- DevKit sandbox: `chatos-uiapps-devkit/src/sandbox/server.js`
