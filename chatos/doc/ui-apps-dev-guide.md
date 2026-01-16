<!--
  UI Apps Plugins 开发指南（面向本项目）
  入口仅支持 module；不支持 iframe/url。
-->

# UI 小应用开发指南（UI Apps Plugins / module）

> 更完整的“目录规范 + 协议 + MCP/Prompt 暴露 + Agent 运行机制”手册见：`chatos/doc/app-dev-handbook.md`

本指南提供一个从 0 到 1 的最短路径：用 `plugin.json + module 入口` 把应用接入 ChatOS，并在 Agent 中按“应用维度”挂载 MCP/Prompt。

## 1. 最快跑起来（复制模板）

1) 选择插件目录（任选其一）：

- 开发/内置目录：`<projectRoot>/ui_apps/plugins`
- 用户插件目录：`<stateDir>/ui_apps/plugins`（即 `~/.chatos/chatos/ui_apps/plugins`）

2) 复制模板插件：

```bash
cp -R chatos/ui_apps/template/basic-plugin <pluginsDir>/my-first-plugin
```

3) 修改 `<pluginsDir>/my-first-plugin/plugin.json`：

- 把 `id` 改成你自己的 pluginId（建议反向域名）
- 把 `apps[0].id/name/description` 改成你的应用信息

4) 打开桌面端 →「应用」页 → 点“刷新” → 进入你的应用卡片。

## 2. module 入口规范

`apps[i].entry`（仅支持）：

```json
{ "type": "module", "path": "my-app/index.mjs" }
```

入口模块导出：

```js
export function mount({ container, host, slots }) {
  // render into container (body)
  // optional: render fixed header into slots.header
  // call host.admin/host.chat/host.backend/host.ui.navigate ...
  return () => {};
}
```

布局建议：不要用 window/body 滚动；把 header/tab 放到 `slots.header`，把可滚动内容放到 `container`。

Host API 详见：`chatos/doc/app-dev-handbook.md`（第 5 节）。

## 3. 插件后端（可选）

如果需要 Node 能力（数据库/SSH/I/O），在 `plugin.json` 里配置：

```json
{ "backend": { "entry": "backend/index.mjs" } }
```

后端导出 `createUiAppsBackend(ctx)`，前端用 `host.backend.invoke(method, params)` 调用。

## 4. MCP / Prompt 暴露（可选）

两种常用方式（详见手册第 7 节）：

1) 应用自带 MCP server + mcpPrompt：在 `apps[i].ai` 里声明 `ai.mcp` + `ai.mcpPrompt`
2) 应用聚合暴露全局 MCP/Prompts：`ai.mcpServers` / `ai.prompts`（`true | false | string[]`）

内置应用的“精细清单”放在：

- `aide/shared/defaults/ui-apps-expose/<pluginId>__<appId>.yaml`

宿主侧（`plugin.json`）只保留 `true/false` 开关。

## 5. 常见问题

- **应用看不到**：检查 `plugin.json` 是否可解析、`entry.path` 是否存在且在插件目录内。
- **Agent 里选不到应用**：应用需在 `apps[i].ai` 里开启 `mcpServers/prompts`（或声明 `mcp/mcpPrompt`）。
- **选择框里没有 MCP/Prompt**：只会展示“该应用主动暴露”的范围；内置应用检查 `aide/shared/defaults/ui-apps-expose/` 是否有清单文件。
