#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { clampNumber, parseArgs } from './cli-utils.js';
import { createPromptFileChangeConfirm } from './shell/prompt-file-change-confirm.js';
import { createDb } from '../shared/data/storage.js';
import { SettingsService } from '../shared/data/services/settings-service.js';
import { createFilesystemOps } from './filesystem/ops.js';
import { createSessionManager } from './shell/session-manager.js';
import { registerShellTools } from './shell/register-tools.js';
import { ensureAppDbPath, resolveFileChangesPath, resolveUiPromptsPath } from '../shared/state-paths.js';
import { resolveSessionRoot } from '../shared/session-root.js';

const execAsync = promisify(exec);
const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const root = path.resolve(args.root || process.cwd());
const serverName = args.name || 'shell_tasks';
// Default timeout raised to 5 minutes; can be adjusted via --timeout/--timeout-ms up to 15 minutes
const defaultTimeout = clampNumber(args.timeout || args['timeout-ms'], 1000, 15 * 60 * 1000, 5 * 60 * 1000);
const maxBuffer = clampNumber(args['max-buffer'], 1024 * 16, 8 * 1024 * 1024, 2 * 1024 * 1024);
const defaultShell =
  args.shell ||
  process.env.SHELL ||
  (process.platform === 'win32' ? process.env.COMSPEC || process.env.ComSpec || 'cmd.exe' : '/bin/bash');
const workspaceNote = `Workspace root: ${root}. Paths must stay inside this directory; absolute paths outside will be rejected.`;
const sessionRoot = resolveSessionRoot();
const sessions = createSessionManager({ execAsync, root, defaultShell, serverName, sessionRoot });
const runId = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
const promptLogPath =
  process.env.MODEL_CLI_UI_PROMPTS ||
  resolveUiPromptsPath(sessionRoot);
const fileChangeLogPath =
  process.env.MODEL_CLI_FILE_CHANGES ||
  resolveFileChangesPath(sessionRoot);
const adminDbPath =
  process.env.MODEL_CLI_TASK_DB ||
  ensureAppDbPath(sessionRoot);
const fsOps = createFilesystemOps({ root, serverName, fileChangeLogPath });

let settingsDb = null;
try {
  const db = createDb({ dbPath: adminDbPath });
  settingsDb = new SettingsService(db);
  settingsDb.ensureRuntime();
} catch {
  settingsDb = null;
}

ensureFileExists(promptLogPath);
ensureFileExists(fileChangeLogPath);
ensureDir(root);
sessions.registerCleanupHandlers();

const server = new McpServer({
  name: serverName,
  version: '0.1.0',
});

const promptFileChangeConfirm = createPromptFileChangeConfirm({
  promptLogPath,
  serverName,
  runId,
  ensureFileExists,
  truncateForUi,
});

