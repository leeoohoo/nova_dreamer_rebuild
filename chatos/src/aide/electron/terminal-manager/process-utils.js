import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export function isPidAlive(pid) {
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

export function tryKillPid(pid, signal, errors) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return false;
  try {
    process.kill(num, signal);
    return true;
  } catch (err) {
    if (Array.isArray(errors)) {
      errors.push(err?.message || String(err));
    }
    return false;
  }
}

export function tryKillProcessGroup(pgid, signal, errors) {
  const num = Number(pgid);
  if (!Number.isFinite(num) || num <= 0) return false;
  if (process.platform === 'win32') return false;
  try {
    process.kill(-num, signal);
    return true;
  } catch (err) {
    if (Array.isArray(errors)) {
      errors.push(err?.message || String(err));
    }
    return false;
  }
}

export async function listProcessTreePidsFromPs(rootPids) {
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
    // Fallback to trying plain `ps` if the absolute path is blocked.
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

