import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

function isDirectory(dirPath) {
  if (!dirPath) return false;
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function looksLikeAideRoot(rootDir) {
  const dir = typeof rootDir === 'string' ? rootDir.trim() : '';
  if (!dir) return false;
  try {
    const entry = path.join(dir, 'src', 'cli.js');
    return fs.existsSync(entry) && fs.statSync(entry).isFile();
  } catch {
    return false;
  }
}

export function resolveAideRoot({ projectRoot }) {
  const root = typeof projectRoot === 'string' ? projectRoot.trim() : '';
  if (!root) return null;
  const internal = path.resolve(root, 'src', 'aide');
  if (isDirectory(internal) && looksLikeAideRoot(internal)) return internal;
  return null;
}

export function resolveAidePath({ projectRoot, relativePath, purpose = '' }) {
  const root = resolveAideRoot({ projectRoot });
  if (!root) {
    const normalizedPurpose = typeof purpose === 'string' ? purpose.trim() : '';
    const label = normalizedPurpose ? `${normalizedPurpose}: ` : '';
    const internal = path.resolve(projectRoot || '', 'src', 'aide');
    throw new Error(
      `${label}AIDE sources not found.\n` +
        `Expected: ${internal}\n` +
        `Ensure the AIDE sources are vendored into the repo (./src/aide).\n`
    );
  }
  const rel = typeof relativePath === 'string' ? relativePath.trim() : '';
  if (!rel) {
    throw new Error('relativePath is required');
  }
  return path.join(root, rel);
}

export function resolveAideFileUrl(options) {
  const filePath = resolveAidePath(options);
  return pathToFileURL(filePath).href;
}
