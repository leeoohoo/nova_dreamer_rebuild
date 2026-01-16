import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

import { ensureDir, escapeCmdBatchString } from './utils.js';

export const win32SystemTerminalLauncher = {
  platform: 'win32',

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

    const scriptPath = path.join(resolvedTerminalsDir, `${rid}.launch.cmd`);
    const script = [
      '@echo off',
      'setlocal',
      `cd /d \"${escapeCmdBatchString(resolvedCwd)}\" || exit /b 1`,
      'cd',
      `echo [deepseek-cli] runId=${escapeCmdBatchString(rid)}`,
      '',
      `set \"MODEL_CLI_SESSION_ROOT=${escapeCmdBatchString(resolvedSessionRoot)}\"`,
      `set \"MODEL_CLI_RUN_ID=${escapeCmdBatchString(rid)}\"`,
      'set \"MODEL_CLI_UI_BRIDGE=1\"',
      'set \"MODEL_CLI_DISABLE_INK=1\"',
      'set \"ELECTRON_RUN_AS_NODE=1\"',
      `\"${escapeCmdBatchString(process.execPath)}\" \"${escapeCmdBatchString(resolvedCliPath)}\" chat`,
      'set \"__AIDE_EXIT=%errorlevel%\"',
      'if \"%__AIDE_EXIT%\"==\"2\" (',
      `  \"${escapeCmdBatchString(process.execPath)}\" \"${escapeCmdBatchString(resolvedCliPath)}\" chat <CONIN$`,
      ')',
      '',
    ].join('\r\n');

    try {
      ensureDir(resolvedTerminalsDir);
      fs.writeFileSync(scriptPath, script, 'utf8');
    } catch {
      return false;
    }

    const comspec =
      typeof process.env.COMSPEC === 'string' && process.env.COMSPEC.trim() ? process.env.COMSPEC.trim() : 'cmd.exe';
    return await new Promise((resolve) => {
      const child = spawn(comspec, ['/c', 'start', 'cmd.exe', '/k', scriptPath], {
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
  },
};

