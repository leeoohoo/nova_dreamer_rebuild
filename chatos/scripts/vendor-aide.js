#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const internalEngineRoot = path.resolve(projectRoot, 'packages', 'aide');
const externalAideRoot = [path.resolve(projectRoot, '..', 'aide')].find(
  (candidate) => isDirectory(candidate) && path.resolve(candidate) !== internalEngineRoot
);

const INCLUDE_DIRS = ['src', 'shared', 'subagents', 'mcp_servers', 'electron', 'cli-ui'];

function isDirectory(dirPath) {
  if (!dirPath) return false;
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function copyDir(srcDir, destDir) {
  fs.cpSync(srcDir, destDir, {
    recursive: true,
    force: true,
    dereference: false,
    filter: (src) => {
      const base = path.basename(src);
      if (base === 'node_modules') return false;
      if (base === '.DS_Store') return false;
      return true;
    },
  });
}

function listFilesRecursive(dirPath) {
  const results = [];
  const root = typeof dirPath === 'string' ? dirPath.trim() : '';
  if (!root) return results;
  if (!isDirectory(root)) return results;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function patchEmbeddedEngineCommonImports(engineRoot) {
  const root = typeof engineRoot === 'string' ? engineRoot.trim() : '';
  if (!root) return;
  const sharedRoot = path.join(root, 'shared');
  if (!isDirectory(sharedRoot)) return;
  const commonRoot = path.resolve(root, '..', 'common');
  const candidates = listFilesRecursive(sharedRoot).filter((filePath) =>
    ['.js', '.mjs', '.cjs'].includes(path.extname(filePath).toLowerCase())
  );

  candidates.forEach((filePath) => {
    const relBase = path.relative(path.dirname(filePath), commonRoot).replace(/\\/g, '/');
    const rel = relBase.startsWith('.') ? relBase : `./${relBase}`;
    let src = '';
    try {
      src = fs.readFileSync(filePath, 'utf8');
    } catch {
      return;
    }
    const next = src
      .replace(/@leeoohoo\/common\//g, `${rel}/`)
      .replace(/(['"`])((?:\.\.\/)+)common\//g, (_match, quote) => `${quote}${rel}/`);
    if (next === src) return;
    try {
      fs.writeFileSync(filePath, next, 'utf8');
    } catch {
      // ignore write errors
    }
  });
}

function main() {
  if (!externalAideRoot) {
    if (isDirectory(internalEngineRoot)) {
      patchEmbeddedEngineCommonImports(internalEngineRoot);
      console.log('[sync:engine] No external aide sources found; using bundled engine.');
      return;
    }
    console.error('[sync:engine] External aide directory not found.');
    console.error('[sync:engine] Expected monorepo layout: <repo>/chatos (with packages/aide/) or <repo>/aide.');
    process.exit(1);
  }

  try {
    fs.rmSync(internalEngineRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }

  fs.mkdirSync(internalEngineRoot, { recursive: true });
  INCLUDE_DIRS.forEach((name) => {
    const src = path.join(externalAideRoot, name);
    if (!isDirectory(src)) return;
    const dest = path.join(internalEngineRoot, name);
    copyDir(src, dest);
  });

  patchEmbeddedEngineCommonImports(internalEngineRoot);

  console.log(`[sync:engine] Vendored aide into: ${internalEngineRoot}`);
}

main();

