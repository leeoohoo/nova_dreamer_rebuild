# ChatOS UI Apps：AsyncTask 轮询协议（MCP 调用）

本协议用于描述 **ACK + 交互待办轮询** 的异步 MCP 调用模式。当 `callMeta.asyncTask` 配置命中某个工具时，ChatOS 不走流式通知，而是：

1. 立即接收 MCP ACK（包含 taskId）
2. 后台执行任务
3. 结果写入「交互待办」（`ui-prompts.jsonl`）
4. ChatOS 轮询匹配结果并返回给工具调用

> 关键点：**没有流式通知**，只能通过轮询 `ui-prompts.jsonl` 获取结果。

## 1) 触发条件（callMeta.asyncTask）

当 MCP server 的 `callMeta` 包含 `asyncTask`，且 `tools` 覆盖当前工具名时，ChatOS 会启用轮询模式。

示例：
```json
{
  "asyncTask": {
    "tools": ["codex_app_window_run"],
    "taskIdKey": "taskId",
    "resultSource": "ui_prompts",
    "uiPromptFile": "ui-prompts.jsonl",
    "pollIntervalMs": 1000
  }
}
```

约定字段：
- `tools`: 触发异步模式的 tool 名列表（小写匹配）
- `taskIdKey`: taskId 字段名（默认 `taskId`）
- `resultSource`: 固定 `ui_prompts`
- `uiPromptFile`: 固定 `ui-prompts.jsonl`
- `pollIntervalMs`: 轮询间隔（200-5000ms）

## 2) ACK 规范（MCP 返回）

工具调用应立即返回 ACK，并带上 `taskId`：

```json
{
  "status": "accepted",
  "taskId": "task_123"
}
```

> ChatOS 不会依赖 ACK 的结构完成轮询，但该 ACK 对其它客户端/调试很重要。

## 3) 结果写入（交互待办）

异步结果必须写入 `ui-prompts.jsonl`，格式必须满足以下条件：

- `type = "ui_prompt"`
- `action = "request"`
- `requestId = taskId` 或 `mcp-task:<taskId>`
- `prompt.kind = "result"`

示例：
```json
{
  "ts": "2025-01-01T00:00:00.000Z",
  "type": "ui_prompt",
  "action": "request",
  "requestId": "task_123",
  "prompt": {
    "kind": "result",
    "markdown": "final output"
  }
}
```

`prompt` 文本字段优先级（ChatOS 解析顺序）：
1. `prompt.markdown`
2. `prompt.result`
3. `prompt.content`

## 4) 轮询规则（ChatOS）

ChatOS 会在 `ui-prompts.jsonl` 中按以下规则匹配结果：

- `type === "ui_prompt"`
- `action === "request"`
- `prompt.kind === "result"`
- `requestId in [taskId, "mcp-task:" + taskId]`

匹配成功即返回结果文本给工具调用。

## 5) 沙箱调试（Devkit）

Devkit 沙箱已提供 `uiPrompts` 内存存储与 UI 面板，可用于调试本协议：

- 通过 **MCP Test 面板的 AsyncTask Test** 按钮生成 taskId + 写入结果，并执行轮询匹配
- 在 MCP Output 中可看到轮询命中结果，UI Prompts 面板可看到 result 类型条目
- 沙箱会同时写入 `stateDir/ui-prompts.jsonl`（可在 MCP Test 的 Paths 中查看路径）

## 6) 常见问题

- **轮询超时**：确认 `ui-prompts.jsonl` 中是否有正确格式的 `prompt.kind=result`。
- **找不到结果**：确认 `requestId` 为 `taskId` 或 `mcp-task:<taskId>`。
- **结果为空**：确认 `prompt.markdown/result/content` 至少存在一个文本字段。
