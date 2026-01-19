# Module Migration Map

Scope: reorganize ChatOS sources by moving domain directories out of `chatos/src` into `chatos/packages` while keeping runtime entry shims stable.

## Directory Moves

| Old path | New path | Notes |
| --- | --- | --- |
| chatos/src/common | chatos/packages/common | Shared UI/runtime utilities (state-core, admin-data, terminal, aide-ui, ui). |
| chatos/src/configs | chatos/packages/configs | Config import/validation/sync helpers. |
| chatos/src/core | chatos/packages/core | Session + config application logic. |
| chatos/src/engine | chatos/packages/aide | AIDE engine sources (core, shared, mcp_servers, subagents, cli-ui, apps). |

## Bootstrap Entry Shims (kept in place)

These remain under `chatos/src` but are updated to point at the new `packages` paths.

- chatos/src/cli.js
- chatos/src/engine-paths.js
- chatos/src/aide-paths.js
- chatos/src/session-root.js

## Rewrite Rules (for imports/config)

- `src/engine` -> `packages/aide`
- `src/common` -> `packages/common`
- `src/configs` -> `packages/configs`
- `src/core` -> `packages/core`

## Validation Checklist

- No references to `chatos/src/engine` remain outside `packages/aide`.
- Build scripts and MCP configs point at `packages/aide`.
- UI and CLI re-exports reference `packages/common/aide-ui`.
- `package.json` files/resources include `packages/**` paths.
