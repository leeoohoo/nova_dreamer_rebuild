import { BaseService } from './base-service.js';
import { taskSchema } from '../schema.js';

export class TaskService extends BaseService {
  constructor(db) {
    super(db, 'tasks', taskSchema);
    this.defaultRunId = this.#currentRunId() || null;
    this.defaultSessionId = this.#currentSessionId() || null;
  }

  replaceAll(tasks = []) {
    return this.db.reset(this.tableName, tasks);
  }

  addTask({ title, details, priority, status, tags, sessionId, runId }) {
    const now = new Date().toISOString();
    const resolvedRunId = this.#resolveRunId(runId);
    const resolvedSessionId = this.#resolveSessionId(sessionId);
    const task = {
      id: this.#generateId(),
      title: this.#requireTitle(title),
      details: this.#requireMeaningfulDetails(details),
      priority: this.#normalizePriority(priority),
      status: this.#normalizeStatus(status),
      tags: this.#normalizeTags(tags),
      runId: resolvedRunId,
      sessionId: resolvedSessionId,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(this.tableName, this.schema.parse(task));
    return task;
  }

  listTasks({
    status,
    tag,
    includeDone = true,
    limit = 50,
    sessionId,
    runId,
    allSessions = false,
    allRuns = false,
  } = {}) {
    const tasks = this.list().map((t) => this.#normalizeTaskShape(t)).filter(Boolean);
    const scopedRunId = allRuns ? '' : this.#getFilterRunId(runId);
    const scopedSessionId = allSessions ? '' : this.#getFilterSessionId(sessionId);
    const filtered = tasks.filter((task) => {
      if (scopedRunId && task.runId !== scopedRunId) return false;
      if (scopedSessionId && task.sessionId !== scopedSessionId) return false;
      if (!includeDone && task.status === 'done') return false;
      if (status && task.status !== this.#normalizeStatus(status)) return false;
      if (tag) {
        const tags = Array.isArray(task.tags) ? task.tags : [];
        if (!tags.some((entry) => entry.toLowerCase() === tag.toLowerCase())) {
          return false;
        }
      }
      return true;
    });
    const capped = filtered.slice(0, limit && Number.isFinite(limit) ? limit : 50);
    return capped;
  }

  updateTask(id, { title, details, appendNote, priority, status, tags }) {
    const existing = this.get(id);
    if (!existing) {
      throw new Error(`未找到 ID 为 ${id} 的任务。`);
    }
    const updated = this.#normalizeTaskShape(existing);
    if (title !== undefined) updated.title = this.#requireTitle(title);
    if (details !== undefined) updated.details = this.#requireMeaningfulDetails(details);
    if (appendNote) {
      const prefix = updated.details ? `${updated.details}\n` : '';
      updated.details = `${prefix}备注: ${appendNote.trim()}`;
    }
    if (priority !== undefined) updated.priority = this.#normalizePriority(priority);
    if (status !== undefined) updated.status = this.#normalizeStatus(status);
    if (tags !== undefined) updated.tags = this.#normalizeTags(tags);
    updated.updatedAt = new Date().toISOString();
    this.db.update(this.tableName, id, this.schema.parse(updated));
    return updated;
  }

  completeTask(id, note) {
    const completionNote = this.#requireCompletionNote(note);
    const payload = {
      status: 'done',
      appendNote: `完成明细(${new Date().toISOString()}): ${completionNote}`,
    };
    return this.updateTask(id, payload);
  }

  clearTasks(modeOrOptions = 'done') {
    const opts =
      modeOrOptions && typeof modeOrOptions === 'object'
        ? modeOrOptions
        : { mode: modeOrOptions };
    const normalizedMode = String(opts.mode || 'done').toLowerCase();
    if (!['done', 'all'].includes(normalizedMode)) {
      throw new Error('mode 必须是 done 或 all');
    }
    const scopedRunId = opts.allRuns ? '' : this.#getFilterRunId(opts.runId);
    const scopedSessionId = opts.allSessions ? '' : this.#getFilterSessionId(opts.sessionId);
    const tasks = this.list().map((t) => this.#normalizeTaskShape(t)).filter(Boolean);
    const remaining = [];
    let removed = 0;
    tasks.forEach((task) => {
      const inScope =
        (!scopedRunId || task.runId === scopedRunId) &&
        (!scopedSessionId || task.sessionId === scopedSessionId);
      if (!inScope) {
        remaining.push(task);
        return;
      }
      if (normalizedMode === 'all') {
        removed += 1;
        return;
      }
      if (task.status === 'done') {
        removed += 1;
        return;
      }
      remaining.push(task);
    });
    this.replaceAll(remaining);
    return { removed, remaining: remaining.length };
  }

  #normalizeTaskShape(task) {
    if (!task || typeof task !== 'object') {
      return null;
    }
    const now = new Date().toISOString();
    const normalizedRunId = this.#normalizeRunId(task.runId);
    const normalizedSession = this.#normalizeSessionId(task.sessionId);
    return this.schema.parse({
      id: String(task.id || this.#generateId()),
      title: this.#requireTitle(task.title),
      details: this.#requireMeaningfulDetails(task.details, { allowEmpty: true }),
      priority: this.#normalizePriority(task.priority),
      status: this.#normalizeStatus(task.status),
      tags: this.#normalizeTags(task.tags),
      runId: normalizedRunId,
      sessionId: normalizedSession,
      createdAt: task.createdAt || now,
      updatedAt: task.updatedAt || now,
    });
  }

  #requireTitle(title) {
    const text = typeof title === 'string' ? title.trim() : '';
    if (!text) {
      throw new Error('title is required');
    }
    return text;
  }

  #requireMeaningfulDetails(details, options = {}) {
    const allowEmpty = options.allowEmpty === true;
    const text = typeof details === 'string' ? details.trim() : '';
    if (allowEmpty && !text) {
      return '';
    }
    if (text.length < 15) {
      throw new Error('details 需要包含背景和验收标准，至少 15 个字符，例如：背景: ...\\n验收: ...');
    }
    return text;
  }

  #normalizeSessionId(sessionId) {
    return typeof sessionId === 'string' ? sessionId.trim() : '';
  }

  #normalizeRunId(runId) {
    return typeof runId === 'string' ? runId.trim() : '';
  }

