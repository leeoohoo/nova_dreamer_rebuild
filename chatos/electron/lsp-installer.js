import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

function logWith(logger, level, message, meta, err) {
  if (!logger) return;
  const fn = typeof logger[level] === 'function' ? logger[level] : logger.info;
  if (typeof fn !== 'function') return;
  fn(message, meta, err);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function splitPathEnv(raw) {
  const text = normalizeString(raw);
  if (!text) return [];
  return text.split(path.delimiter).filter(Boolean);
}

function getWindowsPathExts(env) {
  const raw = normalizeString(env?.PATHEXT);
  const parts = raw ? raw.split(';') : [];
  const exts = parts.map((x) => normalizeString(x).toLowerCase()).filter(Boolean);
  if (exts.length > 0) return exts;
  return ['.exe', '.cmd', '.bat', '.com'];
}

function canExecute(stat) {
  if (!stat) return false;
  if (stat.isDirectory()) return false;
  if (process.platform === 'win32') return true;
  // On POSIX, just check it exists; many user-installed CLIs are fine.
  return true;
}

function safeStatSync(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function resolveCandidateExecutable(candidate, env) {
  const raw = normalizeString(candidate);
  if (!raw) return '';

  if (path.isAbsolute(raw)) {
    const stat = safeStatSync(raw);
    return canExecute(stat) ? raw : '';
  }

  // If user passed a relative path (contains a separator), resolve relative to cwd.
  if (raw.includes(path.sep) || raw.includes('/')) {
    const resolved = path.resolve(process.cwd(), raw);
    const stat = safeStatSync(resolved);
    return canExecute(stat) ? resolved : '';
  }

  const pathParts = splitPathEnv(env?.PATH);
  if (pathParts.length === 0) return '';

  const exts = process.platform === 'win32' ? getWindowsPathExts(env) : [''];
  for (const dir of pathParts) {
    for (const ext of exts) {
      const fullPath = path.join(dir, process.platform === 'win32' ? `${raw}${ext}` : raw);
      const stat = safeStatSync(fullPath);
      if (canExecute(stat)) {
        return fullPath;
      }
    }
  }
  return '';
}

function buildDefaultCatalog() {
  return [
    {
      id: 'typescript',
      title: 'TypeScript / JavaScript',
      description: 'typescript-language-server (TS/JS 语义能力：hover/definition/completion/rename 等)',
      provides: ['typescript-language-server'],
      plans: [
        {
          id: 'npm',
          requires: ['npm'],
          platforms: ['darwin', 'linux', 'win32'],
          steps: [{ cmd: 'npm', args: ['i', '-g', 'typescript', 'typescript-language-server'] }],
          display: 'npm i -g typescript typescript-language-server',
        },
      ],
    },
    {
      id: 'java',
      title: 'Java',
      description: 'jdtls (Eclipse JDT Language Server)',
      provides: ['jdtls'],
      plans: [
        {
          id: 'brew',
          requires: ['brew'],
          platforms: ['darwin'],
          steps: [{ cmd: 'brew', args: ['install', 'jdtls'] }],
          display: 'brew install jdtls',
          notes: ['需要 JDK（java）才能运行；如缺失可先安装：brew install openjdk'],
        },
      ],
    },
    {
      id: 'pyright',
      title: 'Python',
      description: 'pyright-langserver (Python 语义能力)',
      provides: ['pyright-langserver'],
      plans: [
        {
          id: 'npm',
          requires: ['npm'],
          platforms: ['darwin', 'linux', 'win32'],
          steps: [{ cmd: 'npm', args: ['i', '-g', 'pyright'] }],
          display: 'npm i -g pyright',
        },
      ],
    },
    {
      id: 'gopls',
      title: 'Go',
      description: 'gopls (Go 官方 LSP)',
      provides: ['gopls'],
      plans: [
        {
          id: 'go',
          requires: ['go'],
          platforms: ['darwin', 'linux', 'win32'],
          steps: [{ cmd: 'go', args: ['install', 'golang.org/x/tools/gopls@latest'] }],
          display: 'go install golang.org/x/tools/gopls@latest',
        },
      ],
    },
    {
      id: 'csharp',
      title: 'C#',
      description: 'csharp-ls (C# language server via dotnet tool)',
      provides: ['csharp-ls'],
      plans: [
        {
          id: 'dotnet',
          requires: ['dotnet'],
          platforms: ['darwin', 'linux', 'win32'],
          steps: [{ cmd: 'dotnet', args: ['tool', 'install', '-g', 'csharp-ls'] }],
          display: 'dotnet tool install -g csharp-ls',
          notes: ['dotnet global tools 默认安装到 ~/.dotnet/tools，需确保该目录在 PATH。'],
        },
      ],
    },
    {
      id: 'rust_analyzer',
      title: 'Rust',
      description: 'rust-analyzer (Rust 官方/事实标准 LSP)',
      provides: ['rust-analyzer'],
      plans: [
        {
          id: 'rustup',
          requires: ['rustup'],
          platforms: ['darwin', 'linux', 'win32'],
          steps: [{ cmd: 'rustup', args: ['component', 'add', 'rust-analyzer'] }],
          display: 'rustup component add rust-analyzer',
        },
        {
          id: 'brew',
          requires: ['brew'],
          platforms: ['darwin'],
          steps: [{ cmd: 'brew', args: ['install', 'rust-analyzer'] }],
          display: 'brew install rust-analyzer',
        },
      ],
    },
    {
      id: 'clangd',
      title: 'C / C++',
      description: 'clangd (C/C++ LSP；如已安装 Xcode/LLVM 可能已自带)',
      provides: ['clangd'],
      plans: [
        {
          id: 'brew_llvm',
          requires: ['brew'],
          platforms: ['darwin'],
          steps: [{ cmd: 'brew', args: ['install', 'llvm'] }],
          display: 'brew install llvm',
          notes: [
            'Homebrew 的 llvm 常为 keg-only；安装后 clangd 可能在 $(brew --prefix llvm)/bin/clangd（不一定在 PATH）。',
          ],
        },
      ],
      notes: [
        '如果 clangd 不在 PATH，可以在 lsp-servers.json 里把 command 改成绝对路径（macOS 常见：/opt/homebrew/opt/llvm/bin/clangd 或 /usr/local/opt/llvm/bin/clangd）。',
      ],
    },
    {
      id: 'php',
      title: 'PHP',
      description: 'intelephense (PHP language server)',
      provides: ['intelephense'],
      plans: [
        {
          id: 'npm',
          requires: ['npm'],
          platforms: ['darwin', 'linux', 'win32'],
          steps: [{ cmd: 'npm', args: ['i', '-g', 'intelephense'] }],
          display: 'npm i -g intelephense',
        },
      ],
    },
    {
      id: 'lua',
      title: 'Lua',
      description: 'lua-language-server (Lua LSP)',
      provides: ['lua-language-server'],
      plans: [
        {
          id: 'brew',
          requires: ['brew'],
          platforms: ['darwin'],
          steps: [{ cmd: 'brew', args: ['install', 'lua-language-server'] }],
          display: 'brew install lua-language-server',
        },
      ],
    },
    {
      id: 'bash',
      title: 'Bash / Shell',
      description: 'bash-language-server (Bash/Zsh 常用补全/诊断)',
      provides: ['bash-language-server'],
      plans: [
        {
          id: 'npm',
          requires: ['npm'],
          platforms: ['darwin', 'linux', 'win32'],
          steps: [{ cmd: 'npm', args: ['i', '-g', 'bash-language-server'] }],
          display: 'npm i -g bash-language-server',
        },
      ],
    },
    {
      id: 'yaml',
      title: 'YAML',
      description: 'yaml-language-server (YAML LSP)',
      provides: ['yaml-language-server'],
      plans: [
        {
          id: 'npm',
          requires: ['npm'],
          platforms: ['darwin', 'linux', 'win32'],
          steps: [{ cmd: 'npm', args: ['i', '-g', 'yaml-language-server'] }],
          display: 'npm i -g yaml-language-server',
        },
      ],
    },
    {
      id: 'vscode_langservers_extracted',
      title: 'JSON / HTML / CSS',
      description: 'vscode-langservers-extracted (json/html/css language servers)',
      provides: ['vscode-json-language-server', 'vscode-html-language-server', 'vscode-css-language-server'],
      plans: [
        {
          id: 'npm',
          requires: ['npm'],
          platforms: ['darwin', 'linux', 'win32'],
          steps: [{ cmd: 'npm', args: ['i', '-g', 'vscode-langservers-extracted'] }],
          display: 'npm i -g vscode-langservers-extracted',
        },
      ],
    },
    {
      id: 'dockerfile',
      title: 'Dockerfile',
      description: 'docker-langserver (Dockerfile language server)',
      provides: ['docker-langserver'],
      plans: [
        {
          id: 'npm',
          requires: ['npm'],
          platforms: ['darwin', 'linux', 'win32'],
          steps: [{ cmd: 'npm', args: ['i', '-g', 'dockerfile-language-server-nodejs'] }],
          display: 'npm i -g dockerfile-language-server-nodejs',
        },
      ],
    },
  ];
}

function platformLabel() {
  const plat = process.platform;
  if (plat === 'darwin') return 'macOS';
  if (plat === 'win32') return 'Windows';
  if (plat === 'linux') return 'Linux';
  return plat;
}

function buildManagers(env) {
  const lookup = (cmd) => resolveCandidateExecutable(cmd, env);
  return {
    npm: lookup('npm'),
    brew: lookup('brew'),
    go: lookup('go'),
    rustup: lookup('rustup'),
    dotnet: lookup('dotnet'),
    java: lookup('java'),
    python: lookup('python'),
    python3: lookup('python3'),
  };
}

function choosePlan(plans, managers) {
  if (!Array.isArray(plans) || plans.length === 0) return null;
  for (const plan of plans) {
    const platforms = Array.isArray(plan?.platforms) ? plan.platforms : [];
    if (platforms.length > 0 && !platforms.includes(process.platform)) {
      continue;
    }
    const requires = Array.isArray(plan?.requires) ? plan.requires : [];
    const missing = requires.filter((name) => !managers?.[name]);
    if (missing.length === 0) {
      return { ...plan, missingRequirements: [] };
    }
  }

  // No plan matched; return the first plan for this platform with missing requirements info to improve UX.
  const firstPlatformPlan = plans.find((plan) => {
    const platforms = Array.isArray(plan?.platforms) ? plan.platforms : [];
    return platforms.length === 0 || platforms.includes(process.platform);
  });
  if (!firstPlatformPlan) return null;
  const requires = Array.isArray(firstPlatformPlan?.requires) ? firstPlatformPlan.requires : [];
  const missing = requires.filter((name) => !managers?.[name]);
  return { ...firstPlatformPlan, missingRequirements: missing };
}

function computeInstallInfo(item, managers) {
  const plan = choosePlan(item?.plans, managers);
  if (!plan) {
    return {
      available: false,
      reason: 'no_plan',
      missing_requirements: [],
      display: '',
      steps: [],
      notes: [],
      alternatives: [],
    };
  }
  const platforms = Array.isArray(plan?.platforms) ? plan.platforms : [];
  const isForThisPlatform = platforms.length === 0 || platforms.includes(process.platform);
  const missing = Array.isArray(plan?.missingRequirements) ? plan.missingRequirements : [];
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const display = normalizeString(plan?.display);
  const notes = Array.isArray(plan?.notes) ? plan.notes.map((x) => normalizeString(x)).filter(Boolean) : [];

  const alternatives = (Array.isArray(item?.plans) ? item.plans : [])
    .filter((p) => {
      const plat = Array.isArray(p?.platforms) ? p.platforms : [];
      return plat.length === 0 || plat.includes(process.platform);
    })
    .map((p) => ({
      id: normalizeString(p?.id),
      requires: Array.isArray(p?.requires) ? p.requires.map(normalizeString).filter(Boolean) : [],
      display: normalizeString(p?.display),
    }))
    .filter((p) => p.display);

  if (!isForThisPlatform) {
    return {
      available: false,
      reason: 'unsupported_platform',
      missing_requirements: [],
      display: '',
      steps: [],
      notes,
      alternatives,
    };
  }

  if (missing.length > 0) {
    return {
      available: false,
      reason: 'missing_requirements',
      missing_requirements: missing,
      display,
      steps,
      notes,
      alternatives,
    };
  }

  return {
    available: steps.length > 0,
    reason: steps.length > 0 ? 'ok' : 'no_steps',
    missing_requirements: [],
    display,
    steps,
    notes,
    alternatives,
  };
}

function computeInstalledInfo(item, env) {
  const provides = Array.isArray(item?.provides) ? item.provides.map(normalizeString).filter(Boolean) : [];
  const found = {};
  const missing = [];
  for (const cmd of provides) {
    const resolved = resolveCandidateExecutable(cmd, env);
    if (resolved) {
      found[cmd] = resolved;
    } else {
      missing.push(cmd);
    }
  }
  return {
    provides,
    installed: missing.length === 0,
    found,
    missing,
  };
}

function truncateLog(text, maxChars) {
  const raw = typeof text === 'string' ? text : String(text || '');
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n...<truncated ${raw.length - maxChars} chars>`;
}

function runCommand({ cmd, args, cwd, env, timeoutMs }) {
  const command = normalizeString(cmd);
  if (!command) throw new Error('Missing command');
  const argv = Array.isArray(args) ? args.map((x) => String(x)) : [];
  const workDir = normalizeString(cwd) || process.cwd();
  const mergedEnv = { ...process.env, ...(env && typeof env === 'object' ? env : null) };
  const ms = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 0;

  return new Promise((resolve) => {
    const child = spawn(command, argv, { cwd: workDir, env: mergedEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer =
      ms > 0
        ? setTimeout(() => {
            killed = true;
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore
            }
          }, ms)
        : null;

    child.stdout.on('data', (chunk) => {
      stdout += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: code === 0 && !killed,
        code,
        signal,
        timedOut: killed,
        stdout: truncateLog(stdout, 200_000),
        stderr: truncateLog(stderr, 200_000),
      });
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        signal: null,
        timedOut: false,
        stdout: truncateLog(stdout, 200_000),
        stderr: truncateLog(`${stderr}\n${err?.message || String(err)}`, 200_000),
      });
    });
  });
}

export function createLspInstaller({ rootDir, env, logger } = {}) {
  const root = normalizeString(rootDir) || process.cwd();
  const baseEnv = env && typeof env === 'object' ? env : process.env;
  const installLogger = logger || null;

  const catalog = buildDefaultCatalog();

  const getCatalog = async () => {
    const managers = buildManagers(baseEnv);
    const items = catalog.map((item) => {
      const installedInfo = computeInstalledInfo(item, baseEnv);
      const install = computeInstallInfo(item, managers);
      const notes = Array.isArray(item?.notes) ? item.notes.map(normalizeString).filter(Boolean) : [];
      return {
        id: normalizeString(item?.id),
        title: normalizeString(item?.title),
        description: normalizeString(item?.description),
        installed: installedInfo.installed,
        provides: installedInfo.provides,
        found: installedInfo.found,
        missing: installedInfo.missing,
        install,
        notes,
      };
    });
    return {
      ok: true,
      platform: {
        os: process.platform,
        osLabel: platformLabel(),
        arch: process.arch,
        hostname: os.hostname?.() || '',
      },
      managers: Object.fromEntries(Object.entries(managers).map(([k, v]) => [k, v ? true : false])),
      items,
    };
  };

  const install = async ({ ids, timeout_ms, actionId } = {}) => {
    const idList = Array.isArray(ids) ? ids.map(normalizeString).filter(Boolean) : [];
    const logMeta = (meta) => (actionId ? { actionId, ...meta } : meta);
    const log = (level, message, meta, err) => logWith(installLogger, level, message, logMeta(meta), err);
    const includeOutput = (ok) =>
      !ok || (typeof process.env.MODEL_CLI_LOG_INSTALL_OUTPUT === 'string' && process.env.MODEL_CLI_LOG_INSTALL_OUTPUT === '1');

    if (idList.length === 0) {
      log('warn', 'lsp.install.missing_ids', {});
      return { ok: false, message: 'ids is required' };
    }

    log('info', 'lsp.install.begin', { ids: idList, root, timeout_ms });
    const managers = buildManagers(baseEnv);
    const itemsById = new Map(catalog.map((i) => [normalizeString(i.id), i]));
    const results = [];

    for (const id of idList) {
      const item = itemsById.get(id);
      if (!item) {
        log('warn', 'lsp.install.unknown_id', { id });
        results.push({ id, ok: false, skipped: true, reason: 'unknown_id' });
        continue;
      }

      log('info', 'lsp.install.item_start', { id });
      const installedInfo = computeInstalledInfo(item, baseEnv);
      if (installedInfo.installed) {
        log('info', 'lsp.install.already_installed', { id, found: installedInfo.found });
        results.push({ id, ok: true, skipped: true, reason: 'already_installed', found: installedInfo.found });
        continue;
      }

      const install = computeInstallInfo(item, managers);
      if (!install.available) {
        log('warn', 'lsp.install.unavailable', {
          id,
          reason: install.reason,
          missing_requirements: install.missing_requirements || [],
          hint: install.display || '',
        });
        results.push({
          id,
          ok: false,
          skipped: true,
          reason: install.reason,
          missing_requirements: install.missing_requirements || [],
          hint: install.display || '',
        });
        continue;
      }

      const stepResults = [];
      let itemOk = true;
      for (const step of install.steps) {
        const stepCmd = normalizeString(step?.cmd);
        const stepArgs = Array.isArray(step?.args) ? step.args : [];
        const res = await runCommand({
          cmd: stepCmd,
          args: stepArgs,
          cwd: root,
          env: baseEnv,
          timeoutMs: clampNumber(timeout_ms, 1000, 60 * 60 * 1000, 20 * 60 * 1000),
        });
        stepResults.push({ cmd: stepCmd, args: stepArgs, ...res });
        const output = includeOutput(res.ok) ? { stdout: res.stdout, stderr: res.stderr } : {};
        log(res.ok ? 'info' : 'warn', 'lsp.install.step', {
          id,
          cmd: stepCmd,
          args: stepArgs,
          ok: res.ok,
          code: res.code,
          signal: res.signal,
          timedOut: res.timedOut,
          ...output,
        });
        if (!res.ok) {
          itemOk = false;
          break;
        }
      }

      const after = computeInstalledInfo(item, baseEnv);
      const entry = {
        id,
        ok: itemOk && after.installed,
        skipped: false,
        steps: stepResults,
        installed: after.installed,
        found: after.found,
        missing: after.missing,
      };
      log(entry.ok ? 'info' : 'warn', 'lsp.install.item_complete', {
        id,
        ok: entry.ok,
        installed: entry.installed,
        missing: entry.missing,
      });
      results.push(entry);
    }

    const nextCatalog = await getCatalog();
    log('info', 'lsp.install.done', { results: results.length });
    return {
      ok: true,
      results,
      catalog: nextCatalog,
    };
  };

  return { getCatalog, install };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.min(Math.max(parsed, min), max);
  }
  return fallback;
}
