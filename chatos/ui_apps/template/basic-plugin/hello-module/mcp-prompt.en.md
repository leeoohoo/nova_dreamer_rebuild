You can use the MCP server shipped with the **Hello Module App** plugin to demonstrate tool calling.

The server config name (used for tool prefixes) follows the convention: `<pluginId>.<appId>`.
In this template it is typically: `com.example.aideui.template.hello-module`.

Available tools (tool identifiers are prefixed with `mcp_<normalize(serverName)>_`):

- `..._hello({ name? })`: returns a greeting (quick sanity check that MCP works)
- `..._echo({ text })`: echoes text back (validate args/response wiring)

Usage tips:

- To quickly verify MCP is connected: call `..._hello`
- To validate arbitrary strings/JSON round-trip: call `..._echo`
- After the tool result, summarize it briefly in natural language

