import fs from 'fs';
import path from 'path';

import { isFile } from '../lib/fs.js';
import { loadDevkitConfig } from '../lib/config.js';
import { findPluginDir, loadPluginManifest } from '../lib/plugin.js';
import { resolveInsideDir } from '../lib/path-boundary.js';

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function statSizeSafe(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export async function cmdValidate({ flags }) {
  const { config } = loadDevkitConfig(process.cwd());
  const pluginDir = findPluginDir(process.cwd(), flags['plugin-dir'] || flags.pluginDir || config?.pluginDir);

  const { manifestPath, manifest } = loadPluginManifest(pluginDir);

  const manifestSize = statSizeSafe(manifestPath);
  assert(manifestSize <= 256 * 1024, `plugin.json too large (>256KiB): ${manifestSize} bytes`);

  assert(Number(manifest?.manifestVersion || 1) === 1, 'manifestVersion must be 1');
  assert(typeof manifest?.id === 'string' && manifest.id.trim(), 'plugin.id is required');
  assert(typeof manifest?.name === 'string' && manifest.name.trim(), 'plugin.name is required');

  if (manifest?.backend?.entry) {
    const backendAbs = resolveInsideDir(pluginDir, manifest.backend.entry);
    assert(isFile(backendAbs), `backend.entry must be a file: ${manifest.backend.entry}`);
  }

  const apps = Array.isArray(manifest?.apps) ? manifest.apps : [];
  assert(apps.length > 0, 'plugin.apps[] is required (>=1)');
  const ids = new Set();
  for (const app of apps) {
    const appId = typeof app?.id === 'string' ? app.id.trim() : '';
    assert(appId, 'apps[i].id is required');
    assert(!ids.has(appId), `duplicate app.id: ${appId}`);
    ids.add(appId);

    assert(typeof app?.name === 'string' && app.name.trim(), `apps[${appId}].name is required`);
    assert(app?.entry?.type === 'module', `apps[${appId}].entry.type must be "module"`);
    const entryPath = typeof app?.entry?.path === 'string' ? app.entry.path.trim() : '';
    assert(entryPath, `apps[${appId}].entry.path is required`);
    const entryAbs = resolveInsideDir(pluginDir, entryPath);
    assert(isFile(entryAbs), `apps[${appId}].entry.path must be a file: ${entryPath}`);

    const compactType = app?.entry?.compact?.type;
    if (compactType && compactType !== 'module') {
      assert(false, `apps[${appId}].entry.compact.type must be "module"`);
    }
    const compactPath = typeof app?.entry?.compact?.path === 'string' ? app.entry.compact.path.trim() : '';
    if (compactPath) {
      const compactAbs = resolveInsideDir(pluginDir, compactPath);
      assert(isFile(compactAbs), `apps[${appId}].entry.compact.path must be a file: ${compactPath}`);
    }

    // Basic ai path boundary checks (full schema is defined in docs; this validates the security boundary).
    const ai = app?.ai;
    const aiObj =
      typeof ai === 'string'
        ? { config: ai }
        : ai && typeof ai === 'object'
          ? ai
          : null;

    if (aiObj?.config) {
      const abs = resolveInsideDir(pluginDir, aiObj.config);
      assert(isFile(abs), `apps[${appId}].ai.config must be a file: ${aiObj.config}`);
      const size = statSizeSafe(abs);
      assert(size <= 128 * 1024, `ai.config too large (>128KiB): ${aiObj.config}`);
    }

    if (aiObj?.mcp?.entry) {
      const abs = resolveInsideDir(pluginDir, aiObj.mcp.entry);
      assert(isFile(abs), `apps[${appId}].ai.mcp.entry must be a file: ${aiObj.mcp.entry}`);
    }

    const mcpPrompt = aiObj?.mcpPrompt;
    const collectPromptPaths = () => {
      if (!mcpPrompt) return [];
      if (typeof mcpPrompt === 'string') return [mcpPrompt];
      if (typeof mcpPrompt !== 'object') return [];
      const zh = mcpPrompt.zh;
      const en = mcpPrompt.en;
      const out = [];
      const pushSource = (src) => {
        if (!src) return;
        if (typeof src === 'string') out.push(src);
        else if (typeof src === 'object' && typeof src.path === 'string') out.push(src.path);
      };
      pushSource(zh);
      pushSource(en);
      return out;
    };
    for (const rel of collectPromptPaths()) {
      const abs = resolveInsideDir(pluginDir, rel);
      assert(isFile(abs), `apps[${appId}].ai.mcpPrompt path must be a file: ${rel}`);
      const size = statSizeSafe(abs);
      assert(size <= 128 * 1024, `mcpPrompt too large (>128KiB): ${rel}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`OK: ${path.relative(process.cwd(), pluginDir)} (apps=${apps.length})`);
}
