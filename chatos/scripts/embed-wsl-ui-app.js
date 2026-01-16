#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const defaultExternalWslRoot = path.resolve(projectRoot, '..', 'wsl');
const internalPluginsRoot = path.resolve(projectRoot, 'ui_apps', 'plugins');
const providerAppId = 'wsl';

const args = process.argv.slice(2);
const skipIfPresent = args.includes('--skip-if-present');

function readArgValue(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return '';
  const v = args[idx + 1];
  return typeof v === 'string' ? v.trim() : '';
}

function resolveExternalWslRoot() {
  const fromArg = readArgValue('--wsl-root');
  if (fromArg) return path.resolve(fromArg);
  const fromEnv = typeof process.env.MODEL_CLI_WSL_EMBED_ROOT === 'string' ? process.env.MODEL_CLI_WSL_EMBED_ROOT.trim() : '';
  if (fromEnv) return path.resolve(fromEnv);
  return defaultExternalWslRoot;
}

function isDirectory(dirPath) {
  const p = typeof dirPath === 'string' ? dirPath.trim() : '';
  if (!p) return false;
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(filePath) {
  const p = typeof filePath === 'string' ? filePath.trim() : '';
  if (!p) return false;
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function ensureDir(dirPath) {
  const p = typeof dirPath === 'string' ? dirPath.trim() : '';
  if (!p) return;
  fs.mkdirSync(p, { recursive: true });
}

function rmForce(targetPath) {
  const p = typeof targetPath === 'string' ? targetPath.trim() : '';
  if (!p) return;
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function safeReadJson(filePath) {
  const p = typeof filePath === 'string' ? filePath.trim() : '';
  if (!p) return null;
  try {
    if (!isFile(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizeDirComponent(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function findInternalPluginByProvider(appId) {
  const target = typeof appId === 'string' ? appId.trim() : '';
  if (!target || !isDirectory(internalPluginsRoot)) return '';
  const entries = fs.readdirSync(internalPluginsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(internalPluginsRoot, entry.name, 'plugin.json');
    if (!isFile(manifestPath)) continue;
    const manifest = safeReadJson(manifestPath);
    if (typeof manifest?.providerAppId === 'string' && manifest.providerAppId.trim() === target) {
      return path.join(internalPluginsRoot, entry.name);
    }
  }
  return '';
}

function copyDir(srcDir, destDir) {
  fs.cpSync(srcDir, destDir, {
    recursive: true,
    force: true,
    dereference: false,
    filter: (src) => {
      const base = path.basename(src);
      if (base === 'node_modules') return false;
      if (base === '.git') return false;
      if (base === '.DS_Store') return false;
      if (base.endsWith('.map')) return false;
      return true;
    },
  });
}

function main() {
  const externalWslRoot = resolveExternalWslRoot();
  if (!isDirectory(externalWslRoot)) {
    const existingPlugin = findInternalPluginByProvider(providerAppId);
    if (existingPlugin) {
      console.log(`[embed:wsl] External plugin not found, using existing plugin: ${existingPlugin}`);
      return;
    }
    console.error(`[embed:wsl] WSL plugin root not found: ${externalWslRoot}`);
    console.error('[embed:wsl] Provide via --wsl-root <path> or MODEL_CLI_WSL_EMBED_ROOT.');
    process.exit(1);
  }

  const manifestPath = path.join(externalWslRoot, 'plugin.json');
  if (!isFile(manifestPath)) {
    console.error(`[embed:wsl] plugin.json not found: ${manifestPath}`);
    process.exit(1);
  }

  const manifest = safeReadJson(manifestPath);
  const pluginId = typeof manifest?.id === 'string' ? manifest.id.trim() : '';
  if (!pluginId) {
    console.error(`[embed:wsl] Invalid plugin manifest (missing id): ${manifestPath}`);
    process.exit(1);
  }

  const dirName = sanitizeDirComponent(pluginId);
  if (!dirName) {
    console.error(`[embed:wsl] Invalid plugin id: ${pluginId}`);
    process.exit(1);
  }

  const pluginDest = path.join(internalPluginsRoot, dirName);
  if (skipIfPresent && isFile(path.join(pluginDest, 'plugin.json'))) {
    console.log(`[embed:wsl] Already present: ${pluginDest}`);
    return;
  }

  ensureDir(internalPluginsRoot);
  rmForce(pluginDest);
  ensureDir(path.dirname(pluginDest));
  copyDir(externalWslRoot, pluginDest);
  console.log(`[embed:wsl] Synced built-in plugin: ${pluginDest}`);
}

main();

