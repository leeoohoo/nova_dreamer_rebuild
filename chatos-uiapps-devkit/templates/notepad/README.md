# __PLUGIN_NAME__（Notepad 示例模板）

这是一个更接近“真实应用”的 **ChatOS UI Apps** 示例模板：Markdown 记事本（文件夹分类 + 标签检索 + 编辑/预览）。

## 快速开始

```bash
npm install
npm run dev
```

## 本地沙箱 AI Config（可选）

- 右上角 `AI Config` 可配置 `API Key / Base URL / Model ID`，用于测试真实模型调用（以及 MCP 调用）。
- 沙箱默认把 `_meta.workdir` 设为 `dataDir`；如需模拟其它工作目录，可在 `AI Config` 里设置 `Workdir` 覆盖（支持 `$dataDir/$pluginDir/$projectRoot`）。

## 目录说明

- `plugin/plugin.json`：插件清单（应用列表、入口、后端、AI 贡献）
- `plugin/apps/__APP_ID__/`：前端 module（浏览器环境，导出 `mount({ container, host, slots })`）
- `plugin/apps/__APP_ID__/compact.mjs`：compact 入口（可选；用于侧边抽屉/分栏场景）
- `plugin/backend/`：插件后端（Node/Electron main，导出 `createUiAppsBackend(ctx)`）
- `plugin/shared/`：共享存储实现（后端持久化所需）
- `docs/`：协议文档快照（随工程分发）

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

## 协议文档

`docs/` 目录包含当前版本的协议快照（建议团队内统一对齐），并包含主题样式指南与排错清单。

## 后端 API（示例）

前端通过 `host.backend.invoke(method, params)` 调用后端方法，本模板提供 `notes.*` 一组方法用于管理笔记：

- `notes.listFolders / notes.createFolder / notes.renameFolder / notes.deleteFolder`
- `notes.listNotes / notes.createNote / notes.getNote / notes.updateNote / notes.deleteNote`
- `notes.listTags / notes.searchNotes`

## MCP（可选）

模板内包含 `plugin/apps/__APP_ID__/mcp-server.mjs` 与 `mcp-prompt.*.md`，但默认 **未在** `plugin/plugin.json` 启用 `ai.mcp`（避免打包时遗漏依赖导致运行失败）。

⚠️ ChatOS 导入插件时会排除 `node_modules/`。因此 MCP server 只要用了第三方依赖（如 `@modelcontextprotocol/sdk`、`zod`），就必须先 bundle 成单文件，或把依赖源码放进插件目录。
若看到 `Cannot find package '@modelcontextprotocol/sdk'`，说明依赖未被 bundle。

如需启用 MCP：

1) 实现并 **bundle 成单文件**（必须；用 esbuild/rollup，把 `@modelcontextprotocol/sdk` 等依赖打进去）  
2) 在 `plugin/plugin.json` 的 `apps[i].ai.mcp` 写入 `entry/command/args/...` 并指向 bundle 产物  
