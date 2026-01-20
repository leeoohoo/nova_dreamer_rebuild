# 对话超长自动总结改进方案

## 现状与问题
- UI 聊天的请求路径在 `chatos/electron/chat/runner.js` 中直接把 store.messages 拼成 ChatSession 并发送给模型，没有接入自动总结与裁剪逻辑，导致上下文超限后持续报错。
- 现有总结逻辑只在 CLI 引擎内实现（`chatos/packages/aide/src/chat/summary.js`、`chatos/packages/aide/src/chat/context-recovery.js`），Electron UI 未复用。
- `chatMessageSchema` 仅允许 `user/assistant/tool` 角色，无法持久化 `system` 角色的总结消息。

## 目标
- 达到阈值即触发自动总结并裁剪历史，避免等到超限才处理。
- 发生上下文超限时，自动总结并重试；若仍超限，则最小裁剪后继续对话。
- 总结作为单一 `system` 消息追加在 messages 末尾；多次总结时追加到同一条消息内容。
- 裁剪后的历史与总结结果需要持久化到本地 store，避免下次请求仍超长。

## 方案概览
### 1) 引入自动总结与阈值触发
- 在 `chatos/electron/chat/runner.js` 中引入引擎的 `createSummaryManager` / `summarizeSession` / `estimateTokenCount`，并在每次模型请求前执行 `maybeSummarize`。
- 自动总结阈值优先使用 `runtimeSettings.summaryTokenThreshold`（已在 settings 中存在），并在未配置时回落到默认值（如 60000）。
- 建议新增“安全缓冲”策略：当模型上下文上限可知时，使用 `min(配置阈值, 上限 * 0.8)` 作为触发阈值，并预留响应空间（例如 2k~4k tokens）。

### 2) 上下文超限的恢复流程
- 在模型调用处增加“上下文超限恢复”逻辑（复用 `chat/context-recovery.js` 里的策略）：
  1. 捕获上下文超限错误 -> 强制总结 -> 重试；
  2. 若总结后仍超限 -> 硬裁剪为最小上下文再重试。
- 该流程需要同步更新 store（裁剪历史 + 更新总结消息），避免下一次请求重复超限。

### 3) 总结消息的存储与追加
- 扩展 `chatMessageSchema` 支持 `role: 'system'`，并新增 `kind/name` 字段用于标记总结消息（例如 `kind: 'conversation_summary'`）。
- 在 store 中维护“单一总结消息”：
  - 若已存在总结消息 -> 将新总结追加到该消息内容（建议用 `\n\n---\n\n` 分隔，并带时间戳）。
  - 若不存在 -> 创建新的 `system` 消息并置于当前会话 messages 末尾。
- 为避免总结本身无限增大，可设定“总结消息最大长度”，超过后再对总结消息本身做二次摘要或保留最近 N 段。

### 4) 历史裁剪策略
- 复用 `summary.js` 的裁剪逻辑（keepRatio），保留：系统 prompt + 总结消息 + 最近若干条对话（或最近 N tokens）。
- 裁剪时需保持 tool_call 与 tool_result 的完整性，避免破坏工具调用链（可按“用户轮次”分组裁剪）。
- 裁剪后的历史写回 store：删除被裁剪的旧消息，仅保留尾部对话 + 总结系统消息。

### 5) UI 展示与交互
- `ChatMessages` 需支持 `system` 角色的渲染：
  - 方案 A：作为独立“系统消息卡片”显示（折叠为一条“会话总结”提示）。
  - 方案 B：标记为 `hidden` 默认不展示，提供“查看总结”入口。
- “灵动岛”的“立即总结”按钮可复用为强制总结入口，触发与自动总结同一套逻辑。

## 关键改动点清单
1) `chatos/electron/chat/runner.js`
   - 注入 summary manager，增加阈值判断、自动总结与上下文恢复流程。
   - 在总结发生时更新 store：裁剪历史 + 更新/创建 system 总结消息。
2) `chatos/electron/chat/schemas.js`
   - 允许 `role: 'system'`，新增 `kind/name` 字段。
3) `chatos/electron/chat/store.js`
   - 增加查找/更新“总结消息”的辅助方法；提供批量裁剪接口。
4) `chatos/packages/common/aide-ui/features/chat/*`
   - 增加 system 消息的渲染方式与 UI 控制。

## 验证建议
- 构造长对话超过阈值，确认自动总结触发、历史裁剪与继续对话成功。
- 连续触发两次总结，确认总结追加到同一条 system 消息。
- 模拟上下文超限错误（小上下文模型或压低阈值）验证自动恢复流程。
- 验证 UI 是否正确显示/隐藏 system 总结消息。
