# Analysis (pre-task)
Goal: extend the devkit sandbox AsyncTask test so it simulates ChatOS polling and returns the uiPrompts result in the MCP Test output. The current AsyncTask Test only writes a result entry; we need a polling loop that matches the same rules as ChatOS (type=ui_prompt, action=request, prompt.kind=result, requestId in [taskId, mcp-task:taskId]) and then displays the final text.

Key anchors:
- Sandbox uiPrompts storage in chatos-uiapps-devkit/src/sandbox/server.js (entries array).
- ChatOS polling rules in chatos/packages/aide/src/mcp/runtime.js (extractUiPromptResult / waitForUiPromptResult).

# Tasks
1) Add a polling helper in sandbox client code to mirror ChatOS matching rules.
2) Update AsyncTask Test to start polling after ACK and print the matched result.
3) Keep codex_plan.md in repo root.
