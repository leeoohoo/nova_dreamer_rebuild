# Analysis (pre-task)
Goal: fix the sandbox MCP Send flow so it matches ChatOS asyncTask behavior. The Codex MCP tool expects taskId in _meta when asyncTask is configured. In ChatOS, the runtime injects taskId and waits/polls ui-prompts.jsonl for the final result. The sandbox currently calls MCP tools directly without this injection, causing the -32602 error. We'll add asyncTask normalization + taskId injection + ui-prompts polling in the sandbox server tool-call path.

# Tasks
1) Add asyncTask helper functions (normalize config, generate taskId, poll ui-prompts) in chatos-uiapps-devkit/src/sandbox/server.js.
2) Update runSandboxChat tool-call logic to inject taskId into _meta when asyncTask applies, and return polled ui-prompts result (matching ChatOS).
3) Validate the file syntax.
