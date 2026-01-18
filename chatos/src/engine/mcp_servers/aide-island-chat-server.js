#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { StringDecoder } from 'string_decoder';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolveSessionRoot } from '../shared/session-root.js';
import { ensureAppDbPath, resolveAppStateDir } from '../shared/state-paths.js';
import { createDb } from '../shared/data/storage.js';
import { SettingsService } from '../shared/data/services/settings-service.js';
import { getSystemTerminalLauncher } from '../../../electron/terminal-manager/system-terminal/launcher.js';

const MAX_WAIT_MS = 2_147_483_647; // ~24.8 days (max safe setTimeout)

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const serverName = safeTrim(args.name) || 'aide_island_chat';
assertStdioOnly(args);

const sessionRootArg = safeTrim(args['session-root']);
const sessionRoot = sessionRootArg ? path.resolve(String(sessionRootArg)) : resolveSessionRoot();
const workspaceRoot = safeTrim(args['workspace-root'])
  ? path.resolve(String(args['workspace-root']))
  : process.env.MODEL_CLI_WORKSPACE_ROOT
    ? path.resolve(process.env.MODEL_CLI_WORKSPACE_ROOT)
    : process.cwd();

const stateDir = resolveAppStateDir(sessionRoot, { preferSessionRoot: Boolean(sessionRootArg) });
const terminalDir = path.join(stateDir, 'terminals');
const runsPath = process.env.MODEL_CLI_RUNS || path.join(stateDir, 'runs.jsonl');
const eventLogPath = process.env.MODEL_CLI_EVENT_LOG || path.join(stateDir, 'events.jsonl');
const adminDbPath = process.env.MODEL_CLI_TASK_DB || ensureAppDbPath(sessionRoot);

ensureDir(stateDir);
ensureDir(terminalDir);
ensureFileExists(runsPath);
ensureFileExists(eventLogPath);

let settingsDb = null;
try {
  ensureDir(path.dirname(adminDbPath));
  const db = createDb({ dbPath: adminDbPath });
  settingsDb = new SettingsService(db);
  settingsDb.ensureRuntime();
} catch (err) {
  settingsDb = null;
  console.error(`[${serverName}] settings DB init failed: ${err?.message || err}`);
}

const server = new McpServer(
  {
    name: serverName,
    version: '0.1.0',
  },
  {
    capabilities: {
      logging: {},
    },
  }
);

const inflightRunIds = new Set();

server.registerPrompt(
  'aide_island_chat',
  {
    title: 'AIDE Island Chat',
    description:
      'How to use the aide_island_chat MCP server to chat with an AIDE run via the floating island channel, with streaming event log updates.',
    argsSchema: {
      language: z.enum(['zh', 'en']).optional().describe('Prompt language (default zh)'),
    },
  },
  async ({ language } = {}) => {
    const lang = typeof language === 'string' ? language.trim().toLowerCase() : '';
    const isEn = lang === 'en';
    const text = isEn
      ? [
          'You can chat with AIDE via the floating-island run channel and stream progress back to the caller.',
          '',
          'Tools:',
          '- list_sessions: list runs and pick a run_id.',
          '- island_chat: send {text, run_id?} and receive streaming updates via notifications.',
          '- get_session_summary: get the latest summary for a run_id.',
          '',
          'Note: if your client prefixes tools (e.g. AIDE CLI runtime), they may appear as mcp_aide_island_chat_*.',
          '',
          'Streaming contract:',
          '- During island_chat, the server emits MCP notifications/message.',
          '- params.data.type = "meta" or "event".',
          '- When type="event", params.data.entry is the raw events.jsonl entry (ts/type/payload/runId).',
          '',
          'Runtime toggles (optional, defaults to current runtime settings):',
          '- confirm_main_task_create / confirm_sub_task_create / confirm_file_changes',
          '- ui_terminal_mode: auto | system | headless',
          '- persist_settings: true by default; set false to apply overrides for this call only.',
        ].join('\n')
      : [
          '你可以通过 AIDE 的“灵动岛/终端 run”通道发起聊天，并把全过程（含子代理）以 MCP notifications 流式回传给调用方。',
          '',
          '工具：',
          '- list_sessions：列出会话（run_id）并选择目标。',
          '- island_chat：发送 {text, run_id?}，并在调用期间通过 notifications 流式返回事件。',
          '- get_session_summary：获取某个 run_id 的最新总结。',
          '',
          '备注：如果你的客户端会给工具加前缀（例如 AIDE 的 MCP runtime），它们可能表现为 mcp_aide_island_chat_*。',
          '',
          '流式约定：',
          '- island_chat 进行中，服务端会发送 MCP notifications/message。',
          '- params.data.type = "meta" 或 "event"。',
          '- 当 type="event" 时，params.data.entry 为 events.jsonl 的原始条目（ts/type/payload/runId）。',
          '',
          '灵动岛开关（可选，不传则使用当前默认值）：',
          '- confirm_main_task_create / confirm_sub_task_create / confirm_file_changes',
          '- ui_terminal_mode: auto | system | headless（拉起终端）',
          '- persist_settings：默认 true；设为 false 表示仅本次临时覆盖，结束后恢复。',
        ].join('\n');

    return {
      messages: [
        {
          role: 'system',
          content: {
            type: 'text',
            text,
          },
        },
      ],
    };
  }
);

