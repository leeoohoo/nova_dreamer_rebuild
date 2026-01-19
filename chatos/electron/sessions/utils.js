import fs from 'fs';
import os from 'os';
import path from 'path';
import { getHostApp } from '../../packages/common/host-app.js';
import { resolveAppStateDir } from '../../packages/common/state-core/state-paths.js';

export function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

export function sanitizeName(rawName) {
  return (
    String(rawName || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 64) || `sess_${Date.now().toString(36)}`
  );
}

export function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function escapeShellValue(text) {
  return `'${String(text || '').replace(/'/g, `'\\''`)}'`;
}

export function writeJsonAtomic(filePath, payload) {
  const targetDir = path.dirname(filePath);
  ensureDir(targetDir);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function resolveBaseSessionRoot(sessionRoot) {
  const candidate = typeof sessionRoot === 'string' && sessionRoot.trim() ? sessionRoot.trim() : '';
  if (candidate) return path.resolve(candidate);
  if (process.env.MODEL_CLI_SESSION_ROOT) {
    return path.resolve(process.env.MODEL_CLI_SESSION_ROOT);
  }
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  if (home) return path.resolve(home);
  return process.cwd();
}

export function resolveSessionsDir(sessionRoot) {
  const root = resolveBaseSessionRoot(sessionRoot);
  const resolvedHostApp = getHostApp() || 'chatos';
  return path.join(
    resolveAppStateDir(root, { hostApp: resolvedHostApp, fallbackHostApp: 'chatos' }),
    'sessions'
  );
}

export function getSessionPaths(sessionsDir, sessionName) {
  const safeName = sanitizeName(sessionName);
  return {
    name: safeName,
    statusPath: path.join(sessionsDir, `${safeName}.status.json`),
    outputPath: path.join(sessionsDir, `${safeName}.output.log`),
    controlPath: path.join(sessionsDir, `${safeName}.control.jsonl`),
  };
}

export function readJsonSafe(filePath) {
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

export function readLastLinesFromFile(filePath, lineCount, maxBytes = 1024 * 1024) {
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
