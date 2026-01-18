#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveEngineRoot } from '../src/engine-paths.js';
import { resolveAppStateDir } from '../src/engine/shared/state-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const engineRoot = resolveEngineRoot({ projectRoot: repoRoot });
if (!engineRoot) {
  throw new Error('Engine sources not found (expected ./src/engine relative to chatos).');
}

const activeTransports = new Set();
const shutdown = async () => {
  const list = Array.from(activeTransports);
  await Promise.all(
    list.map(async (transport) => {
      try {
        await transport.close();
      } catch {
        // ignore
      }
    })
  );
};

let sessionRoot = '';
let timeoutMs = 10 * 60 * 1_000;
let runA = 'run-a';
let runB = 'run-b';
let promptLogPath = '';

async function main() {
  console.log('[ui-prompt-test] concurrency test');
  console.log(`[ui-prompt-test] sessionRoot=${sessionRoot}`);
  console.log(`[ui-prompt-test] uiPrompts=${promptLogPath}`);
  console.log('');
  console.log('[ui-prompt-test] If Electron UI is not running yet, start it in another terminal:');
  console.log(`  MODEL_CLI_SESSION_ROOT=${escapeShell(sessionRoot)} npm run ui`);
  console.log('');
  console.log(`[ui-prompt-test] Creating 2 concurrent prompts: ${runA}, ${runB}`);
  console.log('[ui-prompt-test] In UI, you should see:');
  console.log('- a runId tag on the prompt card');
  console.log('- a "2 个待处理" tag');
  console.log('- switching the run filter should prioritize that runId’s prompt');
  console.log('');

  const [a, b] = await Promise.allSettled([
    requestChoicePrompt({ runId: runA, sessionRoot, timeoutMs }),
    requestKvPrompt({ runId: runB, sessionRoot, timeoutMs }),
  ]);

  console.log('\n[ui-prompt-test] results');
  printSettled(runA, a);
  printSettled(runB, b);
}

const runningUnderNodeTest = process.argv.includes('--test');
if (!runningUnderNodeTest) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelp();
    process.exit(0);
  }

  sessionRoot = resolveSessionRoot(args);
  timeoutMs = clampNumber(args.timeout_ms ?? args.timeout, 1_000, 30 * 60 * 1_000, 10 * 60 * 1_000);
  runA = safeTrim(args.run_a ?? args.a ?? 'run-a') || 'run-a';
  runB = safeTrim(args.run_b ?? args.b ?? 'run-b') || 'run-b';
  promptLogPath = path.join(resolveAppStateDir(sessionRoot, { preferSessionRoot: true }), 'ui-prompts.jsonl');
  ensureFileExists(promptLogPath);

  process.on('SIGINT', async () => {
    console.error('\n[ui-prompt-test] received SIGINT; shutting down...');
    await shutdown();
    process.exit(130);
  });
  process.on('SIGTERM', async () => {
    console.error('\n[ui-prompt-test] received SIGTERM; shutting down...');
    await shutdown();
    process.exit(143);
  });

  main().catch((err) => {
    console.error('[ui-prompt-test] error:', err?.message || err);
    process.exit(1);
  });
}

async function requestChoicePrompt({ runId, sessionRoot: root, timeoutMs: toolTimeoutMs }) {
  const { client, transport } = await connectUiPrompter({ runId, sessionRoot: root });
  try {
    return await client.callTool(
      {
        name: 'prompt_choices',
        arguments: {
          title: `Choice prompt (${runId})`,
          message: '请选择一项（用于并发/过滤测试）。',
          multiple: false,
          options: [
            { value: 'alpha', label: 'Alpha', description: 'Option alpha' },
            { value: 'beta', label: 'Beta', description: 'Option beta' },
          ],
          allow_cancel: true,
          timeout_ms: toolTimeoutMs,
        },
      },
      undefined,
      buildRequestOptions(toolTimeoutMs)
    );
  } finally {
    await safeCloseTransport(transport);
  }
}

