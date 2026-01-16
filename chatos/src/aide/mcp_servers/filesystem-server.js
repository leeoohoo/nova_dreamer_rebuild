#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createDb } from '../shared/data/storage.js';
import { SettingsService } from '../shared/data/services/settings-service.js';
import { createFilesystemOps, resolveSessionRoot } from './filesystem/ops.js';
import { registerFilesystemTools } from './filesystem/register-tools.js';
import { createTtyPrompt } from './tty-prompt.js';
import { ensureAppDbPath, resolveAppStateDir } from '../shared/state-paths.js';

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const root = path.resolve(args.root || process.cwd());
const allowWrites = booleanFromArg(args.write) || /write/i.test(String(args.mode || ''));
const serverName = args.name || (allowWrites ? 'code_writer' : 'project_files');
const maxFileBytes = clampNumber(args['max-bytes'], 1024, 1024 * 1024, 256 * 1024);
const searchLimit = clampNumber(args['max-search-results'], 1, 200, 40);
const workspaceNote = `Workspace root: ${root}. Paths must stay inside this directory; absolute or relative paths resolving outside will be rejected.`;

const sessionRoot = resolveSessionRoot();
const runId = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
const fileChangeLogPath =
  process.env.MODEL_CLI_FILE_CHANGES || path.join(resolveAppStateDir(sessionRoot), 'file-changes.jsonl');
const promptLogPath =
  process.env.MODEL_CLI_UI_PROMPTS || path.join(resolveAppStateDir(sessionRoot), 'ui-prompts.jsonl');
const adminDbPath = process.env.MODEL_CLI_TASK_DB || ensureAppDbPath(sessionRoot);

let settingsDb = null;
try {
  const db = createDb({ dbPath: adminDbPath });
  settingsDb = new SettingsService(db);
  settingsDb.ensureRuntime();
} catch {
  settingsDb = null;
}

ensureDir(root, allowWrites);
ensureFileExists(promptLogPath);

const server = new McpServer({
  name: `${serverName}`,
  version: '0.2.0',
});

appendRunPid({ pid: process.pid, kind: 'mcp', name: serverName });

function logProgress(message) {
  console.error(`[${serverName}] ${message}`);
}

