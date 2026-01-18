#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createDb } from '../shared/data/storage.js';
import { TaskService } from '../shared/data/services/task-service.js';
import { SettingsService } from '../shared/data/services/settings-service.js';
import { createTtyPrompt } from './tty-prompt.js';
import { ensureAppDbPath, resolveAppStateDir } from '../shared/state-paths.js';
import { resolveSessionRoot } from '../shared/session-root.js';

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const root = path.resolve(args.root || process.cwd());
const serverName = args.name || 'task_manager';
const sessionRoot = resolveSessionRoot();
const adminDbPath =
  process.env.MODEL_CLI_TASK_DB ||
  ensureAppDbPath(sessionRoot);
const runId = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
const promptLogPath =
  process.env.MODEL_CLI_UI_PROMPTS ||
  path.join(resolveAppStateDir(sessionRoot), 'ui-prompts.jsonl');
const callerKind = normalizeCallerKind(process.env.MODEL_CLI_CALLER);

ensureDir(root);
ensureDir(path.dirname(adminDbPath));
ensureFileExists(promptLogPath);

let taskDb = null;
let settingsDb = null;
try {
  const db = createDb({ dbPath: adminDbPath });
  taskDb = new TaskService(db);
  settingsDb = new SettingsService(db);
  settingsDb.ensureRuntime();
} catch (err) {
  console.error(`[${serverName}] DB init failed: ${err.message}`);
  process.exit(1);
}

const server = new McpServer({
  name: serverName,
  version: '0.1.0',
});

