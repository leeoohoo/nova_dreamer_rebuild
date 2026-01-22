import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const nowIso = () => new Date().toISOString();

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const normalizeString = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text;
};

export const makeId = (prefix = 'id') => {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  const rand = crypto.randomBytes(12).toString('hex');
  return `${prefix}_${rand}`;
};

export const ensureDir = async (dirPath) => {
  if (!dirPath) return;
  await fs.mkdir(dirPath, { recursive: true });
};

export const readJsonFile = async (filePath, fallback = null) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err?.code === 'ENOENT') return fallback;
    return fallback;
  }
};

const writeFileAtomic = async (filePath, content) => {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, filePath);
};

export const writeJsonFile = async (filePath, data) => {
  const content = JSON.stringify(data, null, 2);
  await writeFileAtomic(filePath, content);
};

export const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const createLogger = ({ prefix = '', stream = process.stderr } = {}) => {
  const write = (level, message, extra) => {
    const ts = nowIso();
    const base = prefix ? `[${ts}] [${prefix}] [${level}]` : `[${ts}] [${level}]`;
    const line = extra ? `${base} ${message} ${JSON.stringify(extra)}` : `${base} ${message}`;
    try {
      stream.write(`${line}\n`);
    } catch {
      // ignore
    }
  };
  return {
    info: (msg, extra) => write('info', msg, extra),
    warn: (msg, extra) => write('warn', msg, extra),
    error: (msg, extra) => write('error', msg, extra),
    debug: (msg, extra) => write('debug', msg, extra),
  };
};
