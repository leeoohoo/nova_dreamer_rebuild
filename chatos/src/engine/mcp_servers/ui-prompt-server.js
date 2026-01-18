#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { clampNumber, parseArgs } from './cli-utils.js';
import { createTtyPrompt } from './tty-prompt.js';
import { resolveAppStateDir, STATE_ROOT_DIRNAME } from '../shared/state-paths.js';
import { resolveSessionRoot } from '../shared/session-root.js';

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const serverName = args.name || 'ui_prompter';
const sessionRoot = resolveSessionRoot();
const runId = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
const promptLogPath =
  process.env.MODEL_CLI_UI_PROMPTS ||
  path.join(resolveAppStateDir(sessionRoot), 'ui-prompts.jsonl');
const MAX_WAIT_MS = 2_147_483_647; // ~24.8 days (max safe setTimeout)

ensureFileExists(promptLogPath);

const server = new McpServer({
  name: serverName,
  version: '0.1.0',
});

server.registerTool(
  'prompt_key_values',
  {
    title: 'Prompt user (key-value form)',
    description:
      [
        'Ask the user to fill in missing information via the Electron UI floating island.',
        'The UI renders a key/value table and returns the filled values.',
        'Use this when you need the user to provide structured inputs before continuing.',
      ].join('\n'),
    inputSchema: z.object({
      title: z.string().optional().describe('Prompt title (optional)'),
      message: z.string().optional().describe('Prompt message/instructions (optional)'),
      fields: z
        .array(
          z.object({
            key: z.string().min(1).describe('Field key (unique)'),
            label: z.string().optional().describe('Display label (optional)'),
            description: z.string().optional().describe('Help text (optional)'),
            placeholder: z.string().optional().describe('Placeholder (optional)'),
            default: z.string().optional().describe('Default value (optional)'),
            required: z.boolean().optional().describe('Whether required (default false)'),
            multiline: z.boolean().optional().describe('Whether multiline input (default false)'),
            secret: z.boolean().optional().describe('Whether to mask input (default false)'),
          })
        )
        .min(1)
        .max(50)
        .describe('Fields to collect'),
      allow_cancel: z.boolean().optional().describe('Whether user can cancel (default true)'),
      timeout_ms: z
        .number()
        .int()
        .min(0)
        .max(MAX_WAIT_MS)
        .optional()
        .describe('Timeout waiting for user input (ms); 0 means no timeout'),
    }),
  },
  async (input) => {
    const allowCancel = input?.allow_cancel !== false;
    const timeoutMs = normalizeTimeoutMs(input?.timeout_ms);
    const normalized = normalizeKvFields(input?.fields);

    const requestId = crypto.randomUUID();
    appendPromptEntry({
      ts: new Date().toISOString(),
      type: 'ui_prompt',
      action: 'request',
      requestId,
      ...(runId ? { runId } : {}),
      prompt: {
        kind: 'kv',
        title: safeTrim(input?.title),
        message: safeTrim(input?.message),
        allowCancel,
        fields: normalized,
      },
    });

    const tty = createTtyPrompt();
    const runTtyKv = async ({ signal } = {}) => {
      if (!tty) return null;
      tty.writeln('');
      tty.writeln(`[${serverName}] ${safeTrim(input?.title) || '需要你补充信息'}`);
      tty.writeln('可在 UI 或本终端填写；输入 c/cancel 取消。');
      const msg = safeTrim(input?.message);
      if (msg) tty.writeln(msg);
      tty.writeln('');

      const values = {};
      for (const field of normalized) {
        const key = safeTrim(field?.key);
        if (!key) continue;
        const label = safeTrim(field?.label) || key;
        const desc = safeTrim(field?.description);
        const placeholder = safeTrim(field?.placeholder);
        const def = typeof field?.default === 'string' ? field.default : '';
        const required = field?.required === true;
        const multiline = field?.multiline === true;

        if (desc) tty.writeln(`${label}: ${desc}`);
        if (placeholder) tty.writeln(`  提示: ${placeholder}`);

        while (true) {
          if (multiline) {
            tty.writeln(`${label}${required ? ' (必填)' : ''}：多行输入，单独一行输入 "." 结束`);
            const lines = [];
            while (true) {
              const line = await tty.ask('> ', { signal });
              if (line == null) return null;
              const trimmed = String(line ?? '');
              if (allowCancel && trimmed.trim().toLowerCase() === 'c') return { status: 'canceled' };
              if (allowCancel && trimmed.trim().toLowerCase() === 'cancel') return { status: 'canceled' };
              if (trimmed === '.') break;
              lines.push(trimmed);
            }
            const combined = lines.join('\n');
            const finalValue = combined || def || '';
            if (required && !finalValue.trim()) {
              tty.writeln('该项为必填，请重新输入。');
              continue;
            }
            values[key] = finalValue;
            break;
          }

          const suffix = def ? ` [默认: ${def}]` : '';
          const answer = await tty.ask(`${label}${required ? ' (必填)' : ''}${suffix}: `, { signal });
          if (answer == null) return null;
          const raw = String(answer ?? '');
          const trimmedLower = raw.trim().toLowerCase();
          if (allowCancel && (trimmedLower === 'c' || trimmedLower === 'cancel')) {
            return { status: 'canceled' };
          }
          const finalValue = raw.trim() ? raw : def || '';
          if (required && !finalValue.trim()) {
            tty.writeln('该项为必填，请重新输入。');
            continue;
          }
          values[key] = finalValue;
          break;
        }

        tty.writeln('');
      }

      return { status: 'ok', values };
    };

    const response = await (async () => {
      if (tty && tty.backend === 'tty') {
        try {
          const terminalResult = await runTtyKv();
          const entry = {
            ts: new Date().toISOString(),
            type: 'ui_prompt',
            action: 'response',
            requestId,
            ...(runId ? { runId } : {}),
            response: terminalResult || { status: 'canceled' },
          };
          appendPromptEntry(entry);
          return entry;
        } finally {
          tty.close();
        }
      }
      if (tty && tty.backend === 'auto') {
        const abort = new AbortController();
        try {
          const uiWait = waitForPromptResponse({ requestId, timeoutMs }).then((entry) => ({ kind: 'ui', entry }));
          const ttyWait = runTtyKv({ signal: abort.signal }).then((res) => ({ kind: 'tty', res }));
          const first = await Promise.race([uiWait, ttyWait]);
          if (first.kind === 'ui') {
            abort.abort();
            return first.entry;
          }
          const entry = {
            ts: new Date().toISOString(),
            type: 'ui_prompt',
            action: 'response',
            requestId,
            ...(runId ? { runId } : {}),
            response: first.res || { status: 'canceled' },
          };
          appendPromptEntry(entry);
          return entry;
        } finally {
          abort.abort();
          tty.close();
        }
      }
      return await waitForPromptResponse({ requestId, timeoutMs });
    })();
    const status = normalizeResponseStatus(response?.response?.status);
    const values = status === 'ok' ? normalizeKvValues(response?.response?.values, normalized) : {};

    return structuredResponse(
      buildKvText({ status, requestId, values }),
      {
        status,
        request_id: requestId,
        ...(runId ? { run_id: runId } : {}),
        values,
      }
    );
  }
);

