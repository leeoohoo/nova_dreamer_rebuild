import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { resolveAppStateDir } from '../../shared/state-paths.js';

function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

function sanitizeName(rawName) {
  return (
    String(rawName || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 64) || `sess_${Date.now().toString(36)}`
  );
}

function escapeShellValue(text) {
  return `'${String(text || '').replace(/'/g, `'\\''`)}'`;
}

function escapePowerShellSingleQuoted(text) {
  return `'${String(text || '').replace(/'/g, "''")}'`;
}

function isPowerShellExecutable(shellPath) {
  const base = path.basename(String(shellPath || '')).toLowerCase();
  return base === 'powershell.exe' || base === 'pwsh.exe' || base === 'powershell' || base === 'pwsh';
}

function getShellInvocation(shellPath, commandText) {
  const shell = typeof shellPath === 'string' && shellPath.trim() ? shellPath.trim() : null;
  if (process.platform === 'win32') {
    const picked = shell || process.env.COMSPEC || process.env.ComSpec || 'cmd.exe';
    const base = path.basename(picked).toLowerCase();
    if (base === 'powershell.exe' || base === 'pwsh.exe' || base === 'powershell' || base === 'pwsh') {
      return { file: picked, args: ['-NoProfile', '-Command', commandText] };
    }
    return { file: picked, args: ['/d', '/s', '/c', commandText] };
  }
  const picked = shell || process.env.SHELL || '/bin/bash';
  return { file: picked, args: ['-c', commandText] };
}

function isPidAlive(pid) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    // EPERM/EACCES means the process exists but we don't have permission to signal it.
    if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
      return true;
    }
    return false;
  }
}

function writeJsonAtomic(filePath, payload) {
  const targetDir = path.dirname(filePath);
  ensureDir(targetDir);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // ignore
  }
  return null;
}

