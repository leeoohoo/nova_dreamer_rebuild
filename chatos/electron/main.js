import path from 'path';
import fs from 'fs';
import os from 'os';
// electron 是 CommonJS，需要用 default import 解构
import electron from 'electron';
import { fileURLToPath, pathToFileURL } from 'url';
import { registerAdminApi, sanitizeAdminSnapshot } from './backend/api.js';
import { registerRegistryApi } from './backend/registry.js';
import { initRegistryCenter } from './backend/registry-center.js';
import {
  resolveExistingAppDbPath,
  syncRegistryFromAppDb,
  syncRegistryFromServices,
} from './backend/registry-sync.js';
import { registerUiAppsApi } from './ui-apps/index.js';
import { installUiAppsPlugins } from './ui-apps/plugin-installer.js';
import { createConfigManager } from './config-manager/index.js';
import { registerConfigIpcHandlers } from './config-manager/ipc-handlers.js';
import { registerQuickSwitchHandlers } from './config-manager/quick-switch.js';
import { createAdminDefaultsManager } from './admin-defaults.js';
import { createWorkspaceOps } from './workspace.js';
import { listSessions, killSession, killAllSessions, restartSession, stopSession, readSessionLog } from './sessions.js';
import { createSessionApi } from './session-api.js';
import { createCliShim } from './cli-shim.js';
import { createTerminalManager } from './terminal-manager.js';
import { registerChatApi } from './chat/index.js';
import { ensureAllSubagentsInstalled, maybePurgeUiAppsSyncedAdminData, readLegacyState } from './main-helpers.js';
import { resolveEngineRoot } from '../src/engine-paths.js';
import { resolveSessionRoot, persistSessionRoot } from '../src/session-root.js';
import { ensureAppStateDir } from '../src/common/state-core/state-paths.js';
import { resolveRuntimeLogPath } from '../src/common/state-core/runtime-log.js';
import { createDb } from '../src/common/admin-data/storage.js';
import { createAdminServices } from '../src/common/admin-data/services/index.js';
import { syncAdminToFiles } from '../src/common/admin-data/sync.js';
import { buildAdminSeed } from '../src/common/admin-data/legacy.js';
import { createLspInstaller } from './lsp-installer.js';
import { ConfigApplier } from '../src/core/session/ConfigApplier.js';
import { readLastLinesFromFile } from './sessions/utils.js';

const { app, BrowserWindow, ipcMain, dialog, nativeImage } = electron;
const APP_DISPLAY_NAME = 'chatos';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
process.env.MODEL_CLI_HOST_APP = 'chatos';
// 会话根：桌面端默认使用 home（可通过环境变量显式覆盖），避免被 CLI 的 last-session-root 影响。
const explicitSessionRoot =
  typeof process.env.MODEL_CLI_SESSION_ROOT === 'string' && process.env.MODEL_CLI_SESSION_ROOT.trim()
    ? process.env.MODEL_CLI_SESSION_ROOT.trim()
    : '';
const sessionRoot = resolveSessionRoot({ preferHome: true });
process.env.MODEL_CLI_SESSION_ROOT = sessionRoot;
if (explicitSessionRoot) {
  persistSessionRoot(sessionRoot);
}

const engineRoot = resolveEngineRoot({ projectRoot });
if (!engineRoot) {
  throw new Error('Engine sources not found (expected ./src/engine relative to chatos).');
}
const resolveEngineModule = (relativePath) => {
  const rel = typeof relativePath === 'string' ? relativePath.trim() : '';
  if (!rel) throw new Error('Engine module path is required');
  const srcCandidate = path.join(engineRoot, 'src', rel);
  if (fs.existsSync(srcCandidate)) return srcCandidate;
  const distCandidate = path.join(engineRoot, 'dist', rel);
  if (fs.existsSync(distCandidate)) return distCandidate;
  throw new Error(`Engine module not found: ${rel}`);
};
const { createSubAgentManager } = await import(
  pathToFileURL(resolveEngineModule('subagents/index.js')).href
);

const appIconPath = resolveAppIconPath();
const hostApp =
  String(process.env.MODEL_CLI_HOST_APP || 'chatos')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'chatos';
const stateDir = ensureAppStateDir(sessionRoot, { hostApp, fallbackHostApp: 'chatos' });
const authDir = path.join(stateDir, 'auth');
const terminalsDir = path.join(stateDir, 'terminals');

