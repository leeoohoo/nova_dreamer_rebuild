# ChatOS UI Apps DevKit

一个可通过 npm 安装的 DevKit，用来：

- 生成 UI Apps 插件工程（脚手架）
- 在本地沙箱里运行/调试 `module` 应用（Host API mock）
- 校验 `plugin.json` 与路径边界
- 打包/安装到本机 ChatOS（`~/.chatos/chatos/ui_apps/plugins`）

## 安装

```bash
npm i -g @leeoohoo/ui-apps-devkit
```

或直接用 npx：

```bash
npx @leeoohoo/ui-apps-devkit chatos-uiapp --help
```

## 快速开始

```bash
chatos-uiapp init my-first-uiapp
cd my-first-uiapp
npm install
npm run dev
```

## 沙箱能力

- 模拟 `module mount()` 与 `host.*` API
- 右上角 Theme 切换（light/dark/system），用于测试 `host.theme.onChange` 与样式响应
- Inspect 面板展示 `host.context` 与 `--ds-*` tokens

## 模板

```bash
chatos-uiapp init --list-templates
chatos-uiapp init my-app --template basic
chatos-uiapp init my-app --template notepad
```

- `basic`：最小可运行骨架（含 `host.chat.*` / `ctx.llm.complete()` 示例）
- `notepad`：完整示例应用（文件夹/标签/搜索/后端持久化）

完成开发后：

```bash
npm run validate
npm run pack
npm run install:chatos
```

## 生成项目结构（约定）

生成的工程里，**可安装产物**固定在 `plugin/` 目录：

```
my-first-uiapp/
  docs/                # 协议文档（随工程分发）
  chatos.config.json   # DevKit 配置（pluginDir/appId）
  plugin/              # 直接导入/安装到 ChatOS 的插件目录
    plugin.json
    backend/           # (可选) Electron main 进程后端
    apps/<appId>/      # module 前端 + AI 贡献（MCP/Prompt）
```

## CLI

- `chatos-uiapp init <dir>`：生成工程
- `chatos-uiapp dev`：启动本地运行沙箱（支持文件变更自动重载）
- `chatos-uiapp validate`：校验 manifest 与路径边界
- `chatos-uiapp pack`：打包 `.zip`（用于 ChatOS 导入）
- `chatos-uiapp install`：复制到本机 ChatOS 用户插件目录
