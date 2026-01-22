# Analysis
- 需要逐项验证 MCP 管理页、默认 MCP 列表、Prompt 保留列表、land-configs 与文件删除情况。
- 通过查看指定行段与文件列表确认是否已移除。

# Tasks
1. 检查 McpServersManager.jsx 内置列表是否已移除 subagent_router/ui_prompter。
2. 检查 mcp.js 默认 server 列表确认已删除相关定义。
3. 检查 PromptsManager.jsx 保留列表移除 Agent 项。
4. 检查 land-configs.json 的 mcpServers 数组确认已移除。
5. 检查指定文件是否已删除。
