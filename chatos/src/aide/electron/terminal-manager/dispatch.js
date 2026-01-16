import path from 'path';
import { spawn } from 'child_process';

export function createTerminalDispatch({
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
}) {
  const ensureCliRunning = async (runId, options = {}) => {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) throw new Error('runId is required');
    const status = readTerminalStatus(rid);
    // Treat "exited" status as dead even if PID got reused (prevents stuck runs after terminal closes).
    const statusState = typeof status?.state === 'string' ? status.state.trim() : '';
    const alive =
      statusState === 'exited' ? false : status?.pid ? isPidAlive(status.pid) : isRunPidAliveFromRegistry(rid);
    if (alive) return;
    if (typeof isSystemTerminalLaunchPending === 'function' && isSystemTerminalLaunchPending(rid)) {
      return;
    }
    if (launchedCli?.has?.(rid)) {
      const existing = launchedCli.get(rid);
      if (existing && !existing.killed) {
        return;
      }
      launchedCli.delete(rid);
    }

    const bestEntry = (() => {
      try {
        if (!runsPath) return null;
        const entries = parseRuns(safeRead(runsPath));
        let latest = null;
        entries.forEach((entry) => {
          if (!entry || typeof entry !== 'object') return;
          if (String(entry.runId || '').trim() !== rid) return;
          if (!latest || String(entry.ts || '') > String(latest.ts || '')) {
            latest = entry;
          }
        });
        return latest;
      } catch {
        return null;
      }
    })();

    const workspaceRoot =
      typeof bestEntry?.workspaceRoot === 'string'
        ? bestEntry.workspaceRoot.trim()
        : typeof bestEntry?.cwd === 'string'
          ? bestEntry.cwd.trim()
          : '';
    const requestedCwd = typeof options?.cwd === 'string' ? options.cwd.trim() : '';
    const cwd = requestedCwd || workspaceRoot || process.cwd();
    const cliPath = resolveCliEntrypointPath();

    const mode = resolveUiTerminalMode();
    const autoPrefersSystemTerminal = process.platform === 'darwin' || process.platform === 'win32';
    if (mode === 'system' || (mode === 'auto' && autoPrefersSystemTerminal)) {
      const launched = await launchCliInSystemTerminal({
        runId: rid,
        cwd,
        cliPath,
        baseSessionRoot,
        baseTerminalsDir,
        pendingSystemTerminalLaunch,
      });
      if (launched) {
        startTerminalStatusWatcher();
        return;
      }
    }

    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      MODEL_CLI_SESSION_ROOT: baseSessionRoot,
      MODEL_CLI_RUN_ID: rid,
      MODEL_CLI_UI_BRIDGE: '1',
    };
    const stdio = Array.isArray(uiTerminalStdio) ? uiTerminalStdio : ['pipe', 'ignore', 'ignore'];
    let child;
    try {
      child = spawn(process.execPath, [cliPath, 'chat'], {
        cwd,
        env,
        stdio,
        windowsHide: true,
        detached: true,
      });
      child.unref();
    } catch (err) {
      const fallbackCwd = workspaceRoot || process.cwd();
      if (fallbackCwd && fallbackCwd !== cwd) {
        child = spawn(process.execPath, [cliPath, 'chat'], {
          cwd: fallbackCwd,
          env,
          stdio,
          windowsHide: true,
          detached: true,
        });
        child.unref();
      } else {
        throw err;
      }
    }
    launchedCli.set(rid, child);
    startHealthChecker();
    child.on('exit', () => {
      launchedCli.delete(rid);
      broadcastTerminalStatuses();
    });
    startTerminalStatusWatcher();
  };

  const dispatchMessage = async (payload = {}) => {
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text) {
      return { ok: false, message: 'text is required' };
    }
    const requestedRunId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    const force = payload?.force === true;
    const runId = requestedRunId || generateRunId();
    const created = !requestedRunId;

    const requestedCwd = typeof payload?.cwd === 'string' ? payload.cwd.trim() : '';
    let launchCwd = '';
    if (created && requestedCwd) {
      // Do not validate with fs.statSync here: on macOS some directories require user-granted
      // permissions (TCC), and Terminal itself can still `cd` even when Electron can't stat().
      launchCwd = path.resolve(requestedCwd);
    }

    await ensureCliRunning(runId, { cwd: launchCwd });

    let status = readTerminalStatus(runId);
    if (!status) {
      // Always wait for status to appear before sending control commands; otherwise the UI will
      // "send successfully" but nothing will consume the message.
      const mode = resolveUiTerminalMode();
      const autoPrefersSystemTerminal = process.platform === 'darwin' || process.platform === 'win32';
      const isSystem = mode === 'system' || (mode === 'auto' && autoPrefersSystemTerminal);
      const isHeadless = mode === 'headless' || (mode === 'auto' && !autoPrefersSystemTerminal);

      const timeoutMs = created ? (isSystem ? 20_000 : 15_000) : isHeadless ? 8_000 : 8_000;
      status = await waitForTerminalStatus(runId, timeoutMs);

      // On some machines, spawning a system terminal + bootstrapping the CLI can take a while.
      if (!status && typeof isSystemTerminalLaunchPending === 'function' && isSystemTerminalLaunchPending(runId)) {
        status = await waitForTerminalStatus(runId, 8_000);
      }
    }

    const alive = status?.pid ? isPidAlive(status.pid) : isRunPidAliveFromRegistry(runId);
    if (!status) {
      // If we can see a PID from the run registry, it means an older CLI is running without status reporting.
      const legacyAlive = isRunPidAliveFromRegistry(runId);
      if (legacyAlive) {
        if (created || (typeof isSystemTerminalLaunchPending === 'function' && isSystemTerminalLaunchPending(runId))) {
          return {
            ok: false,
            reason: 'not_ready',
            runId,
            message:
              '终端/CLI 仍在启动中（尚未检测到状态上报）。请稍候重试；若持续较久仍无状态上报，请重启该终端的 aide。',
          };
        }
        return {
          ok: false,
          reason: 'unmanaged',
          runId,
          message:
            '该终端的 CLI 未上报状态(可能是旧版本或尚未启动完成)，无法从 UI 发送消息；请重启该终端的 aide。',
        };
      }
      // Otherwise: the terminal/CLI did not start in time.
      pendingSystemTerminalLaunch.delete(runId);
      return {
        ok: false,
        reason: 'not_ready',
        runId,
        message:
          '终端/CLI 未启动或未就绪（未检测到状态上报）。请确认系统 Terminal 可被拉起；如需无终端模式可在灵动岛关闭「拉起终端」或设置 MODEL_CLI_UI_TERMINAL_MODE=headless。',
      };
    }

    const busy = alive && status.state === 'running';
    if (busy && !force) {
      return {
        ok: false,
        reason: 'busy',
        runId,
        currentMessage: typeof status?.currentMessage === 'string' ? status.currentMessage : '',
      };
    }

    if (force && busy) {
      appendTerminalControl(runId, {
        type: 'stop',
        ts: new Date().toISOString(),
      });
    }
    appendTerminalControl(runId, {
      type: 'message',
      text,
      ts: new Date().toISOString(),
    });
    return { ok: true, runId, created };
  };

  return { ensureCliRunning, dispatchMessage };
}

