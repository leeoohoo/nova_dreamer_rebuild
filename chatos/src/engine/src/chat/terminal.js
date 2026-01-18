import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { StringDecoder } from 'string_decoder';
import * as colors from '../colors.js';
import { terminalPlatform } from '../terminal/platform/index.js';
import { resolveTerminalsDir } from '../../shared/state-paths.js';

function createTerminalControl({ runId, sessionRoot, rl, onStop, onAction } = {}) {
  const rid = typeof runId === 'string' ? runId.trim() : '';
  const root = typeof sessionRoot === 'string' && sessionRoot.trim() ? sessionRoot.trim() : '';
  if (!rid || !root) {
    return null;
  }
  if (!rl || typeof rl.emit !== 'function') {
    return null;
  }
  const stop = typeof onStop === 'function' ? onStop : null;
  const actionHandler = typeof onAction === 'function' ? onAction : null;
  const dir = resolveTerminalsDir(root);
  const statusPath = path.join(dir, `${rid}.status.json`);
  const controlPath = path.join(dir, `${rid}.control.jsonl`);
  const cursorPath = path.join(dir, `${rid}.cursor`);
  ensureDir(dir);
  touchFile(controlPath);

  let cursor = readCursor(cursorPath);
  let partial = '';
  let decoder = new StringDecoder('utf8');
  let watcher = null;
  let pollTimer = null;
  let draining = false;
  let lastStatusText = '';
  const keepPollingAlive = process.env.MODEL_CLI_UI_BRIDGE === '1';

  const writeStatus = ({ state, currentMessage } = {}) => {
    const payload = {
      runId: rid,
      pid: process.pid,
      state: state || 'idle',
      currentMessage: typeof currentMessage === 'string' ? currentMessage : '',
      updatedAt: new Date().toISOString(),
    };
    const json = `${JSON.stringify(payload)}\n`;
    if (json === lastStatusText) {
      return payload;
    }
    lastStatusText = json;

    // Retry up to 3 times for critical states (exited, running)
    const isCritical = state === 'exited' || state === 'running';
    const maxAttempts = isCritical ? 5 : 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const tmpPath = `${statusPath}.tmp`;
        fs.writeFileSync(tmpPath, json, 'utf8');
        fs.renameSync(tmpPath, statusPath);
        return payload;
      } catch {
        // Ignore error and retry if attempts remain
        if (attempt === maxAttempts - 1) {
          // Last attempt failed, silently ignore as before
        }
      }
    }
    try {
      fs.writeFileSync(statusPath, json, 'utf8');
    } catch {
      // ignore
    }
    return payload;
  };

  const injectLine = (text) => {
    const line = typeof text === 'string' ? text : String(text ?? '');
    try {
      rl.emit('line', line);
    } catch {
      // ignore injection errors
    }
  };

  const processCommand = (cmd) => {
    const type = typeof cmd?.type === 'string' ? cmd.type.trim() : '';
    if (!type) return;
    if (type === 'stop') {
      if (stop) stop();
      return;
    }
    if (type === 'action') {
      if (actionHandler) {
        try {
          actionHandler(cmd);
        } catch {
          // ignore action handler errors
        }
      }
      // Wake the input loop so the chat loop can handle queued actions even when idle.
      injectLine('');
      return;
    }
    if (type === 'message') {
      const text = typeof cmd?.text === 'string' ? cmd.text : '';
      if (text && text.trim()) {
        echoInjectedMessage(text);
        injectLine(text);
      }
    }
  };

  const echoInjectedMessage = (text) => {
    try {
      if (process.stdout.isTTY) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
      }
      const raw = String(text ?? '');
      const lines = raw.split('\n');
      if (lines.length <= 1) {
        console.log(colors.green('│ you> ') + raw);
        return;
      }
      console.log(colors.green('│ you> ') + (lines[0] || ''));
      for (let i = 1; i < lines.length; i += 1) {
        console.log(colors.green('│ ...> ') + (lines[i] || ''));
      }
    } catch {
      // ignore
    }
  };

  const drain = () => {
    if (draining) return;
    draining = true;
    try {
      const total = (() => {
        try {
          return fs.statSync(controlPath).size;
        } catch {
          return 0;
        }
      })();
      if (cursor > total) {
        cursor = 0;
        partial = '';
        decoder = new StringDecoder('utf8');
      }
      if (total <= cursor) {
        return;
      }

      let nextCursor = cursor;
      try {
        const fd = fs.openSync(controlPath, 'r');
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
      persistCursor(cursorPath, cursor);
      const lines = partial.split('\n');
      partial = lines.pop() || '';
      lines.forEach((line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return;
        try {
          const parsed = JSON.parse(trimmed);
          processCommand(parsed);
        } catch {
          // ignore parse failures
        }
      });
    } catch {
      // ignore control read errors
    } finally {
      draining = false;
    }
  };

  try {
    watcher = fs.watch(controlPath, { persistent: false }, () => drain());
  } catch {
    watcher = null;
  }
  const pollIntervalMs = terminalPlatform.getTerminalControlPollIntervalMs();
  pollTimer = setInterval(drain, pollIntervalMs);
  if (pollTimer && typeof pollTimer.unref === 'function') {
    if (!keepPollingAlive) {
      pollTimer.unref();
    }
  }
  drain();

  const close = () => {
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
      watcher = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  return { writeStatus, close };
}

function appendRunPid({ runId, sessionRoot, pid, kind } = {}) {
  const rid = typeof runId === 'string' ? runId.trim() : '';
  const root = typeof sessionRoot === 'string' && sessionRoot.trim() ? sessionRoot.trim() : '';
  const num = Number(pid);
  if (!rid || !root || !Number.isFinite(num) || num <= 0) {
    return;
  }
  const dir = resolveTerminalsDir(root);
  ensureDir(dir);
  const pidsPath = path.join(dir, `${rid}.pids.jsonl`);
  const payload = {
    ts: new Date().toISOString(),
    runId: rid,
    pid: num,
    kind: typeof kind === 'string' && kind.trim() ? kind.trim() : 'process',
  };
  try {
    fs.appendFileSync(pidsPath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // ignore pid registry failures
  }
}

function hardKillCurrentRunFromSignal() {
  const rid = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
  const root =
    typeof process.env.MODEL_CLI_SESSION_ROOT === 'string' && process.env.MODEL_CLI_SESSION_ROOT.trim()
      ? process.env.MODEL_CLI_SESSION_ROOT.trim()
      : process.cwd();

  // Prefer killing the current foreground process group when available.
  const pgid = terminalPlatform.getProcessGroupId(process.pid);

  if (pgid) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch {
      // fall back below
    }
  }

  // Fall back to killing known PIDs registered for this run.
  if (!rid) return;
  const terminalsDir = resolveTerminalsDir(root);
  const pidsPath = path.join(terminalsDir, `${rid}.pids.jsonl`);
  let pids = [];
  try {
    if (fs.existsSync(pidsPath)) {
      const raw = fs.readFileSync(pidsPath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const unique = new Set();
      lines.forEach((line) => {
        try {
          const parsed = JSON.parse(line);
          const num = Number(parsed?.pid);
          if (Number.isFinite(num) && num > 0 && num !== process.pid) {
            unique.add(num);
          }
        } catch {
          // ignore parse failures
        }
      });
      pids = Array.from(unique);
    }
  } catch {
    // ignore pid file read errors
  }

  // Kill children first, then self.
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
  try {
    process.kill(process.pid, 'SIGKILL');
  } catch {
    // ignore
  }
}

function ensureDir(dirPath) {
  if (!dirPath) return;
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

function touchFile(filePath) {
  if (!filePath) return;
  try {
    fs.closeSync(fs.openSync(filePath, 'a'));
  } catch {
    // ignore
  }
}

function readCursor(cursorPath) {
  if (!cursorPath) return 0;
  try {
    if (!fs.existsSync(cursorPath)) return 0;
    const raw = fs.readFileSync(cursorPath, 'utf8').trim();
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  } catch {
    return 0;
  }
}

function persistCursor(cursorPath, cursor) {
  if (!cursorPath) return;
  const value = Number.isFinite(cursor) && cursor >= 0 ? Math.floor(cursor) : 0;
  try {
    const tmpPath = `${cursorPath}.tmp`;
    fs.writeFileSync(tmpPath, `${value}\n`, 'utf8');
    fs.renameSync(tmpPath, cursorPath);
  } catch {
    // ignore
  }
}

export { appendRunPid, createTerminalControl, hardKillCurrentRunFromSignal };
