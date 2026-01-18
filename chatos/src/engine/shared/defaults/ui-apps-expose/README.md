# UI Apps 暴露清单（默认配置）

本目录用于维护“内置 UI Apps”的默认暴露清单：应用开发者在 `aide` 里决定对 ChatOS 暴露哪些 **MCP Servers** / **Prompts**（精细列表），而宿主侧（`deepseek_cli` 的 `plugin.json`）只保留 `true/false` 开关。

## 文件命名

每个应用一个文件：

`<pluginId>__<appId>.yaml`（也支持 `.yml` / `.json`）

说明：

- `pluginId` / `appId` 会被转成小写；
- 非法字符会被替换为 `_`；
- 示例：`com.leeoohoo.aideui.builtin__cli.yaml`

## 文件内容（YAML/JSON）

支持的字段（与 `deepseek_cli/electron/ui-apps/schemas.js` 的 `uiAppAiConfigSchema` 对齐）：

- `mcpServers`: `true | false | string[]`
  - `true`：暴露“全部”MCP servers
  - `string[]`：仅暴露列出的 MCP serverName
  - `false`：禁用暴露
- `prompts`: `true | false | string[]`
  - `true`：暴露“全部”Prompts
  - `string[]`：仅暴露列出的 prompt name
  - `false`：禁用暴露
- `mcpPrompt`: 可选（该应用的默认 system prompt，宿主会生成 `mcp_<normalize(pluginId.appId)>[__en]` 两个 prompt）

示例：

```yaml
mcpServers: true
prompts: true
```

或只开放部分能力：

```yaml
mcpServers:
  - project_files
  - task_manager

prompts:
  - default
  - internal_main
  - mcp_project_files
  - mcp_task_manager
```

## 宿主开关（必须）

只有当应用在 `plugin.json` 里显式开启时，清单才会对 UI 生效：

```json
{ "ai": { "mcpServers": true, "prompts": true } }
```

- 若 `ai.mcpServers=false` / `ai.prompts=false`：即使本目录有清单，也不会暴露。
- 若 `plugin.json` 未显式配置 `ai.mcpServers/prompts`：默认不会读取本目录的清单（避免“意外启用”）。
