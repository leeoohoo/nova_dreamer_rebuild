import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import { copyDir, ensureDir, rmForce } from '../lib/fs.js';
import { loadDevkitConfig } from '../lib/config.js';
import { findPluginDir, loadPluginManifest } from '../lib/plugin.js';

function hasCmd(cmd) {
  const res = spawnSync('sh', ['-lc', `command -v ${cmd} >/dev/null 2>&1`], { stdio: 'ignore' });
  return res.status === 0;
}

function packWithZip({ cwd, srcDir, outFile }) {
  // zip -r out.zip .  (from within srcDir)
  const res = spawnSync('zip', ['-r', outFile, '.'], { cwd: srcDir, stdio: 'inherit' });
  if (res.status !== 0) throw new Error('zip failed');
}

function packWithPowershell({ srcDir, outFile }) {
  const script = `Compress-Archive -Path "${srcDir}\\*" -DestinationPath "${outFile}" -Force`;
  const res = spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error('powershell Compress-Archive failed');
}

export async function cmdPack({ flags }) {
  const { config } = loadDevkitConfig(process.cwd());
  const pluginDir = findPluginDir(process.cwd(), flags['plugin-dir'] || flags.pluginDir || config?.pluginDir);
  const { pluginId, version } = loadPluginManifest(pluginDir);

  const outArg = String(flags.out || '').trim();
  const outDir = outArg ? path.dirname(path.resolve(process.cwd(), outArg)) : path.join(process.cwd(), 'dist');
  ensureDir(outDir);

  const outFile = outArg
    ? path.resolve(process.cwd(), outArg)
    : path.join(outDir, `${pluginId.replace(/[^a-zA-Z0-9._-]+/g, '-')}-${version || '0.0.0'}.zip`);

  rmForce(outFile);

  const stagingBase = path.join(os.tmpdir(), `chatos-uiapp-pack-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  ensureDir(stagingBase);
  try {
    // mimic ChatOS importer: exclude node_modules/.git/*.map/.DS_Store
    copyDir(pluginDir, stagingBase, {
      filter: (src) => {
        const base = path.basename(src);
        if (base === 'node_modules') return false;
        if (base === '.git') return false;
        if (base === '.DS_Store') return false;
        if (base.endsWith('.map')) return false;
        return true;
      },
    });

  const platform = process.platform;
  if (hasCmd('zip')) {
      packWithZip({ cwd: process.cwd(), srcDir: stagingBase, outFile });
  } else if (platform === 'win32') {
      packWithPowershell({ srcDir: stagingBase, outFile });
  } else {
    throw new Error('zip command not found (install "zip" or run on Windows with powershell)');
  }

  // eslint-disable-next-line no-console
  console.log(`Packed: ${outFile}

ChatOS -> 应用 -> 导入应用包 -> 选择该 zip`);
  } finally {
    rmForce(stagingBase);
  }
}
