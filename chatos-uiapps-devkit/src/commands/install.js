import os from 'os';
import path from 'path';

import { copyDir, ensureDir, isDirectory, rmForce, sanitizeDirComponent } from '../lib/fs.js';
import { loadDevkitConfig } from '../lib/config.js';
import { findPluginDir, loadPluginManifest } from '../lib/plugin.js';

function defaultStateDir(hostApp) {
  const app = typeof hostApp === 'string' && hostApp.trim() ? hostApp.trim() : 'chatos';
  return path.join(os.homedir(), '.deepseek_cli', app);
}

function copyPluginDir(srcDir, destDir) {
  ensureDir(path.dirname(destDir));
  rmForce(destDir);
  copyDir(srcDir, destDir, {
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

export async function cmdInstall({ flags }) {
  const { config } = loadDevkitConfig(process.cwd());
  const pluginDir = findPluginDir(process.cwd(), flags['plugin-dir'] || flags.pluginDir || config?.pluginDir);
  const { pluginId, name, version } = loadPluginManifest(pluginDir);

  const hostApp = String(flags['host-app'] || flags.hostApp || 'chatos').trim() || 'chatos';
  const stateDir = String(flags['state-dir'] || flags.stateDir || defaultStateDir(hostApp)).trim();
  if (!stateDir) throw new Error('stateDir is required');

  const pluginsRoot = path.join(stateDir, 'ui_apps', 'plugins');
  ensureDir(pluginsRoot);

  const dirName = sanitizeDirComponent(pluginId);
  if (!dirName) throw new Error(`Invalid plugin id: ${pluginId}`);

  const destDir = path.join(pluginsRoot, dirName);
  const replaced = isDirectory(destDir);
  copyPluginDir(pluginDir, destDir);

  // eslint-disable-next-line no-console
  console.log(
    `Installed: ${pluginId} (${name}@${version})\n` +
      `  -> ${destDir}\n` +
      `  replaced: ${replaced}\n\n` +
      `Open ChatOS -> 应用 -> 刷新（同 id 覆盖生效）。`
  );
}