registerTools();

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${serverName}] MCP task server ready (db=${relativePath(adminDbPath)}).`);
}

main().catch((err) => {
  console.error(`[${serverName}] crashed:`, err);
  process.exit(1);
});

function registerTools() {
  const singleTaskInput = z
    .object({
      title: z.string().min(1).describe('Task title'),
      details: z.string().optional().describe('Context or acceptance criteria'),
      priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority (default medium)'),
      status: z.enum(['todo', 'doing', 'blocked', 'done']).optional().describe('Initial status (default todo)'),
      tags: z.array(z.string()).optional().describe('Tags, e.g., ["backend","release"]'),
      runId: z.string().optional().describe('Run ID (optional; defaults to current run)'),
      sessionId: z.string().optional().describe('Session ID (optional; defaults to current session)'),
      caller: z
        .string()
        .optional()
        .describe('Caller kind override ("main" | "subagent"). Used to decide which confirmation toggle applies.'),
    })
    .strict();

  const batchTaskInput = z.object({
    tasks: z.array(singleTaskInput).min(1).describe('Batch of tasks to create'),
    runId: z.string().optional().describe('Run ID (optional; defaults to current run)'),
    sessionId: z.string().optional().describe('Session ID (optional; defaults to current session)'),
    caller: z
      .string()
      .optional()
      .describe('Caller kind override ("main" | "subagent"). Used to decide which confirmation toggle applies.'),
  });

  const addTaskInputSchema = z.preprocess((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }
    if (typeof value.tasks !== 'string') {
      return value;
    }
    const rawTasks = value.tasks.trim();
    if (!rawTasks) {
      return value;
    }
    try {
      const parsed = JSON.parse(rawTasks);
      if (Array.isArray(parsed)) {
        return { ...value, tasks: parsed };
      }
    } catch {
      // ignore parse errors; schema validation will surface tasks shape problems
    }
    return value;
  }, z.union([batchTaskInput, singleTaskInput]));

  server.registerTool(
    'add_task',
    {
      title: 'Add task',
      description:
        [
          'Create one or more tasks with priority, tags, and details.',
          'Examples: {"title":"Fix login bug","priority":"high","tags":["frontend","bug"]} or {"tasks":[{"title":"Write docs"},{"title":"Add tests","priority":"medium","tags":["qa"]}]}',
        ].join('\n'),
      inputSchema: addTaskInputSchema,
    },
    async (payload) => {
      const runDefault = pickRunId(payload.runId);
      const sessionDefault = pickSessionId(payload.sessionId);
      const inputs = Array.isArray(payload.tasks) && payload.tasks.length > 0 ? payload.tasks : [payload];

      const requestCallerKind = pickCallerKind(payload?.caller);
      const shouldConfirm = shouldConfirmTaskCreate(requestCallerKind);
      const draftTasks = inputs.map((item, idx) => ({
        draftId: crypto.randomUUID(),
        title: typeof item?.title === 'string' ? item.title : '',
        details: typeof item?.details === 'string' ? item.details : '',
        priority: typeof item?.priority === 'string' ? item.priority : '',
        status: typeof item?.status === 'string' ? item.status : '',
        tags: Array.isArray(item?.tags) ? item.tags : [],
        runId: pickRunId(item?.runId) || runDefault,
        sessionId: pickSessionId(item?.sessionId) || sessionDefault,
        _index: idx,
      }));

      let confirmed = { status: 'ok', tasks: draftTasks, remark: '' };
      if (shouldConfirm) {
        const promptTitle = requestCallerKind === 'subagent' ? '子流程任务创建确认' : '主流程任务创建确认';
        const promptMessage =
          'AI 请求创建任务。你可以新增/删除/修改/调整顺序，并填写备注建议。点击确定后继续创建任务。';
        const requestId = crypto.randomUUID();
        const promptTasks = draftTasks.map((t) => ({
          draftId: t.draftId,
          title: t.title,
          details: t.details,
          priority: t.priority,
          status: t.status,
          tags: normalizeTags(t.tags),
        }));
        appendPromptEntry({
          ts: new Date().toISOString(),
          type: 'ui_prompt',
          action: 'request',
          requestId,
          ...(runId ? { runId } : {}),
          prompt: {
            kind: 'task_confirm',
            title: promptTitle,
            message: promptMessage,
            allowCancel: true,
            source: requestCallerKind,
            tasks: promptTasks,
          },
        });

        const tty = createTtyPrompt();
        const normalizeTaskConfirmList = (list) =>
          (Array.isArray(list) ? list : [])
            .filter((t) => t && typeof t === 'object')
            .map((t, idx) => ({
              draftId: typeof t.draftId === 'string' ? t.draftId.trim() : '',
              title: typeof t.title === 'string' ? t.title : '',
              details: typeof t.details === 'string' ? t.details : '',
              priority: typeof t.priority === 'string' ? t.priority : '',
              status: typeof t.status === 'string' ? t.status : '',
              tags: normalizeTags(t.tags),
              _index: idx,
            }))
            .filter((t) => t.draftId && t.title.trim());

        const runTtyConfirm = async ({ signal } = {}) => {
          if (!tty) return null;

          const tasks = promptTasks.map((t) => ({
            draftId: typeof t?.draftId === 'string' && t.draftId.trim() ? t.draftId.trim() : crypto.randomUUID(),
            title: typeof t?.title === 'string' ? t.title : '',
            details: typeof t?.details === 'string' ? t.details : '',
            priority: typeof t?.priority === 'string' ? t.priority : '',
            status: typeof t?.status === 'string' ? t.status : '',
            tags: normalizeTags(t?.tags),
          }));

          const allowedPriority = new Set(['high', 'medium', 'low']);
          const allowedStatus = new Set(['todo', 'doing', 'blocked', 'done']);
          const maxDetailChars = 240;

          const renderTasks = () => {
            tty.writeln('');
            if (tasks.length === 0) {
              tty.writeln('(当前任务列表为空)');
              return;
            }
            tasks.forEach((task, index) => {
              const title = typeof task?.title === 'string' ? task.title.trim() : '';
              const priority = typeof task?.priority === 'string' ? task.priority.trim() : '';
              const status = typeof task?.status === 'string' ? task.status.trim() : '';
              const tags = normalizeTags(task?.tags);
              const meta = [
                priority ? `priority=${priority}` : '',
                status ? `status=${status}` : '',
                tags.length > 0 ? `tags=${tags.join(',')}` : '',
              ]
                .filter(Boolean)
                .join(' ');
              tty.writeln(`[${index + 1}] ${title || '<untitled>'}${meta ? ` (${meta})` : ''}`);
              const details = typeof task?.details === 'string' ? task.details.trim() : '';
              if (details) {
                const compact = details.replace(/\s+/g, ' ').trim();
                const shown = compact.length > maxDetailChars ? `${compact.slice(0, maxDetailChars)}...` : compact;
                tty.writeln(`    ${shown}`);
              }
            });
          };

          const help = () => {
            tty.writeln('');
            tty.writeln('命令：');
            tty.writeln('  y            确认创建');
            tty.writeln('  n            取消');
            tty.writeln('  e            进入编辑模式（可新增/删除/修改/排序）');
            tty.writeln('');
          };

          const helpEdit = () => {
            tty.writeln('');
            tty.writeln('编辑命令：');
            tty.writeln('  l                    列表');
            tty.writeln('  a                    新增任务');
            tty.writeln('  e <n>                编辑第 n 个任务');
            tty.writeln('  d <n>                删除第 n 个任务');
            tty.writeln('  m <from> <to>         移动/排序（把 from 移到 to）');
            tty.writeln('  y                    确认创建');
            tty.writeln('  n                    取消');
            tty.writeln('  h                    帮助');
            tty.writeln('');
          };

          const parseTagsInput = (text) =>
            String(text || '')
              .split(/[,，]/g)
              .map((t) => t.trim())
              .filter(Boolean);

          const askTaskFields = async ({ existing } = {}) => {
            const base = existing && typeof existing === 'object' ? existing : null;
            const out = base
              ? { ...base, tags: normalizeTags(base.tags) }
              : {
                  draftId: crypto.randomUUID(),
                  title: '',
                  details: '',
                  priority: 'medium',
                  status: 'todo',
                  tags: [],
                };

            while (true) {
              const titlePrompt = base ? `title [${out.title || ''}]: ` : 'title (必填): ';
              const titleRaw = await tty.ask(titlePrompt, { signal });
              if (titleRaw == null) return null;
              const title = String(titleRaw ?? '').trim();
              if (title) {
                out.title = title;
                break;
              }
              if (base && out.title && out.title.trim()) break;
              tty.writeln('title 为必填。');
            }

            const detailsPrompt = base ? `details [${out.details || ''}]: ` : 'details (可选): ';
            const detailsRaw = await tty.ask(detailsPrompt, { signal });
            if (detailsRaw == null) return null;
            const details = String(detailsRaw ?? '');
            if (details.trim() || !base) {
              out.details = details.trim();
            }

            while (true) {
              const current = out.priority && out.priority.trim() ? out.priority.trim() : 'medium';
              const pRaw = await tty.ask(`priority (high/medium/low) [${current}]: `, { signal });
              if (pRaw == null) return null;
              const p = String(pRaw ?? '').trim().toLowerCase();
              if (!p) {
                out.priority = current;
                break;
              }
              if (allowedPriority.has(p)) {
                out.priority = p;
                break;
              }
              tty.writeln('priority 无效，请输入 high/medium/low。');
            }

            while (true) {
              const current = out.status && out.status.trim() ? out.status.trim() : 'todo';
              const sRaw = await tty.ask(`status (todo/doing/blocked/done) [${current}]: `, { signal });
              if (sRaw == null) return null;
              const s = String(sRaw ?? '').trim().toLowerCase();
              if (!s) {
                out.status = current;
                break;
              }
              if (allowedStatus.has(s)) {
                out.status = s;
                break;
              }
              tty.writeln('status 无效，请输入 todo/doing/blocked/done。');
            }

            const tagsPrompt = base
              ? `tags (逗号分隔) [${(out.tags || []).join(', ')}]: `
              : 'tags (逗号分隔，可选): ';
            const tagsRaw = await tty.ask(tagsPrompt, { signal });
            if (tagsRaw == null) return null;
            const tagsText = String(tagsRaw ?? '').trim();
            if (tagsText) {
              out.tags = parseTagsInput(tagsText);
            } else if (!base) {
              out.tags = [];
            }

            return out;
          };

          const confirmWithRemark = async (finalTasks) => {
            const remarkRaw = await tty.ask('备注（可选，直接回车跳过）： ', { signal });
            if (remarkRaw == null) return null;
            const remark = String(remarkRaw ?? '').trim();
            return { status: 'ok', tasks: finalTasks, remark };
          };

          tty.writeln('');
          tty.writeln(`[${serverName}] ${promptTitle}`);
          tty.writeln('可在 UI 或本终端确认；输入 y 确认创建，e 编辑任务列表，直接回车取消。');
          tty.writeln(`source: ${requestCallerKind}`);
          help();
          renderTasks();

          const first = await tty.ask('操作 (y/N/e): ', { signal });
          if (first == null) return null;
          const action = String(first ?? '').trim().toLowerCase();
          if (action === 'y' || action === 'yes') {
            return await confirmWithRemark(tasks);
          }
          if (action !== 'e' && action !== 'edit') {
            return { status: 'canceled' };
          }

          helpEdit();
          renderTasks();
          while (true) {
            const cmdRaw = await tty.ask('task_confirm> ', { signal });
            if (cmdRaw == null) return null;
            const cmd = String(cmdRaw ?? '').trim();
            const parts = cmd.split(/\s+/g).filter(Boolean);
            const head = (parts[0] || '').toLowerCase();

            if (!head) continue;
            if (head === 'h' || head === 'help' || head === '?') {
              helpEdit();
              continue;
            }
            if (head === 'l' || head === 'list') {
              renderTasks();
              continue;
            }
            if (head === 'y' || head === 'yes' || head === 'confirm') {
              if (tasks.length === 0) {
                tty.writeln('任务列表为空，请至少保留 1 个任务。');
                continue;
              }
              const confirmed = await confirmWithRemark(tasks);
              return confirmed;
            }
            if (head === 'n' || head === 'no' || head === 'cancel') {
              return { status: 'canceled' };
            }
            if (head === 'a' || head === 'add') {
              const created = await askTaskFields();
              if (!created) return null;
              tasks.push(created);
              renderTasks();
              continue;
            }
            if (head === 'e' || head === 'edit') {
              const index = Number(parts[1]);
              if (!Number.isFinite(index) || index < 1 || index > tasks.length) {
                tty.writeln('用法: e <n>（n 为任务序号）');
                continue;
              }
              const updated = await askTaskFields({ existing: tasks[index - 1] });
              if (!updated) return null;
              tasks[index - 1] = updated;
              renderTasks();
              continue;
            }
            if (head === 'd' || head === 'del' || head === 'delete') {
              const index = Number(parts[1]);
              if (!Number.isFinite(index) || index < 1 || index > tasks.length) {
                tty.writeln('用法: d <n>（n 为任务序号）');
                continue;
              }
              tasks.splice(index - 1, 1);
              renderTasks();
              continue;
            }
            if (head === 'm' || head === 'move') {
              const from = Number(parts[1]);
              const to = Number(parts[2]);
              if (
                !Number.isFinite(from) ||
                !Number.isFinite(to) ||
                from < 1 ||
                from > tasks.length ||
                to < 1 ||
                to > tasks.length
              ) {
                tty.writeln('用法: m <from> <to>（序号从 1 开始）');
                continue;
              }
              const [item] = tasks.splice(from - 1, 1);
              tasks.splice(to - 1, 0, item);
              renderTasks();
              continue;
            }

            tty.writeln('未知命令，输入 h 查看帮助。');
          }
        };

        const applyConfirmResponse = (responseEntry) => {
          const status = normalizeResponseStatus(responseEntry?.response?.status);
          if (status !== 'ok') {
            return {
              ok: false,
              status,
              tasks: [],
              remark: typeof responseEntry?.response?.remark === 'string' ? responseEntry.response.remark : '',
            };
          }
          const tasksFromUser = Array.isArray(responseEntry?.response?.tasks) ? responseEntry.response.tasks : [];
          const tasks = normalizeTaskConfirmList(tasksFromUser);
          const remark = typeof responseEntry?.response?.remark === 'string' ? responseEntry.response.remark : '';
          return { ok: tasks.length > 0, status: 'ok', tasks, remark };
        };

        if (tty && tty.backend === 'tty') {
          try {
            const terminalResult = await runTtyConfirm();
            appendPromptEntry({
              ts: new Date().toISOString(),
              type: 'ui_prompt',
              action: 'response',
              requestId,
              ...(runId ? { runId } : {}),
              response: terminalResult || { status: 'canceled' },
            });

            const parsed = applyConfirmResponse({ response: terminalResult || { status: 'canceled' } });
            if (!parsed.ok) {
              return structuredResponse(`[${serverName}] 用户取消创建任务 (requestId=${requestId})`, {
                status: parsed.status,
                request_id: requestId,
                caller: requestCallerKind,
                remark: parsed.remark,
              });
            }
            confirmed = { status: 'ok', tasks: parsed.tasks, remark: parsed.remark };
          } finally {
            tty.close();
          }
        } else if (tty && tty.backend === 'auto') {
          const abort = new AbortController();
          try {
            const uiWait = waitForPromptResponse({ requestId }).then((entry) => ({ kind: 'ui', entry }));
            const ttyWait = runTtyConfirm({ signal: abort.signal }).then((res) => ({ kind: 'tty', res }));
            const first = await Promise.race([uiWait, ttyWait]);
            if (first.kind === 'ui') {
              abort.abort();
              const parsed = applyConfirmResponse(first.entry);
              if (!parsed.ok) {
                return structuredResponse(`[${serverName}] 用户取消创建任务 (requestId=${requestId})`, {
                  status: parsed.status,
                  request_id: requestId,
                  caller: requestCallerKind,
                  remark: parsed.remark,
                });
              }
              confirmed = { status: 'ok', tasks: parsed.tasks, remark: parsed.remark };
            } else {
              const terminalResult = first.res;
              if (!terminalResult) {
                const ui = await uiWait;
                const parsed = applyConfirmResponse(ui.entry);
                if (!parsed.ok) {
                  return structuredResponse(`[${serverName}] 用户取消创建任务 (requestId=${requestId})`, {
                    status: parsed.status,
                    request_id: requestId,
                    caller: requestCallerKind,
                    remark: parsed.remark,
                  });
                }
                confirmed = { status: 'ok', tasks: parsed.tasks, remark: parsed.remark };
              } else {
                appendPromptEntry({
                  ts: new Date().toISOString(),
                  type: 'ui_prompt',
                  action: 'response',
                  requestId,
                  ...(runId ? { runId } : {}),
                  response: terminalResult,
                });
                const parsed = applyConfirmResponse({ response: terminalResult });
                if (!parsed.ok) {
                  return structuredResponse(`[${serverName}] 用户取消创建任务 (requestId=${requestId})`, {
                    status: parsed.status,
                    request_id: requestId,
                    caller: requestCallerKind,
                    remark: parsed.remark,
                  });
                }
                confirmed = { status: 'ok', tasks: parsed.tasks, remark: parsed.remark };
              }
            }
          } finally {
            abort.abort();
            tty.close();
          }
        } else {
          const response = await waitForPromptResponse({ requestId });
          const parsed = applyConfirmResponse(response);
          if (!parsed.ok) {
            const status = parsed.status;
            if (status === 'ok') {
              return structuredResponse(`[${serverName}] 用户提交了空任务列表，已取消创建。`, {
                status: 'canceled',
                request_id: requestId,
                caller: requestCallerKind,
                remark: parsed.remark,
              });
            }
            return structuredResponse(`[${serverName}] 用户取消创建任务 (requestId=${requestId})`, {
              status,
              request_id: requestId,
              caller: requestCallerKind,
              remark: parsed.remark,
            });
          }
          confirmed = { status: 'ok', tasks: parsed.tasks, remark: parsed.remark };
        }
      }

      const draftById = new Map(draftTasks.map((t) => [t.draftId, t]));
      const created = confirmed.tasks.map((item) => {
        const prev = item?.draftId ? draftById.get(item.draftId) : null;
        return taskDb.addTask({
          title: safeTrim(item.title),
          details: typeof item.details === 'string' ? item.details : '',
          priority: normalizeTaskPriority(item.priority),
          status: normalizeTaskStatus(item.status),
          tags: normalizeTags(item.tags),
          runId: pickRunId(prev?.runId) || runDefault,
          sessionId: pickSessionId(prev?.sessionId) || sessionDefault,
        });
      });
      const total = taskDb.listTasks({
        runId: runDefault,
        allRuns: false,
        allSessions: true,
        includeDone: false,
        limit: 100000,
      }).length;
      const header =
        created.length > 1
          ? `Created ${created.length} task(s) (${total} total open)`
          : `Task created (${total} total open)`;
      const summary = created.map((task) => renderTaskSummary(task)).join('\n\n');

      const changeSummary = buildTaskConfirmSummary({
        before: draftTasks,
        after: confirmed.tasks,
        remark: confirmed.remark,
      });

      return structuredResponse(`${header}\n${summary}${changeSummary ? `\n\n${changeSummary}` : ''}`, {
        status: 'ok',
        caller: requestCallerKind,
        created: created.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority })),
        user_changes: buildTaskConfirmChanges({ before: draftTasks, after: confirmed.tasks }),
        remark: confirmed.remark || '',
      });
    }
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        'List tasks with optional filters (status/tag). Defaults to current session unless allSessions=true.',
      inputSchema: z.object({
        status: z.enum(['todo', 'doing', 'blocked', 'done']).optional().describe('Filter by status'),
        tag: z.string().optional().describe('Filter by tag'),
        limit: z.number().int().min(1).max(200).optional().describe('Max items to return (default 50)'),
        includeDone: z.boolean().optional().describe('Include completed tasks (default true)'),
        allSessions: z.boolean().optional().describe('If true, ignore session scoping and list all'),
        allRuns: z.boolean().optional().describe('If true, ignore run scoping and list all'),
        runId: z.string().optional().describe('Run ID (optional; defaults to current run)'),
        sessionId: z.string().optional().describe('Session ID (optional; defaults to current session)'),
      }),
    },
    async ({ status, tag, limit, includeDone, allSessions, allRuns, runId, sessionId }) => {
      const scopedRunId = allRuns ? '' : pickRunId(runId);
      const scopedSessionId = allSessions ? '' : pickSessionId(sessionId);
      const tasks = taskDb.listTasks({
        status,
        tag,
        limit,
        includeDone,
        sessionId: scopedSessionId,
        allSessions,
        runId: scopedRunId,
        allRuns,
      });
      const capped = tasks.slice(0, limit && Number.isFinite(limit) ? limit : 50);
      return textResponse(formatTaskList(capped));
    }
  );

  server.registerTool(
    'get_task',
    {
      title: 'Get task',
      description: 'Get detailed task info by task ID.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Task ID'),
      }),
    },
    async ({ id }) => {
      const task = taskDb.get(id);
      if (!task) {
        throw new Error(`未找到 ID 为 ${id} 的任务。`);
      }
      return textResponse(renderTaskSummary(task, 'Task'));
    }
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update task',
      description:
        'Update title/details/status/tags/priority, or append a note to details.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Task ID'),
        title: z.string().optional().describe('New title'),
        details: z.string().optional().describe('Replace details'),
        append_note: z.string().optional().describe('Append note to details'),
        priority: z.enum(['high', 'medium', 'low']).optional().describe('New priority'),
        status: z.enum(['todo', 'doing', 'blocked', 'done']).optional().describe('New status'),
        tags: z.array(z.string()).optional().describe('Replace tags'),
        runId: z.string().optional().describe('Run ID (optional)'),
        sessionId: z.string().optional().describe('Session ID (optional)'),
      }),
    },
    async ({ id, title, details, append_note: appendNote, priority, status, tags }) => {
      const task = taskDb.updateTask(id, {
        title,
        details,
        appendNote,
        priority,
        status,
        tags,
      });
      return textResponse(renderTaskSummary(task, 'Task updated'));
    }
  );

  server.registerTool(
    'complete_task',
    {
      title: 'Complete task',
      description: 'Mark a task as done and record a completion note.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Task ID'),
        note: z
          .string()
          .min(5)
          .describe('Completion note (what was delivered + validation, min 5 chars)'),
        runId: z.string().optional().describe('Run ID (optional)'),
        sessionId: z.string().optional().describe('Session ID (optional)'),
      }),
    },
    async ({ id, note }) => {
      const task = taskDb.completeTask(id, note);
      return textResponse(renderTaskSummary(task, 'Task marked as done'));
    }
  );

  server.registerTool(
    'clear_tasks',
    {
      title: 'Clear tasks',
      description: 'Delete completed tasks, or clear all when explicitly requested.',
      inputSchema: z.object({
        mode: z
          .enum(['done', 'all'])
          .optional()
          .describe('done=delete completed only (default), all=delete everything'),
        allSessions: z.boolean().optional().describe('If true, ignore session scoping'),
        allRuns: z.boolean().optional().describe('If true, ignore run scoping'),
        runId: z.string().optional().describe('Run ID (optional; defaults to current run)'),
        sessionId: z.string().optional().describe('Session ID (optional; defaults to current session)'),
      }),
    },
    async ({ mode, allSessions, allRuns, runId, sessionId }) => {
      const result = taskDb.clearTasks({
        mode: mode || 'done',
        allSessions,
        allRuns,
        runId: allRuns ? '' : pickRunId(runId),
        sessionId: allSessions ? '' : pickSessionId(sessionId),
      });
      return textResponse(`Cleared ${result.removed} task(s), ${result.remaining} remaining.`);
    }
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete task',
      description: 'Delete a task by ID. Requires confirm=true to proceed.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Task ID'),
        confirm: z.boolean().optional().describe('Set true to confirm deletion'),
      }),
    },
    async ({ id, confirm }) => {
      if (confirm !== true) {
        throw new Error('Refusing to delete task without confirm=true.');
      }
      const task = taskDb.get(id);
      if (!task) {
        throw new Error(`未找到 ID 为 ${id} 的任务。`);
      }
      const removed = taskDb.remove(id);
      if (!removed) {
        throw new Error(`删除任务失败：${id}`);
      }
      return textResponse(renderTaskSummary(task, 'Task deleted'));
    }
  );
}

function formatTaskList(tasks) {
  if (!tasks || tasks.length === 0) {
    return 'Task list is empty.';
  }
  const lines = tasks.map((task) => renderTaskLine(task));
  return lines.join('\n');
}

function renderTaskLine(task) {
  const tagText = task.tags && task.tags.length > 0 ? ` #${task.tags.join(' #')}` : '';
  const sessionText = task.sessionId ? `, session=${task.sessionId}` : '';
  return `[${task.status}/${task.priority}] ${task.title} (id=${task.id}${sessionText})${tagText}`;
}