server.registerTool(
  'list_sessions',
  {
    title: 'List AIDE sessions (runs)',
    description:
      [
        'List known AIDE runs from the shared session root.',
        'Each session is identified by run_id (the same value used by the floating island / terminal control channel).',
      ].join('\n'),
    inputSchema: z.object({
      active_only: z.boolean().optional().describe('Only include sessions with a live PID (default false)'),
      limit: z.number().int().min(1).max(500).optional().describe('Maximum number of sessions to return (default 50)'),
    }),
  },
  async (input) => {
    ensureFileExists(runsPath);
    ensureDir(terminalDir);
    const activeOnly = input?.active_only === true;
    const limit = clampNumber(input?.limit, 1, 500, 50);

    const registry = readRunsRegistry(runsPath);
    const latestByRunId = new Map();
    registry.forEach((entry) => {
      const runId = normalizeRunId(entry?.runId);
      if (!runId) return;
      const prev = latestByRunId.get(runId);
      const ts = typeof entry?.ts === 'string' ? entry.ts : '';
      if (!prev || String(ts || '') >= String(prev.ts || '')) {
        latestByRunId.set(runId, entry);
      }
    });

    const sessions = Array.from(latestByRunId.values())
      .map((entry) => {
        const runId = normalizeRunId(entry?.runId);
        const status = runId ? readTerminalStatus({ terminalDir, runId }) : null;
        const pid = Number(status?.pid || entry?.pid) || 0;
        const alive = pid ? isPidAlive(pid) : false;
        const state = typeof status?.state === 'string' && status.state ? status.state : alive ? 'unknown' : 'exited';
        return {
          run_id: runId,
          pid,
          alive,
          state,
          updated_at: typeof status?.updatedAt === 'string' ? status.updatedAt : '',
          ts: typeof entry?.ts === 'string' ? entry.ts : '',
          cwd: typeof entry?.cwd === 'string' ? entry.cwd : '',
          workspace_root: typeof entry?.workspaceRoot === 'string' ? entry.workspaceRoot : '',
          session_root: typeof entry?.sessionRoot === 'string' ? entry.sessionRoot : '',
          command: typeof entry?.command === 'string' ? entry.command : '',
          args: Array.isArray(entry?.args) ? entry.args : [],
        };
      })
      .filter((sess) => (activeOnly ? sess.alive && sess.state !== 'exited' : true))
      .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))
      .slice(0, limit);

    return structuredResponse(`ok (${sessions.length} sessions)`, { ok: true, sessions });
  }
);