async function requestKvPrompt({ runId, sessionRoot: root, timeoutMs: toolTimeoutMs }) {
  const { client, transport } = await connectUiPrompter({ runId, sessionRoot: root });
  try {
    return await client.callTool(
      {
        name: 'prompt_key_values',
        arguments: {
          title: `KV prompt (${runId})`,
          message: '请填写字段（用于并发/过滤测试）。',
          fields: [
            { key: 'name', label: 'Name', required: true, placeholder: 'Your name' },
            { key: 'note', label: 'Note', multiline: true, placeholder: 'Anything… (optional)' },
          ],
          allow_cancel: true,
          timeout_ms: toolTimeoutMs,
        },
      },
      undefined,
      buildRequestOptions(toolTimeoutMs)
    );
  } finally {
    await safeCloseTransport(transport);
  }
}

async function connectUiPrompter({ runId, sessionRoot: root }) {
  const env = {
    ...process.env,
    MODEL_CLI_RUN_ID: runId,
    MODEL_CLI_SESSION_ROOT: root,
  };
  const client = new Client({ name: 'ui-prompt-test', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(engineRoot, 'mcp_servers', 'ui-prompt-server.js'), '--name', 'ui_prompter'],
    cwd: repoRoot,
    env,
    stderr: 'pipe',
  });
  activeTransports.add(transport);
  try {
    await client.connect(transport);
    return { client, transport };
  } catch (err) {
    await safeCloseTransport(transport);
    throw err;
  }
}

function buildRequestOptions(totalMs) {
  const toolMax = clampNumber(totalMs, 1_000, 30 * 60 * 1_000, 10 * 60 * 1_000);
  // Give the MCP transport a small buffer beyond the tool's own timeout to avoid client-side timeouts
  // racing with the server's final response.
  const max = Math.min(toolMax + 15_000, 30 * 60 * 1_000 + 15_000);
  return {
    timeout: max,
    maxTotalTimeout: max,
    resetTimeoutOnProgress: true,
  };
}

async function safeCloseTransport(transport) {
  if (!transport) return;
  activeTransports.delete(transport);
  try {
    await transport.close();
  } catch {
    // ignore
  }
}

function printSettled(label, settled) {
  if (!settled) return;
  if (settled.status === 'rejected') {
    console.log(`[${label}] ❌ ${settled.reason?.message || String(settled.reason)}`);
    return;
  }
  const res = settled.value;
  if (res?.isError) {
    console.log(`[${label}] ❌ MCP returned isError=true`);
  } else {
    console.log(`[${label}] ✅ ok`);
  }
  const text = extractContentText(res?.content);
  if (text) {
    console.log(`[${label}] text:\n${text}`);
  }
  if (res?.structuredContent && typeof res.structuredContent === 'object') {
    console.log(`[${label}] structuredContent:\n${JSON.stringify(res.structuredContent, null, 2)}`);
  }
}

function extractContentText(content) {
  const blocks = Array.isArray(content) ? content : [];
  const texts = blocks
    .map((b) => (b && typeof b === 'object' && b.type === 'text' ? safeTrim(b.text) : ''))
    .filter(Boolean);
  return texts.join('\n').trim();
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

function resolveSessionRoot(parsedArgs) {
  const direct = safeTrim(parsedArgs.session_root ?? parsedArgs.sessionRoot);
  if (direct) return path.resolve(direct);
  if (process.env.MODEL_CLI_SESSION_ROOT) {
    return path.resolve(process.env.MODEL_CLI_SESSION_ROOT);
  }
  const home = os.homedir();
  if (home) return path.resolve(home);
  return process.cwd();
}

function safeTrim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

function escapeShell(text) {
  return `'${String(text || '').replace(/'/g, `'\\''`)}'`;
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
      const normalizedKey = key ? key.replace(/-/g, '_') : '';
      if (normalizedKey) {
        result[normalizedKey] = value ?? true;
      }
      continue;
    }
    const key = token.replace(/^-+/, '').replace(/-/g, '_');
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
  console.log(`Usage: node scripts/ui-prompt-concurrency.js [options]

Options:
  --session-root <dir>   Session root shared with Electron UI (default: $MODEL_CLI_SESSION_ROOT or $HOME)
  --run-a <runId>        First runId (default: run-a)
  --run-b <runId>        Second runId (default: run-b)
  --timeout-ms <ms>      Wait timeout per prompt (default: 600000)

Example:
  MODEL_CLI_SESSION_ROOT=/tmp/ui_prompt_test npm run ui
  node scripts/ui-prompt-concurrency.js --session-root /tmp/ui_prompt_test --run-a run-1 --run-b run-2
`);
}
