import fs from 'fs';
import path from 'path';

import { isFile, readJson } from './fs.js';

export function loadDevkitConfig(cwd) {
  const root = typeof cwd === 'string' ? cwd : process.cwd();
  const cfgPath = path.join(root, 'chatos.config.json');
  if (!isFile(cfgPath)) return { path: cfgPath, config: null };
  try {
    const cfg = readJson(cfgPath);
    return { path: cfgPath, config: cfg };
  } catch {
    return { path: cfgPath, config: null };
  }
}

export function readOptionalJson(filePath) {
  const normalized = typeof filePath === 'string' ? filePath.trim() : '';
  if (!normalized) return null;
  if (!fs.existsSync(normalized)) return null;
  try {
    const raw = fs.readFileSync(normalized, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

