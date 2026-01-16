import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { getDefaultTtyPaths } from '../src/common/terminal/tty-paths.js';
import { resolveAideRoot } from '../src/aide-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const cliRoot = resolveAideRoot({ projectRoot });
if (!cliRoot) {
  throw new Error('AIDE sources not found (expected ./src/aide relative to chatos).');
}

const importAide = async (relativePath) => {
  const target = path.join(cliRoot, relativePath);
  return await import(pathToFileURL(target).href);
};

const importAideCompat = async (...relativePaths) => {
  const candidates = relativePaths
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  if (candidates.length === 0) {
    throw new Error('relativePath is required');
  }
  for (const rel of candidates) {
    const target = path.join(cliRoot, rel);
    try {
      if (fs.existsSync(target)) {
        return await import(pathToFileURL(target).href);
      }
    } catch {
      // ignore
    }
  }
  return await importAide(candidates[0]);
};

const { getTerminalPlatform } = await importAideCompat('dist/terminal/platform/index.js', 'src/terminal/platform/index.js');
const { getSystemTerminalLauncher } = await importAide('electron/terminal-manager/system-terminal/launcher.js');
function assertTerminalPlatform(platform, expected) {
  const impl = getTerminalPlatform(platform);
  assert.equal(typeof impl.ensureUtf8Console, 'function');
  assert.equal(typeof impl.createChatReadlineInput, 'function');
  assert.equal(typeof impl.getTerminalControlPollIntervalMs, 'function');
  assert.equal(typeof impl.getProcessGroupId, 'function');
  assert.equal(impl.getTerminalControlPollIntervalMs(), expected.pollIntervalMs);
}

assertTerminalPlatform('win32', { pollIntervalMs: 200 });
assertTerminalPlatform('darwin', { pollIntervalMs: 800 });
assertTerminalPlatform('linux', { pollIntervalMs: 800 });

assert.equal(getSystemTerminalLauncher('win32').platform, 'win32');
assert.equal(getSystemTerminalLauncher('darwin').platform, 'darwin');
assert.equal(getSystemTerminalLauncher('linux').platform, 'unsupported');

assert.deepEqual(getDefaultTtyPaths('win32'), { inputPath: '\\\\.\\CONIN$', outputPath: '\\\\.\\CONOUT$' });
assert.deepEqual(getDefaultTtyPaths('darwin'), { inputPath: '/dev/tty', outputPath: '/dev/tty' });

console.log('[terminal-platform-selftest] ok');