function renderTaskSummary(task, prefix = '') {
  const header = prefix ? `${prefix}\n` : '';
  const body = [
    renderTaskLine(task),
    task.details ? `Details: ${task.details}` : 'Details: <empty, use update_task to add context/acceptance>',
    `Session: ${task.sessionId || '<unspecified>'}`,
    `Created: ${task.createdAt}`,
    `Updated: ${task.updatedAt}`,
  ]
    .filter(Boolean)
    .join('\n');
  return `${header}${body}`;
}

function textResponse(text) {
  return {
    content: [
      {
        type: 'text',
        text: text || '',
      },
    ],
  };
}

function structuredResponse(text, structuredContent) {
  return {
    content: [
      {
        type: 'text',
        text: text || '',
      },
    ],
    structuredContent: structuredContent && typeof structuredContent === 'object' ? structuredContent : undefined,
  };
}

function ensureDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    const stats = fs.statSync(dirPath);
    if (stats.isDirectory()) {
      return;
    }
    throw new Error(`${dirPath} is not a directory`);
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

function relativePath(target) {
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..')) {
    return target;
  }
  return rel;
}

function pickSessionId(candidate) {
  const normalized = typeof candidate === 'string' ? candidate.trim() : '';
  if (normalized) return normalized;
  const fromEnv = typeof process.env.MODEL_CLI_SESSION_ID === 'string' ? process.env.MODEL_CLI_SESSION_ID.trim() : '';
  return fromEnv || '';
}

