#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, '..');
const distRoot = path.join(root, 'dist');

const skipIfPresent = process.argv.includes('--skip-if-present');
const dev = process.argv.includes('--dev');
const mode = dev ? 'dev' : 'release';

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

function listBuildTargets() {
  return [
    {
      entry: path.join(root, 'src', 'cli.js'),
      outfile: path.join(distRoot, 'cli.js'),
      name: 'cli',
    },
    {
      entry: path.join(root, 'src', 'config-source.js'),
      outfile: path.join(distRoot, 'config-source.js'),
      name: 'config-source',
    },
    {
      entry: path.join(root, 'src', 'session.js'),
      outfile: path.join(distRoot, 'session.js'),
      name: 'session',
    },
    {
      entry: path.join(root, 'src', 'client.js'),
      outfile: path.join(distRoot, 'client.js'),
      name: 'client',
    },
    {
      entry: path.join(root, 'src', 'config.js'),
      outfile: path.join(distRoot, 'config.js'),
      name: 'config',
    },
    {
      entry: path.join(root, 'src', 'subagents', 'index.js'),
      outfile: path.join(distRoot, 'subagents', 'index.js'),
      name: 'subagents',
    },
    {
      entry: path.join(root, 'src', 'subagents', 'runtime.js'),
      outfile: path.join(distRoot, 'subagents', 'runtime.js'),
      name: 'subagents-runtime',
    },
    {
      entry: path.join(root, 'src', 'subagents', 'selector.js'),
      outfile: path.join(distRoot, 'subagents', 'selector.js'),
      name: 'subagents-selector',
    },
    {
      entry: path.join(root, 'src', 'mcp', 'runtime.js'),
      outfile: path.join(distRoot, 'mcp', 'runtime.js'),
      name: 'mcp-runtime',
    },
    {
      entry: path.join(root, 'src', 'mcp', 'prompt-binding.js'),
      outfile: path.join(distRoot, 'mcp', 'prompt-binding.js'),
      name: 'mcp-prompt-binding',
    },
    {
      entry: path.join(root, 'src', 'tools', 'index.js'),
      outfile: path.join(distRoot, 'tools', 'index.js'),
      name: 'tools',
    },
    {
      entry: path.join(root, 'src', 'prompts.js'),
      outfile: path.join(distRoot, 'prompts.js'),
      name: 'prompts',
    },
    {
      entry: path.join(root, 'src', 'event-log.js'),
      outfile: path.join(distRoot, 'event-log.js'),
      name: 'event-log',
    },
    {
      entry: path.join(root, 'src', 'terminal', 'platform', 'index.js'),
      outfile: path.join(distRoot, 'terminal', 'platform', 'index.js'),
      name: 'terminal-platform',
    },
  ];
}

function buildIsFresh(targets, newestSourceMs) {
  if (!Array.isArray(targets) || targets.length === 0) return false;
  if (mode === 'release') {
    const hasMap = targets.some((t) => fs.existsSync(`${t.outfile}.map`));
    if (hasMap) return false;
  }

  return targets.every((t) => {
    if (!fs.existsSync(t.outfile)) return false;
    let outMs = 0;
    try {
      const stat = fs.statSync(t.outfile);
      outMs = typeof stat.mtimeMs === 'number' ? stat.mtimeMs : 0;
    } catch {
      outMs = 0;
    }
    if (!outMs) return false;
    if (!newestSourceMs) return true;
    return outMs >= newestSourceMs;
  });
}

async function main() {
  const targets = listBuildTargets();
  targets.forEach((t) => {
    if (!fs.existsSync(t.entry)) {
      throw new Error(`Engine build entry not found (${t.name}): ${t.entry}`);
    }
  });
  const sources = listFilesRecursive(path.join(root, 'src')).concat(
    listFilesRecursive(path.join(root, 'shared'))
  );
  const newestSource = getLatestMtimeMs(sources);

  if (skipIfPresent && buildIsFresh(targets, newestSource)) {
    console.log(`Engine dist already fresh at ${distRoot}; skipped rebuild.`);
    return;
  }

  const { build } = await import('esbuild');
  fs.mkdirSync(distRoot, { recursive: true });

  if (mode === 'release') {
    targets.forEach((t) => {
      try {
        fs.rmSync(`${t.outfile}.map`, { force: true });
      } catch {
        // ignore
      }
    });
  }

  for (const target of targets) {
    fs.mkdirSync(path.dirname(target.outfile), { recursive: true });
    await build({
      entryPoints: [target.entry],
      outfile: target.outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: ['node18'],
      packages: 'external',
      sourcemap: mode === 'dev',
      minify: mode === 'release',
      ...(target.banner ? { banner: { js: target.banner } } : null),
    });
  }
  console.log(`Engine built to ${distRoot}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