  #resolveRunId(runId) {
    const normalized = this.#normalizeRunId(runId);
    if (normalized) return normalized;
    if (this.defaultRunId) return this.defaultRunId;
    const envId = this.#currentRunId();
    if (envId) {
      this.defaultRunId = envId;
      return envId;
    }
    const generated = this.#generateId('run');
    this.defaultRunId = generated;
    return generated;
  }

  #resolveSessionId(sessionId) {
    const normalized = this.#normalizeSessionId(sessionId);
    if (normalized) return normalized;
    if (this.defaultSessionId) return this.defaultSessionId;
    const envId = this.#currentSessionId();
    if (envId) {
      this.defaultSessionId = envId;
      return envId;
    }
    const generated = this.#generateId('session');
    this.defaultSessionId = generated;
    return generated;
  }

  #getFilterSessionId(sessionId) {
    const normalized = this.#normalizeSessionId(sessionId);
    if (normalized) return normalized;
    if (this.defaultSessionId) return this.defaultSessionId;
    const envId = this.#currentSessionId();
    if (envId) {
      this.defaultSessionId = envId;
      return envId;
    }
    return '';
  }

  #getFilterRunId(runId) {
    const normalized = this.#normalizeRunId(runId);
    if (normalized) return normalized;
    if (this.defaultRunId) return this.defaultRunId;
    const envId = this.#currentRunId();
    if (envId) {
      this.defaultRunId = envId;
      return envId;
    }
    return '';
  }

  #currentSessionId() {
    return this.#normalizeSessionId(process?.env?.MODEL_CLI_SESSION_ID);
  }

  #currentRunId() {
    return this.#normalizeRunId(process?.env?.MODEL_CLI_RUN_ID);
  }

  #normalizePriority(priority) {
    const value = String(priority || 'medium').toLowerCase();
    return ['high', 'medium', 'low'].includes(value) ? value : 'medium';
  }

  #normalizeStatus(status) {
    const value = String(status || 'todo').toLowerCase();
    return ['todo', 'doing', 'blocked', 'done'].includes(value) ? value : 'todo';
  }

  #normalizeTags(tags) {
    if (!Array.isArray(tags)) {
      return [];
    }
    return tags
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }

  #requireCompletionNote(note) {
    const text = typeof note === 'string' ? note.trim() : '';
    if (text.length < 5) {
      throw new Error('complete_task 需要提供完成明细 note（至少 5 个字符），用于记录交付结果。');
    }
    return text;
  }

  #generateId(prefix = 'task') {
    const normalizedPrefix = String(prefix || 'task').replace(/[^a-z0-9_-]/gi, '') || 'task';
    return `${normalizedPrefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 6)}`;
  }
}
