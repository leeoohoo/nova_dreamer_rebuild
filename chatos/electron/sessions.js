import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

import {
  ensureDir,
  escapeShellValue,
  getSessionPaths,
  readJsonSafe,
  readLastLinesFromFile,
  resolveBaseSessionRoot,
  resolveSessionsDir,
  sanitizeName,
  safeUnlink,
  writeJsonAtomic,
} from './sessions/utils.js';
import { isPidAlive, isProcessGroupAlive } from './sessions/process-utils.js';

const execAsync = promisify(exec);
const DEFAULT_STOP_TIMEOUT_MS = 4000;
const DEFAULT_POLL_INTERVAL_MS = 200;
const PS_MAX_BUFFER = 8 * 1024 * 1024;
const PORT_SCAN_LINES = 140;
const PORT_SCAN_BYTES = 128 * 1024;
const DEFAULT_SESSION_SHELL =
  process.platform === 'win32'
    ? process.env.COMSPEC || process.env.ComSpec || 'cmd.exe'
    : typeof process.env.SHELL === 'string' && process.env.SHELL.trim()
      ? process.env.SHELL.trim()
      : '/bin/bash';

async function execText(command, options = {}) {
  try {
    const result = await execAsync(command, { maxBuffer: PS_MAX_BUFFER, ...options });
    return String(result?.stdout || '');
  } catch {
    return '';
  }
}

function buildLaunchCommand({ token, command } = {}) {
  const tok = typeof token === 'string' ? token.trim() : '';
  const cmd = typeof command === 'string' ? command.trim() : '';
  if (!cmd) return '';
  if (process.platform === 'win32') {
    return tok ? `set \"MODEL_CLI_SESSION_TOKEN=${tok}\" && ${cmd}` : cmd;
  }
  if (!tok) return cmd;
  return `export MODEL_CLI_SESSION_TOKEN=${escapeShellValue(tok)}\n${cmd}\ncmd_status=$?\nwait\nwait_status=$?\nif [ $cmd_status -ne 0 ]; then exit $cmd_status; else exit $wait_status; fi`;
}

