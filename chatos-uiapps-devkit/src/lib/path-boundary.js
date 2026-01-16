import path from 'path';

export function resolveInsideDir(rootDir, relativePath) {
  const root = typeof rootDir === 'string' ? rootDir.trim() : '';
  const rel = typeof relativePath === 'string' ? relativePath.trim() : '';
  if (!root) throw new Error('rootDir is required');
  if (!rel) throw new Error('relativePath is required');
  const resolved = path.resolve(root, rel);
  const normalizedRoot = path.resolve(root);
  const isInside = resolved === normalizedRoot || resolved.startsWith(normalizedRoot + path.sep);
  if (!isInside) {
    throw new Error(`Path escapes plugin dir: ${relativePath}`);
  }
  return resolved;
}

