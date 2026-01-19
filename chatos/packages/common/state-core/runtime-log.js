import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveAppStateDir } from './state-paths.js';

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

function ensureRunId(env) {
  const existing = typeof env.MODEL_CLI_RUN_ID === 'string' ? env.MODEL_CLI_RUN_ID.trim() : '';
  if (existing) return existing;
  const short = crypto.randomUUID().split('-')[0];
  const generated = `run-${Date.now().toString(36)}-${short}`;
  env.MODEL_CLI_RUN_ID = generated;
  return generated;
}

function formatError(err, includeStack) {
  if (!err) return '';
  if (err instanceof Error) {
    if (includeStack && err.stack) return err.stack;
    return err.message || String(err);
  }
  if (typeof err === 'string') return err;
  if (typeof err?.message === 'string' && err.message.trim()) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function sanitizeMeta(meta) {
  if (meta === undefined) return undefined;
  try {
    JSON.stringify(meta);
    return meta;
  } catch {
    return { value: String(meta) };
  }
}

export function resolveRuntimeLogPath(options = {}) {
  const filename =
    typeof options.filename === 'string' && options.filename.trim() ? options.filename.trim() : 'runtime-log.jsonl';
  const stateDir = typeof options.stateDir === 'string' && options.stateDir.trim() ? options.stateDir.trim() : '';
  if (stateDir) {
    return path.join(stateDir, filename);
  }
  const sessionRoot =
    typeof options.sessionRoot === 'string' && options.sessionRoot.trim() ? options.sessionRoot.trim() : process.cwd();
  const appDir = resolveAppStateDir(sessionRoot, {
    env: options.env,
    hostApp: options.hostApp,
    fallbackHostApp: options.fallbackHostApp,
    preferSessionRoot: options.preferSessionRoot,
  });
  return path.join(appDir, filename);
}

export function createRuntimeLogger(options = {}) {
  const env = options?.env && typeof options.env === 'object' ? options.env : process.env;
  const filePath =
    typeof options.filePath === 'string' && options.filePath.trim()
      ? options.filePath.trim()
      : resolveRuntimeLogPath({ ...options, env });
  if (!filePath) return null;
  ensureDir(filePath);

  const scope = typeof options.scope === 'string' ? options.scope.trim() : '';
  const hostApp =
    typeof options.hostApp === 'string' && options.hostApp.trim()
      ? options.hostApp.trim()
      : typeof env.MODEL_CLI_HOST_APP === 'string'
        ? env.MODEL_CLI_HOST_APP.trim()
        : '';
  const sessionId =
    typeof options.sessionId === 'string' && options.sessionId.trim()
      ? options.sessionId.trim()
      : typeof env.MODEL_CLI_SESSION_ID === 'string'
        ? env.MODEL_CLI_SESSION_ID.trim()
        : '';
  const runId = typeof options.runId === 'string' && options.runId.trim() ? options.runId.trim() : ensureRunId(env);
  const includeStack =
    options.includeStack ?? (env.MODEL_CLI_LOG_STACK === '1' || env.MODEL_CLI_DEBUG === '1');

  const write = (level, message, meta, err) => {
    const entry = {
      ts: new Date().toISOString(),
      level,
      message: typeof message === 'string' ? message : String(message ?? ''),
      runId,
      pid: process.pid,
    };
    if (scope) entry.scope = scope;
    if (hostApp) entry.hostApp = hostApp;
    if (sessionId) entry.sessionId = sessionId;
    const safeMeta = sanitizeMeta(meta);
    if (safeMeta !== undefined) entry.meta = safeMeta;
    if (err) {
      const formatted = formatError(err, includeStack);
      if (formatted) entry.error = formatted;
    }
    try {
      fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // ignore logging errors
    }
  };

  return {
    path: filePath,
    runId,
    scope,
    log: write,
    debug: (message, meta, err) => write('debug', message, meta, err),
    info: (message, meta, err) => write('info', message, meta, err),
    warn: (message, meta, err) => write('warn', message, meta, err),
    error: (message, meta, err) => write('error', message, meta, err),
  };
}
