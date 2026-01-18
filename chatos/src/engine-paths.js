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

function looksLikeEngineRoot(rootDir) {
  const dir = typeof rootDir === 'string' ? rootDir.trim() : '';
  if (!dir) return false;
  try {
    const entry = path.join(dir, 'src', 'cli.js');
    return fs.existsSync(entry) && fs.statSync(entry).isFile();
  } catch {
    return false;
  }
}

export function resolveEngineRoot({ projectRoot }) {
  const root = typeof projectRoot === 'string' ? projectRoot.trim() : '';
  if (!root) return null;
  const internal = path.resolve(root, 'src', 'engine');
  if (isDirectory(internal) && looksLikeEngineRoot(internal)) return internal;
  return null;
}

export function resolveEnginePath({ projectRoot, relativePath, purpose = '' }) {
  const root = resolveEngineRoot({ projectRoot });
  if (!root) {
    const normalizedPurpose = typeof purpose === 'string' ? purpose.trim() : '';
    const label = normalizedPurpose ? `${normalizedPurpose}: ` : '';
    const internal = path.resolve(projectRoot || '', 'src', 'engine');
    throw new Error(
      `${label}Engine sources not found.\n` +
        `Expected: ${internal}\n` +
        `Ensure the engine sources are present in the repo (./src/engine).\n`
    );
  }
  const rel = typeof relativePath === 'string' ? relativePath.trim() : '';
  if (!rel) {
    throw new Error('relativePath is required');
  }
  return path.join(root, rel);
}

export function resolveEngineFileUrl(options) {
  const filePath = resolveEnginePath(options);
  return pathToFileURL(filePath).href;
}
