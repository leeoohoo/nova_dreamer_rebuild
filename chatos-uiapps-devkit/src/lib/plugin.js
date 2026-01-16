import path from 'path';

import { isFile, readJson } from './fs.js';

export function findPluginDir(cwd, explicitPluginDir) {
  const root = typeof cwd === 'string' ? cwd : process.cwd();
  if (explicitPluginDir) {
    const abs = path.resolve(root, explicitPluginDir);
    if (!isFile(path.join(abs, 'plugin.json'))) {
      throw new Error(`plugin.json not found in --plugin-dir: ${abs}`);
    }
    return abs;
  }

  const direct = path.join(root, 'plugin.json');
  if (isFile(direct)) return root;

  const nested = path.join(root, 'plugin', 'plugin.json');
  if (isFile(nested)) return path.join(root, 'plugin');

  throw new Error('Cannot find plugin.json (expected ./plugin.json or ./plugin/plugin.json)');
}

export function loadPluginManifest(pluginDir) {
  const manifestPath = path.join(pluginDir, 'plugin.json');
  const manifest = readJson(manifestPath);
  const pluginId = typeof manifest?.id === 'string' ? manifest.id.trim() : '';
  const name = typeof manifest?.name === 'string' ? manifest.name.trim() : '';
  const version = typeof manifest?.version === 'string' ? manifest.version.trim() : '0.0.0';
  if (!pluginId) throw new Error(`plugin.json missing "id": ${manifestPath}`);
  if (!name) throw new Error(`plugin.json missing "name": ${manifestPath}`);
  return { manifestPath, manifest, pluginId, name, version };
}

export function pickAppFromManifest(manifest, preferredAppId) {
  const apps = Array.isArray(manifest?.apps) ? manifest.apps : [];
  if (apps.length === 0) throw new Error('plugin.json apps[] is empty');
  if (preferredAppId) {
    const hit = apps.find((a) => String(a?.id || '') === String(preferredAppId));
    if (!hit) throw new Error(`app not found in plugin.json: ${preferredAppId}`);
    return hit;
  }
  return apps[0];
}

