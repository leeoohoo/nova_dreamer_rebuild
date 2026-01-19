# Install Logging Plan

Goal:
- Provide actionable logs for install-related failures in ChatOS (desktop app) and the UI Apps DevKit.
- Make logs discoverable in the UI and return a logId for each install action.

Log sinks:
- Runtime log (desktop + CLI): <stateDir>/runtime-log.jsonl
- DevKit install log: <stateDir>/devkit-install-log.jsonl

Action ID:
- Each install request generates an actionId (logId) to correlate all entries.

Planned changes:
1. Electron main process install logger (scope INSTALL).
   - Add actionId for uiApps:plugins:install, lsp:install, cli:install/uninstall, subagents install/uninstall.
   - Return logId in IPC responses.
2. UI Apps plugin installer logging.
   - Log input type, plugin root detection, per-plugin copy results, trust record updates.
   - Log failures with error details.
3. LSP installer logging.
   - Log per-item plan selection and per-step results.
   - Include stdout/stderr on failure (or when MODEL_CLI_LOG_INSTALL_OUTPUT=1).
4. UI runtime log viewer.
   - Add a lightweight modal that reads runtimeLog:read.
   - Filter by actionId where provided and expose log path.
5. DevKit install logging.
   - Write a jsonl log for chatos-uiapp install with actionId, inputs, and results.

Notes:
- stateDir is resolved by ChatOS: <home>/.deepseek_cli/<hostApp>
- runtime log entries are JSONL: { ts, level, message, runId, scope, meta, error }