function appendRunPid({ pid, kind, name } = {}) {
  const rid = typeof runId === 'string' ? runId.trim() : '';
  const rootDir = typeof sessionRoot === 'string' && sessionRoot.trim() ? sessionRoot.trim() : '';
  const num = Number(pid);
  if (!rid || !rootDir || !Number.isFinite(num) || num <= 0) {
    return;
  }
  const dir = path.join(resolveAppStateDir(rootDir), 'terminals');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  const pidsPath = path.join(dir, `${rid}.pids.jsonl`);
  const payload = {
    ts: new Date().toISOString(),
    runId: rid,
    pid: num,
    kind: typeof kind === 'string' && kind.trim() ? kind.trim() : 'process',
    name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
  };
  try {
    fs.appendFileSync(pidsPath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // ignore
  }
}

const fsOps = createFilesystemOps({
  root,
  serverName,
  fileChangeLogPath,
  logProgress,
  appendRunPid,
});
const { generateUnifiedDiff } = fsOps;

registerFilesystemTools({
  server,
  z,
  workspaceNote,
  allowWrites,
  root,
  maxFileBytes,
  searchLimit,
  fsOps,
  logProgress,
  confirmFileChangeIfNeeded,
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${serverName}] MCP filesystem server ready (root=${root}).`);
}

main().catch((err) => {
  console.error('Filesystem server crashed:', err);
  process.exit(1);
});

function shouldConfirmFileChanges() {
  try {
    const runtime = settingsDb?.getRuntime?.();
    if (!runtime) return false;
    return runtime.confirmFileChanges === true;
  } catch {
    return false;
  }
}

async function confirmFileChangeIfNeeded({
  tool,
  path: filePath,
  mode,
  before,
  afterContent,
  diffOverride,
  messageOverride,
} = {}) {
  if (!allowWrites) return { status: 'skip', requestId: null, remark: '' };
  if (!shouldConfirmFileChanges()) return { status: 'skip', requestId: null, remark: '' };

  const resolvedPath = typeof filePath === 'string' ? filePath.trim() : '';
  const title = '文件变更确认';
  const message =
    typeof messageOverride === 'string' && messageOverride.trim()
      ? messageOverride.trim()
      : `即将执行 ${tool || 'file_change'}（${mode || 'write'}）：${resolvedPath || '<unknown>'}`;

  let diffText = '';
  try {
    if (typeof diffOverride === 'string' && diffOverride.trim()) {
      diffText = diffOverride;
    } else {
      const beforeContent = before?.content ?? '';
      diffText = await generateUnifiedDiff(resolvedPath || '<file>', beforeContent, afterContent ?? '');
    }
  } catch {
    diffText = typeof diffOverride === 'string' ? diffOverride : '';
  }

  const requestId = crypto.randomUUID();
  const promptPayload = {
    kind: 'file_change_confirm',
    title,
    message,
    allowCancel: true,
    source: `${serverName}/${tool || 'file_change'}`,
    path: resolvedPath,
    diff: truncateForUi(diffText, 60_000),
  };
  appendPromptEntry({
    ts: new Date().toISOString(),
    type: 'ui_prompt',
    action: 'request',
    requestId,
    ...(runId ? { runId } : {}),
    prompt: promptPayload,
  });

  const tty = createTtyPrompt();
  const runTtyConfirm = async ({ signal } = {}) => {
    if (!tty) return null;
    tty.writeln('');
    tty.writeln(`[${serverName}] ${promptPayload.title || '文件变更确认'}`);
    tty.writeln('可在 UI 或本终端确认；输入 y 确认继续，直接回车取消。');
    if (promptPayload.message) tty.writeln(promptPayload.message);
    if (promptPayload.path) tty.writeln(`path: ${promptPayload.path}`);
    if (promptPayload.source) tty.writeln(`source: ${promptPayload.source}`);
    const shownDiff = typeof diffText === 'string' ? truncateForUi(diffText, 20_000) : '';
    if (shownDiff && shownDiff.trim()) {
      tty.writeln('');
      tty.writeln('--- diff (truncated) ---');
      tty.writeln(shownDiff.trimEnd());
      tty.writeln('--- end diff ---');
    }
    const answerRaw = await tty.ask('确认继续？(y/N) ', { signal });
    if (answerRaw == null) return null;
    const answer = answerRaw.trim().toLowerCase();
    const ok = answer === 'y' || answer === 'yes';
    const remarkRaw = await tty.ask('备注（可选，直接回车跳过）： ', { signal });
    if (remarkRaw == null) return null;
    const remark = remarkRaw.trim();
    return { status: ok ? 'ok' : 'canceled', remark };
  };

  if (tty && tty.backend === 'tty') {
    try {
      const terminalResult = await runTtyConfirm();
      if (!terminalResult) return { status: 'canceled', requestId, remark: '' };
      appendPromptEntry({
        ts: new Date().toISOString(),
        type: 'ui_prompt',
        action: 'response',
        requestId,
        ...(runId ? { runId } : {}),
        response: terminalResult,
      });
      return { status: terminalResult.status, requestId, remark: terminalResult.remark || '' };
    } finally {
      tty.close();
    }
  }

  if (tty && tty.backend === 'auto') {
    const abort = new AbortController();
    try {
      const uiWait = waitForPromptResponse({ requestId }).then((entry) => ({ kind: 'ui', entry }));
      const ttyWait = runTtyConfirm({ signal: abort.signal }).then((res) => ({ kind: 'tty', res }));
      const first = await Promise.race([uiWait, ttyWait]);
      if (first.kind === 'ui') {
        abort.abort();
        const response = first.entry;
        const status = normalizeResponseStatus(response?.response?.status);
        const remark = typeof response?.response?.remark === 'string' ? response.response.remark : '';
        return { status: status === 'ok' ? 'ok' : 'canceled', requestId, remark };
      }
      const terminalResult = first.res;
      if (!terminalResult) {
        // TTY was aborted; wait for UI response.
        const response = await waitForPromptResponse({ requestId });
        const status = normalizeResponseStatus(response?.response?.status);
        const remark = typeof response?.response?.remark === 'string' ? response.response.remark : '';
        return { status: status === 'ok' ? 'ok' : 'canceled', requestId, remark };
      }
      appendPromptEntry({
        ts: new Date().toISOString(),
        type: 'ui_prompt',
        action: 'response',
        requestId,
        ...(runId ? { runId } : {}),
        response: terminalResult,
      });
      return { status: terminalResult.status, requestId, remark: terminalResult.remark || '' };
    } finally {
      abort.abort();
      tty.close();
    }
  }

  const response = await waitForPromptResponse({ requestId });
  const status = normalizeResponseStatus(response?.response?.status);
  const remark = typeof response?.response?.remark === 'string' ? response.response.remark : '';
  if (status !== 'ok') {
    return { status: 'canceled', requestId, remark };
  }
  return { status: 'ok', requestId, remark };
}

function truncateForUi(text, maxChars) {
  const value = typeof text === 'string' ? text : text == null ? '' : String(text);
  const limit = Number.isFinite(Number(maxChars)) ? Number(maxChars) : 60_000;
  if (limit <= 0) return value;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n... (truncated ${value.length - limit} chars)`;
}

function appendPromptEntry(entry) {
  try {
    ensureFileExists(promptLogPath);
    fs.appendFileSync(promptLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // ignore
  }
}

async function waitForPromptResponse({ requestId }) {
  let watcher = null;
  let poll = null;
  const cleanup = () => {
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
      watcher = null;
    }
    if (poll) {
      clearInterval(poll);
      poll = null;
    }
  };
  return await new Promise((resolve) => {
    const tryRead = () => {
      const found = findLatestPromptResponse(requestId);
      if (found) {
        cleanup();
        resolve(found);
      }
    };
    try {
      watcher = fs.watch(promptLogPath, { persistent: false }, () => tryRead());
      if (watcher && typeof watcher.on === 'function') {
        watcher.on('error', (err) => {
          // fs.watch is flaky on some Windows setups / network drives; falling back to polling avoids crashing the server.
          try {
            console.error(`[${serverName}] prompt log watcher error: ${err?.message || err}`);
          } catch {
            // ignore
          }
          try {
            watcher?.close?.();
          } catch {
            // ignore
          }
          watcher = null;
        });
      }
    } catch {
      watcher = null;
    }
    poll = setInterval(tryRead, 800);
    if (poll && typeof poll.unref === 'function') {
      poll.unref();
    }
    tryRead();
  });
}

function findLatestPromptResponse(requestId) {
  try {
    if (!fs.existsSync(promptLogPath)) {
      return null;
    }
    const raw = fs.readFileSync(promptLogPath, 'utf8');
    const lines = raw.split('\n').filter((line) => line && line.trim().length > 0);
    let match = null;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (
          parsed &&
          typeof parsed === 'object' &&
          parsed.type === 'ui_prompt' &&
          parsed.action === 'response' &&
          parsed.requestId === requestId
        ) {
          match = parsed;
        }
      } catch {
        // ignore parse errors
      }
    }
    return match;
  } catch {
    return null;
  }
}

