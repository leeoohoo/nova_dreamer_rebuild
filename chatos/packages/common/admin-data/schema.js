import { z } from 'zod';

export const TABLE_SCHEMAS = {
  models: {
    name: 'models',
    description: 'AI 模型与 Provider 配置',
    columns: [
      { name: 'id', type: 'string', required: true, note: 'UUID 主键' },
      { name: 'name', type: 'string', required: true, note: '业务别名/标识符' },
      { name: 'provider', type: 'string', required: true, note: '如 openai/azure/etc' },
      { name: 'model', type: 'string', required: true, note: '具体模型 ID' },
      { name: 'supportsVision', type: 'boolean', required: false, note: '是否支持图片理解/输入' },
      { name: 'reasoningEffort', type: 'enum(low|medium|high)', required: false, note: '可选推理等级（仅部分模型支持）' },
      { name: 'baseUrl', type: 'string', required: false, note: '可选自定义网关' },
      { name: 'apiKeyEnv', type: 'string', required: false, note: '读取密钥的环境变量' },
      { name: 'tools', type: 'string[]', required: false, note: '工具或插件列表（可选）' },
      { name: 'description', type: 'string', required: false, note: '备注' },
      { name: 'isDefault', type: 'boolean', required: false, note: '是否默认模型' },
      { name: 'createdAt', type: 'datetime', required: true },
      { name: 'updatedAt', type: 'datetime', required: true },
    ],
  },
  secrets: {
    name: 'secrets',
    description: '环境变量密钥（由 UI 管理，运行时注入到进程 env）',
    columns: [
      { name: 'id', type: 'string', required: true, note: 'UUID 主键' },
      { name: 'name', type: 'string', required: true, note: '环境变量名，如 DEEPSEEK_API_KEY' },
      { name: 'value', type: 'string', required: true, note: '密钥内容（敏感）' },
      { name: 'override', type: 'boolean', required: false, note: '是否覆盖已存在的同名系统环境变量' },
      { name: 'description', type: 'string', required: false, note: '备注' },
      { name: 'createdAt', type: 'datetime', required: true },
      { name: 'updatedAt', type: 'datetime', required: true },
    ],
  },
  mcpServers: {
    name: 'mcpServers',
    description: 'MCP 服务器注册表',
    columns: [
      { name: 'id', type: 'string', required: true, note: 'UUID 主键' },
      { name: 'app_id', type: 'string', required: true, note: '归属应用（按 host/app 隔离，例如 chatos/git_app）' },
      { name: 'name', type: 'string', required: true },
      { name: 'url', type: 'string', required: true, note: 'ws/wss/http 入口' },
      { name: 'description', type: 'string', required: false },
      { name: 'auth', type: 'object', required: false, note: 'token / basic / headers' },
      { name: 'callMeta', type: 'object', required: false, note: 'MCP tools/call _meta 注入' },
      { name: 'tags', type: 'string[]', required: false },
      { name: 'locked', type: 'boolean', required: false, note: '内置不可修改' },
      { name: 'enabled', type: 'boolean', required: false, note: '是否启用（未启用则不连接/不注册工具）' },
      { name: 'allowMain', type: 'boolean', required: false, note: '是否允许主代理使用该 MCP 工具' },
      { name: 'allowSub', type: 'boolean', required: false, note: '是否允许子流程/子代理使用该 MCP 工具' },
      { name: 'createdAt', type: 'datetime', required: true },
      { name: 'updatedAt', type: 'datetime', required: true },
    ],
  },
  subagents: {
    name: 'subagents',
    description: '子代理/插件清单',
    columns: [
      { name: 'id', type: 'string', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'description', type: 'string', required: false },
      { name: 'entry', type: 'string', required: true, note: '执行入口 / URL / 二进制路径' },
      { name: 'enabled', type: 'boolean', required: true },
      { name: 'agents', type: 'string[]', required: false, note: '插件内角色/agent 名称' },
      { name: 'tags', type: 'string[]', required: false },
      { name: 'skills', type: 'string[]', required: false, note: '插件内 skill 名称' },
      { name: 'commands', type: 'string[]', required: false, note: '子代理暴露的命令名称' },
      { name: 'createdAt', type: 'datetime', required: true },
      { name: 'updatedAt', type: 'datetime', required: true },
    ],
  },
  prompts: {
    name: 'prompts',
    description: 'Prompt 模板库',
    columns: [
      { name: 'id', type: 'string', required: true },
      { name: 'name', type: 'string', required: true, note: '唯一标识/slug' },
      { name: 'title', type: 'string', required: false, note: '显示名称' },
      { name: 'content', type: 'string', required: true },
      { name: 'variables', type: 'string[]', required: false },
      { name: 'allowMain', type: 'boolean', required: false, note: '是否允许主流程注入/使用' },
      { name: 'allowSub', type: 'boolean', required: false, note: '是否允许子流程/子代理注入/使用' },
      { name: 'builtin', type: 'boolean', required: false, note: '是否内置' },
      { name: 'locked', type: 'boolean', required: false, note: '内置锁定不可改' },
      { name: 'defaultContent', type: 'string', required: false, note: '内置默认文本，用于恢复' },
      { name: 'createdAt', type: 'datetime', required: true },
      { name: 'updatedAt', type: 'datetime', required: true },
    ],
  },
  events: {
    name: 'events',
    description: '对话/工具/子代理事件日志',
    columns: [
      { name: 'id', type: 'string', required: true, note: 'UUID 主键' },
      { name: 'ts', type: 'datetime', required: true, note: '事件时间' },
      { name: 'type', type: 'string', required: true, note: 'user/assistant/tool_call 等' },
      { name: 'payload', type: 'object', required: false, note: '事件数据' },
      { name: 'meta', type: 'object', required: false, note: '附加信息' },
      { name: 'createdAt', type: 'datetime', required: true },
      { name: 'updatedAt', type: 'datetime', required: true },
    ],
  },
  tasks: {
    name: 'tasks',
    description: '任务列表',
    columns: [
      { name: 'id', type: 'string', required: true },
      { name: 'title', type: 'string', required: true },
      { name: 'runId', type: 'string', required: false, note: '终端运行实例 ID（用于隔离多终端）' },
      { name: 'sessionId', type: 'string', required: false, note: '关联的会话 ID' },
      { name: 'status', type: 'string', required: false },
      { name: 'priority', type: 'string', required: false },
      { name: 'tags', type: 'string[]', required: false },
      { name: 'createdAt', type: 'datetime', required: true },
      { name: 'updatedAt', type: 'datetime', required: true },
    ],
  },
  settings: {
    name: 'settings',
    description: '运行/高级配置',
    columns: [
      { name: 'id', type: 'string', required: true, note: '唯一键，默认为 runtime' },
      { name: 'maxToolPasses', type: 'number', required: false, note: '工具调用最大循环次数' },
      { name: 'promptLanguage', type: 'enum(zh|en)', required: false, note: '系统 Prompt 语言版本（影响内置 prompts 选择）' },
      { name: 'landConfigId', type: 'string', required: false, note: 'Land 配置选择' },
      { name: 'summaryTokenThreshold', type: 'number', required: false, note: '自动总结阈值（估算 token）' },
      { name: 'autoRoute', type: 'boolean', required: false, note: '自动路由到子代理' },
      { name: 'logRequests', type: 'boolean', required: false, note: '打印请求 payload' },
      { name: 'streamRaw', type: 'boolean', required: false, note: '流式原样输出，不展示预览/指示器' },
      { name: 'toolPreviewLimit', type: 'number', required: false, note: '工具写文件预览截断' },
      { name: 'retry', type: 'number', required: false, note: '模型重试次数' },
      { name: 'mcpTimeoutMs', type: 'number', required: false, note: 'MCP 单次超时 (ms)' },
      { name: 'mcpMaxTimeoutMs', type: 'number', required: false, note: 'MCP 最大超时 (ms)' },
      { name: 'confirmMainTaskCreate', type: 'boolean', required: false, note: '主流程任务创建确认' },
      { name: 'confirmSubTaskCreate', type: 'boolean', required: false, note: '子流程任务创建确认' },
      { name: 'confirmFileChanges', type: 'boolean', required: false, note: '文件变更确认（含 shell/file MCP）' },
      { name: 'uiTerminalMode', type: 'enum(auto|system|headless)', required: false, note: '浮动岛发消息时的终端模式' },
      { name: 'createdAt', type: 'datetime', required: true },
      { name: 'updatedAt', type: 'datetime', required: true },
    ],
  },
  landConfigs: {
    name: 'landConfigs',
    description: 'Land 配置',
    columns: [
      { name: 'id', type: 'string', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'description', type: 'string', required: false },
      { name: 'main', type: 'object', required: false, note: '主流程关联配置' },
      { name: 'sub', type: 'object', required: false, note: '子流程关联配置' },
      { name: 'locked', type: 'boolean', required: false, note: '内置锁定不可改' },
      { name: 'createdAt', type: 'datetime', required: true },
      { name: 'updatedAt', type: 'datetime', required: true },
    ],
  },
};