function readLastLinesFromFile(filePath, lineCount, maxBytes = 4 * 1024 * 1024) {
  const requested = Number.isFinite(lineCount) ? Math.max(1, Math.floor(lineCount)) : 500;
  try {
    if (!fs.existsSync(filePath)) return '';
    const fd = fs.openSync(filePath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      let position = stat.size;
      const chunkSize = 64 * 1024;
      let bufText = '';
      let bytesReadTotal = 0;
      while (position > 0 && bytesReadTotal < maxBytes) {
        const readSize = Math.min(chunkSize, position);
        position -= readSize;
        const buf = Buffer.alloc(readSize);
        fs.readSync(fd, buf, 0, readSize, position);
        bufText = buf.toString('utf8') + bufText;
        bytesReadTotal += readSize;
        const newlines = bufText.match(/\n/g);
        if ((newlines ? newlines.length : 0) >= requested + 5) {
          break;
        }
      }
      const lines = bufText.split(/\r?\n/);
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      const slice = lines.slice(Math.max(0, lines.length - requested));
      const tail = slice.join('\n');
      if (bytesReadTotal >= maxBytes && lines.length > requested) {
        return `[output truncated: read ${Math.round(bytesReadTotal / 1024)}KB]\n${tail}`;
      }
      return tail;
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  } catch {
    return '';
  }
}

export function createSessionManager({ execAsync, root, defaultShell, serverName, sessionRoot } = {}) {
  if (typeof execAsync !== 'function') {
    throw new Error('createSessionManager requires execAsync');
  }
  const workspaceRoot = typeof root === 'string' && root.trim() ? path.resolve(root.trim()) : process.cwd();
  const shell = typeof defaultShell === 'string' && defaultShell.trim() ? defaultShell.trim() : '/bin/bash';
  const name = typeof serverName === 'string' && serverName.trim() ? serverName.trim() : 'shell_tasks';
  const baseSessionRoot =
    typeof sessionRoot === 'string' && sessionRoot.trim() ? path.resolve(sessionRoot.trim()) : process.cwd();
  const sessionsDir = path.join(resolveAppStateDir(baseSessionRoot), 'sessions');

  const sessions = new Map();
  let cleanupPromise = null;
  let shuttingDown = false;

  function getSessionPaths(sessionName) {
    const safeName = sanitizeName(sessionName);
    return {
      name: safeName,
      outputPath: path.join(sessionsDir, `${safeName}.output.log`),
      controlPath: path.join(sessionsDir, `${safeName}.control.jsonl`),
      statusPath: path.join(sessionsDir, `${safeName}.status.json`),
    };
  }

  function readStatusByName(sessionName) {
    const paths = getSessionPaths(sessionName);
    const status = readJsonSafe(paths.statusPath);
    if (!status) return null;
    return status;
  }

  function writeStatus(session) {
    const payload = {
      name: session.name,
      pid: session.pid || null,
      token: session.token || null,
      command: session.command || '',
      cwd: session.cwd || workspaceRoot,
      window: session.window || null,
      startedAt: session.startedAt || null,
      exitedAt: session.exitedAt || null,
      exitCode: typeof session.exitCode === 'number' ? session.exitCode : null,
      signal: session.signal || null,
      platform: process.platform,
      outputPath: session.outputPath,
      controlPath: session.controlPath,
      statusPath: session.statusPath,
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(session.statusPath, payload);
  }

  async function getProcessCommandLine(pid) {
    const num = Number(pid);
    if (!Number.isFinite(num) || num <= 0) return '';
    if (process.platform === 'win32') return '';
    try {
      const { stdout } = await execAsync(`ps -o command= -ww -p ${num}`);
      return String(stdout || '').trim();
    } catch {
      return '';
    }
  }

  async function verifyPidToken(pid, token) {
    const tok = typeof token === 'string' ? token.trim() : '';
    if (!tok) return true;
    const cmdline = await getProcessCommandLine(pid);
    if (!cmdline) return true;
    return cmdline.includes(tok);
  }

  async function sendSignalToPid(pid, signal) {
    const sig = typeof signal === 'string' && signal.trim() ? signal.trim() : 'SIGTERM';
    const num = Number(pid);
    if (!Number.isFinite(num) || num <= 0) return;
    if (!isPidAlive(num)) return;

    if (process.platform === 'win32') {
      if (sig === 'SIGKILL') {
        await execAsync(`taskkill /pid ${num} /T /F`).catch(() => {});
        return;
      }
      try {
        process.kill(num, sig);
        return;
      } catch {
        await execAsync(`taskkill /pid ${num} /T /F`).catch(() => {});
        return;
      }
    }

    try {
      process.kill(-num, sig);
      return;
    } catch {
      // ignore
    }
    try {
      process.kill(num, sig);
    } catch {
      // ignore
    }
  }

  async function start({ sessionName, command, workingDir, envVars, windowName } = {}) {
    const safeName = sanitizeName(sessionName);
    const cwd = typeof workingDir === 'string' && workingDir.trim() ? workingDir.trim() : workspaceRoot;
    const env = envVars && typeof envVars === 'object' ? envVars : {};
    const safeWindow = windowName ? sanitizeName(windowName) : null;
    if (!command || typeof command !== 'string' || !command.trim()) {
      throw new Error('command is required');
    }

    ensureDir(sessionsDir);
    const paths = getSessionPaths(safeName);

    const existing = sessions.get(safeName);
    if (existing && existing.pid && isPidAlive(existing.pid)) {
      return {
        backend: 'portable',
        reused: true,
        sessionName: safeName,
        windowName: existing.window || safeWindow,
        stdout: '',
        stderr: '',
        ...paths,
      };
    }

    const existingStatus = readJsonSafe(paths.statusPath);
    const existingPid = existingStatus?.pid;
    if (existingPid && isPidAlive(existingPid)) {
      return {
        backend: 'portable',
        reused: true,
        sessionName: safeName,
        windowName: existingStatus?.window || safeWindow,
        stdout: '',
        stderr: '',
        ...paths,
      };
    }

    safeUnlink(paths.statusPath);
    safeUnlink(`${paths.statusPath}.tmp`);
    safeUnlink(`${paths.outputPath}.tmp`);
    safeUnlink(`${paths.controlPath}.tmp`);
    try {
      fs.writeFileSync(paths.outputPath, '', 'utf8');
    } catch {
      // ignore
    }
    try {
      fs.writeFileSync(paths.controlPath, '', 'utf8');
    } catch {
      // ignore
    }

    const token = crypto.randomUUID();
    const launchCommand = (() => {
      if (process.platform === 'win32') {
        if (isPowerShellExecutable(shell)) {
          const tokenExpr = escapePowerShellSingleQuoted(token);
          return `$env:MODEL_CLI_SESSION_TOKEN=${tokenExpr}; ${command}; exit $LASTEXITCODE`;
        }
        return `set \"MODEL_CLI_SESSION_TOKEN=${token}\" && ${command}`;
      }
      return `export MODEL_CLI_SESSION_TOKEN=${escapeShellValue(token)}\n${command}\ncmd_status=$?\nwait\nwait_status=$?\nif [ $cmd_status -ne 0 ]; then exit $cmd_status; else exit $wait_status; fi`;
    })();

    let outFd = null;
    try {
      outFd = fs.openSync(paths.outputPath, 'a');
    } catch (err) {
      throw new Error(`Failed to open output file for session "${safeName}": ${err?.message || String(err)}`);
    }

    const mergedEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      PAGER: 'cat',
      GIT_PAGER: 'cat',
      ...env,
    };
    let child;
    try {
      const { file, args } = getShellInvocation(shell, launchCommand);
      child = spawn(file, args, {
        cwd,
        env: mergedEnv,
        windowsHide: true,
        stdio: ['pipe', outFd, outFd],
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      try {
        fs.closeSync(outFd);
      } catch {
        // ignore
      }
      throw new Error(`Failed to start session "${safeName}": ${err?.message || String(err)}`);
    } finally {
      try {
        fs.closeSync(outFd);
      } catch {
        // ignore
      }
    }

    try {
      child.unref();
    } catch {
      // ignore
    }

    const session = {
      name: safeName,
      pid: child.pid,
      token,
      command,
      cwd,
      window: safeWindow,
      startedAt: new Date().toISOString(),
      exitedAt: null,
      exitCode: null,
      signal: null,
      outputPath: paths.outputPath,
      controlPath: paths.controlPath,
      statusPath: paths.statusPath,
      child,
    };
    sessions.set(safeName, session);
    writeStatus(session);

    child.on('error', (err) => {
      try {
        fs.appendFileSync(paths.outputPath, `\n[session error] ${err?.message || String(err)}\n`, 'utf8');
      } catch {
        // ignore
      }
    });
    child.on('exit', (code, signal) => {
      session.exitCode = typeof code === 'number' ? code : null;
      session.signal = signal || null;
      session.exitedAt = new Date().toISOString();
      writeStatus(session);
    });

    return {
      backend: 'portable',
      reused: false,
      sessionName: safeName,
      windowName: safeWindow,
      stdout: '',
      stderr: '',
      ...paths,
    };
  }

  async function captureOutput({ sessionName, lineCount } = {}) {
    const safeName = sanitizeName(sessionName);
    const paths = getSessionPaths(safeName);
    if (!fs.existsSync(paths.outputPath) && !fs.existsSync(paths.statusPath)) {
      throw new Error(`Session "${safeName}" is not found. Start it first with session_run.`);
    }
    const lines = Number.isFinite(lineCount) ? Math.max(1, Math.floor(lineCount)) : 500;
    return readLastLinesFromFile(paths.outputPath, lines);
  }

  async function sendInput({ sessionName, data, enter } = {}) {
    const safeName = sanitizeName(sessionName);
    const session = sessions.get(safeName);
    if (!session?.child?.stdin || typeof session.child.stdin.write !== 'function') {
      throw new Error(`Session "${safeName}" is not attached. Restart it with session_run before sending input.`);
    }
    if (session.pid && !isPidAlive(session.pid)) {
      throw new Error(`Session "${safeName}" is not running. Start it first with session_run.`);
    }
    const payload = String(data || '') + (enter === true ? '\n' : '');
    session.child.stdin.write(payload);
  }

  async function sendSignal({ sessionName, signal } = {}) {
    const safeName = sanitizeName(sessionName);
    const session = sessions.get(safeName);
    const status = session ? null : readStatusByName(safeName);
    const pid = session?.pid || status?.pid;
    if (!pid) {
      throw new Error(`Session "${safeName}" is not found. Start it first with session_run.`);
    }
    const token = session?.token || status?.token;
    const verified = await verifyPidToken(pid, token);
    if (!verified) {
      throw new Error(`Refusing to signal pid ${pid}: it does not look like session "${safeName}".`);
    }
    await sendSignalToPid(pid, signal);
  }

  async function killSession({ sessionName } = {}) {
    const safeName = sanitizeName(sessionName);
    await sendSignal({ sessionName: safeName, signal: 'SIGTERM' });
  }

  function listSessions() {
    ensureDir(sessionsDir);
    try {
      const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.status.json'));
      const entries = [];
      files.forEach((fileName) => {
        const statusPath = path.join(sessionsDir, fileName);
        const status = readJsonSafe(statusPath);
        if (!status?.name) return;
        const pid = status.pid;
        const running = pid ? isPidAlive(pid) : false;
        entries.push({
          ...status,
          running,
        });
      });
      entries.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
      return entries;
    } catch {
      return [];
    }
  }

  function registerCleanupHandlers() {
    const handleSignal = (signal) => {
      triggerCleanup(`signal:${signal}`)
        .catch(() => {})
        .finally(() => process.exit(0));
    };
    process.once('SIGINT', () => handleSignal('SIGINT'));
    process.once('SIGTERM', () => handleSignal('SIGTERM'));
    process.once('beforeExit', () => {
      triggerCleanup('before_exit').catch(() => {});
    });
    process.once('uncaughtException', (err) => {
      console.error('Shell server crashed:', err);
      triggerCleanup('uncaughtException')
        .catch(() => {})
        .finally(() => process.exit(1));
    });
    process.once('unhandledRejection', (reason) => {
      console.error('Shell server unhandled rejection:', reason);
      triggerCleanup('unhandledRejection')
        .catch(() => {})
        .finally(() => process.exit(1));
    });
  }

  async function triggerCleanup(reason) {
    if (shuttingDown) {
      return cleanupPromise || Promise.resolve();
    }
    shuttingDown = true;
    cleanupPromise = (async () => {
      const active = Array.from(sessions.values());
      await Promise.allSettled(
        active.map(async (session) => {
          try {
            await sendSignalToPid(session.pid, 'SIGTERM');
          } catch {
            // ignore
          }
          try {
            session.exitedAt = session.exitedAt || new Date().toISOString();
            writeStatus(session);
          } catch {
            // ignore
          }
        })
      );
      if (active.length > 0) {
        console.error(`[${name}] Cleaned up ${active.length} session(s)${reason ? ` (${reason})` : ''}.`);
      }
    })();
    return cleanupPromise;
  }

  return {
    captureOutput,
    getSessionPaths,
    killSession,
    listSessions,
    registerCleanupHandlers,
    sanitizeName,
    sendInput,
    sendSignal,
    start,
    triggerCleanup,
  };
}
