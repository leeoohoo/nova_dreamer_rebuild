# MCP Prompt

You can call `app_task_run` to start an async task.

Guidelines:
- The host injects `taskId` via `_meta`. Do not fabricate it.
- The tool returns an ACK immediately; wait for the final tool result.
- Be explicit about expected output so the async worker can produce a concise result.
