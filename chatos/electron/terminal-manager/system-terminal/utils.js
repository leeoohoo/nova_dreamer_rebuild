import fs from 'fs';

export function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

export function escapeShell(text) {
  return `'${String(text || '').replace(/'/g, `'\\''`)}'`;
}

export function escapeAppleScriptString(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function escapeCmdBatchString(text) {
  return String(text || '')
    .replace(/%/g, '%%')
    .replace(/"/g, '^"');
}