server.registerTool(
  'prompt_choices',
  {
    title: 'Prompt user (single/multi choice)',
    description:
      [
        'Ask the user to make a decision via the Electron UI floating island.',
        'The UI renders single-choice (radio) or multi-choice (checkbox) options and returns the selection.',
        'Use this before dangerous operations or when multiple directions are possible.',
      ].join('\n'),
    inputSchema: z.object({
      title: z.string().optional().describe('Prompt title (optional)'),
      message: z.string().optional().describe('Prompt message/instructions (optional)'),
      multiple: z.boolean().optional().describe('Allow multiple selections (default false)'),
      options: z
        .array(
          z.object({
            value: z.string().min(1).describe('Option value (unique)'),
            label: z.string().optional().describe('Display label (optional)'),
            description: z.string().optional().describe('Help text (optional)'),
          })
        )
        .min(1)
        .max(60)
        .describe('Options to choose from'),
      default: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe('Default selection (string for single, string[] for multiple)'),
      min_selections: z.number().int().min(0).max(60).optional().describe('Minimum selections (multi only)'),
      max_selections: z.number().int().min(1).max(60).optional().describe('Maximum selections (multi only)'),
      allow_cancel: z.boolean().optional().describe('Whether user can cancel (default true)'),
      timeout_ms: z
        .number()
        .int()
        .min(0)
        .max(MAX_WAIT_MS)
        .optional()
        .describe('Timeout waiting for user decision (ms); 0 means no timeout'),
    }),
  },
  async (input) => {
    const allowCancel = input?.allow_cancel !== false;
    const timeoutMs = normalizeTimeoutMs(input?.timeout_ms);
    const multiple = input?.multiple === true;
    const options = normalizeChoiceOptions(input?.options);
    const limits = normalizeChoiceLimits({
      multiple,
      min: input?.min_selections,
      max: input?.max_selections,
      optionCount: options.length,
    });
    const defaultSelection = normalizeDefaultSelection(input?.default, { multiple, options });

    const requestId = crypto.randomUUID();
    appendPromptEntry({
      ts: new Date().toISOString(),
      type: 'ui_prompt',
      action: 'request',
      requestId,
      ...(runId ? { runId } : {}),
      prompt: {
        kind: 'choice',
        title: safeTrim(input?.title),
        message: safeTrim(input?.message),
        allowCancel,
        multiple,
        options,
        default: defaultSelection,
        minSelections: limits.minSelections,
        maxSelections: limits.maxSelections,
      },
    });

    const tty = createTtyPrompt();
    const runTtyChoice = async ({ signal } = {}) => {
      if (!tty) return null;
      tty.writeln('');
      tty.writeln(`[${serverName}] ${safeTrim(input?.title) || (multiple ? '需要你做出选择（多选）' : '需要你做出选择')}`);
      tty.writeln('可在 UI 或本终端选择；输入 c/cancel 取消。');
      const msg = safeTrim(input?.message);
      if (msg) tty.writeln(msg);
      tty.writeln('');

      const indexed = options.map((opt, idx) => ({ idx: idx + 1, value: opt.value, label: safeTrim(opt?.label), description: safeTrim(opt?.description) }));
      indexed.forEach((opt) => {
        const label = opt.label || opt.value;
        const extra = opt.description ? ` — ${opt.description}` : '';
        tty.writeln(`[${opt.idx}] ${label} (${opt.value})${extra}`);
      });
      tty.writeln('');

      const byIndex = new Map(indexed.map((o) => [String(o.idx), o.value]));
      const allowed = new Set(options.map((o) => o.value));

      const parseTokens = (raw) => {
        const text = String(raw ?? '').trim();
        if (!text) return [];
        const parts = text.split(/[,，\s]+/g).map((p) => p.trim()).filter(Boolean);
        const out = [];
        for (const part of parts) {
          const mapped = byIndex.get(part) || part;
          if (allowed.has(mapped)) out.push(mapped);
        }
        return out;
      };

      while (true) {
        const hint = multiple
          ? `选择项（序号或 value，逗号分隔）${defaultSelection?.length ? ` [默认: ${JSON.stringify(defaultSelection)}]` : ''}: `
          : `选择项（序号或 value）${defaultSelection ? ` [默认: ${defaultSelection}]` : ''}: `;
        const answer = await tty.ask(hint, { signal });
        if (answer == null) return null;
        const trimmed = String(answer ?? '').trim();
        const lowered = trimmed.toLowerCase();
        if (allowCancel && (lowered === 'c' || lowered === 'cancel')) {
          return { status: 'canceled' };
        }

        if (!trimmed) {
          if (multiple) {
            const selection = Array.isArray(defaultSelection) ? defaultSelection : [];
            if (selection.length < limits.minSelections) {
              tty.writeln(`至少选择 ${limits.minSelections} 项。`);
              continue;
            }
            if (selection.length > limits.maxSelections) {
              tty.writeln(`最多选择 ${limits.maxSelections} 项。`);
              continue;
            }
            return { status: 'ok', selection };
          }
          if (defaultSelection) {
            return { status: 'ok', selection: defaultSelection };
          }
          tty.writeln('请选择一项。');
          continue;
        }

        const picked = parseTokens(trimmed);
        const unique = Array.from(new Set(picked));
        if (multiple) {
          if (unique.length < limits.minSelections) {
            tty.writeln(`至少选择 ${limits.minSelections} 项。`);
            continue;
          }
          if (unique.length > limits.maxSelections) {
            tty.writeln(`最多选择 ${limits.maxSelections} 项。`);
            continue;
          }
          return { status: 'ok', selection: unique };
        }
        const one = unique[0] || '';
        if (!one) {
          tty.writeln('选择项无效，请重新输入。');
          continue;
        }
        return { status: 'ok', selection: one };
      }
    };

    const response = await (async () => {
      if (tty && tty.backend === 'tty') {
        try {
          const terminalResult = await runTtyChoice();
          const entry = {
            ts: new Date().toISOString(),
            type: 'ui_prompt',
            action: 'response',
            requestId,
            ...(runId ? { runId } : {}),
            response: terminalResult || { status: 'canceled' },
          };
          appendPromptEntry(entry);
          return entry;
        } finally {
          tty.close();
        }
      }
      if (tty && tty.backend === 'auto') {
        const abort = new AbortController();
        try {
          const uiWait = waitForPromptResponse({ requestId, timeoutMs }).then((entry) => ({ kind: 'ui', entry }));
          const ttyWait = runTtyChoice({ signal: abort.signal }).then((res) => ({ kind: 'tty', res }));
          const first = await Promise.race([uiWait, ttyWait]);
          if (first.kind === 'ui') {
            abort.abort();
            return first.entry;
          }
          const entry = {
            ts: new Date().toISOString(),
            type: 'ui_prompt',
            action: 'response',
            requestId,
            ...(runId ? { runId } : {}),
            response: first.res || { status: 'canceled' },
          };
          appendPromptEntry(entry);
          return entry;
        } finally {
          abort.abort();
          tty.close();
        }
      }
      return await waitForPromptResponse({ requestId, timeoutMs });
    })();
    const status = normalizeResponseStatus(response?.response?.status);
    const selection =
      status === 'ok'
        ? normalizeChoiceSelection(response?.response?.selection, { multiple, options })
        : multiple
          ? []
          : '';

    return structuredResponse(
      buildChoiceText({ status, requestId, selection, multiple }),
      {
        status,
        request_id: requestId,
        ...(runId ? { run_id: runId } : {}),
        multiple,
        selection,
      }
    );
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${serverName}] MCP UI prompt server ready (log=${promptLogPath}).`);
}

main().catch((err) => {
  console.error('UI prompt server crashed:', err);
  process.exit(1);
});

function appendPromptEntry(entry) {
  try {
    ensureFileExists(promptLogPath);
    fs.appendFileSync(promptLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // ignore prompt write errors
  }
}

async function waitForPromptResponse({ requestId, timeoutMs }) {
  const deadline = Number.isFinite(timeoutMs) ? Date.now() + timeoutMs : null;
  let watcher = null;
  let timer = null;
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
    if (timer) {
      clearTimeout(timer);
      timer = null;
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
        return;
      }
      if (deadline && Date.now() >= deadline) {
        cleanup();
        resolve({
          ts: new Date().toISOString(),
          type: 'ui_prompt',
          action: 'response',
          requestId,
          ...(runId ? { runId } : {}),
          response: { status: 'timeout' },
        });
      }
    };

    try {
      watcher = fs.watch(promptLogPath, { persistent: false }, () => tryRead());
      if (watcher && typeof watcher.on === 'function') {
        watcher.on('error', (err) => {
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
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(tryRead, Math.max(1_000, timeoutMs));
    }
    if (poll && typeof poll.unref === 'function') {
      poll.unref();
    }
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
    tryRead();
  });
}

function normalizeTimeoutMs(value) {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0) return null;
  return clampNumber(parsed, 1_000, MAX_WAIT_MS, null);
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

function buildKvText({ status, requestId, values }) {
  if (status === 'ok') {
    const keys = Object.keys(values || {});
    if (keys.length === 0) {
      return `requestId=${requestId}\nstatus=ok\nvalues=<empty>`;
    }
    const lines = keys.map((k) => `- ${k}: ${String(values[k] ?? '')}`);
    return `requestId=${requestId}\nstatus=ok\nvalues:\n${lines.join('\n')}`;
  }
  return `requestId=${requestId}\nstatus=${status}`;
}

function buildChoiceText({ status, requestId, selection, multiple }) {
  if (status === 'ok') {
    if (multiple) {
      const list = Array.isArray(selection) ? selection : [];
      return `requestId=${requestId}\nstatus=ok\nselection=${JSON.stringify(list)}`;
    }
    return `requestId=${requestId}\nstatus=ok\nselection=${String(selection || '')}`;
  }
  return `requestId=${requestId}\nstatus=${status}`;
}

function normalizeResponseStatus(status) {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (value === 'ok' || value === 'canceled' || value === 'timeout') {
    return value;
  }
  if (!value) return 'canceled';
  return 'canceled';
}

function normalizeKvFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('fields is required');
  }
  const seen = new Set();
  return fields.map((field) => {
    const key = safeTrim(field?.key);
    if (!key) {
      throw new Error('field.key is required');
    }
    if (seen.has(key)) {
      throw new Error(`duplicate field key: ${key}`);
    }
    seen.add(key);
    return {
      key,
      label: safeTrim(field?.label),
      description: safeTrim(field?.description),
      placeholder: safeTrim(field?.placeholder),
      default: typeof field?.default === 'string' ? field.default : '',
      required: field?.required === true,
      multiline: field?.multiline === true,
      secret: field?.secret === true,
    };
  });
}

function normalizeKvValues(values, fields) {
  const out = {};
  const map = new Map((Array.isArray(fields) ? fields : []).map((f) => [f.key, f]));
  if (values && typeof values === 'object' && !Array.isArray(values)) {
    Object.entries(values).forEach(([key, value]) => {
      const k = safeTrim(key);
      if (!k || !map.has(k)) return;
      out[k] = typeof value === 'string' ? value : value == null ? '' : String(value);
    });
  }
  map.forEach((field, key) => {
    if (out[key] == null || out[key] === '') {
      const fallback = typeof field?.default === 'string' ? field.default : '';
      if (fallback) out[key] = fallback;
    }
  });
  return out;
}

function normalizeChoiceOptions(options) {
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('options is required');
  }
  const seen = new Set();
  return options.map((opt) => {
    const value = safeTrim(opt?.value);
    if (!value) {
      throw new Error('options[].value is required');
    }
    if (seen.has(value)) {
      throw new Error(`duplicate option value: ${value}`);
    }
    seen.add(value);
    return {
      value,
      label: safeTrim(opt?.label),
      description: safeTrim(opt?.description),
    };
  });
}

function normalizeChoiceLimits({ multiple, min, max, optionCount }) {
  const count = Number(optionCount);
  const minRaw = Number(min);
  const maxRaw = Number(max);
  const minSelections =
    multiple && Number.isFinite(minRaw) && minRaw >= 0 ? Math.min(Math.max(0, Math.floor(minRaw)), count) : 0;
  const maxSelections =
    multiple && Number.isFinite(maxRaw) && maxRaw >= 1
      ? Math.min(Math.max(1, Math.floor(maxRaw)), count)
      : multiple
        ? count
        : 1;
  return {
    minSelections: multiple ? Math.min(minSelections, maxSelections) : 1,
    maxSelections: multiple ? maxSelections : 1,
  };
}

function normalizeDefaultSelection(inputDefault, { multiple, options }) {
  const allowed = new Set((Array.isArray(options) ? options : []).map((o) => o.value));
  if (multiple) {
    const values = Array.isArray(inputDefault) ? inputDefault : typeof inputDefault === 'string' ? [inputDefault] : [];
    const filtered = values
      .map((v) => safeTrim(v))
      .filter((v) => v && allowed.has(v));
    return Array.from(new Set(filtered));
  }
  const value = typeof inputDefault === 'string' ? safeTrim(inputDefault) : '';
  return value && allowed.has(value) ? value : '';
}

function normalizeChoiceSelection(selection, { multiple, options }) {
  const allowed = new Set((Array.isArray(options) ? options : []).map((o) => o.value));
  if (multiple) {
    const values = Array.isArray(selection) ? selection : typeof selection === 'string' ? [selection] : [];
    const filtered = values
      .map((v) => safeTrim(v))
      .filter((v) => v && allowed.has(v));
    return Array.from(new Set(filtered));
  }
  const value = typeof selection === 'string' ? safeTrim(selection) : '';
  return value && allowed.has(value) ? value : '';
}

function safeTrim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureFileExists(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
  } catch {
    // ignore
  }
}

function printHelp() {
  console.log(`Usage: ui-prompt-server.js [--name <serverName>]

Environment:
  MODEL_CLI_SESSION_ROOT   Base dir for per-app state (default: $SESSION_ROOT/${STATE_ROOT_DIRNAME}/<app>/...)
  MODEL_CLI_UI_PROMPTS     Override prompt log path (default: $SESSION_ROOT/${STATE_ROOT_DIRNAME}/<app>/ui-prompts.jsonl)
`);
}
