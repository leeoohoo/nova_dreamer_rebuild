# Analysis (pre-task)
Goal: align the sandbox UI Prompts panel and host.uiPrompts APIs with the file-based ui-prompts.jsonl flow so developers see the same data that polling reads. This requires rendering prompts from file entries when available and ensuring UI responses are appended to file.

Key anchors:
- renderPrompts and entries store in chatos-uiapps-devkit/src/sandbox/server.js.
- file-based ui-prompts.jsonl read/append endpoints already added.

# Tasks
1) Update renderPrompts to accept an explicit entries list.
2) Add refreshUiPromptsFromFile to read file entries and re-render/notify listeners.
3) Update emitUpdate and panel open logic to prefer file entries.
4) Ensure UI prompt responses append to ui-prompts.jsonl.
