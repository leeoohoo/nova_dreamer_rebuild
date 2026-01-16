# UI 菜单 SVG 图标

这组 SVG 对应当前管理台菜单（见 `apps/ui/src/index.jsx` 的菜单 key），可直接用于官网功能入口/卖点展示。

## 文件与菜单映射

| 菜单 key | 菜单名称 | SVG 文件 |
|---|---|---|
| `session` | 主页 | `session.svg` |
| `workspace` | 文件浏览器 | `workspace.svg` |
| `events` | 事件流 / 日志 | `events.svg` |
| `admin/models` | 模型 | `admin-models.svg` |
| `admin/mcp` | MCP Servers | `admin-mcp.svg` |
| `admin/subagents` | Sub-agents | `admin-subagents.svg` |
| `admin/prompts` | Prompts | `admin-prompts.svg` |
| `admin/settings` | 运行配置 | `admin-settings.svg` |

## 规格

- 画布：`24x24`，`viewBox="0 0 24 24"`
- 风格：线性图标（`fill="none"`），圆角端点与圆角连接
- 颜色：`stroke="currentColor"`（推荐用 CSS 的 `color` 控制）
- 线宽：`stroke-width="2"`

## 使用方式

### 拷贝到官网静态资源目录（建议）

把整个目录放到官网的静态资源目录（例如 `public/assets/ui-menu-icons/`），保持文件名不变即可。

### 方式 1：直接当图片引用（最简单）

```html
<img src="/assets/ui-menu-icons/session.svg" width="20" height="20" alt="主页" />
```

说明：这种方式下 SVG 内的 `currentColor` 不会继承外部字体颜色（会按 SVG 自身的默认颜色渲染）。

### 方式 2：内联 SVG（推荐，可用 CSS 改颜色）

```html
<span class="icon" aria-hidden="true">
  <!-- 复制 session.svg 的内容到这里 -->
</span>
```

```css
.icon svg {
  width: 20px;
  height: 20px;
  color: #1677ff; /* 控制 stroke 颜色 */
}
```

### 方式 3：CSS mask（外链 SVG 也能随意换色）

```html
<span class="icon-mask" aria-hidden="true"></span>
```

```css
.icon-mask {
  width: 20px;
  height: 20px;
  background: #1677ff;
  -webkit-mask: url("/assets/ui-menu-icons/session.svg") no-repeat center / contain;
  mask: url("/assets/ui-menu-icons/session.svg") no-repeat center / contain;
}
```

### 可选：打包成 zip

```bash
zip -r ui-menu-icons.zip assets/ui-menu-icons
```