let mainWindow = null;
let chatApi = null;
let sessionApi = null;
let terminalManager = null;
let uiAppsManager = null;
const MAX_VIEW_FILE_BYTES = 512 * 1024;
const MAX_LIST_DIR_ENTRIES = 600;
const UI_TERMINAL_STDIO = ['pipe', 'ignore', 'ignore'];
const UI_TERMINAL_MODE_ENV = 'MODEL_CLI_UI_TERMINAL_MODE';
// 桌面 App 里安装的终端命令（无需系统 Node.js）
const DEFAULT_CLI_COMMAND_NAME = 'chatos';
// Windows 上桌面版通过 WindowsApps 放一个 .cmd，很容易和 npm 全局安装的 `chatos` 发生 PATH 冲突；
// 默认改成另一个名字，避免覆盖/抢占用户的终端命令。
const WINDOWS_DESKTOP_CLI_COMMAND_NAME = 'chatos-desktop';
const CLI_COMMAND_NAME = process.platform === 'win32' ? WINDOWS_DESKTOP_CLI_COMMAND_NAME : DEFAULT_CLI_COMMAND_NAME;
const LEGACY_CLI_COMMAND_NAME = DEFAULT_CLI_COMMAND_NAME;
const UI_DEVELOPER_MODE = (!app?.isPackaged) || process.env.MODEL_CLI_UI_DEVELOPER_MODE === '1';
const UI_EXPOSE_SUBAGENTS = resolveBoolEnv('MODEL_CLI_UI_EXPOSE_SUBAGENTS', true);
const UI_WEB_SECURITY = resolveBoolEnv('MODEL_CLI_UI_WEB_SECURITY', true);
const UI_FLAGS = { developerMode: UI_DEVELOPER_MODE, aideInstalled: true, exposeSubagents: UI_EXPOSE_SUBAGENTS };
const ENABLE_ALL_SUBAGENTS = resolveBoolEnv('MODEL_CLI_ENABLE_ALL_SUBAGENTS', Boolean(app?.isPackaged));
// IMPORTANT: keep UI Apps scanning read-only by default; only enable DB sync explicitly via env.
const UIAPPS_SYNC_AI_CONTRIBUTES = resolveBoolEnv('MODEL_CLI_UIAPPS_SYNC_AI_CONTRIBUTES', false);
const BUILTIN_UI_APPS_DIR = path.join(projectRoot, 'ui_apps', 'plugins');
const REGISTRY_KNOWN_APPS = Array.from(new Set([hostApp, 'git_app', 'wsl'].filter(Boolean)));
const sanitizeAdminForUi = (snapshot) => {
  const sanitized = sanitizeAdminSnapshot(snapshot);
  if (UI_DEVELOPER_MODE || UI_EXPOSE_SUBAGENTS) return sanitized;
  if (!sanitized || typeof sanitized !== 'object') return sanitized;
  return { ...sanitized, subagents: [] };
};

patchProcessPath();
try {
  if (app && typeof app.setName === 'function') app.setName(APP_DISPLAY_NAME);
} catch {
  // ignore
}

