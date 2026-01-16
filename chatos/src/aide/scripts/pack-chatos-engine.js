#!/usr/bin/env node
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizeFileComponent(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    const err = new Error(`${command} exited with code ${result.status}`);
    err.exitCode = result.status;
    throw err;
  }
}

function main() {
  const lock = safeReadJson(path.join(root, 'package-lock.json'));
  const version = sanitizeFileComponent(lock?.version);
  const outDir = path.join(root, 'dist_engine');
  fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `aide-engine${version ? `-${version}` : ''}.zip`);
  try {
    fs.rmSync(outFile, { force: true });
  } catch {
  }

  // Build UI plugin dist (and drop sourcemaps) so we don't need cli-ui/ sources in the zip.
  // Build engine dist (release) so the package doesn't ship readable src/ by default.
  run(process.execPath, [path.join(root, 'scripts', 'build-engine.js'), '--skip-if-present'], { cwd: root });
  run(process.execPath, [path.join(root, 'scripts', 'build-cli-ui-plugin.js'), '--release', '--skip-if-present'], {
    cwd: root,
  });

  const include = [
    'dist',
    'shared',
    'subagents',
    'mcp_servers',
    'electron',
    'ui_apps',
    'build_resources',
    'package-lock.json',
    'package.json',
    'README.md',
  ].filter((p) => exists(path.join(root, p)));

  if (include.length === 0) {
    throw new Error('Nothing to pack (no expected directories found).');
  }

  if (process.platform === 'win32') {
    const quoted = include.map((p) => `'${String(p).replace(/'/g, "''")}'`).join(',');
    const dest = outFile.replace(/'/g, "''");
    const ps = [
      '$ErrorActionPreference = "Stop";',
      `$paths = @(${quoted});`,
      `Compress-Archive -Force -Path $paths -DestinationPath '${dest}';`,
      `Write-Host \"Packed: ${dest}\";`,
    ].join(' ');
    run('powershell', ['-NoProfile', '-Command', ps], { cwd: root });
  } else {
    try {
      run('zip', ['-r', outFile, ...include], { cwd: root });
      console.log(`Packed: ${outFile}`);
    } catch (err) {
      if (err?.code === 'ENOENT') {
        throw new Error('zip command not found. Please install zip (e.g. apt-get install zip / brew install zip).');
      }
      throw err;
    }
  }
}

main();
