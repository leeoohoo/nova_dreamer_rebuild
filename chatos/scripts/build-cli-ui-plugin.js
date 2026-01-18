#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, '..');
const sharedUiSrc = path.resolve(root, 'src', 'common', 'aide-ui');

const pluginSrcRoot = path.join(root, 'src', 'engine', 'cli-ui');
const entry = path.join(pluginSrcRoot, 'src', 'index.jsx');
const compactEntry = path.join(pluginSrcRoot, 'src', 'compact.mjs');

const pluginRoot = path.join(root, 'ui_apps', 'plugins', 'aide-builtin');
const pluginDistRoot = path.join(pluginRoot, 'cli', 'dist');
const outfile = path.join(pluginDistRoot, 'index.mjs');
const compactOutfile = path.join(pluginDistRoot, 'compact.mjs');

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
    for (const entryItem of entries) {
      const full = path.join(current, entryItem.name);
      if (entryItem.isDirectory()) {
        stack.push(full);
      } else if (entryItem.isFile()) {
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
  const outputs = [outfile, compactOutfile];
  for (const outputPath of outputs) {
    if (!fs.existsSync(outputPath)) return false;
    if (release && fs.existsSync(`${outputPath}.map`)) return false;
  }
  let outMs = null;
  for (const outputPath of outputs) {
    try {
      const stat = fs.statSync(outputPath);
      const ms = typeof stat.mtimeMs === 'number' ? stat.mtimeMs : 0;
      if (!ms) return false;
      outMs = outMs === null ? ms : Math.min(outMs, ms);
    } catch {
      return false;
    }
  }
  if (!outMs) return false;

  const sources = listFilesRecursive(path.join(pluginSrcRoot, 'src')).concat(listFilesRecursive(sharedUiSrc));
  const newestSource = getLatestMtimeMs(sources);
  if (!newestSource) return true;
  return outMs >= newestSource;
}

function writePluginManifest() {
  const manifest = {
    manifestVersion: 1,
    id: 'aide-builtin',
    name: 'AIDE',
    version: '0.1.0',
    description: 'AIDE built-in apps',
    apps: [
      {
        id: 'cli',
        name: 'AIDE CLI',
        description: 'AIDE CLI workspace',
        entry: {
          type: 'module',
          path: 'cli/dist/index.mjs',
          compact: { type: 'module', path: 'cli/dist/compact.mjs' },
        },
      },
    ],
  };
  const payload = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.mkdirSync(pluginRoot, { recursive: true });
  try {
    if (fs.existsSync(path.join(pluginRoot, 'plugin.json'))) {
      const existing = fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8');
      if (existing === payload) return;
    }
  } catch {
    // ignore read errors
  }
  fs.writeFileSync(path.join(pluginRoot, 'plugin.json'), payload, 'utf8');
}

async function main() {
  if (!fs.existsSync(entry)) {
    throw new Error(`CLI plugin entry not found: ${entry}`);
  }
  writePluginManifest();
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
  const buildOptions = {
    bundle: true,
    format: 'esm',
    sourcemap: !release,
    minify: release,
    platform: 'browser',
    target: ['chrome120'],
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    nodePaths: [
      path.resolve(root, '..', 'node_modules'),
      path.resolve(root, 'node_modules'),
      path.resolve(root, 'deepseek_cli', 'node_modules'),
      path.resolve(root, 'src', 'node_modules'),
      path.resolve(root, 'src', 'engine', 'node_modules'),
    ],
  };

  await build({
    entryPoints: [entry],
    outfile,
    ...buildOptions,
  });
  if (fs.existsSync(compactEntry)) {
    if (release) {
      try {
        fs.rmSync(`${compactOutfile}.map`, { force: true });
      } catch {
        // ignore
      }
    }
    await build({
      entryPoints: [compactEntry],
      outfile: compactOutfile,
      ...buildOptions,
    });
  }
  console.log(`CLI UI plugin built to ${outfile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
