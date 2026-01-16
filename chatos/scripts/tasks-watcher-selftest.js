#!/usr/bin/env node
// Self-test for Electron session-api tasks watcher:
// - <hostApp>.db.sqlite is written via atomic rename (createDb)
// - UI should still receive config:update without restarting
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { createDb } from '../src/common/admin-data/storage.js';
import { createAdminServices } from '../src/common/admin-data/services/index.js';
import { resolveAideRoot } from '../src/aide-paths.js';
import { createSessionApi } from '../electron/session-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const cliRoot = resolveAideRoot({ projectRoot });
if (!cliRoot) {
  throw new Error('AIDE sources not found (expected ./src/aide relative to chatos).');
}

const ROOT =
  process.env.ROOT ||
  path.join(process.cwd(), 'tmp', `tasks-watcher-selftest-${Date.now().toString(36)}`);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, { timeoutMs = 2000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (predicate()) return true;
    } catch {
      // ignore predicate errors while waiting
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs);
  }
  return false;
}

async function main() {
  const hostApp =
    String(process.env.MODEL_CLI_HOST_APP || 'chatos')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'chatos';
  process.env.MODEL_CLI_HOST_APP = hostApp;
  console.log('[setup]', { root: ROOT });
  const stateDir = path.join(ROOT, '.deepseek_cli', hostApp);
  const authDir = path.join(stateDir, 'auth');
  ensureDir(authDir);

  const defaultPaths = {
    defaultsRoot: cliRoot,
    models: path.join(authDir, 'models.yaml'),
    systemPrompt: path.join(authDir, 'system-prompt.yaml'),
    systemDefaultPrompt: path.join(authDir, 'system-default-prompt.yaml'),
    systemUserPrompt: path.join(authDir, 'system-user-prompt.yaml'),
    subagentSystemPrompt: path.join(authDir, 'subagent-system-prompt.yaml'),
    subagentUserPrompt: path.join(authDir, 'subagent-user-prompt.yaml'),
    mcpConfig: path.join(authDir, 'mcp.config.json'),
    sessionReport: path.join(authDir, 'session-report.html'),
    events: path.join(stateDir, 'events.jsonl'),
    fileChanges: path.join(stateDir, 'file-changes.jsonl'),
    uiPrompts: path.join(stateDir, 'ui-prompts.jsonl'),
    runs: path.join(stateDir, 'runs.jsonl'),
    marketplace: path.join(cliRoot, 'subagents', 'marketplace.json'),
    marketplaceUser: path.join(stateDir, 'subagents', 'marketplace.json'),
    pluginsDir: path.join(cliRoot, 'subagents', 'plugins'),
    pluginsDirUser: path.join(stateDir, 'subagents', 'plugins'),
    installedSubagents: path.join(stateDir, 'subagents.json'),
    adminDb: path.join(stateDir, `${hostApp}.db.sqlite`),
  };

  const adminDb = createDb({ dbPath: defaultPaths.adminDb });
  const adminServices = createAdminServices(adminDb);

  const sent = [];
  const mainWindow = {
    webContents: {
      send: (channel, payload) => {
        sent.push({ channel, payload });
      },
    },
  };

  const sessionApi = createSessionApi({
    defaultPaths,
    adminDb,
    adminServices,
    mainWindowGetter: () => mainWindow,
  });

  sessionApi.startTasksWatcher();
  console.log('[watch] started');

  const title = 'watcher should refresh tasks';
  adminServices.tasks.addTask({
    title,
    details: '背景: 自检脚本写入任务\n验收: UI watcher 收到 config:update 并包含该任务',
    priority: 'medium',
    status: 'todo',
    tags: ['selftest'],
    runId: 'run-selftest',
    sessionId: 'session-selftest',
  });
  console.log('[write] task inserted');

  const ok = await waitFor(
    () =>
      sent.some(
        (e) =>
          e.channel === 'config:update' &&
          Array.isArray(e.payload?.tasksList) &&
          e.payload.tasksList.some((t) => t?.title === title)
      ),
    { timeoutMs: 2500 }
  );

  const configUpdates = sent.filter((e) => e.channel === 'config:update');
  if (!ok) {
    console.error('[fail] did not observe tasks in config:update', { configUpdates: configUpdates.length });
    process.exitCode = 1;
  } else {
    console.log('[ok] observed config:update with task', { configUpdates: configUpdates.length });
  }

  // Sanity: ensure we did not accidentally create a self-triggering loop.
  const before = configUpdates.length;
  await sleep(400);
  const after = sent.filter((e) => e.channel === 'config:update').length;
  if (after - before > 5) {
    console.error('[fail] suspicious config:update loop detected', { before, after });
    process.exitCode = 1;
  }

  sessionApi.dispose();
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

main().catch((err) => {
  console.error('[selftest error]', err?.message || err);
  process.exit(1);
});