function normalizeResponseStatus(status) {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (value === 'ok' || value === 'canceled' || value === 'timeout') {
    return value;
  }
  if (!value) return 'ok';
  return 'ok';
}

function parseArgs(input) {
  const result = { _: [] };
  for (let i = 0; i < input.length; i += 1) {
    const token = input[i];
    if (!token.startsWith('-')) {
      result._.push(token);
      continue;
    }
    const isLong = token.startsWith('--');
    const key = isLong ? token.slice(2) : token.slice(1);
    if (!key) continue;
    const [name, inline] = key.split('=');
    if (inline !== undefined) {
      result[name] = inline;
      continue;
    }
    const next = input[i + 1];
    if (next && !next.startsWith('-')) {
      result[name] = next;
      i += 1;
    } else {
      result[name] = true;
    }
  }
  return result;
}

function booleanFromArg(value) {
  if (value === true) return true;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  if (text === '1' || text === 'true' || text === 'yes' || text === 'y') return true;
  return false;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.min(Math.max(parsed, min), max);
  }
  return fallback;
}

function ensureDir(targetDir, writable) {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch {
    // ignore
  }
  try {
    fs.accessSync(targetDir, fs.constants.R_OK);
    if (writable) {
      fs.accessSync(targetDir, fs.constants.W_OK);
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      fs.mkdirSync(targetDir, { recursive: true });
      return;
    }
    throw err;
  }
}

function ensureFileExists(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    // ignore
  }
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
  } catch {
    // ignore
  }
}

function printHelp() {
  console.log(
    [
      'Usage: node filesystem-server.js [--root <path>] [--write] [--name <id>] [--max-bytes <n>]',
      '',
      'Options:',
      '  --root <path>            MCP root (default current directory)',
      '  --write                  Enable write/delete tools',
      '  --mode <read|write>      Compatibility flag; write == --write',
      '  --name <id>              MCP server name (for logging)',
      '  --max-bytes <n>          Max bytes to read per file (default 256KB)',
      '  --max-search-results <n> Max search hits to return (default 40)',
      '  --help                   Show help',
    ].join('\n')
  );
}