export const modelSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'name is required'),
  provider: z.string().trim().min(1, 'provider is required'),
  model: z.string().trim().min(1, 'model is required'),
  reasoningEffort: z
    .union([z.literal(''), z.enum(['low', 'medium', 'high'])])
    .optional()
    .default(''),
  baseUrl: z.string().trim().optional().default(''),
  apiKeyEnv: z.string().trim().optional().default(''),
  tools: z.array(z.string().trim()).optional().default([]),
  description: z.string().trim().optional().default(''),
  isDefault: z.boolean().optional().default(false),
  supportsVision: z.boolean().optional().default(false),
});

export const secretSchema = z.object({
  id: z.string().uuid().optional(),
  name: z
    .string()
    .trim()
    .min(1, 'name is required')
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'name must be a valid env var'),
  value: z.string().trim().min(1, 'value is required'),
  override: z.boolean().optional().default(false),
  description: z.string().trim().optional().default(''),
});

export const mcpServerSchema = z.object({
  id: z.string().uuid().optional(),
  app_id: z.string().trim().min(1, 'app_id is required'),
  name: z.string().trim().min(1, 'name is required'),
  url: z.string().trim().min(1, 'url is required'),
  description: z.string().trim().optional().default(''),
  auth: z
    .object({
      token: z.string().trim().optional(),
      basic: z
        .object({
          username: z.string().trim().optional(),
          password: z.string().trim().optional(),
        })
        .optional(),
      headers: z.record(z.string().trim()).optional(),
    })
    .partial()
    .optional(),
  callMeta: z.record(z.any()).optional(),
  tags: z.array(z.string().trim()).optional().default([]),
  locked: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
  allowMain: z.boolean().optional().default(false),
  allowSub: z.boolean().optional().default(true),
  timeout_ms: z.number().int().min(0).optional(),
  max_timeout_ms: z.number().int().min(0).optional(),
});

