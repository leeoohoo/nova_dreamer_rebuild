# Analysis (pre-task)
Goal: extend the devkit sandbox AsyncTask test to poll results from the ui-prompts.jsonl file (file-based), mirroring ChatOS behavior. This requires server-side endpoints to append/read ui prompts from disk, client-side hooks to write entries to file, and polling that reads from file rather than in-memory entries.

Key anchors:
- Sandbox client uiPrompts store in chatos-uiapps-devkit/src/sandbox/server.js (entries array + host.uiPrompts).
- Sandbox server request handler in chatos-uiapps-devkit/src/sandbox/server.js (add /api/ui-prompts/read + /api/ui-prompts/append).
- ChatOS asyncTask + polling rules in chatos/packages/aide/src/mcp/runtime.js.

# Tasks
1) Add server-side ui-prompts.jsonl helpers and API endpoints for append/read.
2) Update sandbox client uiPrompts.request/respond to persist entries to file via API.
3) Update AsyncTask polling to read from file API (fallback to memory if needed).
4) Update sandbox paths to include ui-prompts.jsonl location.