registerShellTools({
  server,
  z,
  serverName,
  workspaceNote,
  defaultTimeout,
  maxBuffer,
  defaultShell,
  execAsync,
  sessions,
  workspaceRoot: root,
  fsOps,
  ensurePath,
  safeStat,
  assertCommandPathsWithinRoot,
  clampNumber,
  shouldConfirmFileChanges,
  looksLikeFileMutationCommand,
  isSafeGitPreviewCommand,
  canPreviewGitDiff,
  getGitStatusPorcelain,
  getGitDiff,
  buildUntrackedPseudoDiff,
  rollbackGitWorkspace,
  promptFileChangeConfirm,
  normalizeEnv,
  formatCommandResult,
  textResponse,
  structuredResponse,
  truncateForUi,
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${serverName}] MCP shell server ready (root=${root}).`);
}

main().catch((err) => {
  console.error('Shell server crashed:', err);
  sessions.triggerCleanup('startup_failure')
    .catch(() => {})
    .finally(() => process.exit(1));
});

async function ensurePath(relPath = '.') {
  return resolvePathWithinWorkspace(relPath, root);
}

function buildOutsideRootMessage(relPath) {
  return `Path "${relPath}" is outside the workspace root (${root}). Use paths inside this root or set cwd relative to it.`;
}

function assertCommandPathsWithinRoot(commandText, workingDir = root) {
  const tokens = splitCommandTokens(commandText);
  if (tokens.length === 0) {
    return [];
  }
  const violations = [];
  const resolvedPaths = new Set();
  tokens.forEach((token, index) => {
    if (!token) return;
    const candidates = extractPathCandidates(token);
    const tokenIsCommand = isCommandToken(tokens, index);
    for (const candidate of candidates) {
      if (!looksLikePath(candidate)) continue;
      if (tokenIsCommand && isAllowedSystemBinary(candidate, tokenIsCommand)) {
        continue;
      }
      const resolved = resolveCandidateToAbsolute(candidate, workingDir);
      if (resolved?.error) {
        violations.push({ raw: candidate, resolved: resolved.error.message || '<unresolved>' });
        continue;
      }
      if (!resolved?.path) continue;
      if (!isInsideWorkspace(resolved.path)) {
        violations.push({ raw: candidate, resolved: resolved.path });
        continue;
      }
      resolvedPaths.add(resolved.path);
    }
  });
  if (violations.length > 0) {
    const seen = new Set();
    const blocked = [];
    for (const entry of violations) {
      const key = `${entry.raw}|${entry.resolved}`;
      if (seen.has(key)) continue;
      seen.add(key);
      blocked.push(`${entry.raw} -> ${entry.resolved}`);
    }
    const details = blocked.length > 0 ? blocked.join(', ') : '<unknown path>';
    throw new Error(
      [
        'Command contains path(s) outside the workspace root.',
        `Workspace root: ${root}`,
        `Blocked: ${details}`,
        'Use paths relative to the workspace or set cwd within it.',
      ].join('\n')
    );
  }
  return Array.from(resolvedPaths);
}

function splitCommandTokens(input) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escape = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function extractPathCandidates(token) {
  if (!token) return [];
  const stripped = token.replace(/^[0-9]*[<>]+/, '');
  return stripped
    .split('=')
    .map((part) => part.trim())
    .filter(Boolean);
}

function looksLikePath(value) {
  if (!value) return false;
  if (value.startsWith('-')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return false; // URL
  if (process.platform === 'win32') {
    if (value.startsWith('\\\\')) return true;
    if (/^[A-Za-z]:[\\/]/.test(value)) return true;
    if (value.startsWith('.\\') || value.startsWith('..\\')) return true;
    if (value.includes('\\')) return true;
  }
  return (
    value.startsWith('/') ||
    value.startsWith('~/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value === '..' ||
    value.includes('/') ||
    /^[^.]+\.[^./]+$/.test(value)
  );
}

function isCommandToken(tokens, index) {
  if (!Array.isArray(tokens) || index < 0 || index >= tokens.length) {
    return false;
  }
  for (let i = 0; i < index; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (token === 'sudo' || token === 'env') continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) continue;
    return false;
  }
  return true;
}

function resolveCandidateToAbsolute(candidate, workingDir = root) {
  if (!candidate) return { path: null };
  try {
    const resolved = resolvePathWithinWorkspace(candidate, workingDir || root);
    return { path: resolved };
  } catch (err) {
    return { path: null, error: err };
  }
}

function isAllowedSystemBinary(target, isCommandPosition) {
  if (!isCommandPosition) {
    return false;
  }
  const normalized = path.resolve(target);
  if (process.platform === 'win32') {
    const systemRoot =
      typeof process.env.SystemRoot === 'string' && process.env.SystemRoot.trim()
        ? process.env.SystemRoot.trim()
        : 'C:\\Windows';
    const prefixes = [path.join(systemRoot, 'System32'), systemRoot].map((dir) => dir.replace(/[\\/]+$/, ''));
    return prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}${path.sep}`));
  }
  const prefixes = [
    '/bin',
    '/sbin',
    '/usr/bin',
    '/usr/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/opt/homebrew/bin',
  ].map((dir) => dir.replace(/\/+$/, ''));
  return prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}${path.sep}`));
}

function isInsideWorkspace(target) {
  const normalized = path.resolve(target);
  return normalized === root || normalized.startsWith(root + path.sep);
}

function resolvePathWithinWorkspace(rawPath, baseDir = root) {
  const raw = rawPath === undefined || rawPath === null ? '.' : rawPath;
  const base = isInsideWorkspace(baseDir) ? baseDir : root;
  let input = String(raw).trim();
  if (!input || input === '.') {
    return base;
  }

  input = expandHomePath(input);

  const isAbs = path.isAbsolute(input);
  if (isAbs) {
    const normalizedAbs = path.resolve(input);
    if (!isInsideWorkspace(normalizedAbs)) {
      throw new Error(buildOutsideRootMessage(rawPath));
    }
    return normalizedAbs;
  }

  const candidate = path.resolve(base, input);
  if (!isInsideWorkspace(candidate)) {
    throw new Error(buildOutsideRootMessage(rawPath));
  }
  return candidate;
}

function expandHomePath(value) {
  const raw = String(value || '');
  if (!raw.startsWith('~')) return raw;
  // Only expand "~" and "~/" (or "~\\"). Ignore "~user" style.
  if (raw !== '~' && !raw.startsWith('~/') && !raw.startsWith('~\\')) return raw;
  const home = os.homedir();
  if (!home) return raw;
  if (raw === '~') return home;
  const rest = raw.slice(2);
  return path.join(home, rest);
}

function ensureDir(dirPath) {
  const stats = fs.existsSync(dirPath) ? fs.statSync(dirPath) : null;
  if (!stats) {
    fs.mkdirSync(dirPath, { recursive: true });
    return;
  }
  if (!stats.isDirectory()) {
    throw new Error(`${dirPath} is not a directory`);
  }
}

async function safeStat(target) {
  try {
    return await fs.promises.stat(target);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

function normalizeEnv(input) {
  if (!input || typeof input !== 'object') {
    return {};
  }
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      output[key] = value;
    }
  }
  return output;
}

function formatCommandResult({ command, cwd, stdout, stderr, exitCode, signal, timedOut }) {
  const header = [`$ ${command}`, `cwd: ${cwd}`];
  if (exitCode !== null && exitCode !== undefined) {
    header.push(`exit code: ${exitCode}`);
  }
  if (signal) {
    header.push(`signal: ${signal}`);
  }
  if (timedOut) {
    header.push('timed out');
  }
  const divider = '-'.repeat(40);
  const stdoutBlock = stdout ? `STDOUT:\n${stdout}` : 'STDOUT: <empty>';
  const stderrBlock = stderr ? `STDERR:\n${stderr}` : 'STDERR: <empty>';
  return `${header.join(' | ')}\n${divider}\n${stdoutBlock}\n\n${stderrBlock}`;
}

function textResponse(text) {
  return {
    content: [
      {
        type: 'text',
        text: text || '',
      },
    ],
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

function shouldConfirmFileChanges() {
  try {
    const runtime = settingsDb?.getRuntime?.();
    if (!runtime) return false;
    return runtime.confirmFileChanges === true;
  } catch {
    return false;
  }
}

function looksLikeFileMutationCommand(commandText) {
  const cmd = String(commandText || '').trim();
  if (!cmd) return false;
  const lower = cmd.toLowerCase();
  if (lower.includes('>') || lower.includes('>>') || lower.includes('| tee ')) return true;
  return /\b(rm|mv|cp|touch|mkdir|rmdir|sed|perl|python|node|deno)\b/.test(lower);
}

function isSafeGitPreviewCommand(commandText) {
  const cmd = String(commandText || '').trim().toLowerCase();
  if (!cmd) return false;
  if (cmd.startsWith('git ') || cmd === 'git') return false;
  if (/\bgit\s+/.test(cmd)) return false;
  if (cmd.startsWith('npm ') || cmd.startsWith('pnpm ') || cmd.startsWith('yarn ')) return false;
  return true;
}

async function canPreviewGitDiff(workingDir) {
  const cwd = workingDir || root;
  try {
    const { stdout } = await execAsync('git rev-parse --is-inside-work-tree', {
      cwd,
      timeout: 4000,
      maxBuffer: 512 * 1024,
      shell: defaultShell,
    });
    if (!String(stdout || '').trim().toLowerCase().includes('true')) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    const { stdout } = await execAsync('git status --porcelain', {
      cwd,
      timeout: 4000,
      maxBuffer: 512 * 1024,
      shell: defaultShell,
    });
    return !String(stdout || '').trim();
  } catch {
    return false;
  }
}

async function getGitStatusPorcelain(workingDir) {
  const cwd = workingDir || root;
  try {
    const { stdout } = await execAsync('git status --porcelain', {
      cwd,
      timeout: 6000,
      maxBuffer: 1024 * 1024,
      shell: defaultShell,
    });
    return String(stdout || '');
  } catch {
    return '';
  }
}

async function getGitDiff(workingDir) {
  const cwd = workingDir || root;
  try {
    const { stdout } = await execAsync('git diff --no-color', {
      cwd,
      timeout: 8000,
      maxBuffer: 8 * 1024 * 1024,
      shell: defaultShell,
    });
    return String(stdout || '');
  } catch {
    return '';
  }
}

function parseUntrackedFilesFromStatus(statusText) {
  const lines = String(statusText || '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean);
  const out = [];
  lines.forEach((line) => {
    if (!line.startsWith('?? ')) return;
    const rel = line.slice(3).trim();
    if (rel) out.push(rel);
  });
  return out;
}

async function buildUntrackedPseudoDiff(workingDir, statusText) {
  const cwd = workingDir || root;
  const files = parseUntrackedFilesFromStatus(statusText).slice(0, 5);
  if (files.length === 0) return '';
  const parts = [];
  for (const rel of files) {
    const abs = path.resolve(cwd, rel);
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      continue;
    }
    let content = '';
    try {
      const raw = fs.readFileSync(abs, 'utf8');
      content = truncateForUi(raw, 12_000);
    } catch {
      content = '<binary or unreadable>';
    }
    const lines = String(content || '').split('\n');
    const hunk = lines.map((l) => `+${l}`).join('\n');
    parts.push(`--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n${hunk}`);
  }
  return parts.join('\n\n');
}

async function rollbackGitWorkspace(workingDir) {
  const cwd = workingDir || root;
  try {
    await execAsync('git checkout -- .', {
      cwd,
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      shell: defaultShell,
    });
  } catch {
    // ignore
  }
  try {
    await execAsync('git clean -fd', {
      cwd,
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      shell: defaultShell,
    });
  } catch {
    // ignore
  }
}

function truncateForUi(text, maxChars) {
  const value = typeof text === 'string' ? text : text == null ? '' : String(text);
  const limit = Number.isFinite(Number(maxChars)) ? Number(maxChars) : 60_000;
  if (limit <= 0) return value;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n... (truncated ${value.length - limit} chars)`;
}

function printHelp() {
  console.log(
    [
      'Usage: node shell-server.js [--root <path>] [--timeout <ms>] [--max-buffer <bytes>]',
      '',
      'Options:',
      '  --root <path>       Workspace root; all commands are restricted within this directory',
      '  --timeout <ms>      Default command timeout (1000-900000 ms, default 300000)',
      '  --max-buffer <b>    Max STDOUT/STDERR buffer (min 16KB, default 2MB)',
      '  --shell <path>      Optional shell override',
      '  --name <id>         MCP server name',
      '  --help              Show help',
    ].join('\n')
  );
}
