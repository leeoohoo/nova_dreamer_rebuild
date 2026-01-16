import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_ENGINE_DIRNAME = 'aide';
const DEFAULT_ENGINE_MARKER = '.chatos-aide.json';

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

function hasAideCliEntrypoint(rootDir) {
  const dir = typeof rootDir === 'string' ? rootDir.trim() : '';
  if (!dir) return false;
  return isFile(path.join(dir, 'dist', 'cli.js')) || isFile(path.join(dir, 'src', 'cli.js'));
}

export function looksLikeAideRoot(rootDir) {
  const dir = typeof rootDir === 'string' ? rootDir.trim() : '';
  if (!dir) return false;
  return hasAideCliEntrypoint(dir) && isDirectory(path.join(dir, 'shared')) && isDirectory(path.join(dir, 'electron'));
}

function detectAideRootDir(maybeRoot) {
  const root = typeof maybeRoot === 'string' ? maybeRoot.trim() : '';
  if (!root) return null;
  if (looksLikeAideRoot(root)) return root;

  // Common zip layout: <top>/aide/... or <top>/<repo>-<sha>/...
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const candidates = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
    for (const candidate of candidates) {
      if (looksLikeAideRoot(candidate)) return candidate;
    }
  } catch {
    // ignore
  }
  return null;
}

export function detectAideVersion(aideRoot) {
  const root = typeof aideRoot === 'string' ? aideRoot.trim() : '';
  if (!root) return '';

  const lock = safeReadJson(path.join(root, 'package-lock.json'));
  const lockVersion = typeof lock?.version === 'string' ? lock.version.trim() : '';
  if (lockVersion) return lockVersion;

  const builtinPlugin = safeReadJson(path.join(root, 'ui_apps', 'plugins', 'aide-builtin', 'plugin.json'));
  const pluginVersion = typeof builtinPlugin?.version === 'string' ? builtinPlugin.version.trim() : '';
  if (pluginVersion) return pluginVersion;

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
      return true;
    },
  });
}

function ensureNodeModulesLink({ engineDir, hostNodeModulesDir }) {
  const engineRoot = typeof engineDir === 'string' ? engineDir.trim() : '';
  const host = typeof hostNodeModulesDir === 'string' ? hostNodeModulesDir.trim() : '';
  if (!engineRoot) throw new Error('engineDir is required');
  if (!host) throw new Error('hostNodeModulesDir is required');
  if (!isDirectory(host)) {
    throw new Error(`Host node_modules not found: ${host}`);
  }

  const linkPath = path.join(engineRoot, 'node_modules');
  rmForce(linkPath);
  ensureDir(path.dirname(linkPath));
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(host, linkPath, linkType);
}

function writeEnginePackageJson(engineDir, version) {
  const dir = typeof engineDir === 'string' ? engineDir.trim() : '';
  if (!dir) throw new Error('engineDir is required');
  const pkg = {
    name: '@leeoohoo/aide-runtime',
    private: true,
    type: 'module',
    ...(version ? { version } : null),
  };
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

function writeInstallMarker(engineDir, payload) {
  const dir = typeof engineDir === 'string' ? engineDir.trim() : '';
  if (!dir) throw new Error('engineDir is required');
  fs.writeFileSync(path.join(dir, DEFAULT_ENGINE_MARKER), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function getAideInstallStatus({ stateDir }) {
  const state = typeof stateDir === 'string' ? stateDir.trim() : '';
  if (!state) return { installed: false };
  const engineDir = path.join(state, DEFAULT_ENGINE_DIRNAME);
  if (!looksLikeAideRoot(engineDir)) {
    return { installed: false, engineDir };
  }
  const marker = safeReadJson(path.join(engineDir, DEFAULT_ENGINE_MARKER));
  const version = typeof marker?.version === 'string' ? marker.version : '';
  const installedAt = typeof marker?.installedAt === 'string' ? marker.installedAt : '';
  return { installed: true, engineDir, version, installedAt };
}

export async function installAideEngine({ inputPath, stateDir, hostNodeModulesDir }) {
  const normalizedInput = typeof inputPath === 'string' ? inputPath.trim() : '';
  const state = typeof stateDir === 'string' ? stateDir.trim() : '';
  if (!normalizedInput) throw new Error('inputPath is required');
  if (!state) throw new Error('stateDir is required');

  ensureDir(state);

  const stagingBase = fs.mkdtempSync(path.join(os.tmpdir(), 'chatos-aide-'));
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

    const aideRoot = detectAideRootDir(extractedRoot);
    if (!aideRoot) {
      throw new Error('Invalid AIDE package: dist/cli.js or src/cli.js not found');
    }

    const engineDir = path.join(state, DEFAULT_ENGINE_DIRNAME);
    const version = detectAideVersion(aideRoot);

    // Replace engine dir.
    rmForce(engineDir);
    ensureDir(engineDir);

    const includeDirs = ['shared', 'subagents', 'mcp_servers', 'electron', 'ui_apps', 'build_resources'];
    // Prefer src/ when available to avoid dist-bundle runtime differences.
    if (isDirectory(path.join(aideRoot, 'src'))) {
      includeDirs.unshift('src');
    } else if (isDirectory(path.join(aideRoot, 'dist'))) {
      includeDirs.unshift('dist');
    }
    includeDirs.forEach((name) => {
      const src = path.join(aideRoot, name);
      if (!isDirectory(src)) return;
      const dest = path.join(engineDir, name);
      copyDir(src, dest);
    });

    if (!looksLikeAideRoot(engineDir)) {
      throw new Error('AIDE installation incomplete (missing required directories)');
    }

    writeEnginePackageJson(engineDir, version);
    ensureNodeModulesLink({ engineDir, hostNodeModulesDir });

    // Install UI app plugins into user plugins dir (stateDir/ui_apps/plugins).
    const uiPluginsSrc = path.join(aideRoot, 'ui_apps', 'plugins');
    const uiPluginsDest = path.join(state, 'ui_apps', 'plugins');
    if (isDirectory(uiPluginsSrc)) {
      ensureDir(uiPluginsDest);
      const entries = fs.readdirSync(uiPluginsSrc, { withFileTypes: true });
      entries.forEach((entry) => {
        if (!entry.isDirectory()) return;
        const name = String(entry.name || '').trim();
        if (!name || name.startsWith('.')) return;
        copyDir(path.join(uiPluginsSrc, name), path.join(uiPluginsDest, name));
      });
    }

    writeInstallMarker(engineDir, {
      version,
      installedAt: new Date().toISOString(),
      source: {
        kind: isDirectory(normalizedInput) ? 'dir' : 'zip',
        path: normalizedInput,
      },
    });

    return { ok: true, engineDir, version };
  } finally {
    rmForce(stagingBase);
  }
}
