import { createStateManager } from '../lib/state-manager.mjs';
import { createLogger, nowIso } from '../lib/utils.mjs';

const isActiveTask = (task) => task && (task.status === 'todo' || task.status === 'doing' || task.status === 'blocked');

export async function createUiAppsBackend(ctx) {
  const logger = createLogger({ prefix: 'scaffold-backend' });
  const state = createStateManager({ dataDir: ctx?.dataDir || '', logger });
  await state.load();

  const loadLatest = async () => {
    await state.reload();
    return state.getState();
  };

  const listSessionsWithStatus = async () => {
    const current = await loadLatest();
    const tasks = Object.values(current.tasks || {});
    const activeSessionIds = new Set(tasks.filter(isActiveTask).map((task) => task?.meta?.sessionId).filter(Boolean));

    const sessions = Object.values(current.sessions || {}).map((session) => ({
      ...session,
      running: session.running || activeSessionIds.has(session.id),
    }));

    return {
      sessions,
      updatedAt: current.updatedAt,
    };
  };

  return {
    methods: {
      async ping(params, runtimeCtx) {
        return {
          ok: true,
          now: nowIso(),
          pluginId: runtimeCtx?.pluginId || ctx?.pluginId || '',
          params: params ?? null,
        };
      },

      async 'tasks.list'() {
        const current = await loadLatest();
        return { tasks: Object.values(current.tasks || {}) };
      },

      async 'tasks.get'(params) {
        const current = await loadLatest();
        const id = typeof params?.id === 'string' ? params.id : '';
        return { task: id ? current.tasks?.[id] || null : null };
      },

      async 'sessions.list'() {
        return await listSessionsWithStatus();
      },

      async 'sessions.upsert'(params) {
        const id = typeof params?.id === 'string' ? params.id : '';
        if (!id) throw new Error('session id is required');
        const session = state.upsertSession({
          id,
          title: typeof params?.title === 'string' ? params.title : undefined,
          running: Boolean(params?.running),
          updatedAt: nowIso(),
        });
        return { session };
      },

      async 'sessions.setRunning'(params) {
        const id = typeof params?.id === 'string' ? params.id : '';
        if (!id) throw new Error('session id is required');
        const session = state.setSessionRunning(id, Boolean(params?.running));
        return { session };
      },
    },
    async dispose() {
      logger.info('backend disposed');
    },
  };
}
