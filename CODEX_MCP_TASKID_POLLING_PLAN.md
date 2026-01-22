# Async MCP Task Flow (TaskId Contract, Host Poller)

## Background (current failure)
- Codex MCP streaming is unreliable (tool call stays yellow, chat run stops) because the runtime waits for final stream text that is often missing or not routed correctly.
- Runs can stay `running` in the Codex state file, so completion notifications are not emitted.
- Result: the tool call never resolves, the chat cannot continue.

## New direction (no streaming, no AI-driven polling)
Define a **generic async MCP flow** for any UI app that requires a `taskId` (like `projectRoot` in `_meta`):
- MCP server only returns an immediate ack.
- Chat runtime **keeps the tool call pending** (yellow) and **polls the “交互待办” log** programmatically (no extra MCP tools, no LLM polling).
- When the task finishes, the runtime injects the final result as the tool output and the chat continues.

## Async task contract (app-side)
When an app wants async behavior, it must:
1) Require `_meta.taskId` (string, non-empty) for the async tool.
2) Use `taskId` as the request/task id.
3) Write a **UI prompt result** into the 交互待办 log (`ui-prompts.jsonl`):
   - `type: "ui_prompt"`, `action: "request"`
   - `requestId: <taskId>` (or fallback mapping, see below)
   - `prompt.kind: "result"` with `prompt.markdown` as the final output

### Task store (optional but recommended)
Apps can also persist task state/results into a local task store for debugging and richer status:

### Standard task store (recommended schema)
Use the existing Codex format (already in place):
- File: `<dataDir>/<stateFileName>` (e.g. `codex_app_state.v1.json`)
- Field: `mcpTasks: []`
- Each task:
  - `id`, `status` (`queued|running|completed|failed|aborted`)
  - `resultText`, `resultStatus`, `error`, `startedAt`, `finishedAt`

Codex already implements this in:
- `chatos/doc/codex_app/plugin/backend/lib/mcp-tasks.mjs`
- `chatos/doc/codex_app/plugin/backend/lib/state-store.mjs`

## Host-side async handler (no new MCP polling tool)
Implement a **host poller** inside the MCP runtime to resolve async tools by reading the 交互待办 log.

### Where to implement
File: `chatos/packages/aide/src/mcp/runtime.js`

### Detection (how to know a tool is async)
Use server-level config injected via `callMeta` (works for UI apps today):
- In the app’s `plugin.json`, add an async hint under `ai.mcp.callMeta.asyncTask`
- Example:
  ```
  "ai": {
    "mcp": {
      "entry": "codex_app/mcp-server.mjs",
      "callMeta": {
        "asyncTask": {
          "tools": ["codex_app_window_run"],
          "taskIdKey": "taskId",
          "resultSource": "ui_prompts",
          "uiPromptFile": "ui-prompts.jsonl"
        }
      }
    }
  }
  ```

This avoids modifying MCP tool schemas and keeps `taskId` out of AI-visible arguments.

### Runtime flow (per tool call)
1) **Generate taskId** (host-side) and inject into `_meta` (like `projectRoot`).
2) Call the tool → expect immediate ack.
3) Start polling **交互待办日志** (`ui-prompts.jsonl`) under `_meta.chatos.uiApp.stateDir`.
4) Find a `ui_prompt` **request** entry where:
   - `requestId === taskId` (preferred), or `requestId === "mcp-task:" + taskId` (legacy fallback)
   - `prompt.kind === "result"`
5) Return `prompt.markdown` (or `prompt.result/content`) as tool output.

Note: do **not** wait for the user to click “知道了”; the request entry itself is the completion signal.

### Notes
- Respect `AbortSignal` so user abort stops polling.
- Increase or disable tool timeouts for async tasks
  (see `chatos/packages/aide/src/mcp/runtime/timeouts.js`).
- Optional: keep a file offset/cache per session to avoid re-parsing full `ui-prompts.jsonl`.
- Optional: support legacy `requestIdPrefix` (e.g. `mcp-task:`) for tasks created before the switch.
- Optional: if task store exists, use it for status/error details but still use UI prompt as the completion signal.

## Codex MCP server changes (app-side)
File: `chatos/doc/codex_app/plugin/apps/codex_app/mcp-server.mjs`
- Require `_meta.taskId`.
- Use it as `requestId` in `appendStartRunRequest`.
- **Disable streaming notifications** for this tool.
- Return immediate ack (e.g., `toolResultText('调用成功')`).

## Codex backend alignment
Codex already writes a `result` prompt into `ui-prompts.jsonl` and now uses taskId directly as `promptRequestId`.
If you still need to read older tasks, keep a legacy `requestIdPrefix` fallback in the host poller.

## Session switching / UI
- The tool call remains pending in the active chat run; switching sessions does not cancel it.
- Codex already writes a UI prompt result (smiley panel) for the same task.
- Optional: persist pending tool-call → taskId mapping if you want resume after app restart.

## Validation checklist
1) Call async tool without `_meta.taskId` → server rejects.
2) Call with `taskId` → tool call stays pending (yellow).
3) When task finishes, tool result equals `prompt.markdown` (or `prompt.result/content`) from the 交互待办 entry.
4) Smiley panel shows the same task completion output.
5) Switching sessions does not stop completion.
