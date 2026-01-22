import path from 'node:path';
import { nowIso, readJsonFile, writeJsonFile } from './utils.mjs';

const defaultState = () => ({
  version: 1,
  updatedAt: nowIso(),
  tasks: {},
  sessions: {},
});

export const createStateManager = ({ dataDir = '', statePath = '', logger = null, debounceMs = 200 } = {}) => {
  const filePath = statePath || (dataDir ? path.join(dataDir, 'app-state.json') : 'app-state.json');
  let state = defaultState();
  let loaded = false;
  let saveTimer = null;

  const load = async (force = false) => {
    if (loaded && !force) return state;
    const persisted = await readJsonFile(filePath, null);
    if (persisted && typeof persisted === 'object') {
      state = { ...defaultState(), ...persisted };
    }
    loaded = true;
    return state;
  };

  const reload = async () => await load(true);

  const saveNow = async () => {
    try {
      state.updatedAt = nowIso();
      await writeJsonFile(filePath, state);
    } catch (err) {
      logger?.warn?.('state save failed', { message: err?.message || String(err) });
    }
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveNow().catch(() => {});
    }, debounceMs);
  };

  const flush = async () => {
    if (saveTimer) clearTimeout(saveTimer);
    await saveNow();
  };

  const getState = () => state;

  const setTask = (task) => {
    if (!task?.id) return null;
    state.tasks[task.id] = task;
    scheduleSave();
    return task;
  };

  const getTask = (id) => (id ? state.tasks[id] : null);

  const listTasks = () => Object.values(state.tasks || {});

  const upsertSession = (session) => {
    if (!session?.id) return null;
    const prev = state.sessions[session.id] || {};
    state.sessions[session.id] = { ...prev, ...session, id: session.id };
    scheduleSave();
    return state.sessions[session.id];
  };

  const setSessionRunning = (id, running) => {
    if (!id) return null;
    return upsertSession({ id, running: Boolean(running), updatedAt: nowIso() });
  };

  const listSessions = () => Object.values(state.sessions || {});

  const removeTask = (id) => {
    if (!id) return false;
    if (!state.tasks[id]) return false;
    delete state.tasks[id];
    scheduleSave();
    return true;
  };

  const removeSession = (id) => {
    if (!id) return false;
    if (!state.sessions[id]) return false;
    delete state.sessions[id];
    scheduleSave();
    return true;
  };

  return {
    load,
    reload,
    flush,
    getState,
    setTask,
    getTask,
    listTasks,
    upsertSession,
    setSessionRunning,
    listSessions,
    removeTask,
    removeSession,
    filePath,
  };
};
