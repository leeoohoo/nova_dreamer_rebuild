# Analysis (pre-task)
Goal: inspect ChatOS code to identify how it calls the Codex MCP tool and handles asyncTask ACK + polling/backlog, so we can align the sandbox behavior.

# Tasks
1) Locate Codex tool invocation and asyncTask handling in chatos/packages/aide/src/mcp/runtime.js.
2) Find where UI prompts backlog is written/read and how polling matches taskId (likely in chatos/electron or ui prompts utilities).
3) Summarize the actual call flow with code references.
