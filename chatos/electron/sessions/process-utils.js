export function isPidAlive(pid) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
      return true;
    }
    return false;
  }
}

export function isProcessGroupAlive(pgid) {
  const num = Number(pgid);
  if (!Number.isFinite(num) || num <= 0) return false;
  if (process.platform === 'win32') return false;
  try {
    process.kill(-num, 0);
    return true;
  } catch (err) {
    if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
      return true;
    }
    return false;
  }
}

