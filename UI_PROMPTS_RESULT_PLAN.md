# UI Prompts Result (Markdown) – Executable Plan

## Goal
Add a new UI Prompts `prompt.kind="result"` so apps can publish a final execution result via the smiley panel. The result should render as Markdown in ChatOS UI. Also update scaffold protocol docs to reflect the new kind.

## Current Code Touchpoints
- UI Prompt list + selection: `chatos/apps/ui/src/components/UiPromptsSmileHub.jsx`
- Prompt renderer: `chatos/apps/ui/src/features/session/floating-island/FloatingIslandPrompt.jsx`
- UI Prompts protocol doc: `CHATOS_UI_PROMPTS_PROTOCOL.md`
- DevKit scaffold protocol docs:
  - `chatos-uiapps-devkit/templates/basic/docs/CHATOS_UI_PROMPTS_PROTOCOL.md`
  - `chatos-uiapps-devkit/templates/notepad/docs/CHATOS_UI_PROMPTS_PROTOCOL.md`
- DevKit sandbox UI Prompts mock: `chatos-uiapps-devkit/src/sandbox/server.js`

## Proposed Spec (Result Prompt)
### Request
```
{
  "kind": "result",
  "title": "执行结果",
  "message": "可选说明",
  "source": "com.example.plugin:app",
  "allowCancel": true,
  "markdown": "## Done\n- item 1\n- item 2"
}
```

### Response
```
{ "status": "ok" }
```

Notes:
- `markdown` is the primary field for result content.
- `allowCancel` can hide the dismiss button if needed, but UI should always provide a way to close the result (by sending a response).

## Implementation Plan
1) **UI selection / title**
   - Update `UiPromptsSmileHub` to treat `result` as a valid prompt kind.
   - Add title mapping for `kind="result"` (e.g., "执行结果").

2) **Markdown rendering**
   - In `FloatingIslandPrompt`, add a `result` render path that uses `MarkdownBlock` to display `prompt.markdown`.
   - Provide a single confirm/dismiss button that calls `uiPrompts.respond({ status: "ok" })` to clear the pending entry.

3) **Sandbox support**
   - Extend DevKit sandbox `renderPrompts()` to handle `kind="result"` so sandbox can display the result payload.
   - Display content as markdown-like (at least readable raw text in sandbox if full rendering is not available).

4) **Protocol docs**
   - Add `kind="result"` to the root protocol doc and both DevKit template protocol docs, including request/response fields.

## Acceptance Checklist
- UI prompt list shows "执行结果" with `kind=result`.
- Clicking a result item renders Markdown in the right panel (smiley UI).
- Dismiss button writes a `response` entry and removes the pending item.
- Sandbox can show result content without crashing.
- Docs in root + templates mention the new `result` kind.
