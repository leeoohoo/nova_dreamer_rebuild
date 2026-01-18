import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureUiAppsPluginTrustRecord } from './trust-store.js';

const DEFAULT_PLUGINS_DIRNAME = 'ui_apps/plugins';

function isDirectory(dirPath) {
  const normalized = typeof dirPath === 'string' ? dirPath.trim() : '';
  if (!normalized) return false;
  try {
    return fs.existsSync(normalized) && fs.statSync(normalized).isDirectory();
  } catch {
    return false;
  }
}

function isFile(filePath) {
  const normalized = typeof filePath === 'string' ? filePath.trim() : '';
  if (!normalized) return false;
  try {
    return fs.existsSync(normalized) && fs.statSync(normalized).isFile();
  } catch {
    return false;
  }
}

function ensureDir(dirPath) {
  const normalized = typeof dirPath === 'string' ? dirPath.trim() : '';
  if (!normalized) return;
  fs.mkdirSync(normalized, { recursive: true });
}

function rmForce(targetPath) {
  const normalized = typeof targetPath === 'string' ? targetPath.trim() : '';
  if (!normalized) return;
  try {
    fs.rmSync(normalized, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function safeReadJson(filePath) {
  const normalized = typeof filePath === 'string' ? filePath.trim() : '';
  if (!normalized) return null;
  try {
    if (!fs.existsSync(normalized)) return null;
    const raw = fs.readFileSync(normalized, 'utf8');
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

function detectPluginRoots(extractedRoot) {
  const root = typeof extractedRoot === 'string' ? extractedRoot.trim() : '';
  if (!root || !isDirectory(root)) return [];

  const directManifest = path.join(root, 'plugin.json');
  if (isFile(directManifest)) return [root];

  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .filter((dir) => isFile(path.join(dir, 'plugin.json')));
    return candidates;
  } catch {
    return [];
  }
}

export async function installUiAppsPlugins({ inputPath, stateDir }) {
  const normalizedInput = typeof inputPath === 'string' ? inputPath.trim() : '';
  const state = typeof stateDir === 'string' ? stateDir.trim() : '';
  if (!normalizedInput) throw new Error('inputPath is required');
  if (!state) throw new Error('stateDir is required');

  ensureDir(state);
  const pluginsRoot = path.join(state, DEFAULT_PLUGINS_DIRNAME);
  ensureDir(pluginsRoot);

  const stagingBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chatos-uiapps-'));
  let extractedRoot = '';
  try {
    if (isDirectory(normalizedInput)) {
      extractedRoot = normalizedInput;
    } else if (isFile(normalizedInput) && normalizedInput.toLowerCase().endsWith('.zip')) {
      const { default: extractZip } = await import('extract-zip');
      await extractZip(normalizedInput, { dir: stagingBase });
      extractedRoot = stagingBase;
    } else {
      throw new Error('Only directories and .zip files are supported');
    }

    const roots = detectPluginRoots(extractedRoot);
    if (roots.length === 0) {
      throw new Error('Invalid plugin package: plugin.json not found');
    }

    const results = [];
    roots.forEach((pluginDir) => {
      const manifestPath = path.join(pluginDir, 'plugin.json');
      const manifest = safeReadJson(manifestPath);
      const id = typeof manifest?.id === 'string' ? manifest.id.trim() : '';
      if (!id) {
        throw new Error(`Invalid plugin manifest (missing id): ${manifestPath}`);
      }

      const dirName = sanitizeDirComponent(id);
      if (!dirName) {
        throw new Error(`Invalid plugin id: ${id}`);
      }

      const destDir = path.join(pluginsRoot, dirName);
      const replaced = isDirectory(destDir);
      rmForce(destDir);
      ensureDir(path.dirname(destDir));
      copyDir(pluginDir, destDir);

      results.push({
        id,
        name: typeof manifest?.name === 'string' ? manifest.name.trim() : '',
        version: typeof manifest?.version === 'string' ? manifest.version.trim() : '',
        pluginDir: destDir,
        replaced,
      });

      ensureUiAppsPluginTrustRecord({ pluginId: id, stateDir: state });
    });

    return { ok: true, plugins: results, pluginsRoot };
  } finally {
    rmForce(stagingBase);
  }
}