function pickRunId(candidate) {
  const normalized = typeof candidate === 'string' ? candidate.trim() : '';
  if (normalized) return normalized;
  const fromEnv = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
  return fromEnv || '';
}

function parseArgs(input) {
  const result = { _: [] };
  for (let i = 0; i < input.length; i += 1) {
    const token = input[i];
    if (!token.startsWith('-')) {
      result._.push(token);
      continue;
    }
    const isLong = token.startsWith('--');
    const key = isLong ? token.slice(2) : token.slice(1);
    if (!key) continue;
    const [name, inline] = key.split('=');
    if (inline !== undefined) {
      result[name] = inline;
      continue;
    }
    const next = input[i + 1];
    if (next && !next.startsWith('-')) {
      result[name] = next;
      i += 1;
    } else {
      result[name] = true;
    }
  }
  return result;
}

function ensureFileExists(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    // ignore
  }
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
  } catch {
    // ignore
  }
}

function normalizeCallerKind(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'sub' || normalized === 'subagent' || normalized === 'worker') return 'subagent';
  return 'main';
}

function normalizeCallerOverride(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return '';
  if (normalized === 'main') return 'main';
  if (normalized === 'sub' || normalized === 'subagent' || normalized === 'worker') return 'subagent';
  return '';
}

function pickCallerKind(candidate) {
  const override = normalizeCallerOverride(candidate);
  return override || callerKind;
}

