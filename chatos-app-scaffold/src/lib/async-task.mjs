import { nowIso } from './utils.mjs';

export const TASK_STATUSES = Object.freeze({
  TODO: 'todo',
  DOING: 'doing',
  BLOCKED: 'blocked',
  DONE: 'done',
  CANCELLED: 'cancelled',
});

export const createAsyncTaskManager = (options = {}) => {
  const {
    maxConcurrent = 1,
    defaultTimeoutMs = 5 * 60 * 1000,
    logger = null,
  } = options;

  const tasks = new Map();
  const queue = [];
  let running = 0;
  const listeners = new Map();

  const on = (event, handler) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event)?.delete(handler);
  };

  const emit = (event, payload) => {
    const handlers = listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (err) {
        logger?.warn?.('task listener failed', { event, message: err?.message || String(err) });
      }
    }
  };

  const update = (task) => {
    task.updatedAt = nowIso();
    emit('update', task);
  };

  const listTasks = () => Array.from(tasks.values());

  const getTask = (id) => (id ? tasks.get(id) : null);

  const enqueue = (spec) => {
    if (!spec?.id) throw new Error('task id is required');
    const existing = tasks.get(spec.id);
    if (existing) return existing;

    const task = {
      id: spec.id,
      type: spec.type || 'task',
      status: TASK_STATUSES.TODO,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      timeoutMs: Number.isFinite(spec.timeoutMs) ? spec.timeoutMs : defaultTimeoutMs,
      payload: spec.payload ?? null,
      meta: spec.meta ?? {},
      attempts: 0,
      result: null,
      error: null,
      run: typeof spec.run === 'function' ? spec.run : null,
    };

    tasks.set(task.id, task);
    queue.push(task);
    update(task);
    tick();
    return task;
  };

  const setStatus = (id, status, extra = {}) => {
    const task = tasks.get(id);
    if (!task) return null;
    task.status = status;
    Object.assign(task, extra);
    update(task);
    return task;
  };

  const retry = (id) => {
    const task = tasks.get(id);
    if (!task || task.status !== TASK_STATUSES.BLOCKED) return null;
    task.status = TASK_STATUSES.TODO;
    task.error = null;
    queue.push(task);
    update(task);
    tick();
    return task;
  };

  const cancel = (id, reason = 'cancelled') => {
    const task = tasks.get(id);
    if (!task) return null;
    task.status = TASK_STATUSES.CANCELLED;
    task.error = { message: reason };
    update(task);
    return task;
  };

  const runWithTimeout = async (task) => {
    const timeoutMs = task.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return await task.run(task);
    }

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('task timeout')), timeoutMs);
    });

    try {
      return await Promise.race([task.run(task), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const runTask = async (task) => {
    running += 1;
    task.status = TASK_STATUSES.DOING;
    task.startedAt = nowIso();
    task.attempts += 1;
    update(task);

    try {
      if (!task.run) throw new Error('task run handler is not defined');
      task.result = await runWithTimeout(task);
      task.status = TASK_STATUSES.DONE;
      task.error = null;
      update(task);
      emit('done', task);
    } catch (err) {
      task.status = TASK_STATUSES.BLOCKED;
      task.error = { message: err?.message || String(err) };
      update(task);
      emit('error', task);
    } finally {
      running -= 1;
      tick();
    }
  };

  const tick = () => {
    if (running >= maxConcurrent) return;
    const next = queue.find((task) => task.status === TASK_STATUSES.TODO);
    if (!next) return;
    runTask(next);
  };

  return {
    enqueue,
    getTask,
    listTasks,
    setStatus,
    retry,
    cancel,
    on,
    TASK_STATUSES,
  };
};
