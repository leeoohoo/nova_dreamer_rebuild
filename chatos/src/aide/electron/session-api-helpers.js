import fs from 'fs';
import path from 'path';
import { createDb } from '../shared/data/storage.js';
import { parseJsonSafe } from '../shared/data/legacy.js';

export function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

export function ensureFileExists(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
  } catch {
    // ignore
  }
}

export function readTasksFromDbFile(dbPath) {
  try {
    const db = createDb({ dbPath });
    return db.list('tasks') || [];
  } catch {
    return [];
  }
}

export function parseJsonLines(content = '') {
  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  const entries = [];
  lines.forEach((line) => {
    const parsed = parseJsonSafe(line, null);
    if (parsed && typeof parsed === 'object') {
      entries.push(parsed);
    }
  });
  return entries;
}

function maskSecretValue(value) {
  const raw = typeof value === 'string' ? value : String(value || '');
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const suffix = trimmed.slice(-4);
  return `${'*'.repeat(8)}${suffix}`;
}

function sanitizeSecretRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const raw = record.value;
  const hasValue = typeof raw === 'string' ? raw.trim().length > 0 : Boolean(raw);
  return {
    ...record,
    value: hasValue ? maskSecretValue(raw) : '',
    hasValue,
  };
}

export function sanitizeAdminSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  if (!Array.isArray(snapshot.secrets)) return snapshot;
  return {
    ...snapshot,
    secrets: snapshot.secrets.map((item) => sanitizeSecretRecord(item)),
  };
}

export function sanitizeAdminSnapshotForUi(snapshot, { exposeSubagents = true } = {}) {
  const sanitized = sanitizeAdminSnapshot(snapshot);
  if (exposeSubagents) return sanitized;
  if (!sanitized || typeof sanitized !== 'object') return sanitized;
  return { ...sanitized, subagents: [] };
}

export function resolveUiFlags(uiFlags) {
  const resolvedUiFlags = uiFlags && typeof uiFlags === 'object' ? { ...uiFlags } : {};
  const exposeSubagents =
    typeof resolvedUiFlags.exposeSubagents === 'boolean'
      ? resolvedUiFlags.exposeSubagents
      : Boolean(resolvedUiFlags.developerMode);
  return { uiFlags: resolvedUiFlags, exposeSubagents };
}

export function readFileFingerprint(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const ino = typeof stat.ino === 'number' ? stat.ino : 0;
    const size = typeof stat.size === 'number' ? stat.size : 0;
    const mtimeMs = typeof stat.mtimeMs === 'number' ? stat.mtimeMs : 0;
    return `${ino}:${size}:${mtimeMs}`;
  } catch {
    return null;
  }
}