function shouldConfirmTaskCreate(requestCallerKind = callerKind) {
  try {
    const runtime = settingsDb?.getRuntime?.();
    if (!runtime) return false;
    if (requestCallerKind === 'subagent') return runtime.confirmSubTaskCreate === true;
    return runtime.confirmMainTaskCreate === true;
  } catch {
    return false;
  }
}

function appendPromptEntry(entry) {
  try {
    ensureFileExists(promptLogPath);
    fs.appendFileSync(promptLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // ignore
  }
}

async function waitForPromptResponse({ requestId }) {
  let watcher = null;
  let poll = null;
  const cleanup = () => {
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
      watcher = null;
    }
    if (poll) {
      clearInterval(poll);
      poll = null;
    }
  };

  return await new Promise((resolve) => {
    const tryRead = () => {
      const found = findLatestPromptResponse(requestId);
      if (found) {
        cleanup();
        resolve(found);
      }
    };
    try {
      watcher = fs.watch(promptLogPath, { persistent: false }, () => tryRead());
      if (watcher && typeof watcher.on === 'function') {
        watcher.on('error', (err) => {
          try {
            console.error(`[${serverName}] prompt log watcher error: ${err?.message || err}`);
          } catch {
            // ignore
          }
          try {
            watcher?.close?.();
          } catch {
            // ignore
          }
          watcher = null;
        });
      }
    } catch {
      watcher = null;
    }
    poll = setInterval(tryRead, 800);
    if (poll && typeof poll.unref === 'function') {
      poll.unref();
    }
    tryRead();
  });
}

