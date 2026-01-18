import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveEngineRoot } from '../src/engine-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const cliRoot = resolveEngineRoot({ projectRoot });

function parseArgs(argv) {
  const args = { model: null, plugins: [], all: false, dryRun: false, root: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') args.all = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--model') args.model = (argv[i + 1] || '').trim();
    else if (arg.startsWith('--model=')) args.model = arg.replace('--model=', '').trim();
    else if (arg === '--plugins') {
      args.plugins = (argv[i + 1] || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--plugins=')) {
      args.plugins = arg
        .replace('--plugins=', '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    } else if (arg === '--root') args.root = (argv[i + 1] || '').trim();
    else if (arg.startsWith('--root=')) {
      args.root = arg.replace('--root=', '').trim();
    }
  }
  return args;
}

function usage() {
  console.log(`
Usage:
  node scripts/set-subagent-model.js --model <model_id> [--plugins a,b] [--all] [--dry-run] [--root <plugins_dir>]

Defaults:
  --root defaults to <repo>/chatos/src/engine/subagents/plugins
  if neither --plugins nor --all is provided, all plugins are scanned.
`);
}

function loadManifest(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to read ${filePath}: ${err.message}`);
  }
}

function saveManifest(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function setModel(manifest, model) {
  let changed = false;
  if (Array.isArray(manifest.agents)) {
    manifest.agents = manifest.agents.map((agent) => {
      const next = { ...agent, model };
      if (next.model !== agent.model) changed = true;
      return next;
    });
  }
  if (Array.isArray(manifest.commands)) {
    manifest.commands = manifest.commands.map((cmd) => {
      const next = { ...cmd, model };
      if (next.model !== cmd.model) changed = true;
      return next;
    });
  }
  return changed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.model) {
    usage();
    process.exit(1);
  }
  if (!cliRoot) {
    console.error('Engine sources not found (expected ./src/engine relative to chatos).');
    process.exit(1);
  }
  const root = args.root || path.join(cliRoot, 'subagents', 'plugins');
  if (!fs.existsSync(root)) {
    console.error(`Plugins directory not found: ${root}`);
    process.exit(1);
  }

  const candidates = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const targetPlugins =
    args.plugins.length > 0 ? candidates.filter((p) => args.plugins.includes(p)) : candidates;
  if (targetPlugins.length === 0) {
    console.error('No plugins matched. Check --plugins or directory contents.');
    process.exit(1);
  }

  const summary = { model: args.model, scanned: 0, updated: 0, skipped: 0, errors: [] };

  targetPlugins.forEach((pluginId) => {
    const manifestPath = path.join(root, pluginId, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      summary.skipped += 1;
      return;
    }
    summary.scanned += 1;
    try {
      const manifest = loadManifest(manifestPath);
      const changed = setModel(manifest, args.model);
      if (changed && !args.dryRun) {
        saveManifest(manifestPath, manifest);
      }
      if (changed) summary.updated += 1;
    } catch (err) {
      summary.errors.push({ plugin: pluginId, error: err.message });
    }
  });

  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length > 0) {
    process.exitCode = 1;
  }
}

main();