export const subagentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'name is required'),
  description: z.string().trim().optional().default(''),
  entry: z.string().trim().min(1, 'entry is required'),
  enabled: z.boolean().default(true),
  agents: z.array(z.string().trim()).optional().default([]),
  tags: z.array(z.string().trim()).optional().default([]),
  skills: z.array(z.string().trim()).optional().default([]),
  commands: z.array(z.string().trim()).optional().default([]),
});

export const promptSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'name is required'),
  title: z.string().trim().optional().default(''),
  content: z.string().trim().min(1, 'content is required'),
  variables: z.array(z.string().trim()).optional().default([]),
  allowMain: z.boolean().optional().default(true),
  allowSub: z.boolean().optional().default(false),
  builtin: z.boolean().optional().default(false),
  locked: z.boolean().optional().default(false),
  defaultContent: z.string().trim().optional().default(''),
});

export const eventSchema = z.object({
  id: z.string().uuid().optional(),
  ts: z.string().datetime().optional(),
  type: z.string().trim().min(1, 'type is required'),
  payload: z.any().optional(),
  meta: z.record(z.any()).optional(),
});

export const taskSchema = z.object({
  id: z.string().trim().optional(),
  title: z.string().trim().min(1, 'title is required'),
  runId: z.string().trim().optional().default(''),
  sessionId: z.string().trim().optional().default(''),
  details: z.string().trim().optional().default(''),
  status: z
    .enum(['todo', 'doing', 'blocked', 'done'])
    .optional()
    .default('todo'),
  priority: z
    .enum(['high', 'medium', 'low'])
    .optional()
    .default('medium'),
  tags: z.array(z.string().trim()).optional().default([]),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const runtimeSettingsSchema = z.object({
  id: z.string().trim().min(1).optional().default('runtime'),
  maxToolPasses: z.number().int().min(1).max(500).optional().default(240),
  promptLanguage: z.enum(['zh', 'en']).optional().default('zh'),
  landConfigId: z.string().trim().optional().default(''),
  summaryTokenThreshold: z.number().int().min(0).max(1_000_000).optional().default(60_000),
  autoRoute: z.boolean().optional().default(false),
  logRequests: z.boolean().optional().default(false),
  streamRaw: z.boolean().optional().default(false),
  toolPreviewLimit: z.number().int().min(0).max(1_000_000).optional().default(6_000),
  retry: z.number().int().min(0).max(10).optional().default(2),
  mcpTimeoutMs: z.number().int().min(1_000).max(1_800_000).optional().default(600_000),
  mcpMaxTimeoutMs: z.number().int().min(1_000).max(1_800_000).optional().default(1_200_000),
  confirmMainTaskCreate: z.boolean().optional().default(false),
  confirmSubTaskCreate: z.boolean().optional().default(false),
  confirmFileChanges: z.boolean().optional().default(false),
  uiPromptWorkdir: z.string().trim().optional().default(''),
  uiTerminalMode: z.enum(['auto', 'system', 'headless']).optional().default('auto'),
});

const landConfigPromptSchema = z.object({
  key: z.string().trim().min(1, 'prompt key is required'),
  lang: z.enum(['zh', 'en']).optional().default('zh'),
});

const landConfigMcpServerSchema = z.object({
  id: z.string().trim().min(1, 'mcp server id is required'),
  name: z.string().trim().optional().default(''),
  promptLang: z.enum(['zh', 'en']).optional().default('zh'),
});

const landConfigAppSchema = z.object({
  pluginId: z.string().trim().min(1, 'pluginId is required'),
  appId: z.string().trim().min(1, 'appId is required'),
  name: z.string().trim().optional().default(''),
});

const landConfigFlowSchema = z.object({
  mcpServers: z.array(landConfigMcpServerSchema).optional().default([]),
  apps: z.array(landConfigAppSchema).optional().default([]),
  prompts: z.array(landConfigPromptSchema).optional().default([]),
});

export const landConfigSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'name is required'),
  description: z.string().trim().optional().default(''),
  main: landConfigFlowSchema.optional().default({ mcpServers: [], apps: [], prompts: [] }),
  sub: landConfigFlowSchema.optional().default({ mcpServers: [], apps: [], prompts: [] }),
  locked: z.boolean().optional().default(false),
});

export const DEFAULT_RUNTIME_SETTINGS = {
  id: 'runtime',
  maxToolPasses: 240,
  promptLanguage: 'zh',
  landConfigId: '',
  summaryTokenThreshold: 60_000,
  autoRoute: false,
  logRequests: false,
  streamRaw: false,
  toolPreviewLimit: 6_000,
  retry: 2,
  mcpTimeoutMs: 600_000,
  mcpMaxTimeoutMs: 1_200_000,
  confirmMainTaskCreate: false,
  confirmSubTaskCreate: false,
  confirmFileChanges: false,
  uiPromptWorkdir: '',
  uiTerminalMode: 'auto',
};

export const DEFAULT_EMPTY_STATE = {
  models: [],
  secrets: [],
  mcpServers: [],
  subagents: [],
  prompts: [],
  events: [],
  tasks: [],
  settings: [],
  landConfigs: [],
};
