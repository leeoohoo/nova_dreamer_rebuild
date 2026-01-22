import path from 'node:path';
import { createMcpServer } from '../src/mcp-server.mjs';
import { pollForResult } from '../src/lib/ui-prompts.mjs';
import { ensureDir } from '../src/lib/utils.mjs';

export const runTest = async ({ rootDir }) => {
  const stateDir = path.join(rootDir, '.state');
  const dataDir = path.join(stateDir, 'ui_apps', 'data', 'com.example.chatos_scaffold');
  await ensureDir(dataDir);

  const server = createMcpServer({
    toolHandlers: {
      app_task_run: async (args) => ({
        ok: true,
        echo: args?.prompt || '',
      }),
    },
  });

  const init = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {},
  });

  const list = await server.handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });

  const taskId = `task_${Date.now()}`;
  const call = await server.handleRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'app_task_run',
      arguments: { prompt: 'Hello from sandbox' },
      _meta: {
        taskId,
        sessionId: 'session_test',
        stateDir,
        dataDir,
        runId: 'run_test',
        source: 'sandbox',
      },
    },
  });

  const result = await pollForResult({ stateDir, requestId: taskId, intervalMs: 200, timeoutMs: 5000 });

  return { init, list, call, result };
};
