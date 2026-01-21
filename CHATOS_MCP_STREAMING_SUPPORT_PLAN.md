# ChatOS MCP Streaming Support Plan

## Context
- The DevKit sandbox now relays MCP notifications (e.g. codex_app.window_run.stream/done/completed) via SSE.
- ChatOS runtime (packages/aide/src/mcp/runtime.js) currently connects MCP servers but does NOT register any notification handlers.
- ChatOS UI consumes:
  - chat:event (Electron -> UI) for chat stream/tool_result updates
  - events.jsonl (session events) for the Session view / Event stream UI

## Goal
Provide the same streaming MCP notification support in ChatOS (desktop app + UI):
- Capture MCP JSON-RPC notifications from MCP servers during tool runs.
- Persist them to the events log and/or forward them to UI in real time.
- Make them visible in UI (Session Event stream, and optionally a chat-side indicator/panel).
- Support codex_app stream payloads (structured events, final text chunks, done/completed markers).

## Proposed changes (backend/runtime)
1) Register MCP notification handlers in the MCP runtime
   - File: chatos/packages/aide/src/mcp/runtime.js
   - Add a helper similar to the DevKit sandbox:
     - Register LoggingMessageNotificationSchema (notifications/message)
     - Register custom notification methods used by codex_app:
       - codex_app.window_run.stream
       - codex_app.window_run.done
       - codex_app.window_run.completed
     - The handler should call:
       - eventLogger.log('mcp_stream', { server, method, params }) (if eventLogger is provided)
       - and/or runtimeOptions.onNotification(notification) for UI streaming
   - This keeps transport independent (stdio/http/ws) and works for all MCP servers.
   - Capture the following fields when present in params:
     - requestId, rpcId, windowId, runId
     - event (structured), text (display string)
     - final, finalTextChunk, finalText, chunkId, chunkIndex, chunkCount
     - done, status, finishedAt

2) Wire the notification callback from ChatOS Electron runtime
   - File: chatos/electron/chat/runner.js (ensureMcp)
   - Provide a runtime option on initializeMcpRuntime, e.g. onNotification:
     - sendEvent({ type: 'mcp_stream', sessionId, payload: { server, method, params } })
   - Map runId if available in params to route the stream to the current session/run.
   - Optional: also append to events.jsonl by reusing terminal-manager.appendEventLog or a lightweight event logger.
   - Note: tools/call returns immediate ack; streaming is only via notifications after that.

3) CLI path (optional but consistent)
   - File: chatos/cli/src/index.js
   - eventLogger already exists; ensure runtime logs mcp_stream events so they appear in events.jsonl.

## Proposed changes (UI)
1) Session Event stream view (events.jsonl)
   - File: chatos/packages/common/aide-ui/lib/events.js
     - Add meta for new event types: mcp_stream, mcp_log, mcp_done (optional)
   - File: chatos/packages/common/aide-ui/lib/event-markdown.js
     - Render stream payload nicely (prefer params.text if present, fallback to JSON)
     - If finalTextChunk is present, optionally assemble finalText by chunkId+chunkIndex
     - If event exists, show a compact summary (event.type / item.status / item.command)
   - This makes streaming visible in Session -> Events panel and ToolDrawer if desired.

2) Chat view (real-time)
   - File: chatos/packages/common/aide-ui/features/chat/hooks/useChatSessions.js
     - Handle chat:event type 'mcp_stream'
     - Append the stream to a lightweight UI buffer (e.g., per session) and show in a small panel or inline system message
   - File: chatos/packages/common/aide-ui/features/chat/components/ChatMessages.jsx (or a new small component)
     - Render the MCP stream buffer, collapsed by default to avoid chat noise
   - Include a simple run status badge based on done/completed notifications.

## UI behavior recommendations
- Default to showing MCP stream in the Session Event stream (safe + unobtrusive).
- Optional in chat view: a collapsible "MCP Stream" card per session/run.
- Filter out stream after done/completed by runId to avoid post-completion noise.
- When finalTextChunk is used, show a stitched "Final Summary" block once chunkCount is satisfied.
- Only the stitched finalTextChunk content should be injected into the next AI turn; all other stream events are display-only.

## Files to review/update
- chatos/packages/aide/src/mcp/runtime.js
- chatos/electron/chat/runner.js
- chatos/cli/src/index.js (optional)
- chatos/packages/common/aide-ui/lib/events.js
- chatos/packages/common/aide-ui/lib/event-markdown.js
- chatos/packages/common/aide-ui/features/chat/hooks/useChatSessions.js
- chatos/packages/common/aide-ui/features/chat/components/ChatMessages.jsx (or new component)

## Implementation steps
1) Add notification registration in mcp runtime and emit mcp_stream events.
2) Extend Electron chat runner to pass onNotification and map to chat:event.
3) Update events metadata + markdown renderer for mcp_stream.
4) (Optional) Add chat UI stream panel using chat:event.
5) Verify with codex_app MCP server: stream -> done/completed -> UI stops.
6) Verify finalTextChunk assembly across chunkIndex ordering (out-of-order safe).

## Validation checklist
- MCP server emits codex_app.window_run.stream notifications -> events.jsonl updated.
- Session Events view shows stream entries in order with readable text.
- Chat view shows optional stream panel (if implemented).
- done/completed sets status and no extra UI spam after completion.
