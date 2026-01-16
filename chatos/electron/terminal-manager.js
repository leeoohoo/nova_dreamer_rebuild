import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parseJsonSafe, safeRead } from '../src/aide/shared/data/legacy.js';
import { getHostApp } from '../src/common/host-app.js';
import { resolveAppStateDir } from '../src/common/state-core/state-paths.js';

import { isPidAlive, listProcessTreePidsFromPs, tryKillPid, tryKillProcessGroup } from './terminal-manager/process-utils.js';
import { isPendingSystemTerminalLaunch, launchCliInSystemTerminal } from './terminal-manager/system-terminal.js';
import { createTerminalDispatch } from './terminal-manager/dispatch.js';

function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

function parseRuns(content = '') {
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  const entries = [];
  lines.forEach((line) => {
    const parsed = parseJsonSafe(line, null);
    if (parsed && typeof parsed === 'object') {
      entries.push(parsed);
    }
  });
  return entries;
}

export function createTerminalManager({
  projectRoot,
  terminalsDir,
  sessionRoot,
  defaultPaths,
  adminServices,
  mainWindowGetter,
  uiTerminalModeEnv = 'MODEL_CLI_UI_TERMINAL_MODE',
  uiTerminalStdio = ['pipe', 'ignore', 'ignore'],
} = {}) {
  const baseProjectRoot =
    typeof projectRoot === 'string' && projectRoot.trim() ? path.resolve(projectRoot) : process.cwd();
  const baseSessionRoot =
    typeof sessionRoot === 'string' && sessionRoot.trim() ? path.resolve(sessionRoot) : process.cwd();
  const resolvedHostApp = getHostApp() || 'chatos';
  const baseTerminalsDir =
    typeof terminalsDir === 'string' && terminalsDir.trim()
      ? path.resolve(terminalsDir)
      : path.join(
          resolveAppStateDir(baseSessionRoot, { hostApp: resolvedHostApp, fallbackHostApp: 'chatos' }),
          'terminals'
        );
  const getMainWindow = typeof mainWindowGetter === 'function' ? mainWindowGetter : () => null;
  const runsPath = typeof defaultPaths?.runs === 'string' && defaultPaths.runs.trim() ? defaultPaths.runs : '';

  const launchedCli = new Map();
  const pendingSystemTerminalLaunch = new Map();

  let terminalStatusWatcher = null;
  let terminalStatusWatcherDebounce = null;
  let healthCheckInterval = null;

  function cleanupLaunchedCli() {
    launchedCli.forEach((child) => {
      try {
        if (child && !child.killed) {
          child.kill('SIGTERM');
        }
      } catch {
        // ignore
      }
    });
    launchedCli.clear();
  }

  function resolveUiTerminalMode() {
    const fromSettings = (() => {
      try {
        const runtime = adminServices?.settings?.getRuntime?.();
        const raw = typeof runtime?.uiTerminalMode === 'string' ? runtime.uiTerminalMode.trim() : '';
        if (!raw) return '';
        const normalized = raw.toLowerCase();
        if (['headless', 'system', 'auto'].includes(normalized)) {
          return normalized;
        }
      } catch {
        // ignore settings lookup failures
      }
      return '';
    })();
    if (fromSettings && fromSettings !== 'auto') {
      return fromSettings;
    }

    const raw = typeof process.env[uiTerminalModeEnv] === 'string' ? process.env[uiTerminalModeEnv].trim() : '';
    if (raw) {
      const normalized = raw.toLowerCase();
      if (['headless', 'system', 'auto'].includes(normalized)) {
        return normalized;
      }
    }
    if (fromSettings === 'auto') {
      return fromSettings;
    }
    return process.platform === 'darwin' || process.platform === 'win32' ? 'system' : 'headless';
  }

  function generateRunId() {
    const short = crypto.randomUUID().split('-')[0];
    return `run-${Date.now().toString(36)}-${short}`;
  }

  function resolveCliEntrypointPath() {
    const resources = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
    if (resources) {
      const asarPath = path.join(resources, 'app.asar');
      try {
        if (fs.existsSync(asarPath)) {
          const distCandidate = path.join(asarPath, 'dist', 'cli.js');
          if (fs.existsSync(distCandidate)) return distCandidate;
          const srcCandidate = path.join(asarPath, 'src', 'cli.js');
          if (fs.existsSync(srcCandidate)) return srcCandidate;
        }
      } catch {
        // ignore
      }
    }

    const srcLocal = path.join(baseProjectRoot, 'src', 'cli.js');
    try {
      if (fs.existsSync(srcLocal)) return srcLocal;
    } catch {
      // ignore
    }
    const distLocal = path.join(baseProjectRoot, 'dist', 'cli.js');
    try {
      if (fs.existsSync(distLocal)) return distLocal;
    } catch {
      // ignore
    }
    return distLocal;
  }

  function startTerminalStatusWatcher() {
    if (terminalStatusWatcher) return;
    ensureDir(baseTerminalsDir);
    terminalStatusWatcher = fs.watch(baseTerminalsDir, { persistent: false }, () => {
      if (terminalStatusWatcherDebounce) {
        clearTimeout(terminalStatusWatcherDebounce);
      }
      terminalStatusWatcherDebounce = setTimeout(() => {
        terminalStatusWatcherDebounce = null;
        broadcastTerminalStatuses();
      }, 120);
    });
    broadcastTerminalStatuses();
  }
  function startHealthChecker() {
    if (healthCheckInterval) return;
    healthCheckInterval = setInterval(() => {
      launchedCli.forEach((child, rid) => {
        if (child && child.killed) {
          launchedCli.delete(rid);
          broadcastTerminalStatuses();
          return;
        }
        if (child && child.exitCode !== null) {
          launchedCli.delete(rid);
          broadcastTerminalStatuses();
          return;
        }
        // Check if process is still alive using pid
        if (child && child.pid && !isPidAlive(child.pid)) {
          launchedCli.delete(rid);
          broadcastTerminalStatuses();
        }
      });
    }, 30000); // 30 seconds
    if (healthCheckInterval.unref) healthCheckInterval.unref();
  }

  function broadcastTerminalStatuses() {
    const win = getMainWindow();
    if (!win) return;
    win.webContents.send('terminalStatus:update', {
      statuses: listTerminalStatuses(),
    });
  }

  function listTerminalStatuses() {
    try {
      ensureDir(baseTerminalsDir);
      const files = fs.readdirSync(baseTerminalsDir).filter((name) => name.endsWith('.status.json'));
      const out = [];
      files.forEach((name) => {
        const runId = name.replace(/\.status\.json$/, '');
        const status = readTerminalStatus(runId);
        if (status) out.push(status);
      });
      return out;
    } catch {
      return [];
    }
  }

  function readTerminalStatus(runId) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) return null;
    const statusPath = path.join(baseTerminalsDir, `${rid}.status.json`);
    try {
      if (!fs.existsSync(statusPath)) return null;
      const raw = fs.readFileSync(statusPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // ignore status read errors
    }
    return null;
  }

  function appendTerminalControl(runId, command) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) throw new Error('runId is required');
    ensureDir(baseTerminalsDir);
    const controlPath = path.join(baseTerminalsDir, `${rid}.control.jsonl`);
    fs.appendFileSync(controlPath, `${JSON.stringify(command)}\n`, 'utf8');
  }

  async function waitForTerminalStatus(runId, timeoutMs = 1200) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) return null;
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    while (Date.now() < deadline) {
      const status = readTerminalStatus(rid);
      if (status) return status;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return null;
  }

  function isRunPidAliveFromRegistry(runId) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid || !runsPath) return false;
    try {
      const entries = parseRuns(safeRead(runsPath));
      let best = null;
      entries.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        if (String(entry.runId || '').trim() !== rid) return;
        if (!best || String(entry.ts || '') > String(best.ts || '')) {
          best = entry;
        }
      });
      const pid = best?.pid;
      return isPidAlive(pid);
    } catch {
      return false;
    }
  }

  function getRunPidFromRegistry(runId) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid || !runsPath) return null;
    try {
      const entries = parseRuns(safeRead(runsPath));
      let best = null;
      entries.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        if (String(entry.runId || '').trim() !== rid) return;
        if (!best || String(entry.ts || '') > String(best.ts || '')) {
          best = entry;
        }
      });
      const pid = best?.pid;
      const num = Number(pid);
      return Number.isFinite(num) && num > 0 ? num : null;
    } catch {
      return null;
    }
  }

  async function waitForTerminalState(runId, predicate, timeoutMs = 2000) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) return null;
    const check = typeof predicate === 'function' ? predicate : () => false;
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    while (Date.now() < deadline) {
      const status = readTerminalStatus(rid);
      if (check(status)) return status;
      await new Promise((resolve) => setTimeout(resolve, 140));
    }
    return readTerminalStatus(rid);
  }

  function listRunPidRegistry(runId) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) return [];
    const filePath = path.join(baseTerminalsDir, `${rid}.pids.jsonl`);
    try {
      if (!fs.existsSync(filePath)) return [];
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const unique = new Set();
      lines.forEach((line) => {
        try {
          const parsed = JSON.parse(line);
          const pid = Number(parsed?.pid);
          if (Number.isFinite(pid) && pid > 0) {
            unique.add(pid);
          }
        } catch {
          // ignore parse failures
        }
      });
      return Array.from(unique);
    } catch {
      return [];
    }
  }

  function listRunPidRecords(runId) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) return [];
    const filePath = path.join(baseTerminalsDir, `${rid}.pids.jsonl`);
    try {
      if (!fs.existsSync(filePath)) return [];
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const latestByPid = new Map();
      lines.forEach((line) => {
        const parsed = parseJsonSafe(line, null);
        if (!parsed || typeof parsed !== 'object') return;
        const pid = Number(parsed?.pid);
        if (!Number.isFinite(pid) || pid <= 0) return;
        const record = {
          pid,
          runId: typeof parsed?.runId === 'string' ? parsed.runId : rid,
          kind: typeof parsed?.kind === 'string' ? parsed.kind : '',
          name: typeof parsed?.name === 'string' ? parsed.name : '',
          ts: typeof parsed?.ts === 'string' ? parsed.ts : '',
        };
        const prev = latestByPid.get(pid);
        if (!prev || String(record.ts || '') >= String(prev.ts || '')) {
          latestByPid.set(pid, record);
        }
      });
      return Array.from(latestByPid.values());
    } catch {
      return [];
    }
  }

  function appendTerminalInbox(runId, entry) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) throw new Error('runId is required');
    ensureDir(baseTerminalsDir);
    const inboxPath = path.join(baseTerminalsDir, `${rid}.inbox.jsonl`);
    fs.appendFileSync(inboxPath, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  function appendEventLog(type, payload, runId) {
    const eventPath = typeof defaultPaths?.events === 'string' && defaultPaths.events.trim() ? defaultPaths.events : '';
    if (!eventPath) return;
    try {
      fs.mkdirSync(path.dirname(eventPath), { recursive: true });
      fs.appendFileSync(
        eventPath,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          type: String(type || ''),
          payload: payload && typeof payload === 'object' ? payload : payload === undefined ? undefined : { value: payload },
          runId: typeof runId === 'string' && runId.trim() ? runId.trim() : undefined,
        })}\n`,
        'utf8'
      );
    } catch {
      // ignore
    }
  }

  async function intervene(payload = {}) {
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text) return { ok: false, message: 'text is required' };
    const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    if (!runId) return { ok: false, message: 'runId is required' };
    const targetRaw = typeof payload?.target === 'string' ? payload.target.trim().toLowerCase() : '';
    const requestedTarget = targetRaw || 'auto';

    const aliveWorkers = listRunPidRecords(runId).filter(
      (rec) => rec && rec.kind === 'subagent_worker' && isPidAlive(rec.pid)
    );
    const inprocActive = listRunPidRecords(runId).some(
      (rec) => rec && rec.kind === 'subagent_inproc' && isPidAlive(rec.pid)
    );

    const resolvedTarget =
      requestedTarget === 'auto'
        ? aliveWorkers.length > 0
          ? 'subagent_worker'
          : inprocActive
            ? 'subagent_inproc'
          : 'cli'
        : requestedTarget === 'main'
          ? 'cli'
          : requestedTarget;

    if (resolvedTarget === 'subagent_worker') {
      if (aliveWorkers.length === 0) {
        // Auto mode should never hit this, but keep a friendly message for explicit targeting.
        return { ok: false, reason: 'no_worker', message: '未检测到正在运行的子进程(subagent_worker)，无法发送纠正。' };
      }
      try {
        appendTerminalInbox(runId, {
          ts: new Date().toISOString(),
          type: 'correction',
          runId,
          target: 'subagent_worker',
          text,
          source: 'ui',
        });
        appendEventLog('ui_correction', { target: 'subagent_worker', text }, runId);
        return { ok: true, runId, target: 'subagent_worker' };
      } catch (err) {
        return { ok: false, message: err?.message || String(err) };
      }
    }

    if (resolvedTarget === 'subagent_inproc') {
      if (!inprocActive) {
        return { ok: false, reason: 'no_inproc', message: '未检测到正在运行的子流程(in-process sub-agent)，无法发送纠正。' };
      }
      try {
        appendTerminalInbox(runId, {
          ts: new Date().toISOString(),
          type: 'correction',
          runId,
          target: 'subagent_inproc',
          text,
          source: 'ui',
        });
        appendEventLog('ui_correction', { target: 'subagent_inproc', text }, runId);
        return { ok: true, runId, target: 'subagent_inproc' };
      } catch (err) {
        return { ok: false, message: err?.message || String(err) };
      }
    }

    // Fallback: treat correction as an interrupt+send for the main CLI.
    if (resolvedTarget === 'cli') {
      const result = await dispatchMessage({ text, runId, force: true });
      if (result?.ok === false) {
        return { ...result, target: 'cli' };
      }
      appendEventLog('ui_correction', { target: 'cli', text }, runId);
      return { ...result, target: 'cli' };
    }

    return { ok: false, message: `unsupported target: ${resolvedTarget}` };
  }


  function cleanupTerminalArtifacts(runId) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) return;
    const targets = [
      path.join(baseTerminalsDir, `${rid}.status.json`),
      path.join(baseTerminalsDir, `${rid}.control.jsonl`),
      path.join(baseTerminalsDir, `${rid}.cursor`),
      path.join(baseTerminalsDir, `${rid}.inbox.jsonl`),
      path.join(baseTerminalsDir, `${rid}.launch.command`),
      path.join(baseTerminalsDir, `${rid}.launch.cmd`),
      path.join(baseTerminalsDir, `${rid}.pids.jsonl`),
    ];
    targets.forEach((target) => {
      try {
        if (fs.existsSync(target)) {
          fs.unlinkSync(target);
        }
      } catch {
        // ignore cleanup failures
      }
    });
  }

  async function forceKillRun(runId, options = {}) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) return { ok: false, message: 'runId is required' };

    const pidSet = new Set();
    const hinted = Number(options?.pidHint);
    if (Number.isFinite(hinted) && hinted > 0) {
      pidSet.add(hinted);
    }

    const child = launchedCli.get(rid);
    if (child && Number.isFinite(child.pid) && child.pid > 0) {
      pidSet.add(child.pid);
    }

    const status = readTerminalStatus(rid);
    const statusPid = Number(status?.pid);
    if (Number.isFinite(statusPid) && statusPid > 0) {
      pidSet.add(statusPid);
    }

    const registryPid = getRunPidFromRegistry(rid);
    if (Number.isFinite(registryPid) && registryPid > 0) {
      pidSet.add(registryPid);
    }

    listRunPidRegistry(rid).forEach((pid) => {
      if (Number.isFinite(pid) && pid > 0) pidSet.add(pid);
    });

    pidSet.delete(process.pid);

    const rootPids = Array.from(pidSet);
    const killList = await listProcessTreePidsFromPs(rootPids);
    const errors = [];
    const killed = [];

    // Best-effort: kill the process group led by the CLI pid (common on macOS Terminal),
    // so we don't rely on `ps` to discover short-lived descendants.
    const groupLeader = [statusPid, hinted, registryPid, child?.pid].find(
      (pid) => Number.isFinite(Number(pid)) && Number(pid) > 0
    );
    if (Number.isFinite(Number(groupLeader)) && Number(groupLeader) > 0 && isPidAlive(groupLeader)) {
      tryKillProcessGroup(groupLeader, 'SIGTERM', errors);
      await new Promise((resolve) => setTimeout(resolve, 120));
      tryKillProcessGroup(groupLeader, 'SIGKILL', errors);
    }

    const killAll = (signal) => {
      killList.forEach((pid) => {
        if (!Number.isFinite(pid) || pid <= 0) return;
        if (pid === process.pid) return;
        const ok = tryKillPid(pid, signal, errors);
        if (ok) killed.push({ pid, signal });
      });
    };

    // Try SIGTERM then SIGKILL (fast, but still gives a brief chance to clean up).
    killAll('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 250));
    killAll('SIGKILL');

    // Wait briefly for processes to exit.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const stillAlive = killList.filter((pid) => pid && pid !== process.pid && isPidAlive(pid));
    const ok = stillAlive.length === 0;

    if (ok && options?.cleanupArtifacts !== false) {
      cleanupTerminalArtifacts(rid);
    }

    // Even when everything is dead, keep the pid registry around unless we explicitly cleaned artifacts.
    if (ok && options?.cleanupArtifacts) {
      try {
        launchedCli.delete(rid);
      } catch {
        // ignore
      }
    }

    return {
      ok,
      runId: rid,
      rootPids,
      killList,
      stillAlive,
      errors,
      killed,
      message: ok ? undefined : '进程仍在运行（已尝试 SIGTERM/SIGKILL）',
    };
  }

  const isSystemTerminalLaunchPending = (runId) =>
    isPendingSystemTerminalLaunch({ runId, pendingSystemTerminalLaunch, readTerminalStatus });

  const { ensureCliRunning, dispatchMessage } = createTerminalDispatch({
    baseSessionRoot,
    baseTerminalsDir,
    launchedCli,
    pendingSystemTerminalLaunch,
    runsPath,
    parseRuns,
    safeRead,
    resolveCliEntrypointPath,
    resolveUiTerminalMode,
    uiTerminalStdio,
    isPidAlive,
    isRunPidAliveFromRegistry,
    readTerminalStatus,
    waitForTerminalStatus,
    appendTerminalControl,
    startTerminalStatusWatcher,
    startHealthChecker,
    broadcastTerminalStatuses,
    launchCliInSystemTerminal,
    generateRunId,
    isSystemTerminalLaunchPending,
  });

  async function sendAction(payload = {}) {
    const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    if (!runId) {
      return { ok: false, message: 'runId is required' };
    }
    const action = typeof payload?.action === 'string' ? payload.action.trim() : '';
    const supported = new Set(['summary_now']);
    if (!supported.has(action)) {
      return { ok: false, message: `unsupported action: ${action || '(empty)'}` };
    }

    let status = readTerminalStatus(runId);
    if (!status) {
      // Best-effort: wait briefly so a freshly launched CLI can pick up the control file.
      status = await waitForTerminalStatus(runId, 1500);
    }
    const alive = status?.pid ? isPidAlive(status.pid) : isRunPidAliveFromRegistry(runId);
    if (!alive) {
      return { ok: false, message: 'terminal is not running' };
    }

    appendTerminalControl(runId, {
      type: 'action',
      action,
      ts: new Date().toISOString(),
      source: 'ui',
    });
    return { ok: true, runId, queued: true };
  }

  async function stopRun(payload = {}) {
    const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    if (!runId) {
      return { ok: false, message: 'runId is required' };
    }
    const status = readTerminalStatus(runId);
    const alive = status?.pid ? isPidAlive(status.pid) : isRunPidAliveFromRegistry(runId);
    if (!alive) {
      return { ok: false, message: 'terminal is not running' };
    }
    appendTerminalControl(runId, {
      type: 'stop',
      ts: new Date().toISOString(),
    });
    return { ok: true };
  }

  async function terminateRun(payload = {}) {
    const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    if (!runId) {
      return { ok: false, message: 'runId is required' };
    }
    const result = await forceKillRun(runId, { cleanupArtifacts: true });
    return result;
  }

  async function closeRun(payload = {}) {
    const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    if (!runId) {
      return { ok: false, message: 'runId is required' };
    }
    const force = payload?.force === true;

    let status = readTerminalStatus(runId);
    let pid = status?.pid || getRunPidFromRegistry(runId) || null;
    let alive = pid ? isPidAlive(pid) : isRunPidAliveFromRegistry(runId);

    if (alive && !status) {
      status = await waitForTerminalStatus(runId, 1200);
      pid = status?.pid || pid;
    }

    alive = pid ? isPidAlive(pid) : isRunPidAliveFromRegistry(runId);
    const busy = alive && status?.state === 'running';
    const missingStatus = alive && !status;
    if ((busy || missingStatus) && !force) {
      return {
        ok: false,
        reason: 'busy',
        runId,
        currentMessage:
          typeof status?.currentMessage === 'string'
            ? status.currentMessage
            : missingStatus
              ? '（该终端未上报状态，无法确定是否正在执行）'
              : '',
      };
    }

    if (alive && (busy || force)) {
      try {
        appendTerminalControl(runId, { type: 'stop', ts: new Date().toISOString() });
      } catch {
        // ignore
      }
      await waitForTerminalState(runId, (next) => !next || next.state !== 'running', 2500);
    }

    const terminated = await forceKillRun(runId, { cleanupArtifacts: true, pidHint: pid });
    pendingSystemTerminalLaunch.delete(runId);
    broadcastTerminalStatuses();
    return terminated;
  }

  function listStatusesWithWatcher() {
    startTerminalStatusWatcher();
    return { statuses: listTerminalStatuses() };
  }

  
  function stopHealthChecker() {
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
      healthCheckInterval = null;
    }
  }

  function dispose() {
    stopHealthChecker();
    try {
      terminalStatusWatcher?.close?.();
    } catch {
      // ignore
    }
    terminalStatusWatcher = null;
    if (terminalStatusWatcherDebounce) {
      clearTimeout(terminalStatusWatcherDebounce);
      terminalStatusWatcherDebounce = null;
    }
  }

  return {
    cleanupLaunchedCli,
    closeRun,
    sendAction,
    dispatchMessage,
    dispose,
    intervene,
    listStatusesWithWatcher,
    stopRun,
    terminateRun,
  };
}
