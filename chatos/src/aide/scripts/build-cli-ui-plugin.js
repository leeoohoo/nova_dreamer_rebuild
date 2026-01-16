#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, '..');
const sharedUiSrc = path.resolve(root, '..', 'common', 'aide-ui');

const pluginSrcRoot = path.join(root, 'cli-ui');
const entry = path.join(pluginSrcRoot, 'src', 'index.jsx');

const pluginDistRoot = path.join(root, 'ui_apps', 'plugins', 'aide-builtin', 'cli', 'dist');
const outfile = path.join(pluginDistRoot, 'index.mjs');

const skipIfPresent = process.argv.includes('--skip-if-present');
const release = process.argv.includes('--release');

function listFilesRecursive(dirPath) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }
  return results;
}

function getLatestMtimeMs(filePaths = []) {
  let latest = 0;
  for (const filePath of filePaths) {
    try {
      const stat = fs.statSync(filePath);
      const ms = typeof stat.mtimeMs === 'number' ? stat.mtimeMs : 0;
      latest = Math.max(latest, ms);
    } catch {
      // ignore missing/invalid files
    }
  }
  return latest;
}

function buildIsFresh() {
  if (!fs.existsSync(outfile)) return false;
  if (release && fs.existsSync(`${outfile}.map`)) return false;
  let outMs = 0;
  try {
    const stat = fs.statSync(outfile);
    outMs = typeof stat.mtimeMs === 'number' ? stat.mtimeMs : 0;
  } catch {
    outMs = 0;
  }
  if (!outMs) return false;

  const sources = listFilesRecursive(path.join(pluginSrcRoot, 'src')).concat(listFilesRecursive(sharedUiSrc));
  const newestSource = getLatestMtimeMs(sources);
  if (!newestSource) return true;
  return outMs >= newestSource;
}

async function main() {
  if (!fs.existsSync(entry)) {
    throw new Error(`CLI plugin entry not found: ${entry}`);
  }
  if (skipIfPresent && buildIsFresh()) {
    console.log(`CLI UI plugin dist already fresh at ${outfile}; skipped rebuild.`);
    return;
  }

  const { build } = await import('esbuild');
  fs.mkdirSync(pluginDistRoot, { recursive: true });
  if (release) {
    try {
      fs.rmSync(`${outfile}.map`, { force: true });
    } catch {
      // ignore
    }
  }
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    sourcemap: !release,
    minify: release,
    platform: 'browser',
    target: ['chrome120'],
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    nodePaths: [
      path.resolve(root, '..', '..', 'node_modules'),
      path.resolve(root, '..', 'node_modules'),
      path.resolve(root, '..', 'deepseek_cli', 'node_modules'),
      path.join(root, 'node_modules'),
    ],
  });
  console.log(`CLI UI plugin built to ${outfile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
