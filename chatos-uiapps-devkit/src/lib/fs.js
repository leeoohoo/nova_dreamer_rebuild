import fs from 'fs';
import path from 'path';

export function isFile(filePath) {
  const normalized = typeof filePath === 'string' ? filePath.trim() : '';
  if (!normalized) return false;
  try {
    return fs.existsSync(normalized) && fs.statSync(normalized).isFile();
  } catch {
    return false;
  }
}

export function isDirectory(dirPath) {
  const normalized = typeof dirPath === 'string' ? dirPath.trim() : '';
  if (!normalized) return false;
  try {
    return fs.existsSync(normalized) && fs.statSync(normalized).isDirectory();
  } catch {
    return false;
  }
}

export function ensureDir(dirPath) {
  const normalized = typeof dirPath === 'string' ? dirPath.trim() : '';
  if (!normalized) return;
  fs.mkdirSync(normalized, { recursive: true });
}

export function readText(filePath) {
  const normalized = typeof filePath === 'string' ? filePath.trim() : '';
  if (!normalized) throw new Error('readText: filePath is required');
  return fs.readFileSync(normalized, 'utf8');
}

export function writeText(filePath, content) {
  const normalized = typeof filePath === 'string' ? filePath.trim() : '';
  if (!normalized) throw new Error('writeText: filePath is required');
  ensureDir(path.dirname(normalized));
  fs.writeFileSync(normalized, content, 'utf8');
}

export function readJson(filePath) {
  const raw = readText(filePath);
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error(`Invalid JSON object: ${filePath}`);
  return parsed;
}

export function writeJson(filePath, obj) {
  writeText(filePath, `${JSON.stringify(obj, null, 2)}\n`);
}

export function rmForce(targetPath) {
  const normalized = typeof targetPath === 'string' ? targetPath.trim() : '';
  if (!normalized) return;
  try {
    fs.rmSync(normalized, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export function copyDir(srcDir, destDir, { filter } = {}) {
  fs.cpSync(srcDir, destDir, {
    recursive: true,
    force: true,
    dereference: false,
    filter: (src) => (typeof filter === 'function' ? filter(src) : true),
  });
}

export function sanitizeDirComponent(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

