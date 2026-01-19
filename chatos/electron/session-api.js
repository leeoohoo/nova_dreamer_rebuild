import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createDb } from '../packages/aide/shared/data/storage.js';
import { syncAdminToFiles } from '../packages/aide/shared/data/sync.js';
import {
  parseEvents,
  parseInstalledPlugins,
  parseJsonSafe,
  parseMcpServers,
  parseModels,
  parsePrompts,
  safeRead,
} from '../packages/aide/shared/data/legacy.js';
import {
  ensureDir,
  ensureFileExists,
  parseJsonLines,
  readTasksFromDbFile,
  readFileFingerprint,
  resolveUiFlags,
  sanitizeAdminSnapshotForUi as sanitizeAdminSnapshotForUiHelper,
} from './session-api-helpers.js';

export function createSessionApi({ defaultPaths, adminDb, adminServices, mainWindowGetter, sessions, uiFlags } = {}) {
  if (!defaultPaths) {
    throw new Error('defaultPaths is required');
  }
  if (!adminDb) {
    throw new Error('adminDb is required');
  }
  if (!adminServices) {
    throw new Error('adminServices is required');
  }
  const getMainWindow = typeof mainWindowGetter === 'function' ? mainWindowGetter : () => null;

  let sessionWatcher = null;
  let eventsWatcher = null;
  let tasksWatcher = null;
  let fileChangesWatcher = null;
  let uiPromptsWatcher = null;
  let runsWatcher = null;
  let tasksWatcherDebounce = null;
  let tasksWatcherRestart = null;
  let tasksPoller = null;
  let lastAdminDbFingerprint = null;
  const { uiFlags: resolvedUiFlags, exposeSubagents } = resolveUiFlags(uiFlags);

  const sanitizeAdminSnapshotForUi = (snapshot) => sanitizeAdminSnapshotForUiHelper(snapshot, { exposeSubagents });

  function readConfigPayload() {
    const snapshot = adminServices.snapshot();
    const modelsList = snapshot.models || parseModels(safeRead(defaultPaths.models));
    const systemPromptMainInternal = safeRead(defaultPaths.systemPrompt);
    const systemDefaultPrompt = safeRead(defaultPaths.systemDefaultPrompt);
    const systemUserPrompt = safeRead(defaultPaths.systemUserPrompt);
    const subagentSystemPromptInternal = safeRead(defaultPaths.subagentSystemPrompt);
    const subagentUserPrompt = safeRead(defaultPaths.subagentUserPrompt);
    const promptsMainInternal = parsePrompts(systemPromptMainInternal);
    const promptsDefault = parsePrompts(systemDefaultPrompt);
    const promptsUser = parsePrompts(systemUserPrompt);
    const promptsSubInternal = parsePrompts(subagentSystemPromptInternal);
    const promptsSubUser = parsePrompts(subagentUserPrompt);
    const prompts = {
      internal_main: promptsMainInternal.internal_main || '',
      default:
        systemDefaultPrompt && systemDefaultPrompt.trim()
          ? promptsDefault.default || ''
          : promptsMainInternal.default || '',
      user_prompt:
        systemUserPrompt && systemUserPrompt.trim()
          ? promptsUser.user_prompt || ''
          : promptsMainInternal.user_prompt || '',
      internal_subagent:
        subagentSystemPromptInternal && subagentSystemPromptInternal.trim()
          ? promptsSubInternal.internal_subagent || ''
          : promptsMainInternal.internal_subagent || '',
      subagent_user_prompt:
        subagentUserPrompt && subagentUserPrompt.trim()
          ? promptsSubUser.subagent_user_prompt || ''
          : promptsSubInternal.subagent_user_prompt ||
            promptsMainInternal.subagent_user_prompt ||
            '',
    };
    const mcpServers = snapshot.mcpServers || parseMcpServers(safeRead(defaultPaths.mcpConfig));
    const marketplacePaths = [defaultPaths.marketplace, defaultPaths.marketplaceUser].filter(Boolean);
    const marketplace = exposeSubagents
      ? (() => {
          const merged = new Map();
          marketplacePaths.forEach((mp) => {
            const list = parseJsonSafe(safeRead(mp), []);
            if (!Array.isArray(list)) return;
            list.forEach((entry) => {
              if (entry?.id) {
                merged.set(entry.id, entry);
              }
            });
          });
          return Array.from(merged.values());
        })()
      : [];
    const defaultSubagentsList = exposeSubagents
      ? parseJsonSafe(
          safeRead(path.join(path.resolve(defaultPaths.defaultsRoot || ''), 'shared', 'defaults', 'subagents.json')),
          {}
        )?.plugins || []
      : [];
    const installedPlugins = exposeSubagents
      ? parseInstalledPlugins(safeRead(defaultPaths.installedSubagents), {
          pluginsDir: [defaultPaths.pluginsDirUser, defaultPaths.pluginsDir].filter(Boolean),
          marketplacePath: marketplacePaths,
          defaultList: Array.isArray(defaultSubagentsList) ? defaultSubagentsList : [],
        })
      : [];
    const tasksList = readTasksFromDbFile(defaultPaths.adminDb);
    const eventsList = parseEvents(safeRead(defaultPaths.events));
    const adminState = sanitizeAdminSnapshotForUi(snapshot);
    const runtimeSettings = Array.isArray(snapshot.settings) ? snapshot.settings : [];
    const tasksJson = JSON.stringify({ tasks: tasksList || [] }, null, 2);
    const eventsContent = eventsList.map((e) => JSON.stringify(e)).join('\n');
    return {
      modelsPath: defaultPaths.models,
      models: safeRead(defaultPaths.models),
      modelsList,
      systemPromptPath: defaultPaths.systemPrompt,
      systemPrompt: systemPromptMainInternal,
      systemDefaultPromptPath: defaultPaths.systemDefaultPrompt,
      systemDefaultPrompt,
      systemUserPromptPath: defaultPaths.systemUserPrompt,
      systemUserPrompt,
      subagentSystemPromptPath: defaultPaths.subagentSystemPrompt,
      subagentSystemPrompt: subagentSystemPromptInternal,
      subagentUserPromptPath: defaultPaths.subagentUserPrompt,
      subagentUserPrompt,
      prompts,
      mcpConfigPath: defaultPaths.mcpConfig,
      mcpConfig: safeRead(defaultPaths.mcpConfig),
      mcpServers,
      marketplace,
      installedPlugins,
      sessionReportPath: defaultPaths.sessionReport,
      tasksPath: defaultPaths.tasks,
      tasks: tasksJson,
      tasksList,
      eventsPath: defaultPaths.events,
      eventsList,
      eventsContent,
      fileChangesPath: defaultPaths.fileChanges,
      adminDbPath: defaultPaths.adminDb,
      adminState,
      uiFlags: resolvedUiFlags,
      runtimeSettings,
    };
  }

  function readSessionPayload() {
    return {
      path: defaultPaths.sessionReport,
      html: safeRead(defaultPaths.sessionReport),
    };
  }

  function readEventsPayload() {
    const eventsList = parseEvents(safeRead(defaultPaths.events));
    return {
      path: defaultPaths.events,
      content: eventsList.map((e) => JSON.stringify(e)).join('\n'),
      eventsList,
    };
  }

  function readFileChangesPayload() {
    const entries = parseJsonLines(safeRead(defaultPaths.fileChanges));
    return {
      path: defaultPaths.fileChanges,
      entries,
    };
  }

  function readUiPromptsPayload() {
    const entries = parseJsonLines(safeRead(defaultPaths.uiPrompts));
    return {
      path: defaultPaths.uiPrompts,
      entries,
    };
  }

  function readRunsPayload() {
    const entries = parseJsonLines(safeRead(defaultPaths.runs));
    return {
      path: defaultPaths.runs,
      entries,
    };
  }

  function startSessionWatcher() {
    if (sessionWatcher) return;
    ensureFileExists(defaultPaths.sessionReport);
    sessionWatcher = fs.watch(defaultPaths.sessionReport, { persistent: false }, () => {
      const win = getMainWindow();
      if (win) {
        win.webContents.send('session:update', readSessionPayload());
      }
    });
  }

  function startEventsWatcher() {
    if (eventsWatcher) return;
    ensureFileExists(defaultPaths.events);
    eventsWatcher = fs.watch(defaultPaths.events, { persistent: false }, () => {
      const win = getMainWindow();
      if (win) {
        win.webContents.send('events:update', readEventsPayload());
      }
    });
  }

  function startFileChangesWatcher() {
    if (fileChangesWatcher) return;
    ensureFileExists(defaultPaths.fileChanges);
    fileChangesWatcher = fs.watch(defaultPaths.fileChanges, { persistent: false }, () => {
      const win = getMainWindow();
      if (win) {
        win.webContents.send('fileChanges:update', readFileChangesPayload());
      }
    });
  }

  function startUiPromptsWatcher() {
    if (uiPromptsWatcher) return;
    ensureFileExists(defaultPaths.uiPrompts);
    uiPromptsWatcher = fs.watch(defaultPaths.uiPrompts, { persistent: false }, () => {
      const win = getMainWindow();
      if (win) {
        win.webContents.send('uiPrompts:update', readUiPromptsPayload());
      }
    });
  }

  function startRunsWatcher() {
    if (runsWatcher) return;
    ensureFileExists(defaultPaths.runs);
    runsWatcher = fs.watch(defaultPaths.runs, { persistent: false }, () => {
      const win = getMainWindow();
      if (win) {
        win.webContents.send('runs:update', readRunsPayload());
      }
    });
  }

  function startTasksWatcher() {
    if (tasksWatcher || tasksPoller) return;

    const emitConfigUpdate = () => {
      const fingerprint = readFileFingerprint(defaultPaths.adminDb);
      if (fingerprint && fingerprint === lastAdminDbFingerprint) {
        return;
      }
      lastAdminDbFingerprint = fingerprint;
      const win = getMainWindow();
      if (win) {
        win.webContents.send('config:update', readConfigPayload());
      }
    };

    const scheduleRefresh = () => {
      if (tasksWatcherDebounce) clearTimeout(tasksWatcherDebounce);
      tasksWatcherDebounce = setTimeout(() => {
        tasksWatcherDebounce = null;
        emitConfigUpdate();
      }, 50);
    };

    const startTasksPoller = (pollMs = 750) => {
      if (tasksPoller) return;
      // We may be falling back after missing fs events; force a refresh once so UI catches up.
      lastAdminDbFingerprint = null;
      emitConfigUpdate();
      tasksPoller = setInterval(() => emitConfigUpdate(), pollMs);
      if (tasksPoller && typeof tasksPoller.unref === 'function') {
        tasksPoller.unref();
      }
    };

    const restartWatch = (delayMs = 25) => {
      if (tasksWatcherRestart) return;
      try {
        tasksWatcher?.close?.();
      } catch {
        // ignore
      }
      tasksWatcher = null;
      tasksWatcherRestart = setTimeout(() => {
        tasksWatcherRestart = null;
        startTasksWatcher();
      }, delayMs);
    };

    const adminDbDir = path.dirname(defaultPaths.adminDb);
    const adminDbBase = path.basename(defaultPaths.adminDb);

    const sqliteSidecars = new Set([
      `${adminDbBase}-wal`,
      `${adminDbBase}-shm`,
      `${adminDbBase}-journal`,
    ]);

    const shouldRefreshForFilename = (filename) => {
      if (!filename) return true;
      const normalized = Buffer.isBuffer(filename) ? filename.toString('utf8') : String(filename || '');
      if (!normalized) return true;
      if (normalized === adminDbBase) return true;
      if (sqliteSidecars.has(normalized)) return true;
      // SQL.js persists via atomic rename; watch for temp artifacts too.
      if (normalized.startsWith(`.${adminDbBase}.`)) return true;
      return false;
    };

    ensureDir(adminDbDir);
    ensureFileExists(defaultPaths.adminDb);
    try {
      // Watch the directory (not the file). SQL.js uses atomic rename, SQLite writes WAL/SHM sidecars,
      // and a file watcher can break across rename on some platforms.
      tasksWatcher = fs.watch(adminDbDir, { persistent: false }, (_eventType, filename) => {
        if (!shouldRefreshForFilename(filename)) return;
        scheduleRefresh();
      });
      if (tasksWatcher && tasksWatcher.on) {
        tasksWatcher.on('error', (err) => {
          const code = err?.code;
          if (code === 'EMFILE' || code === 'ENOSPC') {
            try {
              tasksWatcher?.close?.();
            } catch {
              // ignore
            }
            tasksWatcher = null;
            startTasksPoller();
            return;
          }
          restartWatch(250);
        });
      }
    } catch {
      startTasksPoller();
    }
  }

  async function clearAllCaches() {
    const summary = {
      tasksCleared: 0,
      eventsCleared: 0,
      fileChangesCleared: 0,
      uiPromptsCleared: 0,
      runsCleared: 0,
      filesCleared: [],
      sessionsKilled: 0,
      sessionsErrors: [],
    };

    try {
      const existingTasks = adminServices.tasks.list();
      adminDb.reset('tasks', []);
      summary.tasksCleared = existingTasks.length;
    } catch (err) {
      summary.tasksError = err?.message || String(err);
    }

    try {
      const existingEvents = adminServices.events.list();
      adminDb.reset('events', []);
      ensureDir(path.dirname(defaultPaths.events));
      fs.writeFileSync(defaultPaths.events, '', 'utf8');
      summary.eventsCleared = existingEvents.length;
      summary.filesCleared.push(defaultPaths.events);
    } catch (err) {
      summary.eventsError = err?.message || String(err);
    }

    try {
      ensureDir(path.dirname(defaultPaths.fileChanges));
      fs.writeFileSync(defaultPaths.fileChanges, '', 'utf8');
      summary.fileChangesCleared = 1;
      summary.filesCleared.push(defaultPaths.fileChanges);
    } catch (err) {
      summary.fileChangesError = err?.message || String(err);
    }

    try {
      ensureDir(path.dirname(defaultPaths.uiPrompts));
      fs.writeFileSync(defaultPaths.uiPrompts, '', 'utf8');
      summary.uiPromptsCleared = 1;
      summary.filesCleared.push(defaultPaths.uiPrompts);
    } catch (err) {
      summary.uiPromptsError = err?.message || String(err);
    }

    try {
      ensureDir(path.dirname(defaultPaths.runs));
      fs.writeFileSync(defaultPaths.runs, '', 'utf8');
      summary.runsCleared = 1;
      summary.filesCleared.push(defaultPaths.runs);
    } catch (err) {
      summary.runsError = err?.message || String(err);
    }

    try {
      ensureDir(path.dirname(defaultPaths.sessionReport));
      fs.writeFileSync(defaultPaths.sessionReport, '', 'utf8');
      summary.filesCleared.push(defaultPaths.sessionReport);
    } catch (err) {
      summary.sessionError = err?.message || String(err);
    }

    try {
      const killAllSessions = sessions?.killAllSessions;
      if (typeof killAllSessions === 'function') {
        const sessSummary = await killAllSessions();
        summary.sessionsKilled = Array.isArray(sessSummary.killed) ? sessSummary.killed.length : 0;
        if (!sessSummary.ok) {
          summary.sessionsError =
            sessSummary.reason || (Array.isArray(sessSummary.errors) ? sessSummary.errors.join('; ') : 'unknown');
        }
        if (Array.isArray(sessSummary.errors) && sessSummary.errors.length > 0) {
          summary.sessionsErrors.push(...sessSummary.errors);
        }
      } else {
        summary.sessionsError = 'session helper not available';
      }
    } catch (err) {
      summary.sessionsError = err?.message || String(err);
    }

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

    const win = getMainWindow();
    if (win) {
      win.webContents.send('config:update', readConfigPayload());
      win.webContents.send('admin:update', { data: sanitizeAdminSnapshotForUi(snapshot), dbPath: adminServices.dbPath });
      win.webContents.send('session:update', readSessionPayload());
      win.webContents.send('events:update', readEventsPayload());
      win.webContents.send('fileChanges:update', readFileChangesPayload());
      win.webContents.send('uiPrompts:update', readUiPromptsPayload());
      win.webContents.send('runs:update', readRunsPayload());
    }

    const errors = ['tasksError', 'eventsError', 'sessionError', 'fileChangesError', 'uiPromptsError', 'runsError'].filter(
      (key) => summary[key]
    );
    return { ok: errors.length === 0, ...summary };
  }

  function requestUiPrompt(payload = {}) {
    const rawPrompt = payload?.prompt && typeof payload.prompt === 'object' ? payload.prompt : null;
    if (!rawPrompt) {
      return { ok: false, message: 'prompt is required' };
    }

    const requestIdRaw = typeof payload?.requestId === 'string' ? payload.requestId.trim() : '';
    const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    const requestId =
      requestIdRaw ||
      (typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `req_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`);

    const safeTrim = (value) => (typeof value === 'string' ? value.trim() : '');
    const kind = safeTrim(rawPrompt?.kind);
    if (!kind) {
      return { ok: false, message: 'prompt.kind is required' };
    }

    const title = typeof rawPrompt?.title === 'string' ? rawPrompt.title : '';
    const message = typeof rawPrompt?.message === 'string' ? rawPrompt.message : '';
    const source = typeof rawPrompt?.source === 'string' ? rawPrompt.source : '';
    const allowCancel = rawPrompt?.allowCancel !== false;

    const normalizeStringList = (value) =>
      (Array.isArray(value) ? value : [])
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);

    const normalizeKvFields = (fields) => {
      const list = Array.isArray(fields) ? fields : [];
      if (list.length === 0) {
        return { ok: false, message: 'prompt.fields is required for kind=kv' };
      }
      if (list.length > 50) {
        return { ok: false, message: 'prompt.fields must be <= 50' };
      }
      const seen = new Set();
      const out = [];
      for (const field of list) {
        const key = safeTrim(field?.key);
        if (!key) return { ok: false, message: 'prompt.fields[].key is required' };
        if (seen.has(key)) return { ok: false, message: `duplicate field key: ${key}` };
        seen.add(key);
        out.push({
          key,
          label: safeTrim(field?.label),
          description: safeTrim(field?.description),
          placeholder: safeTrim(field?.placeholder),
          default: typeof field?.default === 'string' ? field.default : '',
          required: field?.required === true,
          multiline: field?.multiline === true,
          secret: field?.secret === true,
        });
      }
      return { ok: true, fields: out };
    };

    const normalizeChoiceOptions = (options) => {
      const list = Array.isArray(options) ? options : [];
      if (list.length === 0) {
        return { ok: false, message: 'prompt.options is required for kind=choice' };
      }
      if (list.length > 60) {
        return { ok: false, message: 'prompt.options must be <= 60' };
      }
      const seen = new Set();
      const out = [];
      for (const opt of list) {
        const value = safeTrim(opt?.value);
        if (!value) return { ok: false, message: 'prompt.options[].value is required' };
        if (seen.has(value)) return { ok: false, message: `duplicate option value: ${value}` };
        seen.add(value);
        out.push({
          value,
          label: safeTrim(opt?.label),
          description: safeTrim(opt?.description),
        });
      }
      return { ok: true, options: out };
    };

    const normalizeChoiceLimits = ({ multiple, minSelections, maxSelections, optionCount }) => {
      if (!multiple) {
        return { ok: true, minSelections: 0, maxSelections: optionCount };
      }
      const min = Number.isFinite(Number(minSelections)) ? Number(minSelections) : 0;
      const max = Number.isFinite(Number(maxSelections)) ? Number(maxSelections) : optionCount;
      if (!Number.isInteger(min) || min < 0 || min > optionCount) {
        return { ok: false, message: `prompt.minSelections must be an int between 0 and ${optionCount}` };
      }
      if (!Number.isInteger(max) || max < 1 || max > optionCount) {
        return { ok: false, message: `prompt.maxSelections must be an int between 1 and ${optionCount}` };
      }
      if (min > max) {
        return { ok: false, message: 'prompt.minSelections must be <= prompt.maxSelections' };
      }
      return { ok: true, minSelections: min, maxSelections: max };
    };

    const normalizeTaskConfirmTasks = (tasks) => {
      const list = Array.isArray(tasks) ? tasks : [];
      const allowedPriority = new Set(['high', 'medium', 'low']);
      const allowedStatus = new Set(['todo', 'doing', 'blocked', 'done']);
      return list
        .filter((item) => item && typeof item === 'object')
        .map((task) => {
          const priorityRaw = safeTrim(task?.priority);
          const statusRaw = safeTrim(task?.status);
          const draftId =
            safeTrim(task?.draftId) ||
            (typeof crypto?.randomUUID === 'function'
              ? crypto.randomUUID()
              : `draft_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`);
          return {
            draftId,
            title: typeof task?.title === 'string' ? task.title : '',
            details: typeof task?.details === 'string' ? task.details : '',
            priority: allowedPriority.has(priorityRaw) ? priorityRaw : 'medium',
            status: allowedStatus.has(statusRaw) ? statusRaw : 'todo',
            tags: normalizeStringList(task?.tags),
          };
        });
    };

    const promptBase = {
      kind,
      title,
      message,
      allowCancel,
      ...(source && source.trim() ? { source } : {}),
    };

    let prompt = null;
    if (kind === 'kv') {
      const normalized = normalizeKvFields(rawPrompt?.fields);
      if (!normalized.ok) return normalized;
      prompt = {
        ...promptBase,
        kind: 'kv',
        fields: normalized.fields,
      };
    } else if (kind === 'choice') {
      const multiple = rawPrompt?.multiple === true;
      const normalizedOptions = normalizeChoiceOptions(rawPrompt?.options);
      if (!normalizedOptions.ok) return normalizedOptions;
      const optionValues = new Set(normalizedOptions.options.map((o) => o.value));
      const defaultSelection = (() => {
        if (multiple) {
          const raw = rawPrompt?.default;
          const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
          return Array.from(
            new Set(list.map((v) => safeTrim(v)).filter((v) => v && optionValues.has(v)))
          );
        }
        const raw = typeof rawPrompt?.default === 'string' ? rawPrompt.default : '';
        const selected = safeTrim(raw);
        return selected && optionValues.has(selected) ? selected : '';
      })();
      const normalizedLimits = normalizeChoiceLimits({
        multiple,
        minSelections: rawPrompt?.minSelections,
        maxSelections: rawPrompt?.maxSelections,
        optionCount: normalizedOptions.options.length,
      });
      if (!normalizedLimits.ok) return normalizedLimits;
      prompt = {
        ...promptBase,
        kind: 'choice',
        multiple,
        options: normalizedOptions.options,
        default: defaultSelection,
        minSelections: normalizedLimits.minSelections,
        maxSelections: normalizedLimits.maxSelections,
      };
    } else if (kind === 'task_confirm') {
      const tasks = normalizeTaskConfirmTasks(rawPrompt?.tasks);
      const defaultRemark = typeof rawPrompt?.defaultRemark === 'string' ? rawPrompt.defaultRemark : '';
      prompt = {
        ...promptBase,
        kind: 'task_confirm',
        tasks,
        ...(defaultRemark && defaultRemark.trim() ? { defaultRemark } : {}),
      };
    } else if (kind === 'file_change_confirm') {
      const diff = typeof rawPrompt?.diff === 'string' ? rawPrompt.diff : '';
      const filePath = typeof rawPrompt?.path === 'string' ? rawPrompt.path : '';
      const command = typeof rawPrompt?.command === 'string' ? rawPrompt.command : '';
      const cwd = typeof rawPrompt?.cwd === 'string' ? rawPrompt.cwd : '';
      const defaultRemark = typeof rawPrompt?.defaultRemark === 'string' ? rawPrompt.defaultRemark : '';
      prompt = {
        ...promptBase,
        kind: 'file_change_confirm',
        diff,
        path: filePath,
        command,
        cwd,
        ...(defaultRemark && defaultRemark.trim() ? { defaultRemark } : {}),
      };
    } else {
      return { ok: false, message: `Unsupported prompt.kind: ${kind}` };
    }

    const entry = {
      ts: new Date().toISOString(),
      type: 'ui_prompt',
      action: 'request',
      requestId,
      ...(runId ? { runId } : {}),
      prompt,
    };

    try {
      ensureFileExists(defaultPaths.uiPrompts);
      fs.appendFileSync(defaultPaths.uiPrompts, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }

    startUiPromptsWatcher();
    const win = getMainWindow();
    if (win) {
      win.webContents.send('uiPrompts:update', readUiPromptsPayload());
    }

    return { ok: true, requestId };
  }

  function respondUiPrompt(payload = {}) {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId.trim() : '';
    if (!requestId) {
      return { ok: false, message: 'requestId is required' };
    }
    const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    const response = payload?.response && typeof payload.response === 'object' ? payload.response : null;
    if (!response) {
      return { ok: false, message: 'response is required' };
    }
    const status = typeof response?.status === 'string' ? response.status.trim() : '';
    if (!status) {
      return { ok: false, message: 'response.status is required' };
    }

    const entry = {
      ts: new Date().toISOString(),
      type: 'ui_prompt',
      action: 'response',
      requestId,
      ...(runId ? { runId } : {}),
      response,
    };
    try {
      ensureFileExists(defaultPaths.uiPrompts);
      fs.appendFileSync(defaultPaths.uiPrompts, `${JSON.stringify(entry)}\n`, 'utf8');
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  }

  function dispose() {
    try {
      sessionWatcher?.close?.();
    } catch {
      // ignore
    }
    sessionWatcher = null;

    try {
      eventsWatcher?.close?.();
    } catch {
      // ignore
    }
    eventsWatcher = null;

    try {
      tasksWatcher?.close?.();
    } catch {
      // ignore
    }
    tasksWatcher = null;

    try {
      fileChangesWatcher?.close?.();
    } catch {
      // ignore
    }
    fileChangesWatcher = null;

    try {
      uiPromptsWatcher?.close?.();
    } catch {
      // ignore
    }
    uiPromptsWatcher = null;

    try {
      runsWatcher?.close?.();
    } catch {
      // ignore
    }
    runsWatcher = null;

    if (tasksWatcherDebounce) {
      clearTimeout(tasksWatcherDebounce);
      tasksWatcherDebounce = null;
    }
    if (tasksWatcherRestart) {
      clearTimeout(tasksWatcherRestart);
      tasksWatcherRestart = null;
    }
    if (tasksPoller) {
      clearInterval(tasksPoller);
      tasksPoller = null;
    }
  }

  return {
    clearAllCaches,
    dispose,
    readConfigPayload,
    readEventsPayload,
    readFileChangesPayload,
    readRunsPayload,
    readSessionPayload,
    readUiPromptsPayload,
    requestUiPrompt,
    respondUiPrompt,
    startEventsWatcher,
    startFileChangesWatcher,
    startRunsWatcher,
    startSessionWatcher,
    startTasksWatcher,
    startUiPromptsWatcher,
  };
}
