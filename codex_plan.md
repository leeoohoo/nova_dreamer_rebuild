# Analysis (pre-task)
Goal: add developer-facing protocol documentation for asyncTask-based polling, and extend the devkit sandbox MCP Test UI with a dedicated async-task test button that simulates ACK + uiPrompts result placement.

Key anchors in code:
- Sandbox uiPrompts store and host API in chatos-uiapps-devkit/src/sandbox/server.js (entries array + uiPrompts.request).
- ChatOS asyncTask + polling rules in chatos/packages/aide/src/mcp/runtime.js (taskId injection + prompt.kind=result matching).
- Template docs live in templates/*/docs; overview docs list should include the new protocol doc.

# Tasks
1) Add an asyncTask polling protocol doc to template docs (basic + notepad) and link it from the overview.
2) Extend sandbox MCP Test panel with an asyncTask test action that:
   - Generates taskId and ACK payload
   - Writes a ui_prompt request with prompt.kind=result
   - Surfaces status/output in MCP panel
3) Keep codex_plan.md in repo root.