server.registerTool(
  'get_session_summary',
  {
    title: 'Get last session summary',
    description:
      [
        'Return the latest auto/forced summary for a given run_id.',
        'Summaries are emitted into the shared event log as type="summary".',
        '',
        'If no summary event is found, the server will attempt a best-effort fallback by searching for assistant messages that look like a summary.',
      ].join('\n'),
    inputSchema: z.object({
      run_id: z.string().min(1).describe('Target runId'),
      max_scan_bytes: z
        .number()
        .int()
        .min(64 * 1024)
        .max(256 * 1024 * 1024)
        .optional()
        .describe('Maximum bytes to scan from the end of the event log (default 32MB)'),
    }),
  },
  async (input) => {
    const runId = normalizeRunId(input?.run_id);
    if (!runId) {
      return structuredResponse('run_id is required', { ok: false, error: 'run_id is required' });
    }
    ensureFileExists(eventLogPath);
    const maxScanBytes = clampNumber(input?.max_scan_bytes, 64 * 1024, 256 * 1024 * 1024, 32 * 1024 * 1024);

    const findSummaryEntry = () =>
      readLastJsonlEntry(eventLogPath, {
        maxScanBytes,
        predicate: (entry) => normalizeRunId(entry?.runId) === runId && String(entry?.type || '') === 'summary',
      });
    const findAssistantFallback = () =>
      readLastJsonlEntry(eventLogPath, {
        maxScanBytes,
        predicate: (entry) => {
          if (normalizeRunId(entry?.runId) !== runId) return false;
          if (String(entry?.type || '') !== 'assistant') return false;
          const payload = entry?.payload && typeof entry.payload === 'object' ? entry.payload : null;
          const text = payload && typeof payload.text === 'string' ? payload.text.trim() : '';
          return text.startsWith('【会话总结') || text.toLowerCase().startsWith('[summary]');
        },
      });

    const summaryEntry = findSummaryEntry() || findAssistantFallback();
    if (!summaryEntry) {
      return structuredResponse('No summary found for this run.', { ok: false, error: 'not_found', run_id: runId });
    }

    const type = String(summaryEntry.type || '');
    const payload = summaryEntry.payload && typeof summaryEntry.payload === 'object' ? summaryEntry.payload : null;
    const summaryText =
      type === 'summary'
        ? typeof payload?.text === 'string'
          ? payload.text
          : ''
        : type === 'assistant'
          ? typeof payload?.text === 'string'
            ? payload.text
            : ''
          : '';

    return structuredResponse(summaryText || `ok (run_id=${runId})`, {
      ok: true,
      run_id: runId,
      summary: summaryText || '',
      ts: typeof summaryEntry?.ts === 'string' ? summaryEntry.ts : '',
      source: type || '',
    });
  }
);

