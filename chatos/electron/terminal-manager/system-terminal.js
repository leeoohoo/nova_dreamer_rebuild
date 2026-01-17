import path from 'path';
import { getSystemTerminalLauncher } from './system-terminal/launcher.js';

export function isPendingSystemTerminalLaunch({
  runId,
  pendingSystemTerminalLaunch,
  readTerminalStatus,
  timeoutMs = 12_000,
} = {}) {
  const rid = typeof runId === 'string' ? runId.trim() : '';
  if (!rid) return false;
  if (!(pendingSystemTerminalLaunch instanceof Map)) return false;

  const readStatus = typeof readTerminalStatus === 'function' ? readTerminalStatus : () => null;
  // If the CLI already reported status, we are no longer in a "launching" state.
  if (readStatus(rid)) {
    pendingSystemTerminalLaunch.delete(rid);
    return false;
  }

  const ts = pendingSystemTerminalLaunch.get(rid);
  if (!ts) return false;
  if (Date.now() - ts > Math.max(0, Number(timeoutMs) || 0)) {
    pendingSystemTerminalLaunch.delete(rid);
    return false;
  }
  return true;
}

export async function launchCliInSystemTerminal({
  runId,
  cwd,
  cliPath,
  baseSessionRoot,
  baseTerminalsDir,
  pendingSystemTerminalLaunch,
  landConfigId,
} = {}) {
  const rid = typeof runId === 'string' ? runId.trim() : '';
  if (!rid) return false;
  if (!(pendingSystemTerminalLaunch instanceof Map)) return false;

  const resolvedCwd = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : process.cwd();
  const resolvedCliPath =
    typeof cliPath === 'string' && cliPath.trim() ? cliPath.trim() : path.join(process.cwd(), 'src', 'cli.js');
  const sessionRoot = typeof baseSessionRoot === 'string' && baseSessionRoot.trim() ? baseSessionRoot.trim() : process.cwd();
  const terminalsDir = typeof baseTerminalsDir === 'string' && baseTerminalsDir.trim() ? baseTerminalsDir.trim() : process.cwd();

  // Prevent duplicate launches while the terminal window/CLI is still starting up.
  pendingSystemTerminalLaunch.set(rid, Date.now());

  const launcher = getSystemTerminalLauncher();
  let ok = false;
  try {
    ok = await launcher.launchCliInSystemTerminal({
      runId: rid,
      cwd: resolvedCwd,
      cliPath: resolvedCliPath,
      sessionRoot,
      terminalsDir,
      landConfigId,
    });
  } catch {
    ok = false;
  }

  if (!ok) {
    pendingSystemTerminalLaunch.delete(rid);
  }
  return ok;
}
