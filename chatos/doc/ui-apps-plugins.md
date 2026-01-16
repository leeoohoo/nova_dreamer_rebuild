# UI「应用」插件（UI Apps Plugins）

> 更完整的“目录规范 + 协议 + MCP/Prompt 暴露 + Agent 运行机制”手册见：`chatos/doc/app-dev-handbook.md`

本文件只保留 UI Apps 插件的**清单格式（plugin.json）**与**模块入口（module）**要点；ChatOS 不支持 `iframe/url` 入口。

## 插件目录

宿主会扫描两个目录（在 UI「应用」页也会展示实际路径）：

- **用户插件目录**：`<stateDir>/ui_apps/plugins`（即 `~/.chatos/chatos/ui_apps/plugins`）
- **内置/开发目录**：`<projectRoot>/ui_apps/plugins`

每个插件一个文件夹，根目录必须包含 `plugin.json`。

也可以在桌面端 `应用` 页点击 `导入应用包`，选择插件目录或 `.zip`，宿主会自动复制到用户插件目录（要求 `plugin.json` 在包根目录，或包根目录下一层目录）。

模板：`chatos/ui_apps/template/basic-plugin`（复制到上述目录后即可在 UI「应用」页看到）。

## plugin.json（接口/契约）

插件清单必须叫 `plugin.json`。核心字段：

- `manifestVersion`：清单版本（当前为 `1`，可省略）
- `id`：插件 ID（建议反向域名，全局唯一且稳定）
- `name`：显示名称
- `version` / `description`：可选
- `backend.entry`：可选，插件后端入口（Electron main 进程执行）
- `apps[]`：该插件提供的应用列表

### apps[i]

- `id`：应用 ID（同一插件内唯一）
- `name`：显示名称
- `description` / `icon`：可选
- `entry`：入口（仅支持 `module`）
  - `{ "type": "module", "path": "my-app/index.mjs" }`
- `ai`：可选 AI 声明（让应用对 ChatOS 暴露 MCP/Prompt，供 Agent 按“应用维度”选择）
  - 可直接写对象；也支持写成一个**相对路径字符串**（如 `"my-app/ai.yaml"`）从文件读取（必须在插件目录内）

示例（最小可运行）：

```json
{
  "manifestVersion": 1,
  "id": "com.example.tools",
  "name": "Example Tools",
  "version": "0.1.0",
  "description": "示例插件",
  "backend": { "entry": "backend/index.mjs" },
  "apps": [
    {
      "id": "hello-module",
      "name": "Hello App（Module）",
      "description": "Module 入口示例（直接挂载到宿主 UI）",
      "entry": { "type": "module", "path": "hello-module/index.mjs" }
    }
  ]
}
```

## Module 入口（前端）

入口模块需导出 `mount`：

```js
export function mount({ container, host, slots }) {
  // render UI into container (body)
  // optional: render fixed header into slots.header
  // call host.admin / host.chat / host.backend / host.ui.navigate ...
  return () => {};
}
```

### Layout / Header 规范（强烈建议）

- **不要使用 window/body 作为滚动容器**：宿主会把应用挂载在一个固定高度的区域里；请把滚动放在应用内部。
- `container`：应用**正文区域（body）**容器，建议你的主布局根节点使用 `height: 100%` + `min-height: 0`，并在内部自行控制 `overflow`。
- `slots.header`（可选）：应用**固定 Header / Tab / 菜单导航**容器，位于 body 之上，不随 body 滚动；适合放“标题、筛选、Tabs、二级导航、操作按钮”等。
- **导航**：跨应用/跨页面跳转一律用 `host.ui.navigate(menu)`；应用内的二级导航建议放到 `slots.header`（Tabs/Segmented 等）。

`host`（当前实现）提供：

- `host.context.get()` / `host.theme.get()` / `host.theme.onChange(fn)`
- `host.registry.list()`
- `host.admin.state()` / `host.admin.onUpdate(fn)`
- `host.admin.models.list()` / `host.admin.secrets.list()`
- `host.backend.invoke(method, params)`
- `host.ui.navigate(menu)`
- `host.chat.*`（agents/sessions/messages/send/abort/events）

## 后端（可选）

有些应用需要 Node 能力（数据库/SSH/I/O 等）。这类能力放在插件后端，由 Electron main 进程加载并通过 IPC 调用。

`plugin.json`：

```json
{ "backend": { "entry": "backend/index.mjs" } }
```

后端入口模块需导出 `createUiAppsBackend(ctx)`：

```js
export async function createUiAppsBackend(ctx) {
  return {
    methods: {
      async ping(params) {
        return { ok: true };
      }
    },
    async dispose() {}
  };
}
```

`ctx`（宿主注入）：

- `pluginId` / `pluginDir`
- `dataDir`：`<stateDir>/ui_apps/data/<pluginId>`
- `stateDir` / `sessionRoot` / `projectRoot`
- `llm`：可选。共享模型调用接口（复用 ChatOS 的 Models / API Keys）
  - `ctx.llm.complete({ input, modelId?, modelName?, systemPrompt?, disableTools? })`

## 参考实现

- 模板插件：`chatos/ui_apps/template/basic-plugin/plugin.json`
- 宿主扫描/同步：`chatos/electron/ui-apps/index.js`
- 宿主 schema：`chatos/electron/ui-apps/schemas.js`
- UI 应用中心：`chatos/apps/ui/src/features/apps/AppsHubView.jsx`
- UI 运行视图：`chatos/apps/ui/src/features/apps/AppsPluginView.jsx`
