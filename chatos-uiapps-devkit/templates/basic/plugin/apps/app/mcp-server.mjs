/**
 * MCP Server 入口（可选）
 *
 * 注意：
 * - ChatOS 导入插件包时会默认排除 `node_modules/`，因此这里不要依赖“随包携带的依赖”。
 * - 若你需要使用 `@modelcontextprotocol/sdk`，请在 build 阶段做 bundle（把依赖打进单文件）。
 *
 * 你可以：
 * 1) 用 bundler（esbuild/rollup）把 MCP Server 打包成单文件，并在 plugin.json 里把 `ai.mcp.entry` 指向打包产物；
 * 2) 或者把依赖源码 vendoring 到插件目录内，使用相对路径 import。
 */

// TODO: 实现你自己的 MCP Server（stdio）。建议把日志写到 stderr，不要污染 stdout。
console.error('[mcp] placeholder: implement your MCP server here');
process.exit(1);
