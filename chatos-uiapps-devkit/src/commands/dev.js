import { loadDevkitConfig } from '../lib/config.js';
import { findPluginDir } from '../lib/plugin.js';
import { startSandboxServer } from '../sandbox/server.js';

export async function cmdDev({ flags }) {
  const { config } = loadDevkitConfig(process.cwd());
  const pluginDir = findPluginDir(process.cwd(), flags['plugin-dir'] || flags.pluginDir || config?.pluginDir);
  const portRaw = String(flags.port || flags.p || '').trim();
  const port = portRaw ? Number(portRaw) : 4399;
  const appId = String(flags.app || flags['app-id'] || flags.appId || config?.appId || '').trim();

  await startSandboxServer({ pluginDir, port, appId });
}

