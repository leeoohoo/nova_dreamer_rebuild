import fs from 'fs';
import os from 'os';
import path from 'path';

function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

function escapeShell(text) {
  return `'${String(text || '').replace(/'/g, `'\\''`)}'`;
}

function escapeCmdBatchString(text) {
  return String(text || '')
    .replace(/%/g, '%%')
    .replace(/"/g, '^"');
}

export function createCliShim({ projectRoot, commandName } = {}) {
  const CLI_COMMAND_NAME = typeof commandName === 'string' && commandName.trim() ? commandName.trim() : 'chatos';
  const baseRoot = typeof projectRoot === 'string' && projectRoot.trim() ? projectRoot.trim() : process.cwd();

  function isWritableDirectory(target) {
    if (!target) return false;
    try {
      const stat = fs.statSync(target);
      if (!stat.isDirectory()) return false;
      fs.accessSync(target, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  function resolveCliEntrypointPath() {
    const resources = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
    if (resources) {
      const asarPath = path.join(resources, 'app.asar');
      if (fs.existsSync(asarPath)) {
        const distCandidate = path.join(asarPath, 'dist', 'cli.js');
        if (fs.existsSync(distCandidate)) return distCandidate;
        const legacyCandidate = path.join(asarPath, 'src', 'cli.js');
        if (fs.existsSync(legacyCandidate)) return legacyCandidate;
      }
    }
    const distLocal = path.join(baseRoot, 'dist', 'cli.js');
    if (fs.existsSync(distLocal)) return distLocal;
    return path.join(baseRoot, 'src', 'cli.js');
  }

  function resolveWindowsAppsDir() {
    const localAppData =
      typeof process.env.LOCALAPPDATA === 'string' && process.env.LOCALAPPDATA.trim()
        ? process.env.LOCALAPPDATA.trim()
        : '';
    const base = localAppData || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'Microsoft', 'WindowsApps');
  }

  function resolveWindowsFallbackBinDir() {
    return path.join(os.homedir(), '.deepseek_cli', 'bin');
  }

  function listCliShimCandidates() {
    if (process.platform === 'win32') {
      const windowsAppsDir = resolveWindowsAppsDir();
      const fallbackDir = resolveWindowsFallbackBinDir();
      return [
        path.join(windowsAppsDir, `${CLI_COMMAND_NAME}.cmd`),
        path.join(fallbackDir, `${CLI_COMMAND_NAME}.cmd`),
      ];
    }
    const home = os.homedir();
    const candidates = [];
    if (process.platform === 'darwin') {
      candidates.push('/opt/homebrew/bin');
      candidates.push('/usr/local/bin');
    }
    candidates.push(path.join(home, '.local', 'bin'));
    candidates.push(path.join(home, 'bin'));
    return candidates.map((dir) => path.join(dir, CLI_COMMAND_NAME));
  }

  function resolvePreferredCliShimTarget() {
    if (process.platform === 'win32') {
      const windowsAppsDir = resolveWindowsAppsDir();
      if (isWritableDirectory(windowsAppsDir)) {
        return {
          dir: windowsAppsDir,
          path: path.join(windowsAppsDir, `${CLI_COMMAND_NAME}.cmd`),
          kind: 'cmd',
        };
      }
      const fallbackDir = resolveWindowsFallbackBinDir();
      ensureDir(fallbackDir);
      return {
        dir: fallbackDir,
        path: path.join(fallbackDir, `${CLI_COMMAND_NAME}.cmd`),
        kind: 'cmd',
      };
    }
    const home = os.homedir();
    const homeLocalBin = path.join(home, '.local', 'bin');
    const candidates = [];
    if (process.platform === 'darwin') {
      candidates.push('/opt/homebrew/bin');
      candidates.push('/usr/local/bin');
    }
    candidates.push(homeLocalBin);
    candidates.push(path.join(home, 'bin'));

    for (const dir of candidates) {
      if (!dir) continue;
      if (dir === homeLocalBin) {
        ensureDir(dir);
      }
      if (isWritableDirectory(dir)) {
        return { dir, path: path.join(dir, CLI_COMMAND_NAME), kind: 'sh' };
      }
    }
    ensureDir(homeLocalBin);
    return { dir: homeLocalBin, path: path.join(homeLocalBin, CLI_COMMAND_NAME), kind: 'sh' };
  }

  function buildCliShimContent({ execPath, cliPath, kind }) {
    if (kind === 'cmd') {
      const escapedExec = escapeCmdBatchString(execPath);
      const escapedCli = escapeCmdBatchString(cliPath);
      return [
        '@echo off',
        'setlocal',
        'set "ELECTRON_RUN_AS_NODE=1"',
        'if /I "%~1"=="chat" (',
        `  "${escapedExec}" "${escapedCli}" %*`,
        `  if errorlevel 2 if not errorlevel 3 "${escapedExec}" "${escapedCli}" %* <CONIN$`,
        ') else (',
        `  "${escapedExec}" "${escapedCli}" %*`,
        ')',
        '',
      ].join('\r\n');
    }
    return [
      '#!/bin/sh',
      'export ELECTRON_RUN_AS_NODE=1',
      `exec ${escapeShell(execPath)} ${escapeShell(cliPath)} "$@"`,
      '',
    ].join('\n');
  }

  function buildCliLaunchExamples({ execPath, cliPath } = {}) {
    const resolvedExec =
      typeof execPath === 'string' && execPath.trim() ? execPath.trim() : process.execPath;
    const resolvedCli =
      typeof cliPath === 'string' && cliPath.trim() ? cliPath.trim() : resolveCliEntrypointPath();
    if (process.platform === 'win32') {
      return {
        direct: `set ELECTRON_RUN_AS_NODE=1 && "${resolvedExec}" "${resolvedCli}" chat`,
        command: `${CLI_COMMAND_NAME} chat`,
      };
    }
    return {
      direct: `ELECTRON_RUN_AS_NODE=1 ${escapeShell(resolvedExec)} ${escapeShell(resolvedCli)} chat`,
      command: `${CLI_COMMAND_NAME} chat`,
    };
  }

  function buildCliPathHint({ installedPath, preferred } = {}) {
    const resolvedInstalled = typeof installedPath === 'string' ? installedPath.trim() : '';
    if (!resolvedInstalled) return '';

    if (process.platform === 'win32') {
      const windowsAppsDir = resolveWindowsAppsDir();
      const normalizedInstalled = resolvedInstalled.toLowerCase();
      const normalizedWindowsApps = String(windowsAppsDir || '').toLowerCase();
      if (normalizedWindowsApps && normalizedInstalled.startsWith(normalizedWindowsApps)) {
        return '';
      }
      const dir = preferred?.dir || path.dirname(resolvedInstalled);
      return `如果终端找不到 ${CLI_COMMAND_NAME}，请把 ${dir} 加入 PATH（或把 ${CLI_COMMAND_NAME}.cmd 放到 %LOCALAPPDATA%\\Microsoft\\WindowsApps）。`;
    }

    const normalized = resolvedInstalled.replace(/\\/g, '/');
    if (normalized.includes('/.local/bin/')) {
      return '如果终端提示 command not found，请把 ~/.local/bin 加入 PATH：export PATH="$HOME/.local/bin:$PATH"';
    }
    return '';
  }

  function getCliCommandStatus() {
    const installedPath = listCliShimCandidates().find((candidate) => {
      try {
        return candidate && fs.existsSync(candidate);
      } catch {
        return false;
      }
    }) || '';
    const preferred = resolvePreferredCliShimTarget();
    const cliPath = resolveCliEntrypointPath();
    const examples = buildCliLaunchExamples({ execPath: process.execPath, cliPath });
    return {
      ok: true,
      platform: process.platform,
      command: CLI_COMMAND_NAME,
      installed: Boolean(installedPath),
      installedPath,
      targetPath: preferred.path,
      targetDir: preferred.dir,
      entrypoint: cliPath,
      examples,
      pathHint: buildCliPathHint({ installedPath, preferred }),
    };
  }

  function installCliCommand({ force = false } = {}) {
    const target = resolvePreferredCliShimTarget();
    if (!target?.path) {
      return { ok: false, message: '无法确定安装路径' };
    }

    try {
      ensureDir(target.dir);
    } catch {
      // ignore
    }

    try {
      const exists = fs.existsSync(target.path);
      if (exists && !force) {
        return { ok: false, reason: 'exists', message: '命令已存在，使用 force 覆盖安装', ...getCliCommandStatus() };
      }
    } catch {
      // ignore
    }

    const cliPath = resolveCliEntrypointPath();
    if (!fs.existsSync(cliPath)) {
      return { ok: false, message: `找不到 CLI 入口：${cliPath}` };
    }

    const content = buildCliShimContent({
      execPath: process.execPath,
      cliPath,
      kind: target.kind,
    });
    try {
      fs.writeFileSync(target.path, content, 'utf8');
      if (target.kind === 'sh') {
        fs.chmodSync(target.path, 0o755);
      }
      return { ok: true, installedPath: target.path, ...getCliCommandStatus() };
    } catch (err) {
      return { ok: false, message: err?.message || String(err), ...getCliCommandStatus() };
    }
  }

  function uninstallCliCommand() {
    const candidates = listCliShimCandidates();
    let removed = '';
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        if (!fs.existsSync(candidate)) continue;
        fs.unlinkSync(candidate);
        removed = candidate;
        break;
      } catch {
        // ignore uninstall errors
      }
    }
    return { ok: true, removedPath: removed, ...getCliCommandStatus() };
  }

  return {
    getCliCommandStatus,
    installCliCommand,
    uninstallCliCommand,
  };
}