async function startSession({ sessionRoot, name, command, cwd, windowName } = {}) {
  const sessionName = sanitizeName(name);
  if (!sessionName) {
    throw new Error('session name is required');
  }
  const cmd = typeof command === 'string' ? command.trim() : '';
  if (!cmd) {
    throw new Error(`session "${sessionName}" has no command`);
  }

  const sessionsDir = resolveSessionsDir(sessionRoot);
  ensureDir(sessionsDir);
  const paths = getSessionPaths(sessionsDir, sessionName);

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
  const launchCommand = buildLaunchCommand({ token, command: cmd });
  const fallbackCwd = resolveBaseSessionRoot(sessionRoot);
  const workingDir = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : fallbackCwd;
  const shell = DEFAULT_SESSION_SHELL;
  const startedAt = new Date().toISOString();

  let outFd = null;
  try {
    outFd = fs.openSync(paths.outputPath, 'a');
  } catch (err) {
    throw new Error(`Failed to open output file for session "${sessionName}": ${err?.message || String(err)}`);
  }

  let child;
  try {
    child = spawn(launchCommand, {
      cwd: workingDir,
      env: process.env,
      shell,
      windowsHide: true,
      stdio: ['pipe', outFd, outFd],
      detached: process.platform !== 'win32',
    });
  } catch (err) {
    throw new Error(`Failed to start session "${sessionName}": ${err?.message || String(err)}`);
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

  const statusPayload = {
    name: sessionName,
    pid: child?.pid || null,
    // pgid will be resolved on demand; best-effort when detached
    pgid: process.platform === 'win32' ? null : child?.pid || null,
    token,
    command: cmd,
    cwd: workingDir,
    window: typeof windowName === 'string' && windowName.trim() ? windowName.trim() : null,
    startedAt,
    exitedAt: null,
    exitCode: null,
    signal: null,
    platform: process.platform,
    outputPath: paths.outputPath,
    controlPath: paths.controlPath,
    statusPath: paths.statusPath,
    updatedAt: startedAt,
  };
  writeJsonAtomic(paths.statusPath, statusPayload);

  child.on('exit', (code, signal) => {
    try {
      const existing = readJsonSafe(paths.statusPath);
      if (!existing) return;
      writeJsonAtomic(paths.statusPath, {
        ...existing,
        exitedAt: existing.exitedAt || new Date().toISOString(),
        exitCode: typeof code === 'number' ? code : null,
        signal: signal || null,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // ignore
    }
  });

  child.on('error', (err) => {
    try {
      fs.appendFileSync(paths.outputPath, `\n[session error] ${err?.message || String(err)}\n`, 'utf8');
    } catch {
      // ignore
    }
  });

  return { ok: true, name: sessionName, pid: child?.pid || null };
}

async function getProcessCommandLine(pid) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return '';
  if (process.platform === 'win32') {
    // Best-effort only; fall back to allowing kill/list if unavailable.
    const cmd = `powershell -NoProfile -Command \"(Get-CimInstance Win32_Process -Filter 'ProcessId=${num}').CommandLine\"`;
    try {
      const stdout = await execText(cmd);
      return String(stdout || '').trim();
    } catch {
      return '';
    }
  }
  const stdout = await execText(`ps -o command= -ww -p ${num}`);
  return String(stdout || '').trim();
}

async function getProcessCommandLineWithEnv(pid) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return '';
  if (process.platform === 'win32') {
    return await getProcessCommandLine(num);
  }

  const commands = [
    `ps eww -p ${num} -o command=`,
    `ps eww -o command= -p ${num}`,
    `ps eww -p ${num}`,
  ];
  for (const cmd of commands) {
    const stdout = await execText(cmd);
    const text = String(stdout || '').trim();
    if (text) return text;
  }
  return '';
}

async function verifyPidToken(pid, token) {
  const tok = typeof token === 'string' ? token.trim() : '';
  if (!tok) return true;
  const cmdline = await getProcessCommandLine(pid);
  if (!cmdline) return true;
  if (cmdline.includes(tok)) return true;
  const enriched = await getProcessCommandLineWithEnv(pid);
  if (!enriched) return true;
  return enriched.includes(tok);
}

function sleep(ms) {
  const duration = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function tryKillPid(pid, signal) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return false;
  try {
    process.kill(num, signal);
    return true;
  } catch {
    return false;
  }
}

function tryKillProcessGroup(pgid, signal) {
  const num = Number(pgid);
  if (!Number.isFinite(num) || num <= 0) return false;
  if (process.platform === 'win32') return false;
  try {
    process.kill(-num, signal);
    return true;
  } catch {
    return false;
  }
}

async function listProcessTreePidsFromPs(rootPids) {
  const roots = (Array.isArray(rootPids) ? rootPids : [])
    .map((pid) => Number(pid))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
  if (roots.length === 0) return [];
  if (process.platform === 'win32') return roots;

  let stdout = '';
  try {
    const result = await execAsync('/bin/ps -ax -o pid=,ppid=');
    stdout = result?.stdout || '';
  } catch {
    try {
      const result = await execAsync('ps -ax -o pid=,ppid=');
      stdout = result?.stdout || '';
    } catch {
      return roots;
    }
  }

  const childrenMap = new Map();
  const lines = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  lines.forEach((line) => {
    const parts = line.split(/\s+/);
    if (parts.length < 2) return;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (!Number.isFinite(pid) || pid <= 0) return;
    if (!Number.isFinite(ppid) || ppid < 0) return;
    if (!childrenMap.has(ppid)) {
      childrenMap.set(ppid, []);
    }
    childrenMap.get(ppid).push(pid);
  });

  const seen = new Set();
  const order = [];
  const queue = roots.slice();
  while (queue.length > 0) {
    const pid = queue.shift();
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (seen.has(pid)) continue;
    seen.add(pid);
    order.push(pid);
    const kids = childrenMap.get(pid);
    if (Array.isArray(kids) && kids.length > 0) {
      kids.forEach((childPid) => {
        if (!seen.has(childPid)) {
          queue.push(childPid);
        }
      });
    }
  }

  // Kill children first to reduce orphaning.
  return order.reverse();
}

function extractPidsFromPsOutput(stdout, token) {
  const tok = typeof token === 'string' ? token.trim() : '';
  if (!tok) return [];
  const pids = new Set();
  const lines = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!line.includes(tok)) continue;
    const match = line.match(/^(\d+)\s+/);
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    pids.add(pid);
  }
  return Array.from(pids);
}

