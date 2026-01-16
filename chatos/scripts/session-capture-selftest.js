#!/usr/bin/env node
// Simple session capture self-test: start a session, print a few lines, capture output, then kill it.
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath, pathToFileURL } from 'url';

import { resolveAideRoot } from '../src/aide-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const cliRoot = resolveAideRoot({ projectRoot });
if (!cliRoot) {
  throw new Error('AIDE sources not found (expected ./src/aide relative to chatos).');
}

const { createSessionManager } = await import(pathToFileURL(path.join(cliRoot, 'mcp_servers/shell/session-manager.js')).href);

const execAsync = promisify(exec);

const sessionName = process.env.SESSION || 'mcp_cli_test';
const cwd = process.env.CWD || process.cwd();
const lines = Number(process.env.LINES) || 80;
const sessionRoot =
  process.env.SESSION_ROOT ||
  process.env.MODEL_CLI_SESSION_ROOT ||
  process.env.HOME ||
  process.env.USERPROFILE ||
  os.homedir() ||
  process.cwd();
const defaultShell =
  process.env.SHELL ||
  (process.platform === 'win32' ? process.env.COMSPEC || process.env.ComSpec || 'cmd.exe' : '/bin/bash');

const sessions = createSessionManager({
  execAsync,
  root: cwd,
  defaultShell,
  serverName: 'session_selftest',
  sessionRoot,
});

async function main() {
  const safeName = sessions.sanitizeName(sessionName);
  await sessions.killSession({ sessionName: safeName }).catch(() => {});

  const nodePath = JSON.stringify(process.execPath);
  const jsCode = `console.log("hello"); setTimeout(() => console.log("world"), 700); setTimeout(() => console.log("done"), 1400);`;
  const cmd = `${nodePath} -e ${JSON.stringify(jsCode)}`;

  console.log(`[start] session=${safeName} cwd=${cwd}`);
  const started = await sessions.start({ sessionName: safeName, command: cmd, workingDir: cwd });
  console.log('[paths]', {
    output: started.outputPath,
    control: started.controlPath,
    status: started.statusPath,
  });

  await sleep(1600);
  const output = await sessions.captureOutput({ sessionName: safeName, lineCount: lines });
  console.log(`[capture] last ${lines} lines:\n${output || '<empty>'}`);

  await sessions.killSession({ sessionName: safeName });
  console.log('[kill] requested');

  await sleep(250);
  const after = await sessions.captureOutput({ sessionName: safeName, lineCount: Math.min(50, lines) });
  console.log('[capture after kill]\n' + (after || '<empty>'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('[selftest error]', err.message || err);
  process.exit(1);
});
