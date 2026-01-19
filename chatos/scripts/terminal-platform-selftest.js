import assert from 'assert/strict';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { getDefaultTtyPaths } from '../packages/common/terminal/tty-paths.js';
import { resolveEngineRoot } from '../src/engine-paths.js';
import { getSystemTerminalLauncher } from '../electron/terminal-manager/system-terminal/launcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const engineRoot = resolveEngineRoot({ projectRoot });
if (!engineRoot) {
  throw new Error('Engine sources not found (expected ./packages/aide relative to chatos).');
}

const importAide = async (relativePath) => {
  const target = path.join(engineRoot, relativePath);
  return await import(pathToFileURL(target).href);
};

const { getTerminalPlatform } = await importAide('src/terminal/platform/index.js');
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
