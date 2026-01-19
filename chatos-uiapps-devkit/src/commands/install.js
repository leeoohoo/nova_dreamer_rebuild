import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

import { copyDir, ensureDir, isDirectory, rmForce, sanitizeDirComponent } from '../lib/fs.js';
import { loadDevkitConfig } from '../lib/config.js';
import { findPluginDir, loadPluginManifest } from '../lib/plugin.js';
import { STATE_ROOT_DIRNAME } from '../lib/state-constants.js';

function createActionId(prefix) {
  const base = typeof prefix === 'string' && prefix.trim() ? prefix.trim() : 'action';
  const short = crypto.randomUUID().split('-')[0];
  return `${base}-${Date.now().toString(36)}-${short}`;
}

function logWith(filePath, entry) {
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // ignore logging failures
  }
}

function defaultStateDir(hostApp) {
  const app = typeof hostApp === 'string' && hostApp.trim() ? hostApp.trim() : 'chatos';
  return path.join(os.homedir(), STATE_ROOT_DIRNAME, app);
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
  const actionId = createActionId('devkit_install');
  const hostApp = String(flags['host-app'] || flags.hostApp || 'chatos').trim() || 'chatos';
  const stateDir = String(flags['state-dir'] || flags.stateDir || defaultStateDir(hostApp)).trim();
  const logFile = String(flags['log-file'] || flags.logFile || path.join(stateDir, 'devkit-install-log.jsonl')).trim();
  const log = (level, message, meta, err) => {
    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      actionId,
      pid: process.pid,
      meta: meta && typeof meta === 'object' ? meta : meta === undefined ? undefined : { value: meta },
      error: err?.message || (err ? String(err) : undefined),
    };
    logWith(logFile, entry);
  };

  try {
    if (!stateDir) throw new Error('stateDir is required');
    log('info', 'devkit.install.start', { hostApp, stateDir, logFile });
    const pluginDir = findPluginDir(process.cwd(), flags['plugin-dir'] || flags.pluginDir || config?.pluginDir);
    const { pluginId, name, version } = loadPluginManifest(pluginDir);

    const pluginsRoot = path.join(stateDir, 'ui_apps', 'plugins');
    ensureDir(pluginsRoot);

    const dirName = sanitizeDirComponent(pluginId);
    if (!dirName) throw new Error(`Invalid plugin id: ${pluginId}`);

    const destDir = path.join(pluginsRoot, dirName);
    const replaced = isDirectory(destDir);
    copyPluginDir(pluginDir, destDir);

    log('info', 'devkit.install.complete', {
      pluginId,
      name,
      version,
      pluginDir,
      destDir,
      replaced,
    });

    // eslint-disable-next-line no-console
    console.log(
      `Installed: ${pluginId} (${name}@${version})\n` +
        `  -> ${destDir}\n` +
        `  replaced: ${replaced}\n` +
        `  log: ${logFile}\n\n` +
        `Open ChatOS -> 应用 -> 刷新（同 id 覆盖生效）。`
    );
  } catch (err) {
    log('error', 'devkit.install.failed', {}, err);
    throw err;
  }
}