server.registerTool(
  'island_chat',
  {
    title: 'Chat via AIDE floating island',
    description:
      [
        'Send a message into an AIDE CLI run (the same channel used by the Electron "灵动岛" floating island).',
        'Streams the run event log back to the caller via MCP notifications/message.',
        '',
        'Notes:',
        '- If run_id is omitted, uses the only active run (if exactly one), otherwise starts a new run.',
        '- Streaming events are emitted as MCP notifications/message with structured JSON data.',
      ].join('\n'),
    inputSchema: z.object({
      text: z.string().min(1).describe('Message to send to AIDE'),
      run_id: z.string().optional().describe('Target runId (optional)'),
      force: z.boolean().optional().describe('If true, stops current run output then sends message (optional)'),
      timeout_ms: z.number().int().min(0).max(MAX_WAIT_MS).optional().describe('Wait timeout (ms); 0 disables'),
      confirm_main_task_create: z
        .boolean()
        .optional()
        .describe('Override runtime setting: confirmMainTaskCreate (optional)'),
      confirm_sub_task_create: z
        .boolean()
        .optional()
        .describe('Override runtime setting: confirmSubTaskCreate (optional)'),
      confirm_file_changes: z
        .boolean()
        .optional()
        .describe('Override runtime setting: confirmFileChanges (optional)'),
      ui_terminal_mode: z
        .enum(['auto', 'system', 'headless'])
        .optional()
        .describe('Override runtime setting: uiTerminalMode (optional)'),
      persist_settings: z
        .boolean()
        .optional()
        .describe('If false, apply overrides temporarily for this request only (default true)'),
    }),
  },
  async (input, extra) => {
    const text = safeTrim(input?.text);
    if (!text) {
      return structuredResponse('text is required', { ok: false, error: 'text is required' });
    }

    const injectedWorkdir = safeTrim(extra?._meta?.workdir);
    const force = input?.force === true;
    const timeoutMs = normalizeTimeoutMs(input?.timeout_ms, 120_000);
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : null;

    let runId = normalizeRunId(input?.run_id);
    let created = false;

    if (!runId) {
      const active = listActiveRuns({ terminalDir });
      if (active.length === 1) {
        runId = active[0].runId;
      } else if (active.length === 0) {
        runId = generateRunId();
        created = true;
      } else {
        return structuredResponse(
          'Multiple active runs detected; please specify run_id.',
          { ok: false, error: 'multiple_active_runs', active_run_ids: active.map((r) => r.runId) }
        );
      }
    }

    if (inflightRunIds.has(runId)) {
      return structuredResponse('Run is busy (another request in progress).', { ok: false, error: 'run_locked', run_id: runId });
    }

    inflightRunIds.add(runId);
    try {
      ensureFileExists(eventLogPath);
      const persistSettings = input?.persist_settings !== false;
      const runtimePatch = buildRuntimeSettingsPatch(input);
      let runtimeRestore = null;
      const currentRuntime = settingsDb ? readRuntimeSettings() : null;
      const effectiveUiTerminalMode = resolveEffectiveUiTerminalMode({
        requested: runtimePatch?.uiTerminalMode,
        current: currentRuntime?.uiTerminalMode,
      });

      if (runtimePatch && Object.keys(runtimePatch).length > 0) {
        if (!settingsDb) {
          return structuredResponse('Runtime settings DB unavailable.', { ok: false, error: 'settings_db_unavailable' });
        }
        if (!persistSettings && currentRuntime) {
          runtimeRestore = buildRuntimeSettingsRestore(runtimePatch, currentRuntime);
        }
        try {
          settingsDb.saveRuntime(runtimePatch);
        } catch (err) {
          return structuredResponse(`Failed to update runtime settings: ${err?.message || err}`, {
            ok: false,
            error: 'settings_update_failed',
          });
        }
      }

      const ensured = await ensureCliRunReady({
        runId,
        sessionRoot,
        workspaceRoot,
        cwd: injectedWorkdir || safeTrim(input?.cwd),
        deadline,
        uiTerminalMode: effectiveUiTerminalMode,
      });
      created = created || ensured.created;

      const statusBefore = readTerminalStatus({ terminalDir, runId });
      if (statusBefore?.state === 'running' && !force) {
        return structuredResponse('Run is currently running; set force=true to interrupt.', {
          ok: false,
          error: 'busy',
          run_id: runId,
          current_message: typeof statusBefore?.currentMessage === 'string' ? statusBefore.currentMessage : '',
        });
      }

      const emit = createEmitter(extra, serverName);
      await emit({
        type: 'meta',
        event: 'run_selected',
        run_id: runId,
        created,
      });

      let lastAssistantText = '';
      let lastAssistantTs = '';
      const tailer = createJsonlTailer(eventLogPath, {
        startCursor: readFileSize(eventLogPath),
        pollIntervalMs: 200,
        onEntry: async (entry) => {
          if (!entry || typeof entry !== 'object') return;
          if (normalizeRunId(entry.runId) !== runId) return;
          if (String(entry.type || '') === 'assistant') {
            const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : null;
            const stage = payload && typeof payload.stage === 'string' ? payload.stage : '';
            const text = payload && typeof payload.text === 'string' ? payload.text : '';
            if (text) {
              // Prefer the final assistant reply (no stage, or explicitly "final").
              if (!stage || stage === 'final') {
                lastAssistantText = text;
                lastAssistantTs = typeof entry.ts === 'string' ? entry.ts : '';
              }
            }
          }
          await emit({
            type: 'event',
            entry,
          });
        },
      });

      let tailerClosed = false;
      const closeAll = () => {
        if (tailerClosed) return;
        tailerClosed = true;
        try {
          tailer.close();
        } catch {}
      };

      const abortSignal = extra?.signal;
      const onAbort = () => {
        closeAll();
      };
      if (abortSignal && typeof abortSignal.addEventListener === 'function') {
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        dispatchToRun({ terminalDir, runId, text, force });
        await emit({ type: 'meta', event: 'message_dispatched', run_id: runId });

        const idleResult = await waitForRunIdle({
          terminalDir,
          runId,
          deadline,
          signal: abortSignal,
        });
        await emit({
          type: 'meta',
          event: 'run_idle',
          run_id: runId,
          status: idleResult,
        });

        // Give the logger a brief grace window to flush the final event(s).
        await sleep(220, abortSignal);
      } finally {
        if (!tailerClosed) {
          try {
            tailer.drain?.();
          } catch {}
          try {
            await tailer.flush?.();
          } catch {}
        }
        closeAll();
        if (abortSignal && typeof abortSignal.removeEventListener === 'function') {
          abortSignal.removeEventListener('abort', onAbort);
        }
      }

      const responseText = safeTrim(lastAssistantText);
      const payload = {
        ok: true,
        run_id: runId,
        created,
        response: responseText,
        ...(lastAssistantTs ? { assistant_ts: lastAssistantTs } : {}),
      };
      return structuredResponse(responseText || `ok (run_id=${runId})`, payload);
    } finally {
      // Restore runtime settings if requested.
      if (settingsDb && runtimeRestore && Object.keys(runtimeRestore).length > 0) {
        try {
          settingsDb.saveRuntime(runtimeRestore);
        } catch {
          // ignore restore failures
        }
      }
      inflightRunIds.delete(runId);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${serverName}] ready (stdio)`);
  console.error(`[${serverName}] sessionRoot=${sessionRoot}`);
  console.error(`[${serverName}] eventLog=${eventLogPath}`);
}

main().catch((err) => {
  console.error(`[${serverName}] crashed:`, err);
  process.exit(1);
});

function createEmitter(extra, loggerName) {
  const sendNotification =
    extra && typeof extra.sendNotification === 'function' ? extra.sendNotification : null;
  return async (data) => {
    const payload = data && typeof data === 'object' ? data : { value: data };
    if (!sendNotification) return;
    try {
      await sendNotification({
        method: 'notifications/message',
        params: {
          level: 'info',
          logger: loggerName,
          data: payload,
        },
      });
    } catch {
      // ignore stream failures
    }
  };
}

function buildRuntimeSettingsPatch(input) {
  if (!input || typeof input !== 'object') return null;
  const patch = {};
  if (typeof input.confirm_main_task_create === 'boolean') {
    patch.confirmMainTaskCreate = input.confirm_main_task_create;
  }
  if (typeof input.confirm_sub_task_create === 'boolean') {
    patch.confirmSubTaskCreate = input.confirm_sub_task_create;
  }
  if (typeof input.confirm_file_changes === 'boolean') {
    patch.confirmFileChanges = input.confirm_file_changes;
  }
  if (typeof input.ui_terminal_mode === 'string' && input.ui_terminal_mode.trim()) {
    patch.uiTerminalMode = input.ui_terminal_mode.trim().toLowerCase();
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function readRuntimeSettings() {
  if (!settingsDb) return null;
  try {
    return settingsDb.getRuntime();
  } catch {
    return null;
  }
}

function buildRuntimeSettingsRestore(patch, current) {
  const restore = {};
  if (!patch || typeof patch !== 'object' || !current || typeof current !== 'object') return restore;
  Object.keys(patch).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(current, key)) return;
    restore[key] = current[key];
  });
  return restore;
}

function resolveEffectiveUiTerminalMode({ requested, current } = {}) {
  const allowed = new Set(['auto', 'system', 'headless']);
  const req = typeof requested === 'string' ? requested.trim().toLowerCase() : '';
  if (allowed.has(req)) return req;
  const cur = typeof current === 'string' ? current.trim().toLowerCase() : '';
  if (allowed.has(cur)) return cur;
  return 'auto';
}

function normalizeTimeoutMs(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  const bounded = Math.min(Math.floor(num), MAX_WAIT_MS);
  return bounded;
}

function sleep(ms, signal) {
  const delay = Math.max(0, Number(ms) || 0);
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delay);
    const onAbort = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      try {
        signal.removeEventListener('abort', onAbort);
      } catch {}
    };
    try {
      signal.addEventListener('abort', onAbort, { once: true });
    } catch {
      // ignore
    }
  });
}

function normalizeRunId(value) {
  const rid = typeof value === 'string' ? value.trim() : '';
  return rid;
}

function generateRunId() {
  const short = crypto.randomUUID().split('-')[0];
  return `run-${Date.now().toString(36)}-${short}`;
}

function isPidAlive(pid) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch {
    return false;
  }
}

function listActiveRuns({ terminalDir }) {
  const dir = typeof terminalDir === 'string' ? terminalDir : '';
  if (!dir) return [];
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const runs = [];
  names.forEach((name) => {
    if (!name.endsWith('.status.json')) return;
    const filePath = path.join(dir, name);
    const parsed = readJsonSafe(filePath, null);
    const runId = normalizeRunId(parsed?.runId);
    const pid = Number(parsed?.pid);
    const state = typeof parsed?.state === 'string' ? parsed.state : '';
    if (!runId) return;
    if (state === 'exited') return;
    if (!isPidAlive(pid)) return;
    runs.push({ runId, pid, state, updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : '' });
  });
  return runs;
}

function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

function ensureFileExists(filePath) {
  try {
    ensureDir(path.dirname(filePath));
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
  } catch {
    // ignore
  }
}

function readFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readRunsRegistry(filePath) {
  const target = typeof filePath === 'string' ? filePath : '';
  if (!target) return [];
  try {
    if (!fs.existsSync(target)) return [];
    const raw = fs.readFileSync(target, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const entries = [];
    lines.forEach((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          entries.push(parsed);
        }
      } catch {
        // ignore parse failures
      }
    });
    return entries;
  } catch {
    return [];
  }
}

function readLastJsonlEntry(filePath, { predicate, maxScanBytes } = {}) {
  const target = typeof filePath === 'string' ? filePath : '';
  const match = typeof predicate === 'function' ? predicate : () => false;
  const maxBytes =
    Number.isFinite(Number(maxScanBytes)) && Number(maxScanBytes) > 0 ? Math.floor(Number(maxScanBytes)) : 32 * 1024 * 1024;
  if (!target) return null;
  try {
    if (!fs.existsSync(target)) return null;
    const stat = fs.statSync(target);
    const totalSize = Number(stat?.size) || 0;
    if (!(totalSize > 0)) return null;

    const fd = fs.openSync(target, 'r');
    try {
      const chunkSize = 64 * 1024;
      let pos = totalSize;
      let scanned = 0;
      let carry = Buffer.alloc(0);
      while (pos > 0 && scanned < maxBytes) {
        const toRead = Math.min(chunkSize, pos, maxBytes - scanned);
        pos -= toRead;
        const buf = Buffer.alloc(toRead);
        const bytesRead = fs.readSync(fd, buf, 0, toRead, pos);
        if (!(bytesRead > 0)) break;
        scanned += bytesRead;

        let combined = carry.length > 0 ? Buffer.concat([buf.subarray(0, bytesRead), carry]) : buf.subarray(0, bytesRead);
        while (combined.length > 0) {
          const newlineIndex = combined.lastIndexOf(0x0a); // '\n'
          if (newlineIndex < 0) break;
          const lineBuf = combined.subarray(newlineIndex + 1);
          combined = combined.subarray(0, newlineIndex);
          const line = lineBuf.toString('utf8').trim();
          if (!line) continue;
          let parsed = null;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          if (match(parsed)) return parsed;
        }
        carry = combined;
      }

      // Process the remaining prefix (beginning of file or oversized first line).
      const finalLine = carry.length > 0 ? carry.toString('utf8').trim() : '';
      if (!finalLine) return null;
      try {
        const parsed = JSON.parse(finalLine);
        if (match(parsed)) return parsed;
      } catch {
        // ignore
      }
      return null;
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  } catch {
    return null;
  }
}

function readTerminalStatus({ terminalDir, runId }) {
  const rid = normalizeRunId(runId);
  if (!rid) return null;
  const filePath = path.join(terminalDir, `${rid}.status.json`);
  const parsed = readJsonSafe(filePath, null);
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    runId: normalizeRunId(parsed?.runId) || rid,
    pid: Number(parsed?.pid) || 0,
    state: typeof parsed?.state === 'string' ? parsed.state : '',
    currentMessage: typeof parsed?.currentMessage === 'string' ? parsed.currentMessage : '',
    updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : '',
  };
}

async function ensureCliRunReady({ runId, sessionRoot, workspaceRoot, cwd, deadline, uiTerminalMode } = {}) {
  const rid = normalizeRunId(runId);
  if (!rid) throw new Error('runId is required');
  const dir = path.join(resolveAppStateDir(sessionRoot, { preferSessionRoot: Boolean(sessionRootArg) }), 'terminals');
  ensureDir(dir);

  const existing = readTerminalStatus({ terminalDir: dir, runId: rid });
  const alive = existing?.pid ? isPidAlive(existing.pid) : false;
  if (existing && alive && existing.state !== 'exited') {
    return { created: false, status: existing };
  }

  await spawnCliChat({ runId: rid, sessionRoot, workspaceRoot, cwd, uiTerminalMode, terminalsDir: dir });

  const timeoutMs = Math.max(0, (deadline ?? Date.now() + 12_000) - Date.now());
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const status = readTerminalStatus({ terminalDir: dir, runId: rid });
    if (status && status.pid && isPidAlive(status.pid) && status.state !== 'exited') {
      return { created: true, status };
    }
    await sleep(140);
  }
  const status = readTerminalStatus({ terminalDir: dir, runId: rid });
  throw new Error(
    `Run did not become ready in time (run_id=${rid}, status=${status ? JSON.stringify(status) : 'missing'})`
  );
}

async function spawnCliChat({ runId, sessionRoot, workspaceRoot, cwd, uiTerminalMode, terminalsDir } = {}) {
  const rid = normalizeRunId(runId);
  const root = typeof sessionRoot === 'string' && sessionRoot.trim() ? path.resolve(sessionRoot) : resolveSessionRoot();
  const wr = typeof workspaceRoot === 'string' && workspaceRoot.trim() ? path.resolve(workspaceRoot) : process.cwd();
  const launchCwd = safeTrim(cwd) ? path.resolve(String(cwd)) : wr;
  const resolvedTerminalsDir =
    typeof terminalsDir === 'string' && terminalsDir.trim()
      ? path.resolve(terminalsDir)
      : path.join(resolveAppStateDir(root, { preferSessionRoot: Boolean(sessionRootArg) }), 'terminals');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const cliPath = path.resolve(__dirname, '../src/cli.js');

  const mode = resolveEffectiveUiTerminalMode({ requested: uiTerminalMode, current: null });
  const autoPrefersSystemTerminal = process.platform === 'darwin' || process.platform === 'win32';
  if (mode === 'system' || (mode === 'auto' && autoPrefersSystemTerminal)) {
    try {
      const launcher = getSystemTerminalLauncher(process.platform);
      const ok = await launcher.launchCliInSystemTerminal({
        runId: rid,
        cwd: launchCwd,
        cliPath,
        sessionRoot: root,
        terminalsDir: resolvedTerminalsDir,
      });
      if (ok) return;
    } catch {
      // fall through to headless spawn
    }
  }

  const env = {
    ...process.env,
    MODEL_CLI_RUN_ID: rid,
    MODEL_CLI_SESSION_ROOT: root,
    MODEL_CLI_WORKSPACE_ROOT: wr,
    MODEL_CLI_UI_BRIDGE: '1',
    MODEL_CLI_DISABLE_CONSOLE_STDIN: '1',
  };

  try {
    const child = spawn(process.execPath, [cliPath, 'chat'], {
      cwd: launchCwd,
      env,
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    child.unref();
  } catch (err) {
    console.error(`[${serverName}] Failed to spawn CLI (run_id=${rid}):`, err?.message || err);
  }
}

function appendTerminalControl({ terminalDir, runId, entry }) {
  const rid = normalizeRunId(runId);
  if (!rid) throw new Error('runId is required');
  if (!entry || typeof entry !== 'object') throw new Error('entry must be an object');
  ensureDir(terminalDir);
  const controlPath = path.join(terminalDir, `${rid}.control.jsonl`);
  ensureFileExists(controlPath);
  fs.appendFileSync(controlPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function dispatchToRun({ terminalDir, runId, text, force } = {}) {
  const rid = normalizeRunId(runId);
  const msg = safeTrim(text);
  if (!rid) throw new Error('runId is required');
  if (!msg) throw new Error('text is required');

  const status = readTerminalStatus({ terminalDir, runId: rid });
  const busy = status?.state === 'running' && status?.pid && isPidAlive(status.pid);
  if (busy && force) {
    appendTerminalControl({
      terminalDir,
      runId: rid,
      entry: { type: 'stop', ts: new Date().toISOString(), source: 'mcp' },
    });
  }
  appendTerminalControl({
    terminalDir,
    runId: rid,
    entry: { type: 'message', text: msg, ts: new Date().toISOString(), source: 'mcp' },
  });
}

async function waitForRunIdle({ terminalDir, runId, deadline, signal } = {}) {
  const rid = normalizeRunId(runId);
  if (!rid) throw new Error('runId is required');

  let sawRunning = false;
  while (true) {
    if (signal?.aborted) {
      return { state: 'aborted' };
    }
    if (deadline && Date.now() > deadline) {
      throw new Error(`timeout waiting for run to become idle (run_id=${rid})`);
    }
    const status = readTerminalStatus({ terminalDir, runId: rid });
    const alive = status?.pid ? isPidAlive(status.pid) : false;
    const state = typeof status?.state === 'string' ? status.state : '';
    if (!status || !alive) {
      // If status is missing, keep waiting briefly; spawn might still be starting.
      await sleep(150, signal);
      continue;
    }
    if (state === 'running') {
      sawRunning = true;
    }
    if (sawRunning && state === 'idle') {
      return status;
    }
    if (!sawRunning && state === 'idle') {
      // If CLI never reported running, accept idle after a short quiet window.
      await sleep(300, signal);
      const confirm = readTerminalStatus({ terminalDir, runId: rid });
      if (confirm?.state === 'idle') {
        return confirm;
      }
    }
    await sleep(180, signal);
  }
}

function createJsonlTailer(filePath, { startCursor = 0, pollIntervalMs = 250, onEntry } = {}) {
  ensureFileExists(filePath);
  let cursor = Math.max(0, Number(startCursor) || 0);
  let partial = '';
  let decoder = new StringDecoder('utf8');
  let watcher = null;
  let poll = null;
  let draining = false;
  const cb = typeof onEntry === 'function' ? onEntry : null;
  let pending = Promise.resolve();

  const drain = () => {
    if (draining) return;
    draining = true;
    try {
      const total = readFileSize(filePath);
      if (cursor > total) {
        cursor = 0;
        partial = '';
        decoder = new StringDecoder('utf8');
      }
      if (total <= cursor) return;

      let nextCursor = cursor;
      try {
        const fd = fs.openSync(filePath, 'r');
        try {
          const chunkSize = 64 * 1024;
          const buf = Buffer.alloc(chunkSize);
          while (nextCursor < total) {
            const toRead = Math.min(chunkSize, total - nextCursor);
            const bytesRead = fs.readSync(fd, buf, 0, toRead, nextCursor);
            if (!(bytesRead > 0)) break;
            partial += decoder.write(buf.subarray(0, bytesRead));
            nextCursor += bytesRead;
          }
        } finally {
          try {
            fs.closeSync(fd);
          } catch {
            // ignore
          }
        }
      } catch {
        return;
      }

      cursor = nextCursor;
      const lines = partial.split('\n');
      partial = lines.pop() || '';
      for (const line of lines) {
        const trimmed = String(line || '').trim();
        if (!trimmed) continue;
        let parsed = null;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (!cb) continue;
        pending = pending.then(() => cb(parsed)).catch(() => {});
      }
    } finally {
      draining = false;
    }
  };

  try {
    watcher = fs.watch(filePath, { persistent: false }, () => drain());
    watcher?.on?.('error', () => {
      try {
        watcher?.close?.();
      } catch {}
      watcher = null;
    });
  } catch {
    watcher = null;
  }

  poll = setInterval(drain, Math.max(50, Number(pollIntervalMs) || 250));
  poll.unref?.();
  drain();

  return {
    close: () => {
      try {
        watcher?.close?.();
      } catch {}
      watcher = null;
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    },
    flush: () => pending,
    drain: () => drain(),
  };
}

function structuredResponse(text, structuredContent) {
  return {
    content: [
      {
        type: 'text',
        text: text || '',
      },
    ],
    structuredContent: structuredContent && typeof structuredContent === 'object' ? structuredContent : undefined,
  };
}

function safeTrim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

function assertStdioOnly(parsedArgs = {}) {
  const transport = safeTrim(parsedArgs.transport || parsedArgs.t);
  const normalized = transport.toLowerCase();
  if (parsedArgs.http === true) {
    throw new Error('HTTP/SSE transport is no longer supported. Use stdio.');
  }
  if (Object.prototype.hasOwnProperty.call(parsedArgs, 'host') || Object.prototype.hasOwnProperty.call(parsedArgs, 'port')) {
    throw new Error('HTTP/SSE options (--host/--port) are no longer supported. Use stdio.');
  }
  if (transport && normalized !== 'stdio') {
    throw new Error(`Unsupported transport "${transport}". Only "stdio" is supported.`);
  }
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
    if (isLong && token.includes('=')) {
      const trimmed = token.replace(/^--+/, '');
      const [key, value] = trimmed.split('=');
      if (key) {
        result[key] = value ?? true;
      }
      continue;
    }
    const key = token.replace(/^-+/, '');
    if (!key) continue;
    const next = input[i + 1];
    if (!next || next.startsWith('-')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    i += 1;
  }
  return result;
}

function printHelp() {
  console.log(`Usage: aide-island-chat-server.js [--name aide_island_chat]

Runs an MCP server over stdio for AIDE floating-island chat.

Tools:
  - list_sessions
  - island_chat
  - get_session_summary

Args:
  --name               MCP server name (default aide_island_chat)
  --session-root       Override MODEL_CLI_SESSION_ROOT (per-app state lives under .deepseek_cli/<app>)
  --workspace-root     Override MODEL_CLI_WORKSPACE_ROOT (used as default cwd for new runs)

Environment:
  MODEL_CLI_SESSION_ROOT   Base dir for per-app state (default: $SESSION_ROOT/.deepseek_cli/<app>/...)
  MODEL_CLI_EVENT_LOG      Override event log path (default: $SESSION_ROOT/.deepseek_cli/<app>/events.jsonl)
  MODEL_CLI_RUNS           Override runs registry path (default: $SESSION_ROOT/.deepseek_cli/<app>/runs.jsonl)
  MODEL_CLI_TASK_DB        Override admin DB path (default: $SESSION_ROOT/.deepseek_cli/<app>/<app>.db.sqlite)
`);
}
