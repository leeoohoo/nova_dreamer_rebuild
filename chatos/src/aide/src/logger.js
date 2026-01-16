import * as colors from './colors.js';

function normalizeLevel(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (raw === 'debug') return 'debug';
  if (raw === 'info') return 'info';
  if (raw === 'warn' || raw === 'warning') return 'warn';
  if (raw === 'error') return 'error';
  if (raw === 'silent' || raw === 'none' || raw === 'off') return 'silent';
  return 'info';
}

function levelRank(level) {
  switch (level) {
    case 'debug':
      return 10;
    case 'info':
      return 20;
    case 'warn':
      return 30;
    case 'error':
      return 40;
    case 'silent':
      return Infinity;
    default:
      return 20;
  }
}

export function formatError(err, { includeStack } = {}) {
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

export function createLogger(scope = '', options = {}) {
  const prefix = scope ? `[${scope}] ` : '';
  const minLevel = normalizeLevel(options.level ?? process.env.MODEL_CLI_LOG_LEVEL);
  const minRank = levelRank(minLevel);
  const includeStack =
    options.includeStack ??
    (process.env.MODEL_CLI_LOG_STACK === '1' || process.env.MODEL_CLI_DEBUG === '1');

  const shouldLog = (level) => levelRank(level) >= minRank;
  const write = (level, message, err) => {
    if (!shouldLog(level)) return;
    const msg = typeof message === 'string' ? message : String(message ?? '');
    const suffix = err ? `: ${formatError(err, { includeStack })}` : '';
    const line = `${prefix}${msg}${suffix}`;
    if (level === 'debug') {
      console.log(colors.dim(line));
      return;
    }
    if (level === 'info') {
      console.log(line);
      return;
    }
    // warn/error
    console.error(colors.yellow(line));
  };

  return {
    debug: (message, err) => write('debug', message, err),
    info: (message, err) => write('info', message, err),
    warn: (message, err) => write('warn', message, err),
    error: (message, err) => write('error', message, err),
  };
}
