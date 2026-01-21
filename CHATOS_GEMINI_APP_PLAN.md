# 基于 Gemini CLI 的 ChatOS 新应用方案

## 目标
- 在 ChatOS 中新增一个“Gemini 应用”（UI App 插件），而不是替换原有 CLI。
- 应用内可发起对话、执行工具、支持基础会话管理。
- 复用 ChatOS 现有 Admin DB / MCP / 任务体系，避免破坏现有 CLI。

## 核心思路
- 把 Gemini CLI 作为一个 **独立的 App Backend**（进程或服务）运行。
- 在 ChatOS 中以 **UI App 插件**形式接入：
  - UI 前端（React）展示对话、输入框、工具输出。
  - 后端通过 ChatOS App Bridge 或 MCP 通道与 Gemini CLI 通信。

## 架构方案（推荐）
1) **Gemini 后端服务（Adapter）**
   - 形式：Node 进程，负责启动 Gemini CLI（或使用其 core 包）。
   - 职责：
     - 提供对话 API（send message / stream response）。
     - 维护 session（保存到 ChatOS stateDir 或 Gemini 目录）。
     - 处理认证（注入 `GEMINI_API_KEY` / settings）。
   - 位置建议：`chatos/apps/gemini-backend/` 或 `chatos/ui_apps/plugins/<pluginId>/backend/`。

2) **ChatOS UI App 插件**
   - 插件目录：`chatos/ui_apps/plugins/<pluginId>/<appId>/`。
   - 前端负责：
     - 发送用户输入到 Backend。
     - 渲染流式输出、工具调用、错误提示。
     - 简单的会话列表（可选）。
   - 对接方式：
     - 方案 A：用 ChatOS App Host 的 `backend.invoke` 透传到 Gemini Backend。
     - 方案 B：用 MCP Server 暴露 Gemini tools（ChatOS 前端通过 MCP 调用）。

3) **认证与配置**
   - 复用 ChatOS Admin DB 的 API Key 读取逻辑。
   - 由 Gemini Backend 写入 `GEMINI_API_KEY` 与 `GEMINI_CLI_HOME`。
   - 可选：在 ChatOS 管理台新增“Gemini 应用设置”（模型、默认系统提示等）。

4) **会话与状态存储**
   - 方案 A：存到 ChatOS stateDir（统一备份/迁移）。
   - 方案 B：存到 Gemini 默认目录（`~/.gemini`），但需配置 `GEMINI_CLI_HOME`。
   - 推荐 A：方便和 ChatOS UI 统一展示。

## 计划与里程碑
### Phase 0：功能确认（1-2 天）
- 明确 Gemini App 需要的功能范围：
  - 是否必须支持 MCP 工具？
  - 是否需要任务/子代理能力？
  - 是否需要多会话管理？

### Phase 1：MVP（2-4 天）
- 新建 UI App 插件（前端 + 简单输入/输出）。
- 新建 Gemini Backend（只支持 send/receive）。
- 用环境变量注入 `GEMINI_API_KEY`，固定默认模型。
- 验证：在 ChatOS UI 中可正常对话。

### Phase 2：流式输出与会话（2-3 天）
- 支持 streaming 输出。
- 实现会话存储（按 ChatOS stateDir 结构）。
- UI 支持会话列表与切换。

### Phase 3：MCP/工具桥接（3-5 天）
- 评估 Gemini CLI MCP 模型与 ChatOS MCP 的差异。
- 选择必要 MCP 工具，做适配映射。
- UI 显示工具调用与结果。

### Phase 4：打包与发布（1-2 天）
- 把 Gemini Backend 与 UI App 插件纳入构建/发布。
- 更新文档与安装说明。

## 风险与注意点
- Gemini CLI 需要 Node >= 20，ChatOS 当前 >= 18。
- Gemini CLI 的交互模型与 ChatOS App Bridge 是否完全兼容需要验证。
- API Key 与多租户隔离策略要确认（避免泄露/冲突）。

## 验收标准
- 在 ChatOS App 页面打开 Gemini 应用可正常聊天。
- 支持流式输出。
- API Key 无需登录即可工作。
- 会话记录能在 ChatOS 中管理（至少保存/恢复）。
