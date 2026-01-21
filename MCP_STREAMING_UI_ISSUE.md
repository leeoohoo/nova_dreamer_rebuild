# Codex App MCP Streaming UI Render Issue

## Symptom
- Calling the codex_app MCP tool (codex_app_window_run) produces no streaming updates in the chat UI.

## Analysis
1) Stream notifications do not carry a sessionId.
   - The MCP server emits codex_app.window_run.stream notifications with requestId/rpcId/windowId/runId but no sessionId.
   - Source: chatos/doc/codex_app/plugin/apps/codex_app/mcp-server.mjs:348
   - The chat runner only forwards mcp_stream to the UI if it can resolve a sessionId (params.sessionId or a single active run).
   - Source: chatos/electron/chat/runner.js:588
   - codex_app_window_run is async and returns immediately, so the chat run can finish before stream events arrive. When activeRuns is empty, resolveMcpSessionId returns '', and the stream is dropped.

2) SessionId attachment depends on rpcId and tracker state.
   - The MCP runtime tries to attach sessionId to notifications by matching params.rpcId against a pending stream tracker entry.
   - Source: chatos/packages/aide/src/mcp/runtime.js:119
   - If rpcId is not numeric (string) or the tracker entry was never created, sessionId is never attached, causing the same drop in the chat runner.

## Tasks
1) Confirm routing failure
   - Inspect events log for mcp_stream_unrouted entries during codex_app_window_run.
   - Verify notification params include rpcId/runId/windowId.

2) Ensure sessionId is always available for routing
   - Option A: Propagate sessionId from the tool call into codex_app MCP notifications (read from params._meta in the MCP server and include it in stream payloads).
   - Option B: In the chat runner, maintain a mapping from rpcId (or requestId) to sessionId when the tool call is issued and use it in resolveMcpSessionId.

3) Harden the rpcId/sessionId attachment
   - If rpcId can be a string, normalize it to a number (or accept numeric strings) before lookup in the stream tracker.

4) Verify UI behavior
   - Run codex_app_window_run and confirm chat:event receives mcp_stream with sessionId.
   - Confirm McpStreamPanel renders incremental items and finalText.
