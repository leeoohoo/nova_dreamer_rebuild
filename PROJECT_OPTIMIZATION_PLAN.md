# Project Optimization Plan

Goal: address the four agreed improvement items in order, with focus on config isolation (agent/灵动岛), de-duplication, and build hygiene.

## 1) MCP Config Isolation + Single Source of Truth
- Status: done
- Ensure agent and 灵动岛 follow their own config; remove conflicting/extra MCP config sources.
- Align root/engine MCP config files so they no longer diverge.
- Seed admin DB from the same MCP config file used at runtime.
- Removed environment overrides for land_config and UI terminal mode, and forced the ChatOS host app in CLI entrypoints so runtime settings stay authoritative.

## 2) Subagent Command De-duplication
- Status: done
- Move identical command instructions into a shared location.
- Update plugin manifests to point at the shared commands.

## 3) Stable AIDE-UI Entry Point
- Status: done
- Add a stable `aide-ui` entry point/alias.
- Update shims/build to reduce deep relative path coupling.

## 4) Rebuild Dist Outputs
- Status: done
- Regenerate UI/CLI UI bundles to remove stale paths and confirm build integrity.