function resolveAppIconPath() {
  const candidates = [
    path.join(projectRoot, 'apps', 'ui', 'dist', 'icon.png'),
    path.join(projectRoot, 'apps', 'ui', 'icon.png'),
    path.join(projectRoot, 'build_resources', 'icon.png'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function resolveBoolEnv(name, fallback = false) {
  const raw = typeof process.env[name] === 'string' ? process.env[name].trim().toLowerCase() : '';
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false;
  return fallback;
}

function readRuntimeLog({ lineCount, maxBytes } = {}) {
  const outputPath = resolveRuntimeLogPath({
    sessionRoot,
    hostApp,
    fallbackHostApp: 'chatos',
    preferSessionRoot: true,
  });
  if (!outputPath) {
    return { ok: false, message: 'runtime log path not available' };
  }
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (!fs.existsSync(outputPath)) {
      fs.writeFileSync(outputPath, '', 'utf8');
    }
  } catch {
    // ignore file bootstrap failures
  }
  const size = (() => {
    try {
      return fs.statSync(outputPath).size;
    } catch {
      return null;
    }
  })();
  const mtime = (() => {
    try {
      const stat = fs.statSync(outputPath);
      return stat?.mtime ? stat.mtime.toISOString() : null;
    } catch {
      return null;
    }
  })();
  const bytes = Number.isFinite(Number(maxBytes))
    ? Math.max(1024, Math.min(4 * 1024 * 1024, Math.floor(Number(maxBytes))))
    : 1024 * 1024;
  const lines = Number.isFinite(Number(lineCount))
    ? Math.max(1, Math.min(50_000, Math.floor(Number(lineCount))))
    : 500;
  const content = readLastLinesFromFile(outputPath, lines, bytes);
  return { ok: true, outputPath, size, mtime, lineCount: lines, maxBytes: bytes, content };
}


function patchProcessPath() {
  // GUI apps on macOS often do not inherit the user's shell PATH (e.g., Homebrew lives in /opt/homebrew/bin).
  // Ensure common binary locations are available for child_process exec/spawn.
  if (process.platform !== 'darwin') return;

  const current = typeof process.env.PATH === 'string' ? process.env.PATH : '';
  const parts = current.split(':').filter(Boolean);
  const prepend = [];

  const addDir = (dirPath) => {
    const normalized = typeof dirPath === 'string' ? dirPath.trim() : '';
    if (!normalized) return;
    if (prepend.includes(normalized)) return;
    if (parts.includes(normalized)) return;
    try {
      if (fs.existsSync(normalized)) {
        prepend.push(normalized);
      }
    } catch {
      // ignore
    }
  };

  const addLatestNvmNodeBin = (homeDir) => {
    if (!homeDir) return;
    const versionsDir = path.join(homeDir, '.nvm', 'versions', 'node');
    let entries = [];
    try {
      entries = fs.readdirSync(versionsDir, { withFileTypes: true });
    } catch {
      return;
    }
    const parseSemver = (dirName) => {
      const match = String(dirName || '')
        .trim()
        .match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
      if (!match) return null;
      return {
        major: Number(match[1] || 0),
        minor: Number(match[2] || 0),
        patch: Number(match[3] || 0),
        dir: dirName,
      };
    };
    const candidates = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => parseSemver(entry.name))
      .filter(Boolean)
      .sort((a, b) => {
        if (a.major !== b.major) return b.major - a.major;
        if (a.minor !== b.minor) return b.minor - a.minor;
        return b.patch - a.patch;
      });
    const best = candidates[0];
    if (!best?.dir) return;
    addDir(path.join(versionsDir, best.dir, 'bin'));
  };

  // Homebrew (Apple Silicon / Intel), MacPorts, plus common user bins.
  addDir('/opt/homebrew/bin');
  addDir('/opt/homebrew/sbin');
  addDir('/usr/local/bin');
  addDir('/usr/local/sbin');
  addDir('/opt/local/bin');
  addDir('/opt/local/sbin');

  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  if (home) {
    // Popular Node/Python toolchains and version managers (for MCP servers using npx/uvx/etc).
    addDir(path.join(home, '.volta', 'bin'));
    addDir(path.join(home, '.asdf', 'shims'));
    addDir(path.join(home, '.nodenv', 'shims'));
    addLatestNvmNodeBin(home);

    // Common language toolchain bins (for LSP installers).
    addDir(path.join(home, '.cargo', 'bin'));
    addDir(path.join(home, '.dotnet', 'tools'));
    addDir(path.join(home, 'go', 'bin'));

    addDir(path.join(home, '.local', 'bin'));
    addDir(path.join(home, 'bin'));
  }

  if (prepend.length === 0) return;
  process.env.PATH = [...prepend, ...parts].join(':');
}

function registerUiAppsPluginInstallerIpc() {
  ipcMain.handle('uiApps:plugins:install', async (_event, payload = {}) => {
    let selectedPath = typeof payload?.path === 'string' ? payload.path.trim() : '';
    if (!selectedPath) {
      if (!dialog || typeof dialog.showOpenDialog !== 'function') {
        return { ok: false, message: 'dialog not available' };
      }
      let result = null;
      if (process.platform === 'win32') {
        let mode = typeof payload?.mode === 'string' ? payload.mode.trim().toLowerCase() : '';
        if (!mode && dialog && typeof dialog.showMessageBox === 'function') {
          const selection = await dialog.showMessageBox(mainWindow || undefined, {
            type: 'question',
            title: '导入应用包',
            message: '请选择应用包类型',
            detail: 'Windows 的文件选择器在“目录/文件混选”模式下可能看不到 .zip。',
            buttons: ['选择 .zip', '选择目录', '取消'],
            defaultId: 0,
            cancelId: 2,
          });
          if (selection?.response === 2) {
            return { ok: false, canceled: true };
          }
          mode = selection?.response === 1 ? 'dir' : 'zip';
        }
        if (mode !== 'dir' && mode !== 'zip') {
          mode = 'zip';
        }
        result = await dialog.showOpenDialog(mainWindow || undefined, {
          title: mode === 'dir' ? '选择应用包目录' : '选择应用包（.zip）',
          properties: mode === 'dir' ? ['openDirectory'] : ['openFile'],
          ...(mode === 'zip' ? { filters: [{ name: 'App package', extensions: ['zip'] }] } : null),
        });
      } else {
        result = await dialog.showOpenDialog(mainWindow || undefined, {
          title: '选择应用包（目录或 .zip）',
          properties: ['openFile', 'openDirectory'],
          filters: [{ name: 'App package', extensions: ['zip'] }],
        });
      }
      if (result.canceled) {
        return { ok: false, canceled: true };
      }
      selectedPath = Array.isArray(result.filePaths) ? result.filePaths[0] : '';
      if (!selectedPath) {
        return { ok: false, canceled: true };
      }
    }

    try {
      return await installUiAppsPlugins({ inputPath: selectedPath, stateDir });
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  });
}

registerUiAppsPluginInstallerIpc();

const lspInstaller = createLspInstaller({ rootDir: projectRoot });
ipcMain.handle('lsp:catalog', async () => {
  try {
    return await lspInstaller.getCatalog();
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
});
ipcMain.handle('lsp:install', async (_event, payload = {}) => {
  try {
    const ids = Array.isArray(payload?.ids) ? payload.ids : [];
    const timeout_ms = payload?.timeout_ms;
    return await lspInstaller.install({ ids, timeout_ms });
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
});

const defaultPaths = {
  defaultsRoot: engineRoot,
  models: path.join(authDir, 'models.yaml'),
  systemPrompt: path.join(authDir, 'system-prompt.yaml'),
  systemDefaultPrompt: path.join(authDir, 'system-default-prompt.yaml'),
  systemUserPrompt: path.join(authDir, 'system-user-prompt.yaml'),
  subagentSystemPrompt: path.join(authDir, 'subagent-system-prompt.yaml'),
  subagentUserPrompt: path.join(authDir, 'subagent-user-prompt.yaml'),
  mcpConfig: path.join(authDir, 'mcp.config.json'),
  sessionReport: path.join(authDir, 'session-report.html'),
  events: path.join(stateDir, 'events.jsonl'),
  fileChanges: path.join(stateDir, 'file-changes.jsonl'),
  uiPrompts: path.join(stateDir, 'ui-prompts.jsonl'),
  runs: path.join(stateDir, 'runs.jsonl'),
  marketplace: path.join(engineRoot, 'subagents', 'marketplace.json'),
  marketplaceUser: path.join(stateDir, 'subagents', 'marketplace.json'),
  pluginsDir: path.join(engineRoot, 'subagents', 'plugins'),
  pluginsDirUser: path.join(stateDir, 'subagents', 'plugins'),
  installedSubagents: path.join(stateDir, 'subagents.json'),
  adminDb: path.join(stateDir, `${hostApp}.db.sqlite`),
};

const legacyAdminDb = path.join(stateDir, `${hostApp}.db.json`);
if (ENABLE_ALL_SUBAGENTS) {
  ensureAllSubagentsInstalled({
    installedSubagentsPath: defaultPaths.installedSubagents,
    pluginsDirList: [defaultPaths.pluginsDir, defaultPaths.pluginsDirUser],
    enableAllSubagents: ENABLE_ALL_SUBAGENTS,
  });
}
const adminDb = createDb({
  dbPath: defaultPaths.adminDb,
  seed: readLegacyState(legacyAdminDb) || buildAdminSeed(defaultPaths),
});
const adminServices = createAdminServices(adminDb);
const configManager = createConfigManager(adminDb, { adminServices });
const registryCenter = initRegistryCenter({ db: adminDb });
const adminDefaults = createAdminDefaultsManager({ defaultPaths, adminDb, adminServices });
adminDefaults.maybeReseedModelsFromYaml();
adminDefaults.maybeReseedSubagentsFromPlugins();
if (ENABLE_ALL_SUBAGENTS) {
  try {
    const current = adminServices.subagents.list() || [];
    current.forEach((record) => {
      if (!record?.id) return;
      if (record.enabled === false) {
        adminServices.subagents.update(record.id, { enabled: true });
      }
    });
  } catch {
    // ignore subagent enable failures
  }
}
adminDefaults.refreshModelsFromDefaults();
adminDefaults.refreshBuiltinsFromDefaults();
if (!UIAPPS_SYNC_AI_CONTRIBUTES) {
  maybePurgeUiAppsSyncedAdminData({ stateDir, adminServices, hostApp });
}

registerConfigIpcHandlers(ipcMain, configManager, { getWindow: () => mainWindow });

if (!app.isPackaged) {
  configManager.migrateLegacyConfig().catch((err) => {
    console.error('[config:migrate]', err?.message || err);
  });
}

syncAdminToFiles(adminServices.snapshot(), {
  modelsPath: defaultPaths.models,
  mcpConfigPath: defaultPaths.mcpConfig,
  subagentsPath: defaultPaths.installedSubagents,
  promptsPath: defaultPaths.systemPrompt,
  systemDefaultPromptPath: defaultPaths.systemDefaultPrompt,
  systemUserPromptPath: defaultPaths.systemUserPrompt,
  subagentPromptsPath: defaultPaths.subagentSystemPrompt,
  subagentUserPromptPath: defaultPaths.subagentUserPrompt,
  tasksPath: null,
});

const workspaceOps = createWorkspaceOps({
  maxViewFileBytes: MAX_VIEW_FILE_BYTES,
  maxListDirEntries: MAX_LIST_DIR_ENTRIES,
});

const subAgentManager = createSubAgentManager({
  baseDir: path.join(engineRoot, 'subagents'),
  stateDir,
});

sessionApi = createSessionApi({
  defaultPaths,
  adminDb,
  adminServices,
  mainWindowGetter: () => mainWindow,
  sessions: { killAllSessions: () => killAllSessions({ sessionRoot }) },
  uiFlags: UI_FLAGS,
});

const cliShim = createCliShim({ projectRoot: engineRoot, commandName: CLI_COMMAND_NAME });
const legacyCliShim =
  process.platform === 'win32' && CLI_COMMAND_NAME !== LEGACY_CLI_COMMAND_NAME
    ? createCliShim({ projectRoot: engineRoot, commandName: LEGACY_CLI_COMMAND_NAME })
    : null;

terminalManager = createTerminalManager({
  projectRoot: engineRoot,
  terminalsDir,
  sessionRoot,
  defaultPaths,
  adminServices,
  mainWindowGetter: () => mainWindow,
  uiTerminalModeEnv: UI_TERMINAL_MODE_ENV,
  uiTerminalStdio: UI_TERMINAL_STDIO,
});

registerAdminApi(ipcMain, adminServices, () => mainWindow, {
  exposeSubagents: UI_DEVELOPER_MODE || UI_EXPOSE_SUBAGENTS,
  uiFlags: UI_FLAGS,
  onChange: async () => {
    const snapshot = adminServices.snapshot();
    syncAdminToFiles(snapshot, {
      modelsPath: defaultPaths.models,
      mcpConfigPath: defaultPaths.mcpConfig,
      subagentsPath: defaultPaths.installedSubagents,
      promptsPath: defaultPaths.systemPrompt,
      systemDefaultPromptPath: defaultPaths.systemDefaultPrompt,
      systemUserPromptPath: defaultPaths.systemUserPrompt,
      subagentPromptsPath: defaultPaths.subagentSystemPrompt,
      subagentUserPromptPath: defaultPaths.subagentUserPrompt,
      tasksPath: defaultPaths.tasks,
    });
    if (mainWindow) {
      mainWindow.webContents.send('config:update', sessionApi.readConfigPayload());
    }
  },
});

const syncAdminAndBroadcast = async () => {
  const snapshot = adminServices.snapshot();
  syncAdminToFiles(snapshot, {
    modelsPath: defaultPaths.models,
    mcpConfigPath: defaultPaths.mcpConfig,
    subagentsPath: defaultPaths.installedSubagents,
    promptsPath: defaultPaths.systemPrompt,
    systemDefaultPromptPath: defaultPaths.systemDefaultPrompt,
    systemUserPromptPath: defaultPaths.systemUserPrompt,
    subagentPromptsPath: defaultPaths.subagentSystemPrompt,
    subagentUserPromptPath: defaultPaths.subagentUserPrompt,
    tasksPath: defaultPaths.tasks,
  });
  if (mainWindow) {
    mainWindow.webContents.send('config:update', sessionApi.readConfigPayload());
    mainWindow.webContents.send('admin:update', {
      data: sanitizeAdminForUi(snapshot),
      dbPath: adminServices.dbPath,
      uiFlags: UI_FLAGS,
    });
  }
};

const configApplier = new ConfigApplier({
  configManager,
  adminServices,
  onApplied: async () => {
    await syncAdminAndBroadcast();
  },
});
registerQuickSwitchHandlers(ipcMain, configApplier);

uiAppsManager = registerUiAppsApi(ipcMain, {
  projectRoot,
  stateDir,
  adminServices,
  onAdminMutation: syncAdminAndBroadcast,
  syncAiContributes: UIAPPS_SYNC_AI_CONTRIBUTES,
  builtinPluginsDir: BUILTIN_UI_APPS_DIR,
});
if (uiAppsManager && typeof uiAppsManager.listRegistry === 'function') {
  uiAppsManager.listRegistry().catch(() => {});
}
registerRegistryApi(ipcMain, { sessionRoot, knownApps: REGISTRY_KNOWN_APPS });

Promise.resolve()
  .then(async () => {
    try {
      syncRegistryFromServices({
        registry: registryCenter,
        providerAppId: hostApp,
        services: adminServices,
      });
    } catch {
      // ignore
    }

    const otherApps = REGISTRY_KNOWN_APPS.filter((appId) => appId !== hostApp);
    for (const appId of otherApps) {
      const { dbPath, dbExists } = resolveExistingAppDbPath({ sessionRoot, hostApp: appId });
      if (dbExists) {
        await syncRegistryFromAppDb({ registry: registryCenter, providerAppId: appId, dbPath });
        continue;
      }

    }
  })
  .catch(() => {});

chatApi = registerChatApi(ipcMain, {
  adminDb,
  adminServices,
  defaultPaths,
  sessionRoot,
  workspaceRoot: process.cwd(),
  subAgentManager,
  uiApps: uiAppsManager,
  mainWindowGetter: () => mainWindow,
});

ipcMain.handle('config:read', async () => {
  sessionApi.startTasksWatcher();
  return sessionApi.readConfigPayload();
});
ipcMain.handle('session:read', async () => {
  sessionApi.startSessionWatcher();
  return sessionApi.readSessionPayload();
});
ipcMain.handle('events:read', async () => {
  sessionApi.startEventsWatcher();
  return sessionApi.readEventsPayload();
});
ipcMain.handle('fileChanges:read', async () => {
  sessionApi.startFileChangesWatcher();
  return sessionApi.readFileChangesPayload();
});
ipcMain.handle('uiPrompts:read', async () => {
  sessionApi.startUiPromptsWatcher();
  return sessionApi.readUiPromptsPayload();
});
ipcMain.handle('runs:read', async () => {
  sessionApi.startRunsWatcher();
  return sessionApi.readRunsPayload();
});
ipcMain.handle('uiPrompts:request', async (_event, payload = {}) => {
  return sessionApi.requestUiPrompt(payload);
});
ipcMain.handle('uiPrompts:respond', async (_event, payload = {}) => {
  return sessionApi.respondUiPrompt(payload);
});

ipcMain.handle('dialog:selectDirectory', async (_event, payload = {}) => {
  const preferred = typeof payload?.defaultPath === 'string' ? payload.defaultPath.trim() : '';
  const fallback = process.env.HOME || process.env.USERPROFILE || os.homedir() || process.cwd();
  const defaultPath = preferred && fs.existsSync(preferred) ? preferred : fallback;
  try {
    if (!dialog || typeof dialog.showOpenDialog !== 'function') {
      return { ok: false, message: 'dialog not available' };
    }
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: '选择工作目录',
      defaultPath,
      properties: ['openDirectory'],
    });
    if (result.canceled) {
      return { ok: false, canceled: true };
    }
    const selected = Array.isArray(result.filePaths) ? result.filePaths[0] : '';
    if (!selected) {
      return { ok: false, canceled: true };
    }
    return { ok: true, path: selected };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
});

ipcMain.handle('file:read', async (_event, payload = {}) => workspaceOps.readWorkspaceFile(payload));
ipcMain.handle('dir:list', async (_event, payload = {}) => workspaceOps.listWorkspaceDirectory(payload));
ipcMain.handle('tasks:watch', async () => {
  sessionApi.startTasksWatcher();
  return { ok: true };
});
ipcMain.handle('session:clearCache', async () => sessionApi.clearAllCaches());

ipcMain.handle('cli:status', async () => {
  const status = cliShim.getCliCommandStatus();
  if (!legacyCliShim) return status;
  const legacy = legacyCliShim.getCliCommandStatus();
  return {
    ...status,
    legacyCommand: legacy.command,
    legacyInstalled: legacy.installed,
    legacyInstalledPath: legacy.installedPath,
  };
});
ipcMain.handle('cli:install', async (_event, payload = {}) => {
  const force = payload?.force === true;
  const result = cliShim.installCliCommand({ force });
  if (!legacyCliShim) return result;
  const legacy = legacyCliShim.getCliCommandStatus();
  const shouldRemoveLegacy = result?.ok === true || result?.reason === 'exists';
  if (!shouldRemoveLegacy) {
    return {
      ...result,
      legacyCommand: legacy.command,
      legacyInstalled: legacy.installed,
      legacyInstalledPath: legacy.installedPath,
    };
  }
  const legacyRemoved = legacyCliShim.uninstallCliCommand();
  return {
    ...result,
    legacyCommand: legacyRemoved.command,
    legacyInstalled: legacyRemoved.installed,
    legacyInstalledPath: legacyRemoved.installedPath,
    legacyRemovedPath: legacyRemoved.removedPath,
  };
});
ipcMain.handle('cli:uninstall', async () => {
  const result = cliShim.uninstallCliCommand();
  if (!legacyCliShim) return result;
  const legacyRemoved = legacyCliShim.uninstallCliCommand();
  return {
    ...result,
    legacyCommand: legacyRemoved.command,
    legacyInstalled: legacyRemoved.installed,
    legacyInstalledPath: legacyRemoved.installedPath,
    legacyRemovedPath: legacyRemoved.removedPath,
  };
});

ipcMain.handle('subagents:setModel', async (_event, payload = {}) => {
  const result = adminDefaults.setSubagentModels(payload);
  adminDefaults.maybeReseedSubagentsFromPlugins();
  syncAdminToFiles(adminServices.snapshot(), {
    modelsPath: defaultPaths.models,
    mcpConfigPath: defaultPaths.mcpConfig,
    subagentsPath: defaultPaths.installedSubagents,
    promptsPath: defaultPaths.systemPrompt,
    systemDefaultPromptPath: defaultPaths.systemDefaultPrompt,
    systemUserPromptPath: defaultPaths.systemUserPrompt,
    subagentPromptsPath: defaultPaths.subagentSystemPrompt,
    subagentUserPromptPath: defaultPaths.subagentUserPrompt,
    tasksPath: null,
  });
  if (mainWindow) {
    mainWindow.webContents.send('admin:update', {
      data: sanitizeAdminForUi(adminServices.snapshot()),
      dbPath: adminServices.dbPath,
      uiFlags: UI_FLAGS,
    });
    mainWindow.webContents.send('config:update', sessionApi.readConfigPayload());
  }
  return result;
});
ipcMain.handle('subagents:marketplace:list', async () => {
  try {
    return {
      ok: true,
      marketplace: subAgentManager.listMarketplace(),
      sources: UI_DEVELOPER_MODE || UI_EXPOSE_SUBAGENTS ? subAgentManager.listMarketplaceSources() : [],
    };
  } catch (err) {
    return { ok: false, message: err?.message || String(err), marketplace: [], sources: [] };
  }
});
ipcMain.handle('subagents:marketplace:addSource', async (_event, payload = {}) => {
  if (!UI_DEVELOPER_MODE && !UI_EXPOSE_SUBAGENTS) {
    return { ok: false, message: 'Sub-agents 管理未开启（需要开发者模式或开启 Sub-agents 暴露开关）。' };
  }
  const source = typeof payload?.source === 'string' ? payload.source.trim() : '';
  if (!source) {
    return { ok: false, message: 'source is required' };
  }
  try {
    const result = subAgentManager.addMarketplaceSource(source);
    if (mainWindow) {
      mainWindow.webContents.send('config:update', sessionApi.readConfigPayload());
    }
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
});
ipcMain.handle('subagents:plugins:install', async (_event, payload = {}) => {
  if (!UI_DEVELOPER_MODE && !UI_EXPOSE_SUBAGENTS) {
    return { ok: false, message: 'Sub-agents 管理未开启（需要开发者模式或开启 Sub-agents 暴露开关）。' };
  }
  const pluginId = typeof payload?.id === 'string' ? payload.id.trim() : typeof payload?.pluginId === 'string' ? payload.pluginId.trim() : '';
  if (!pluginId) {
    return { ok: false, message: 'pluginId is required' };
  }
  try {
    const changed = subAgentManager.install(pluginId);
    adminDefaults.maybeReseedSubagentsFromPlugins();
    syncAdminToFiles(adminServices.snapshot(), {
      modelsPath: defaultPaths.models,
      mcpConfigPath: defaultPaths.mcpConfig,
      subagentsPath: defaultPaths.installedSubagents,
      promptsPath: defaultPaths.systemPrompt,
      systemDefaultPromptPath: defaultPaths.systemDefaultPrompt,
      systemUserPromptPath: defaultPaths.systemUserPrompt,
      subagentPromptsPath: defaultPaths.subagentSystemPrompt,
      subagentUserPromptPath: defaultPaths.subagentUserPrompt,
      tasksPath: null,
    });
    if (mainWindow) {
      mainWindow.webContents.send('admin:update', {
        data: sanitizeAdminForUi(adminServices.snapshot()),
        dbPath: adminServices.dbPath,
        uiFlags: UI_FLAGS,
      });
      mainWindow.webContents.send('config:update', sessionApi.readConfigPayload());
    }
    return { ok: true, changed };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
});
ipcMain.handle('subagents:plugins:uninstall', async (_event, payload = {}) => {
  if (!UI_DEVELOPER_MODE && !UI_EXPOSE_SUBAGENTS) {
    return { ok: false, message: 'Sub-agents 管理未开启（需要开发者模式或开启 Sub-agents 暴露开关）。' };
  }
  const pluginId = typeof payload?.id === 'string' ? payload.id.trim() : typeof payload?.pluginId === 'string' ? payload.pluginId.trim() : '';
  if (!pluginId) {
    return { ok: false, message: 'pluginId is required' };
  }
  try {
    const removed = subAgentManager.uninstall(pluginId);
    adminDefaults.maybeReseedSubagentsFromPlugins();
    syncAdminToFiles(adminServices.snapshot(), {
      modelsPath: defaultPaths.models,
      mcpConfigPath: defaultPaths.mcpConfig,
      subagentsPath: defaultPaths.installedSubagents,
      promptsPath: defaultPaths.systemPrompt,
      systemDefaultPromptPath: defaultPaths.systemDefaultPrompt,
      systemUserPromptPath: defaultPaths.systemUserPrompt,
      subagentPromptsPath: defaultPaths.subagentSystemPrompt,
      subagentUserPromptPath: defaultPaths.subagentUserPrompt,
      tasksPath: null,
    });
    if (mainWindow) {
      mainWindow.webContents.send('admin:update', {
        data: sanitizeAdminForUi(adminServices.snapshot()),
        dbPath: adminServices.dbPath,
        uiFlags: UI_FLAGS,
      });
      mainWindow.webContents.send('config:update', sessionApi.readConfigPayload());
    }
    return { ok: true, removed };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
});
ipcMain.handle('sessions:list', async () => listSessions({ sessionRoot }));
ipcMain.handle('sessions:kill', async (_event, payload = {}) => killSession({ sessionRoot, name: payload?.name }));
ipcMain.handle('sessions:killAll', async () => killAllSessions({ sessionRoot }));
ipcMain.handle('sessions:restart', async (_event, payload = {}) => restartSession({ sessionRoot, name: payload?.name }));
ipcMain.handle('sessions:stop', async (_event, payload = {}) => stopSession({ sessionRoot, name: payload?.name }));
ipcMain.handle('sessions:readLog', async (_event, payload = {}) =>
  readSessionLog({
    sessionRoot,
    name: payload?.name,
    lineCount: payload?.lineCount,
    maxBytes: payload?.maxBytes,
  })
);
ipcMain.handle('runtimeLog:read', async (_event, payload = {}) =>
  readRuntimeLog({
    lineCount: payload?.lineCount,
    maxBytes: payload?.maxBytes,
  })
);

ipcMain.handle('terminalStatus:list', async () => terminalManager.listStatusesWithWatcher());
ipcMain.handle('terminal:dispatch', async (_event, payload = {}) => terminalManager.dispatchMessage(payload));
ipcMain.handle('terminal:action', async (_event, payload = {}) => terminalManager.sendAction(payload));
ipcMain.handle('terminal:intervene', async (_event, payload = {}) => terminalManager.intervene(payload));
ipcMain.handle('terminal:stop', async (_event, payload = {}) => terminalManager.stopRun(payload));
ipcMain.handle('terminal:terminate', async (_event, payload = {}) => terminalManager.terminateRun(payload));
ipcMain.handle('terminal:close', async (_event, payload = {}) => terminalManager.closeRun(payload));

app.whenReady().then(() => {
  if (process.platform === 'darwin' && appIconPath) {
    try {
      const dockIcon = nativeImage.createFromPath(appIconPath);
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon);
      }
    } catch {
      // ignore
    }
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  terminalManager?.cleanupLaunchedCli?.();
});

function createWindow() {
  const options = {
    width: 1280,
    height: 860,
    title: APP_DISPLAY_NAME,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: UI_WEB_SECURITY,
    },
  };
  if (appIconPath) {
    options.icon = appIconPath;
  }
  mainWindow = new BrowserWindow(options);
  try {
    mainWindow.setTitle(APP_DISPLAY_NAME);
  } catch {
    // ignore
  }
  const htmlPath = path.join(__dirname, '..', 'apps', 'ui', 'dist', 'index.html');
  mainWindow.loadFile(htmlPath);
  mainWindow.on('closed', () => {
    mainWindow = null;
    sessionApi?.dispose?.();
    terminalManager?.dispose?.();
    chatApi?.dispose?.();
  });
}
