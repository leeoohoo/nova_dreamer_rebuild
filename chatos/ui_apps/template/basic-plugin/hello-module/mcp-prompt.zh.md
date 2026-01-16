你可以使用一个与 UI 小应用 **Hello Module App** 配套的 MCP Server（stdio 本地命令）来完成简单工具调用演示。

该 Server 的配置名称（用于工具前缀）遵循约定：`<pluginId>.<appId>`。
在模板插件里它通常是：`com.example.aideui.template.hello-module`。

可用工具（tool name 会带 `mcp_<normalize(serverName)>_` 前缀）：

- `..._hello({ name? })`：返回一段问候语（用于快速验证 MCP 链路是否正常）
- `..._echo({ text })`：原样返回文本（用于验证参数传递/回包）

使用建议：

- 需要快速自检 MCP 是否可用时：先调用 `..._hello`
- 需要验证任意字符串/JSON 能否正确传递时：调用 `..._echo`
- 工具返回后，用一句话总结结果即可

