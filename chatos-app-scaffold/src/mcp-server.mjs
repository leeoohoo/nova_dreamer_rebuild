import readline from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAsyncTaskManager } from './lib/async-task.mjs';
import { appendResultPrompt } from './lib/ui-prompts.mjs';
import { createStateManager } from './lib/state-manager.mjs';
import { createLogger, makeId, normalizeString, nowIso, sleep } from './lib/utils.mjs';

const DEFAULT_TOOL_NAME = 'app_task_run';

const DEFAULT_TOOLS = [
  {
    name: DEFAULT_TOOL_NAME,
    description: 'Run an async task and return results via ui-prompts.jsonl.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Task instructions.' },
        priority: { type: 'string', description: 'Optional priority.' },
      },
      required: ['prompt'],
    },
  },
];

const jsonRpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const jsonRpcError = (id, code, message, data) => ({
  jsonrpc: '2.0',
  id,
  error: {
    code,
    message,
    data: data ?? undefined,
  },
});

const toolResultText = (text) => ({
  content: [{ type: 'text', text }],
});

const resolveStateDir = (meta) =>
  normalizeString(meta?.stateDir) || normalizeString(meta?.hostStateDir) || process.env.CHATOS_STATE_DIR || process.cwd();

const resolveDataDir = (meta, stateDir) =>
  normalizeString(meta?.dataDir) || normalizeString(meta?.pluginDataDir) || path.join(stateDir, 'ui_apps', 'data');

const formatResultMarkdown = (task) => {
  if (!task) return 'No result.';
  const result = task.result;
  if (typeof result === 'string') return result;
  if (result === null || result === undefined) return 'No result.';
  if (typeof result === 'object') {
    try {
      return `\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
    } catch {
      return String(result);
    }
  }
  return String(result);
};

const defaultToolHandlers = {
  async [DEFAULT_TOOL_NAME](args) {
    const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : '';
    if (!prompt) throw new Error('prompt is required');
    await sleep(200);
    return {
      ok: true,
      summary: `Processed task: ${prompt}`,
    };
  },
};

const isActiveStatus = (status) => status === 'todo' || status === 'doing' || status === 'blocked';

export const createMcpServer = ({
  tools = DEFAULT_TOOLS,
  toolHandlers = {},
  taskIdKey = 'taskId',
  defaultTimeoutMs = 10 * 60 * 1000,
  logger = createLogger({ prefix: 'scaffold-mcp' }),
} = {}) => {
  const handlers = { ...defaultToolHandlers, ...toolHandlers };
  const taskManager = createAsyncTaskManager({ defaultTimeoutMs, logger });
  const stateManagers = new Map();
  let initialized = false;

  const getStateManager = async (meta) => {
    const stateDir = resolveStateDir(meta);
    const dataDir = resolveDataDir(meta, stateDir);
    const key = `${stateDir}::${dataDir}`;
    if (!stateManagers.has(key)) {
      const manager = createStateManager({ dataDir, logger });
      await manager.load();
      stateManagers.set(key, manager);
    }
    return stateManagers.get(key);
  };

  const updateSessionRunning = async (sessionId, meta) => {
    if (!sessionId) return;
    const stillActive = taskManager
      .listTasks()
      .some((task) => task?.meta?.sessionId === sessionId && isActiveStatus(task.status));

    const state = await getStateManager(meta);
    state.upsertSession({ id: sessionId, running: stillActive, updatedAt: nowIso() });
    await state.flush();
  };

  taskManager.on('update', async (task) => {
    try {
      const state = await getStateManager(task.meta || {});
      state.setTask(task);
    } catch (err) {
      logger.warn('failed to persist task', { message: err?.message || String(err) });
    }
  });

  taskManager.on('done', async (task) => {
    try {
      const stateDir = resolveStateDir(task.meta || {});
      await appendResultPrompt({
        stateDir,
        requestId: task.id,
        runId: task.meta?.runId || '',
        title: 'Task Result',
        message: `Task ${task.id} completed`,
        markdown: formatResultMarkdown(task),
        source: task.meta?.source || '',
        allowCancel: true,
      });
      await updateSessionRunning(task.meta?.sessionId, task.meta || {});
    } catch (err) {
      logger.warn('failed to write result prompt', { message: err?.message || String(err) });
    }
  });

  taskManager.on('error', async (task) => {
    try {
      await updateSessionRunning(task.meta?.sessionId, task.meta || {});
    } catch (err) {
      logger.warn('failed to update session status', { message: err?.message || String(err) });
    }
  });

  const handleToolCall = async (id, params) => {
    const name = normalizeString(params?.name);
    const args = params?.arguments || {};
    const meta = params?._meta || {};

    if (!name) return jsonRpcError(id, -32602, 'tool name is required');
    if (!handlers[name]) return jsonRpcError(id, -32601, `Unknown tool: ${name}`);

    const metaTaskId = normalizeString(meta?.[taskIdKey]);
    const taskId = metaTaskId || normalizeString(args?.[taskIdKey]) || makeId('task');
    const sessionId = normalizeString(meta?.sessionId);

    const state = await getStateManager(meta);
    if (sessionId) {
      state.upsertSession({ id: sessionId, running: true, updatedAt: nowIso() });
      await state.flush();
    }

    taskManager.enqueue({
      id: taskId,
      type: name,
      payload: args,
      meta: {
        sessionId,
        runId: normalizeString(meta?.runId),
        source: normalizeString(meta?.source),
        stateDir: resolveStateDir(meta),
        dataDir: resolveDataDir(meta, resolveStateDir(meta)),
      },
      async run(task) {
        const handler = handlers[name];
        return await handler(task.payload, { taskId, sessionId, meta });
      },
    });

    return jsonRpcResult(id, toolResultText(`ACK: queued task ${taskId}`));
  };

  const handleRequest = async (req) => {
    const id = req?.id;
    const method = String(req?.method || '');
    const params = req?.params;

    if (!method) return null;

    if (method === 'initialize') {
      initialized = true;
      return jsonRpcResult(id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'chatos-app-scaffold', version: '0.1.0' },
        capabilities: { tools: {} },
      });
    }

    if (!initialized) {
      return jsonRpcError(id, -32002, 'Server not initialized');
    }

    if (method === 'tools/list') {
      return jsonRpcResult(id, { tools });
    }

    if (method === 'tools/call') {
      return await handleToolCall(id, params);
    }

    if (method === 'shutdown') {
      return jsonRpcResult(id, { ok: true });
    }

    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  };

  return {
    handleRequest,
  };
};

const startStdioServer = () => {
  const server = createMcpServer();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on('line', async (line) => {
    const raw = String(line || '').trim();
    if (!raw) return;

    let req;
    try {
      req = JSON.parse(raw);
    } catch (err) {
      const resp = jsonRpcError(null, -32700, 'Parse error', { message: err?.message || String(err) });
      process.stdout.write(`${JSON.stringify(resp)}\n`);
      return;
    }

    if (!req || typeof req !== 'object') return;
    if (req.jsonrpc !== '2.0') return;
    if (req.id === undefined) return;

    try {
      const resp = await server.handleRequest(req);
      if (resp) process.stdout.write(`${JSON.stringify(resp)}\n`);
    } catch (err) {
      const resp = jsonRpcError(req.id, -32000, err?.message || String(err));
      process.stdout.write(`${JSON.stringify(resp)}\n`);
    }
  });
};

const isMain = () => {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
};

if (isMain()) {
  startStdioServer();
}