async function listPidsMatchingToken(token) {
  const tok = typeof token === 'string' ? token.trim() : '';
  if (!tok) return [];

  if (process.platform === 'win32') {
    const escaped = tok.replace(/'/g, "''");
    const cmd =
      `powershell -NoProfile -Command \"Get-CimInstance Win32_Process ` +
      `| Where-Object { $_.CommandLine -like '*${escaped}*' } ` +
      `| Select-Object -ExpandProperty ProcessId\"`;
    const stdout = await execText(cmd);
    const matches = String(stdout || '')
      .split(/\s+/)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0);
    return Array.from(new Set(matches));
  }

  const quickList = ['ps -ax -o pid=,command= -ww', '/bin/ps -ax -o pid=,command= -ww'];
  for (const cmd of quickList) {
    const stdout = await execText(cmd);
    const pids = extractPidsFromPsOutput(stdout, tok);
    if (pids.length > 0) return pids;
  }

  const envList = ['ps eww -ax', '/bin/ps eww -ax', 'ps eww -ax -o pid=,command=', '/bin/ps eww -ax -o pid=,command='];
  for (const cmd of envList) {
    const stdout = await execText(cmd);
    const pids = extractPidsFromPsOutput(stdout, tok);
    if (pids.length > 0) return pids;
  }

  return [];
}

async function getProcessGroupId(pid) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (process.platform === 'win32') return null;
  const stdout = await execText(`ps -o pgid= -p ${num}`);
  const parsed = Number(String(stdout || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function resolveSessionRuntimeFromToken(token) {
  const pids = await listPidsMatchingToken(token);
  const alive = pids.filter((pid) => pid !== process.pid && isPidAlive(pid));
  if (alive.length === 0) return null;

  if (process.platform === 'win32') {
    return { pid: alive[0], pgid: null, pids: alive };
  }

  const infos = await Promise.all(
    alive.map(async (pid) => ({
      pid,
      pgid: await getProcessGroupId(pid),
    }))
  );

  const groups = new Map();
  for (const info of infos) {
    const key = info.pgid || info.pid;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(info.pid);
  }

  const ordered = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  const [bestPgid, bestPids] = ordered[0];
  const leaderPid = bestPids.includes(bestPgid) ? bestPgid : Math.min(...bestPids);
  return { pid: leaderPid, pgid: bestPgid, pids: alive };
}

function resolveSessionIds(status) {
  const pidNum = Number(status?.pid);
  const pid = Number.isFinite(pidNum) && pidNum > 0 ? pidNum : null;

  const pgidNum = Number(status?.pgid);
  const pgid = Number.isFinite(pgidNum) && pgidNum > 0 ? pgidNum : pid;

  return { pid, pgid };
}

function isSessionAlive(pid, pgid) {
  const leader = Number(pid);
  const group = Number(pgid);
  if (Number.isFinite(leader) && leader > 0 && isPidAlive(leader)) return true;
  if (Number.isFinite(group) && group > 0 && isProcessGroupAlive(group)) return true;
  return false;
}

function normalizePort(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const port = Math.trunc(num);
  if (port <= 0 || port > 65535) return null;
  return port;
}

function appendPort(list, value) {
  const port = normalizePort(value);
  if (!port) return;
  if (!list.includes(port)) {
    list.push(port);
  }
}

function extractPortsFromText(text) {
  const ports = [];
  const source = String(text || '');
  if (!source) return ports;

  const patterns = [
    /https?:\/\/(?:\[[^\]]+\]|[^\s/:]+):(\d{2,5})/gi,
    /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\s+)(\d{2,5})\b/gi,
    /\bport\s*(?:=|:)?\s*(\d{2,5})\b/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      appendPort(ports, match[1]);
    }
  }

  return ports;
}

function extractPortsFromCommand(command) {
  const ports = [];
  const source = String(command || '');
  if (!source) return ports;

  const patterns = [
    /(?:^|\s)--port(?:=|\s+)(\d{2,5})\b/g,
    /(?:^|\s)-p(?:=|\s+)?(\d{2,5})(?::\d{2,5})?\b/g,
    /(?:^|\s)PORT\s*=\s*(\d{2,5})\b/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      appendPort(ports, match[1]);
    }
  }

  extractPortsFromText(source).forEach((port) => appendPort(ports, port));
  return ports;
}

