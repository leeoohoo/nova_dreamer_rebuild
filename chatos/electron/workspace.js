import fs from 'fs';
import path from 'path';

function isPathInsideRoot(rootDir, targetPath) {
  const relative = path.relative(rootDir, targetPath);
  if (relative === '') return true;
  if (relative === '..') return false;
  if (relative.startsWith(`..${path.sep}`)) return false;
  return !path.isAbsolute(relative);
}

function readFilePrefixUtf8(filePath, maxBytes) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

export function createWorkspaceOps({ maxViewFileBytes = 512 * 1024, maxListDirEntries = 600 } = {}) {
  function readWorkspaceFile(payload = {}) {
    const workspaceRoot = typeof payload.workspaceRoot === 'string' ? payload.workspaceRoot.trim() : '';
    const relPath = typeof payload.path === 'string' ? payload.path.trim() : '';
    const absPath = typeof payload.absolutePath === 'string' ? payload.absolutePath.trim() : '';
    if (!workspaceRoot) {
      throw new Error('workspaceRoot is required.');
    }

    const resolvedRoot = path.resolve(workspaceRoot);
    const resolvedTarget = path.resolve(absPath || path.join(resolvedRoot, relPath));

    if (!isPathInsideRoot(resolvedRoot, resolvedTarget)) {
      throw new Error('Rejected: file path is outside workspaceRoot.');
    }

    const stats = fs.statSync(resolvedTarget);
    if (!stats.isFile()) {
      throw new Error('Target is not a file.');
    }

    let realRoot = resolvedRoot;
    let realTarget = resolvedTarget;
    try {
      realRoot = fs.realpathSync(resolvedRoot);
    } catch {
      // ignore realpath errors
    }
    try {
      realTarget = fs.realpathSync(resolvedTarget);
    } catch {
      // ignore realpath errors
    }
    if (!isPathInsideRoot(realRoot, realTarget)) {
      throw new Error('Rejected: resolved file path is outside workspaceRoot.');
    }

    const requestedMaxBytes = Number(payload.maxBytes);
    const maxBytes = Number.isFinite(requestedMaxBytes)
      ? Math.max(1024, Math.min(requestedMaxBytes, 1024 * 1024))
      : maxViewFileBytes;
    const truncated = stats.size > maxBytes;
    const content = truncated ? readFilePrefixUtf8(resolvedTarget, maxBytes) : fs.readFileSync(resolvedTarget, 'utf8');

    return {
      path: resolvedTarget,
      size: stats.size,
      mtime: stats.mtime ? stats.mtime.toISOString() : null,
      mtimeMs: typeof stats.mtimeMs === 'number' ? stats.mtimeMs : null,
      maxBytes,
      truncated,
      content,
    };
  }

  function listWorkspaceDirectory(payload = {}) {
    const workspaceRoot = typeof payload.workspaceRoot === 'string' ? payload.workspaceRoot.trim() : '';
    const relPath = typeof payload.path === 'string' ? payload.path.trim() : '.';
    const absPath = typeof payload.absolutePath === 'string' ? payload.absolutePath.trim() : '';
    if (!workspaceRoot) {
      throw new Error('workspaceRoot is required.');
    }

    const resolvedRoot = path.resolve(workspaceRoot);
    const resolvedTarget = path.resolve(absPath || path.join(resolvedRoot, relPath || '.'));

    if (!isPathInsideRoot(resolvedRoot, resolvedTarget)) {
      throw new Error('Rejected: directory path is outside workspaceRoot.');
    }

    let realRoot = resolvedRoot;
    let realTarget = resolvedTarget;
    try {
      realRoot = fs.realpathSync(resolvedRoot);
    } catch {
      // ignore realpath errors
    }
    try {
      realTarget = fs.realpathSync(resolvedTarget);
    } catch {
      // ignore realpath errors
    }
    if (!isPathInsideRoot(realRoot, realTarget)) {
      throw new Error('Rejected: resolved directory path is outside workspaceRoot.');
    }

    const stats = fs.statSync(realTarget);
    if (!stats.isDirectory()) {
      throw new Error('Target is not a directory.');
    }

    const maxEntries = clampNumber(payload.maxEntries, 1, 5000, maxListDirEntries);
    const dirents = fs.readdirSync(realTarget, { withFileTypes: true });
    dirents.sort((a, b) => {
      const aDir = a.isDirectory();
      const bDir = b.isDirectory();
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const truncated = dirents.length > maxEntries;
    const entries = dirents.slice(0, maxEntries).map((dirent) => {
      const name = dirent.name;
      const absolutePath = path.join(realTarget, name);
      const relativePath = path.relative(realRoot, absolutePath);
      let lstats = null;
      try {
        lstats = fs.lstatSync(absolutePath);
      } catch {
        // ignore stat errors
      }
      return {
        name,
        path: relativePath,
        absolutePath,
        isDir: dirent.isDirectory(),
        isFile: dirent.isFile(),
        isSymlink: dirent.isSymbolicLink(),
        size: lstats && lstats.isFile() ? lstats.size : null,
        mtime: lstats?.mtime ? lstats.mtime.toISOString() : null,
        mtimeMs: typeof lstats?.mtimeMs === 'number' ? lstats.mtimeMs : null,
      };
    });

    return {
      path: realTarget,
      maxEntries,
      truncated,
      entries,
    };
  }

  return { readWorkspaceFile, listWorkspaceDirectory };
}
