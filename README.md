# Nova Dreamer（ChatOS + AIDE + UI Apps）

本 README 主要介绍桌面端 **UI 界面的使用**（暂不展开终端/CLI 的安装与运行细节）。

This README focuses on **desktop UI usage** (terminal/CLI instructions are intentionally skipped).

[中文](#zh) | [English](#en)

---

<a id="zh"></a>
## 中文

### 项目简介

Nova Dreamer 是一个以 **ChatOS 桌面端**为宿主、以 **AIDE** 为核心引擎的工作台，主打“UI 优先”的使用体验：

- **ChatOS（宿主）**：桌面端 Electron 应用（工作区：`chatos/`），提供对话、Agent、应用中心与管理台。
- **AIDE（引擎）**：模型调用/工具/MCP/子代理等能力（工作区：`chatos/packages/aide/`），并以内置应用的形式提供可视化面板。
- **UI Apps（嵌入应用）**：可在「应用」中心安装/打开的小应用插件（例如 Git/记事本/WSL/AIDE 面板）。
- **DevKit（可选）**：用于开发/校验/打包 UI Apps 的工具（工作区：`chatos-uiapps-devkit/`）。

> 如果你只关心“怎么点、怎么用”，下面直接按 UI 流程阅读即可。构建/打包等终端内容可先忽略。

### UI 导航速览（你会经常用到的入口）

- 顶部主导航：`chatos`（对话相关） / `应用`（应用中心）
- `chatos` 子导航：`对话` / `Agent` / `MCP Servers` / `Prompt`
- 右上角：主题切换与设置入口
- 右下角：笑脸按钮 `交互待办`（UI Prompts：需要你确认/选择/填写时会出现角标）

### 1) 管理台：模型与 API Keys

1. 右上角打开设置菜单
2. 进入 `模型`：
   - 新增/编辑模型、设置默认模型
   - 若模型支持视觉输入（Vision），对话输入框会出现“添加图片/粘贴图片”的能力提示
3. 进入 `API Keys`：
   - 按界面提示添加密钥（用于模型 Provider 调用）
   - 建议先完成这一步，再开始创建 Agent / 发起对话

### 2) Agent：把模型/能力组合成“角色”

入口：顶部 `chatos` → 子导航 `Agent`

- `新增 Agent`：创建一个可复用的对话角色（模型 + 能力组合）
- 常用配置思路：
  - **选择模型**：决定对话能力与是否支持图片输入
  - **挂载应用能力**：在 Agent 编辑器里选择 UI Apps，并为每个应用勾选启用：
    - `MCP`：让 Agent 可调用该应用暴露的工具（例如 Git/记事本/WSL 的管理工具）
    - `Prompt`：让 Agent 可使用该应用提供的提示词模板
- 保存后，到 `对话` 页左侧选择对应 Agent 即可开始使用

### 3) 对话：会话、工作目录与消息输入

入口：顶部 `chatos` → 子导航 `对话`

- 左侧栏：
  - 选择当前 `Agent`
  - 管理会话：新建、重命名、删除、刷新
- 会话顶部：
  - `设置目录`（可选择目录或手动输入 `cwd`，该会话的工具/MCP 会以此作为工作目录 root）
  - `清除` 可恢复为默认启动目录
- 消息输入框：
  - `Enter` 发送，`Shift+Enter` 换行
  - 若模型支持图片：可“添加图片”或直接粘贴图片（最多 4 张，单张 ≤ 10MB）
  - 生成中可点击 `停止`
- 助手回复展示：
  - “思考过程”支持折叠/展开（若后端提供）
  - 工具调用会以标签形式展示，点开可看参数与结果，并支持复制
  - 支持一键 `复制全部`

### 4) 交互待办：UI Prompts（右下角笑脸）

当 AI 需要你做结构化输入/确认时（常见场景：任务创建确认、文件变更确认、单选/多选、表单填写）：

1. 右下角笑脸按钮会出现角标数字
2. 点击打开右侧抽屉 `交互待办`
3. 左侧选择待处理项，右侧按提示提交/取消

### 5) 应用：应用中心与插件管理

入口：顶部 `应用` → `应用中心`

- `导入应用包`：从 **插件目录**或 **.zip 包**导入应用（安装后会出现在应用列表）
- `刷新`：重新扫描插件、更新应用列表
- 点击应用卡片进入应用；应用内通常提供：
  - `返回`：回到应用中心
  - `刷新`：重新加载应用（常用于开发/调试）
- 若插件加载失败，应用中心会显示“部分插件加载失败”的原因提示

### 6) 内置应用怎么用（UI 视角）

这些应用默认会出现在「应用中心」，可直接打开使用。

#### AIDE 引擎（AIDE Built-in Apps）

入口：`应用` → `AIDE 引擎`

- 顶部 Tab：`主页` / `文件浏览器` / `轨迹`
- `主页`：汇总展示最近对话、任务、工具调用、文件改动，以及会话列表与日志查看入口
- `文件浏览器`：选择工作目录后，浏览文件树、预览文件内容，并查看文件变更历史/差异
- `轨迹`：以更细粒度查看运行轨迹（事件流），便于回溯一次运行到底发生了什么
- 右下角/悬浮交互面板（灵动岛）：用于在 UI 内进行“发送/纠正/停止/立即总结”等交互，并承载 UI Prompts

#### Git Manager

入口：`应用` → `Git Manager`

- `添加仓库`：按弹窗提示填写仓库名称、仓库路径、认证方式（`username/token/ssh`）
- 顶部选择仓库与分支，可：
  - `刷新分支` / `新建分支` / `切换分支`
  - 输入提交信息后执行 `提交`，以及 `推送` / `拉取`
- 下方输出区会显示执行过程与结果（成功/失败原因）

#### 记事本（Markdown Notes）

入口：`应用` → `记事本`

- 文件夹树：支持新建子文件夹、重命名、递归删除，并可“设为当前文件夹”
- 笔记列表：支持在当前文件夹下新建笔记、移动到其它文件夹、删除
- 编辑区：
  - `编辑` / `预览` 一键切换
  - 支持为笔记设置 `标签`（逗号分隔），并通过标签快速过滤
  - 未保存时会提示“未保存 · …”，切换笔记时会二次确认是否丢弃

#### WSL Tools（WSL Manager）

入口：`应用` → `WSL Manager`

- 顶部状态条会提示 WSL 是否可用；不可用时会给出原因（例如需要在桌面端运行）
- `刷新发行版` 后选择发行版
- 输入命令后可选择：
  - `实时执行`（持续输出）
  - `一次性执行`（执行结束后返回结果）
- `清空输出` 可清理终端输出区域

### AIDE 使用教程视频（根目录）

- `a4006768210fd84e36cc654a6f0a6b84.mp4`：[点击观看/下载](./a4006768210fd84e36cc654a6f0a6b84.mp4)

### 进一步阅读（可选）

- 架构总览（组件/数据流/关键入口）：`ARCHITECTURE_OVERVIEW.md`
- UI Apps 框架/协议概览：`CHATOS_UI_APPS_OVERVIEW.md`
- 插件清单（`plugin.json`）规范：`CHATOS_UI_APPS_PLUGIN_MANIFEST.md`
- Host API（前端侧）：`CHATOS_UI_APPS_HOST_API.md`
- UI Prompts 协议：`CHATOS_UI_PROMPTS_PROTOCOL.md`
- 插件后端协议：`CHATOS_UI_APPS_BACKEND_PROTOCOL.md`

---

<a id="en"></a>
## English

### Overview

Nova Dreamer is a **UI-first** workspace built around a **ChatOS desktop host** and the **AIDE engine**:

- **ChatOS (host)**: Electron desktop app (workspace: `chatos/`) — chat, agents, apps, and admin panels.
- **AIDE (engine)**: model runtime + tools/MCP/sub-agents (workspace: `chatos/packages/aide/`) — also shipped as a built-in UI app.
- **UI Apps (embedded apps)**: plugins you can install and open in the `Apps` center (e.g. Git/Notepad/WSL/AIDE panel).
- **DevKit (optional)**: tooling to develop/validate/package UI Apps (workspace: `chatos-uiapps-devkit/`).

> This document is about “where to click and how to use the UI”. Build/CLI topics are intentionally skipped here.

### UI Map (main entry points)

- Top navigation: `chatos` (chat-related) / `Apps` (app center)
- `chatos` sub tabs: `Chat` / `Agent` / `MCP Servers` / `Prompt`
- Top-right: theme toggle + Settings menu
- Bottom-right: Smiley button `UI Prompts` inbox (badges appear when your input/confirmation is required)

### 1) Admin: Models & API Keys

1. Open the Settings menu in the top-right corner
2. Go to `Models`:
   - create/edit models and set the default model
   - if the selected model supports Vision, the chat composer will enable image input
3. Go to `API Keys`:
   - add provider API keys as guided by the UI
   - recommended to finish this before creating agents or starting chats

### 2) Agents: compose “roles” (model + capabilities)

Entry: `chatos` → `Agent`

- Click `New Agent` to create a reusable agent profile
- Common setup:
  - **Select a model** (also determines whether image input is available)
  - **Attach app capabilities**: select UI Apps in the agent editor, and enable per app:
    - `MCP` (tools exposed by the app, e.g. Git/Notes/WSL management)
    - `Prompt` (prompt templates provided by the app)
- Save, then pick the agent in the `Chat` view (left sidebar)

### 3) Chat: sessions, workspace root, composing messages

Entry: `chatos` → `Chat`

- Left sidebar:
  - choose the current `Agent`
  - manage sessions: create, rename, delete, refresh
- Session header:
  - set `cwd` via `Pick folder` or manual input (used as the tool/MCP workspace root)
  - `Clear` resets it to the default startup directory
- Composer:
  - `Enter` to send, `Shift+Enter` for new lines
  - Vision models: add/paste images (up to 4, ≤ 10MB each)
  - stop a running generation with `Stop`
- Assistant messages:
  - reasoning (if provided) is collapsible
  - tool calls appear as tags; click to inspect args/results and copy
  - `Copy all` is available per turn

### 4) UI Prompts inbox (bottom-right smiley)

When the AI needs structured inputs/confirmations (task creation, file change confirmation, choices, forms):

1. A badge count appears on the smiley button
2. Click it to open the `UI Prompts` drawer
3. Select a pending item on the left, then submit/cancel on the right

### 5) Apps: app center & plugin management

Entry: `Apps` → `App Center`

- `Import app package`: import a plugin directory or a `.zip`
- `Refresh`: rescan plugins and reload the app list
- Click an app card to open; apps usually provide:
  - `Back` to the app center
  - `Reload` to re-mount the app (useful during development)
- If a plugin fails to load, the app center will show error hints

### 6) Built-in apps (UI usage)

These apps are available in the app center by default.

#### AIDE Engine (AIDE Built-in Apps)

Entry: `Apps` → `AIDE Engine`

- Tabs: `Home` / `File Explorer` / `Trace`
- `Home`: overview of recent conversations, tasks, tool calls, file changes, plus session/log panels
- `File Explorer`: pick a workspace root, browse the tree, preview files, and inspect change history/diffs
- `Trace`: inspect the event stream for a run (fine-grained timeline)
- Floating panel (island): UI actions like send/correct/stop/summary, and it also hosts UI prompts

#### Git Manager

Entry: `Apps` → `Git Manager`

- `Add repo`: fill repo name, repo path, and auth type (`username/token/ssh`)
- Select repo & branch, then:
  - `Refresh branches` / `New branch` / `Checkout`
  - enter a commit message and `Commit`, then `Push` / `Pull`
- The output panel shows progress and errors

#### Notepad (Markdown Notes)

Entry: `Apps` → `Notepad`

- Folder tree: create subfolders, rename, recursive delete, and “set as current folder”
- Notes: create in the current folder, move to another folder, delete
- Editor:
  - toggle `Edit` / `Preview`
  - set `Tags` (comma-separated) and filter notes by tags
  - unsaved changes are highlighted and confirmed before discarding

#### WSL Tools (WSL Manager)

Entry: `Apps` → `WSL Manager`

- Status pill shows whether WSL is available (and why it isn’t)
- `Refresh distros`, select a distro, type a command, then:
  - `Run (streaming)` for real-time output
  - `Run once` for one-shot execution
- `Clear output` wipes the terminal output panel

### AIDE video tutorial (repo root)

- `a4006768210fd84e36cc654a6f0a6b84.mp4`: [Watch / download](./a4006768210fd84e36cc654a6f0a6b84.mp4)

### Further reading (optional)

- Architecture overview (components/data flow/entry points): `ARCHITECTURE_OVERVIEW.md`
- UI Apps overview: `CHATOS_UI_APPS_OVERVIEW.md`
- Plugin manifest spec (`plugin.json`): `CHATOS_UI_APPS_PLUGIN_MANIFEST.md`
- Host API (frontend): `CHATOS_UI_APPS_HOST_API.md`
- UI Prompts protocol: `CHATOS_UI_PROMPTS_PROTOCOL.md`
- Backend protocol: `CHATOS_UI_APPS_BACKEND_PROTOCOL.md`