async function waitForPidExit(pid, timeoutMs = DEFAULT_STOP_TIMEOUT_MS, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return true;
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  const interval = Math.max(50, Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS);
  while (Date.now() < deadline) {
    if (!isPidAlive(num)) return true;
    await sleep(interval);
  }
  return !isPidAlive(num);
}

async function waitForSessionExit({ pid, pgid, timeoutMs = DEFAULT_STOP_TIMEOUT_MS, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  const leader = Number(pid);
  const group = Number(pgid);
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  const interval = Math.max(50, Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS);
  while (Date.now() < deadline) {
    if (!isSessionAlive(leader, group)) return true;
    await sleep(interval);
  }
  return !isSessionAlive(leader, group);
}

function isPathInsideDir(filePath, dirPath) {
  try {
    const dir = path.resolve(dirPath);
    const file = path.resolve(filePath);
    if (file === dir) return true;
    const prefix = dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`;
    return file.startsWith(prefix);
  } catch {
    return false;
  }
}

function cleanupSessionArtifacts({ sessionsDir, sessionName, status } = {}) {
  const safeName = sanitizeName(sessionName);
  const baseDir = typeof sessionsDir === 'string' && sessionsDir ? sessionsDir : '';
  if (!safeName || !baseDir) return;

  const computed = {
    statusPath: path.join(baseDir, `${safeName}.status.json`),
    outputPath: path.join(baseDir, `${safeName}.output.log`),
    controlPath: path.join(baseDir, `${safeName}.control.jsonl`),
  };

  const candidates = new Set(
    [
      status?.statusPath,
      status?.outputPath,
      status?.controlPath,
      computed.statusPath,
      computed.outputPath,
      computed.controlPath,
      `${computed.statusPath}.tmp`,
      `${computed.outputPath}.tmp`,
      `${computed.controlPath}.tmp`,
    ].filter((v) => typeof v === 'string' && v.trim())
  );

  for (const filePath of candidates) {
    if (!isPathInsideDir(filePath, baseDir)) continue;
    safeUnlink(filePath);
  }
}

async function sendSignalToPid(pid, signal) {
  const sig = typeof signal === 'string' && signal.trim() ? signal.trim() : 'SIGTERM';
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return;

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

export async function listSessions({ sessionRoot } = {}) {
  const sessionsDir = resolveSessionsDir(sessionRoot);
  ensureDir(sessionsDir);
  const platform = process.platform;
  try {
    const files = fs.readdirSync(sessionsDir).filter((name) => name.endsWith('.status.json'));
    const sessions = [];
    for (const fileName of files) {
      const statusPath = path.join(sessionsDir, fileName);
      const status = readJsonSafe(statusPath);
      if (!status?.name) continue;
      const { pid, pgid } = resolveSessionIds(status);
      let running = pid ? isSessionAlive(pid, pgid) : false;
      let resolvedPid = pid;
      let resolvedPgid = pgid;
      let recovered = false;

      if (status.token) {
        if (running && pid && isPidAlive(pid)) {
          const verified = await verifyPidToken(pid, status.token);
          if (!verified) {
            running = false;
          }
        }

        if (!running) {
          const runtime = await resolveSessionRuntimeFromToken(status.token);
          if (runtime?.pid) {
            running = true;
            resolvedPid = runtime.pid;
            resolvedPgid = runtime.pgid;
            recovered = true;
          }
        }
      }

      const ports = [];
      const outputPath = typeof status?.outputPath === 'string' ? status.outputPath : '';
      if (running && outputPath) {
        const tail = readLastLinesFromFile(outputPath, PORT_SCAN_LINES, PORT_SCAN_BYTES);
        extractPortsFromText(tail).forEach((port) => appendPort(ports, port));
      }
      if (ports.length === 0) {
        extractPortsFromCommand(status?.command).forEach((port) => appendPort(ports, port));
      }
      const port = ports.length > 0 ? ports[0] : null;

      sessions.push({ ...status, running, resolvedPid, resolvedPgid, recovered, port, ports });
    }
    sessions.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
    return { available: true, platform, sessionsDir, sessions };
  } catch (err) {
    return { available: true, platform, sessionsDir, sessions: [], error: err?.message || String(err) };
  }
}

export async function killSession({ sessionRoot, name, signal } = {}) {
  const sessionName = sanitizeName(name);
  if (!sessionName) {
    throw new Error('session name is required');
  }
  const sessionsDir = resolveSessionsDir(sessionRoot);
  ensureDir(sessionsDir);
  const statusPath = path.join(sessionsDir, `${sessionName}.status.json`);
  const status = readJsonSafe(statusPath);
  let { pid, pgid } = resolveSessionIds(status);

  if (status?.token && !isSessionAlive(pid, pgid)) {
    const runtime = await resolveSessionRuntimeFromToken(status.token);
    if (runtime?.pid) {
      pid = runtime.pid;
      pgid = runtime.pgid || pgid;
    }
  }

  if (!pid && !pgid) {
    cleanupSessionArtifacts({ sessionsDir, sessionName, status });
    return { ok: true, name: sessionName, pid: null, removed: true };
  }

  // Only verify token when the leader pid is still present; otherwise we cannot trust the cmdline check.
  if (status?.token && pid && isPidAlive(pid)) {
    const verified = await verifyPidToken(pid, status.token);
    if (!verified) {
      throw new Error(`refusing to kill pid ${pid}: token mismatch (session=${sessionName})`);
    }
  }

  const initialSignal = typeof signal === 'string' && signal.trim() ? signal.trim() : 'SIGTERM';
  const killTreeOnce = async (sig) => {
    if (process.platform === 'win32') {
      if (pid) {
        if (sig === 'SIGKILL') {
          await execAsync(`taskkill /pid ${pid} /T /F`).catch(() => {});
          return;
        }
        tryKillPid(pid, sig);
      }
      return;
    }

    if (pgid) {
      tryKillProcessGroup(pgid, sig);
    }

    if (pid) {
      const killList = await listProcessTreePidsFromPs([pid]);
      killList.forEach((targetPid) => {
        if (targetPid === process.pid) return;
        tryKillPid(targetPid, sig);
      });
    }
  };

  await killTreeOnce(initialSignal);
  let exited = await waitForSessionExit({ pid, pgid });
  if (!exited) {
    await killTreeOnce('SIGKILL');
    exited = await waitForSessionExit({ pid, pgid });
  }
  if (!exited) {
    throw new Error(`failed to stop session ${sessionName} (pid=${pid || 'n/a'})`);
  }

  cleanupSessionArtifacts({ sessionsDir, sessionName, status });
  return { ok: true, name: sessionName, pid: pid || null, removed: true };
}

export async function stopSession({ sessionRoot, name, signal } = {}) {
  const sessionName = sanitizeName(name);
  if (!sessionName) {
    throw new Error('session name is required');
  }
  const sessionsDir = resolveSessionsDir(sessionRoot);
  ensureDir(sessionsDir);
  const statusPath = path.join(sessionsDir, `${sessionName}.status.json`);
  const status = readJsonSafe(statusPath);
  let { pid, pgid } = resolveSessionIds(status);

  if (status?.token && !isSessionAlive(pid, pgid)) {
    const runtime = await resolveSessionRuntimeFromToken(status.token);
    if (runtime?.pid) {
      pid = runtime.pid;
      pgid = runtime.pgid || pgid;
    }
  }

  if (!pid && !pgid) {
    if (status) {
      const now = new Date().toISOString();
      writeJsonAtomic(statusPath, { ...status, exitedAt: status.exitedAt || now, updatedAt: now, pid: null, pgid: null });
    }
    return { ok: true, name: sessionName, pid: null, stopped: true };
  }

  // Only verify token when the leader pid is still present; otherwise we cannot trust the cmdline check.
  if (status?.token && pid && isPidAlive(pid)) {
    const verified = await verifyPidToken(pid, status.token);
    if (!verified) {
      throw new Error(`refusing to stop pid ${pid}: token mismatch (session=${sessionName})`);
    }
  }

  const initialSignal = typeof signal === 'string' && signal.trim() ? signal.trim() : 'SIGTERM';
  const killTreeOnce = async (sig) => {
    if (process.platform === 'win32') {
      if (pid) {
        if (sig === 'SIGKILL') {
          await execAsync(`taskkill /pid ${pid} /T /F`).catch(() => {});
          return;
        }
        tryKillPid(pid, sig);
      }
      return;
    }

    if (pgid) {
      tryKillProcessGroup(pgid, sig);
    }

    if (pid) {
      const killList = await listProcessTreePidsFromPs([pid]);
      killList.forEach((targetPid) => {
        if (targetPid === process.pid) return;
        tryKillPid(targetPid, sig);
      });
    }
  };

  await killTreeOnce(initialSignal);
  let exited = await waitForSessionExit({ pid, pgid });
  if (!exited) {
    await killTreeOnce('SIGKILL');
    exited = await waitForSessionExit({ pid, pgid });
  }
  if (!exited) {
    throw new Error(`failed to stop session ${sessionName} (pid=${pid || 'n/a'})`);
  }

  if (status) {
    const now = new Date().toISOString();
    writeJsonAtomic(statusPath, {
      ...status,
      exitedAt: status.exitedAt || now,
      signal: initialSignal,
      updatedAt: now,
      pid: null,
      pgid: null,
    });
  }

  return { ok: true, name: sessionName, pid: pid || null, stopped: true };
}

export async function readSessionLog({ sessionRoot, name, lineCount, maxBytes } = {}) {
  const sessionName = sanitizeName(name);
  if (!sessionName) {
    throw new Error('session name is required');
  }
  const sessionsDir = resolveSessionsDir(sessionRoot);
  ensureDir(sessionsDir);
  const { statusPath, outputPath } = getSessionPaths(sessionsDir, sessionName);
  const status = readJsonSafe(statusPath);
  if (!status) {
    throw new Error(`Session "${sessionName}" is not found.`);
  }
  const size = (() => {
    try {
      return fs.statSync(outputPath).size;
    } catch {
      return null;
    }
  })();
  const mtime = (() => {
    try {
      const stat = fs.statSync(outputPath);
      return stat?.mtime ? stat.mtime.toISOString() : null;
    } catch {
      return null;
    }
  })();
  const bytes = Number.isFinite(Number(maxBytes)) ? Math.max(1024, Math.min(4 * 1024 * 1024, Math.floor(Number(maxBytes)))) : 1024 * 1024;
  const lines = Number.isFinite(Number(lineCount)) ? Math.max(1, Math.min(50_000, Math.floor(Number(lineCount)))) : 500;
  const content = readLastLinesFromFile(outputPath, lines, bytes);
  return { ok: true, name: sessionName, outputPath, size, mtime, lineCount: lines, maxBytes: bytes, content };
}

export async function restartSession({ sessionRoot, name } = {}) {
  const sessionName = sanitizeName(name);
  if (!sessionName) {
    throw new Error('session name is required');
  }
  const sessionsDir = resolveSessionsDir(sessionRoot);
  ensureDir(sessionsDir);
  const { statusPath } = getSessionPaths(sessionsDir, sessionName);
  const status = readJsonSafe(statusPath);
  if (!status) {
    throw new Error(`Session "${sessionName}" is not found.`);
  }
  const command = typeof status?.command === 'string' ? status.command.trim() : '';
  if (!command) {
    throw new Error(`Session "${sessionName}" has no command to restart.`);
  }
  const cwd = typeof status?.cwd === 'string' && status.cwd.trim() ? status.cwd.trim() : null;
  const windowName = typeof status?.window === 'string' ? status.window : null;

  await killSession({ sessionRoot, name: sessionName });
  return await startSession({ sessionRoot, name: sessionName, command, cwd, windowName });
}

export async function killAllSessions({ sessionRoot, signal } = {}) {
  const summary = { ok: true, killed: [], errors: [] };
  const list = await listSessions({ sessionRoot });
  const sessions = Array.isArray(list.sessions) ? list.sessions : [];
  if (sessions.length === 0) return summary;
  for (const sess of sessions) {
    if (!sess?.name) continue;
    try {
      const result = await killSession({ sessionRoot, name: sess.name, signal });
      summary.killed.push(result?.name || sess.name);
    } catch (err) {
      summary.ok = false;
      summary.errors.push(`${sess.name}: ${err?.message || err}`);
    }
  }
  return summary;
}
