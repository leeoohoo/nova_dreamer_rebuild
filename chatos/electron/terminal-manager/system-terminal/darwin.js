import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

import { ensureDir, escapeShell, escapeAppleScriptString } from './utils.js';

export const darwinSystemTerminalLauncher = {
  platform: 'darwin',

  async launchCliInSystemTerminal({ runId, cwd, cliPath, sessionRoot, terminalsDir } = {}) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) return false;

    const resolvedCwd = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : process.cwd();
    const resolvedCliPath =
      typeof cliPath === 'string' && cliPath.trim() ? cliPath.trim() : path.join(process.cwd(), 'src', 'cli.js');
    const resolvedSessionRoot =
      typeof sessionRoot === 'string' && sessionRoot.trim() ? sessionRoot.trim() : process.cwd();
    const resolvedTerminalsDir =
      typeof terminalsDir === 'string' && terminalsDir.trim() ? terminalsDir.trim() : process.cwd();
    const hostApp = typeof process.env.MODEL_CLI_HOST_APP === 'string' ? process.env.MODEL_CLI_HOST_APP.trim() : '';
    const hostEnv = hostApp ? `MODEL_CLI_HOST_APP=${escapeShell(hostApp)}` : '';

    const envPrefix = [
      `MODEL_CLI_SESSION_ROOT=${escapeShell(resolvedSessionRoot)}`,
      `MODEL_CLI_RUN_ID=${escapeShell(rid)}`,
      hostEnv,
      'MODEL_CLI_UI_BRIDGE=1',
      'MODEL_CLI_DISABLE_INK=1',
      'ELECTRON_RUN_AS_NODE=1',
    ]
      .filter(Boolean)
      .join(' ');
    const execCmd = [
      envPrefix,
      escapeShell(process.execPath),
      escapeShell(resolvedCliPath),
      'chat',
    ]
      .filter(Boolean)
      .join(' ');

    const scriptPath = path.join(resolvedTerminalsDir, `${rid}.launch.command`);
    const script = [
      '#!/bin/zsh',
      `cd ${escapeShell(resolvedCwd)} || exit 1`,
      'pwd',
      `echo ${escapeShell(`[deepseek-cli] runId=${rid}`)}`,
      '',
      execCmd,
      '',
    ].join('\n');

    try {
      ensureDir(resolvedTerminalsDir);
      fs.writeFileSync(scriptPath, script, 'utf8');
      fs.chmodSync(scriptPath, 0o755);
    } catch {
      return false;
    }

    const openTerminalOk = await new Promise((resolve) => {
      const child = spawn('/usr/bin/open', ['-a', 'Terminal', scriptPath], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
    if (openTerminalOk) return true;

    const openOk = await new Promise((resolve) => {
      const child = spawn('/usr/bin/open', [scriptPath], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
    if (openOk) return true;

    const terminalCmd = [
      `cd ${escapeShell(resolvedCwd)}`,
      '&&',
      'pwd',
      '&&',
      `echo ${escapeShell(`[deepseek-cli] runId=${rid}`)}`,
      '&&',
      execCmd,
    ].join(' ');
    const appleScript = [
      'tell application \"Terminal\"',
      'activate',
      `do script \"${escapeAppleScriptString(terminalCmd)}\"`,
      'end tell',
    ].join('\n');
    return await new Promise((resolve) => {
      const child = spawn('/usr/bin/osascript', ['-e', appleScript], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
  },
};

