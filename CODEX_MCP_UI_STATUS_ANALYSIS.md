# Codex MCP UI Pending Tool Calls Analysis

## Observed behavior
- Tool tag appears only after a UI refresh or fullscreen toggle.
- Session status flips to "ready" even while the codex task is still running.
- Tool tag remains yellow if the codex run has not produced a result yet.

## Root causes
1. Tool calls are persisted to the DB in `onAssistantStep` (chat runner), but no UI event is emitted after the update. The UI only receives `assistant_start` (before toolCalls exist) and `assistant_done`, so tool tags do not show until a later refresh.
2. Running state is tracked only in UI memory (`streamState`). When the user switches views or reloads the UI, that state is lost and the header shows "ready" even if the backend still has an active run.
3. Async codex tasks rely on `ui-prompts.jsonl` to complete. If the codex run is still running, the tool call correctly stays pending; without (1) and (2), this looks like a UI regression.

## Fix applied
- Emit `messages_refresh` when toolCalls are first recorded in `onAssistantStep`, so the tool tag appears immediately.
- Expose active session ids from the backend runner and include `running` in `chat:sessions:list`.
- UI computes `isSessionBusy = streamState || session.running` to keep status and disable input across view changes.

## Files touched
- chatos/electron/chat/runner.js
- chatos/electron/chat/index.js
- chatos/packages/common/aide-ui/features/chat/ChatView.jsx

## Expected result
- Tool tag shows as soon as toolCalls are written.
- Session status stays "running" across view changes while a backend run is active.
- When codex finishes and writes the result, the tool tag turns purple with the final output.
