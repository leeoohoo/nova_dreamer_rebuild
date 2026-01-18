# __PLUGIN_NAME__

这是一个 **ChatOS UI Apps 插件工程**（UI Apps Plugins）。

## 你应该在哪写什么

- `plugin/plugin.json`：插件清单（应用列表、入口、后端、AI 贡献）
- `plugin/apps/__APP_ID__/index.mjs`：**module 入口**（导出 `mount({ container, host, slots })`）
- `plugin/apps/__APP_ID__/compact.mjs`：**compact 入口**（可选；用于侧边抽屉/分栏场景）
- `plugin/backend/index.mjs`：**插件后端**（导出 `createUiAppsBackend(ctx)`，通过 `host.backend.invoke()` 调用）
- `plugin/apps/__APP_ID__/mcp-server.mjs`：应用自带 MCP Server（可选）
- `plugin/apps/__APP_ID__/mcp-prompt.zh.md` / `.en.md`：MCP Prompt（可选）

## 开发与预览（本地沙箱）

```bash
npm install
npm run dev
```

沙箱会：

- 用 HTTP 运行你的 `module` 入口（模拟 ChatOS 的 `mount()` 调用）
- 提供 `host.*` 的 mock（含 `host.backend.invoke()`、`host.uiPrompts.*`、`host.chat.*`）

## 主题与样式（重要）

- 宿主通过 `document.documentElement.dataset.theme` 下发 `light` / `dark`，用 `host.theme.get()` / `host.theme.onChange()` 读取与监听。
- 推荐使用 CSS Tokens（`--ds-*`）做主题适配，避免硬编码颜色。
- 本地沙箱右上角提供 Theme 切换（light/dark/system）用于测试样式响应。
- 本地沙箱 Inspect 面板可查看 `host.context` 与 `--ds-*` tokens。

## 开发清单（建议）

- `plugin/plugin.json`：`apps[i].entry.type` 必须是 `module`，且 `path` 在插件目录内。
- `plugin/plugin.json`：可选 `apps[i].entry.compact.path`，用于 compact UI。
- 安全：插件目录内尽量避免 symlink（`npm run validate` 会提示），以免路径边界与打包行为不一致。
- `mount()`：返回卸载函数并清理事件/订阅；滚动放在应用内部，固定内容用 `slots.header`。
- 主题：用 `host.theme.*` 与 `--ds-*` tokens；避免硬编码颜色。
- 宿主能力：先判断 `host.bridge.enabled`，非宿主环境要可降级运行。
- Node 能力：前端不直接用 Node API，需要时走 `host.backend.invoke()`。
- 打包：依赖需 bundle 成单文件；ChatOS 导入会排除 `node_modules`，MCP server 不能直接 import 第三方依赖。
- 提交前：`npm run validate`，必要时再 `pack/install`。

## 复用 ChatOS 的 AI 调用（推荐）

本模板演示两种“复用宿主模型/密钥/工具链”的方式：

1) **前端直连 Chat 域**：用 `host.chat.*` 创建 agent/session、`host.chat.send()` 发送消息、`host.chat.events.subscribe()` 订阅流式事件。
2) **后端调用 LLM**：在 `plugin/backend/index.mjs` 里通过 `ctx.llm.complete()` 调用模型；前端用 `host.backend.invoke('llmComplete', { input })` 触发。

说明：本地沙箱默认是 mock；可通过右上角 `AI Config` 配置 `API Key / Base URL / Model ID` 后启用真实模型调用，并用于测试应用 MCP（需配置 `ai.mcp`）。
补充：沙箱默认把 `_meta.workdir` 设为 `dataDir`；如需模拟其它工作目录，可在 `AI Config` 里设置 `Workdir` 覆盖（支持 `$dataDir/$pluginDir/$projectRoot`）。

## 安装到本机 ChatOS

```bash
npm run validate
npm run install:chatos
```

或打包成 zip（用于 ChatOS UI：应用 → 导入应用包）：

```bash
npm run pack
```

## 协议文档

`docs/` 目录包含当前版本的协议快照（建议团队内统一对齐），并包含主题样式指南与排错清单。

## 启用 MCP（可选）

本模板默认只启用 `ai.mcpPrompt`（不启用 `ai.mcp`），避免第三方插件在未打包依赖时运行失败。

⚠️ ChatOS 导入插件时会排除 `node_modules/`。因此 MCP server 只要用了第三方依赖（如 `@modelcontextprotocol/sdk`、`zod`），就必须先 bundle 成单文件，或把依赖源码放进插件目录。
若看到 `Cannot find package '@modelcontextprotocol/sdk'`，说明依赖未被 bundle。

如果你要启用 MCP：

1) 实现并打包 `plugin/apps/__APP_ID__/mcp-server.mjs`（必须 bundle 成单文件，除非完全不依赖第三方）  
2) 在 `plugin/plugin.json` 的 `apps[i].ai.mcp` 写入 `entry/command/args/...` 并指向 bundle 产物  