function findLatestPromptResponse(requestId) {
  try {
    if (!fs.existsSync(promptLogPath)) {
      return null;
    }
    const raw = fs.readFileSync(promptLogPath, 'utf8');
    const lines = raw.split('\n').filter((line) => line && line.trim().length > 0);
    let match = null;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (
          parsed &&
          typeof parsed === 'object' &&
          parsed.type === 'ui_prompt' &&
          parsed.action === 'response' &&
          parsed.requestId === requestId
        ) {
          match = parsed;
        }
      } catch {
        // ignore parse errors
      }
    }
    return match;
  } catch {
    return null;
  }
}

function normalizeResponseStatus(status) {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (value === 'ok' || value === 'canceled' || value === 'timeout') {
    return value;
  }
  if (!value) return 'canceled';
  return 'canceled';
}

function safeTrim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTaskPriority(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  return undefined;
}

function normalizeTaskStatus(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v === 'todo' || v === 'doing' || v === 'blocked' || v === 'done') return v;
  return undefined;
}

function normalizeTags(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  list.forEach((tag) => {
    const t = safeTrim(tag);
    if (t) out.push(t);
  });
  return out;
}

function buildTaskConfirmChanges({ before, after }) {
  const original = Array.isArray(before) ? before : [];
  const final = Array.isArray(after) ? after : [];
  const originalById = new Map(original.map((t) => [t.draftId, t]));
  const finalById = new Map(final.map((t) => [t.draftId, t]));
  const added = final.filter((t) => t && typeof t === 'object' && t.draftId && !originalById.has(t.draftId));
  const removed = original.filter((t) => t && typeof t === 'object' && t.draftId && !finalById.has(t.draftId));
  const modified = [];
  final.forEach((t) => {
    if (!t || typeof t !== 'object') return;
    if (!t.draftId || !originalById.has(t.draftId)) return;
    const prev = originalById.get(t.draftId);
    if (!prev) return;
    const changed =
      safeTrim(prev.title) !== safeTrim(t.title) ||
      safeTrim(prev.details) !== safeTrim(t.details) ||
      safeTrim(prev.priority) !== safeTrim(t.priority) ||
      safeTrim(prev.status) !== safeTrim(t.status) ||
      normalizeTags(prev.tags).join(',') !== normalizeTags(t.tags).join(',');
    if (changed) {
      modified.push({ before: prev, after: t });
    }
  });
  return {
    added: added.map((t) => ({ title: safeTrim(t.title) })),
    removed: removed.map((t) => ({ title: safeTrim(t.title) })),
    modified: modified.map((pair) => ({
      before: { title: safeTrim(pair.before?.title) },
      after: { title: safeTrim(pair.after?.title) },
    })),
  };
}

function buildTaskConfirmSummary({ before, after, remark }) {
  const changes = buildTaskConfirmChanges({ before, after });
  const lines = [];
  if (changes.added.length > 0) {
    lines.push(`用户新增任务：${changes.added.map((t) => t.title).filter(Boolean).join('；')}`);
  }
  if (changes.removed.length > 0) {
    lines.push(`用户删除任务：${changes.removed.map((t) => t.title).filter(Boolean).join('；')}`);
  }
  if (changes.modified.length > 0) {
    lines.push(`用户变更任务：${changes.modified.map((t) => t.after.title).filter(Boolean).join('；')}`);
  }
  const remarkText = safeTrim(remark);
  if (remarkText) {
    lines.push(`用户备注：${remarkText}`);
  }
  return lines.join('\n');
}

function printHelp() {
  console.log(`Usage: node task-server.js [--root <path>] [--name <id>]

Options:
  --root <path>   Workspace root (default current directory)
  --name <id>     MCP server name (default task_manager)
  --help          Show help`);
}
