import fs from 'fs';
import path from 'path';
import { resolveTerminalsDir } from '../../shared/state-paths.js';

import { registerTool, listTools } from './registry.js';
import { ChatSession, generateSessionId } from '../session.js';
import { getSubAgentContext } from '../subagents/runtime.js';
import { selectAgent } from '../subagents/selector.js';
import { describeModelError, resolveSubagentInvocationModel, shouldFallbackToCurrentModelOnError } from '../subagents/model.js';
import { filterSubagentTools, withSubagentGuardrails } from '../subagents/tooling.js';
import { buildUserPromptMessages } from '../prompts.js';
import { appendRunPid } from '../chat/terminal.js';

registerTool({
  name: 'get_current_time',
  description: 'Return the current timestamp in ISO 8601 format.',
  parameters: {
    type: 'object',
    properties: {},
  },
  handler: async () => new Date().toISOString(),
});

registerTool({
  name: 'echo_text',
  description: 'Echo back the provided text string.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to echo back.' },
    },
    required: ['text'],
  },
  handler: async ({ text }) => String(text ?? ''),
});

registerTool({
  name: 'invoke_sub_agent',
  description:
    'Invoke a specialized sub-agent from the local marketplace. Automatically selects the best agent based on requested skills/category if agent_id is omitted.',
  parameters: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', description: 'Specific sub-agent identifier to use.' },
      category: { type: 'string', description: 'Preferred plugin/category when auto-selecting.' },
      skills: {
        type: 'array',
        description: 'List of skill identifiers to activate or prefer.',
        items: { type: 'string' },
      },
      task: { type: 'string', description: 'Task description for the sub-agent.' },
    },
    required: ['task'],
  },
  handler: async ({ agent_id: agentId, category, skills = [], task }, toolContext = {}) => {
    const signal = toolContext?.signal;
    const context = getSubAgentContext();
    if (!context || !context.manager) {
      throw new Error('Sub-agent runtime unavailable. Ensure chat session initialized.');
    }
    const manager = context.manager;
    const clientProvider = typeof context.getClient === 'function' ? context.getClient : null;
    const client = clientProvider ? clientProvider() : null;
    const registerToolResult =
      typeof context.registerToolResult === 'function' ? context.registerToolResult : null;
    const eventLogger =
      context.eventLogger && typeof context.eventLogger.log === 'function'
        ? context.eventLogger
        : null;
    if (!client) {
      throw new Error('Sub-agent runtime missing client context.');
    }
    // 确保有可用 agent（若初始状态为空则自动安装默认插件）
    await ensureAgentsAvailable(manager);
    const normalizedSkills = Array.isArray(skills)
      ? skills.map((entry) => String(entry).trim()).filter(Boolean)
      : [];
    let agentRef = selectAgent(manager, { agentId, category, skills: normalizedSkills });
    if (!agentRef) {
      throw new Error('No suitable sub-agent is available. Install plugins via /sub install.');
    }
    let systemPrompt;
    let usedSkills = [];
    let internalPrompt = '';
    try {
      const promptResult = manager.buildSystemPrompt(agentRef, normalizedSkills);
      internalPrompt = promptResult.internalPrompt || '';
      systemPrompt = withTaskTracking(promptResult.systemPrompt, internalPrompt);
      usedSkills = promptResult.usedSkills || [];
    } catch (err) {
      throw new Error(`Failed to build sub-agent prompt: ${err.message}`);
    }
    const configuredModel = typeof agentRef.agent.model === 'string' ? agentRef.agent.model.trim() : '';
    const currentModel =
      typeof context.getCurrentModel === 'function' ? context.getCurrentModel() : null;
    let activeModel = resolveSubagentInvocationModel({
      configuredModel,
      currentModel,
      client,
    });
    const fallbackModel = typeof currentModel === 'string' ? currentModel.trim() : '';
    const canFallbackToMain = Boolean(fallbackModel && activeModel && activeModel !== fallbackModel);
    let usedFallbackModel = false;
    const subSessionId = generateSessionId(task || '');
    const guardedPrompt = withSubagentGuardrails(systemPrompt);
    const extraSystemPrompts = buildUserPromptMessages(
      context.subagentUserPrompt,
      'subagent_user_prompt'
    );
    const subSession = new ChatSession(guardedPrompt, {
      sessionId: subSessionId,
      trailingSystemPrompts: internalPrompt ? [internalPrompt] : [],
      extraSystemPrompts,
    });
    subSession.addUser(task);
    if (registerToolResult) {
      try {
        registerToolResult(`[sub:${agentRef.agent.id}] start`, `task=${task}`);
      } catch {
        // ignore
      }
    }
    if (configuredModel && fallbackModel && configuredModel !== activeModel && activeModel === fallbackModel) {
      const notice = `子流程模型 "${configuredModel}" 不可用或未配置 Key，本轮使用主流程模型 "${fallbackModel}"。`;
      try {
        registerToolResult?.(`[sub:${agentRef.agent.id}] model_fallback`, notice);
      } catch {
        // ignore
      }
      eventLogger?.log?.('subagent_notice', {
        agent: agentRef.agent.id,
        text: notice,
        source: 'system',
        kind: 'agent',
        fromModel: configuredModel,
        toModel: fallbackModel,
        reason: 'model_unavailable',
      });
    }
    eventLogger?.log?.('subagent_start', { agent: agentRef.agent.id, task });
    const allowMcpPrefixes = Array.isArray(context.subagentMcpAllowPrefixes)
      ? context.subagentMcpAllowPrefixes
      : null;
    const toolsOverride = filterSubagentTools(listTools(), { allowMcpPrefixes });
    const logs = [];
    const summaryManager = createSummaryManagerForSubagent();

    const runId = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
    const sessionRoot =
      typeof process.env.MODEL_CLI_SESSION_ROOT === 'string' && process.env.MODEL_CLI_SESSION_ROOT.trim()
        ? process.env.MODEL_CLI_SESSION_ROOT.trim()
        : process.cwd();
    const pendingCorrections = [];
    let activeController = null;
    const abortActive = () => {
      if (activeController && !activeController.signal.aborted) {
        try {
          activeController.abort();
        } catch {
          // ignore
        }
      }
    };
    if (signal && typeof signal.addEventListener === 'function') {
      try {
        if (signal.aborted) throw createAbortError();
        signal.addEventListener('abort', abortActive, { once: true });
      } catch {
        // ignore
      }
    }

    const acceptCorrectionTarget = (target) => {
      const value = typeof target === 'string' ? target.trim() : '';
      if (!value || value === 'all') return true;
      if (value === 'subagent_inproc') return true;
      return false;
    };

    const inboxListener =
      runId && sessionRoot
        ? createRunInboxListener({
            runId,
            sessionRoot,
            consumerId: `cli_subagent_inproc_${process.pid}`,
            skipExisting: true,
            onEntry: (entry) => {
              if (!entry || typeof entry !== 'object') return;
              if (String(entry.type || '') !== 'correction') return;
              if (!acceptCorrectionTarget(entry.target)) return;
              const text = typeof entry.text === 'string' ? entry.text.trim() : '';
              if (!text) return;
              pendingCorrections.push(text);
              eventLogger?.log?.('subagent_user', {
                agent: agentRef.agent.id,
                text,
                source: 'ui',
                target: typeof entry.target === 'string' ? entry.target : undefined,
              });
              eventLogger?.log?.('subagent_notice', {
                agent: agentRef.agent.id,
                text: '收到纠正：已中止当前请求，正在带着纠正继续执行…',
                source: 'ui',
              });
              abortActive();
            },
          })
        : null;

    // Mark this CLI PID as "in-process subagent" so the UI can auto-route corrections.
    if (runId && sessionRoot) {
      try {
        appendRunPid({ runId, sessionRoot, pid: process.pid, kind: 'subagent_inproc' });
      } catch {
        // ignore
      }
    }

    const applyCorrections = () => {
      if (pendingCorrections.length === 0) return;
      const merged = pendingCorrections.splice(0, pendingCorrections.length);
      const combined = merged.join('\n');
      subSession.addUser(`【用户纠正】\n${combined}`);
    };

    let responseText = '';
    try {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (signal?.aborted) throw createAbortError();
        applyCorrections();
        responseText = '';
        const controller = new AbortController();
        activeController = controller;
        try {
          // eslint-disable-next-line no-await-in-loop
          await chatWithRetry(
            client,
            activeModel,
            subSession,
            {
              stream: true,
              toolsOverride,
              caller: 'subagent',
              signal: controller.signal,
              onToken: (t) => {
                responseText += t;
              },
              onAssistantStep: (step) => {
                const reasoning = typeof step?.reasoning === 'string' ? step.reasoning.trim() : '';
                const text = typeof step?.text === 'string' ? step.text.trim() : '';
                const iteration = step?.iteration;
                const tools = Array.isArray(step?.toolCalls)
                  ? step.toolCalls.map((c) => c?.function?.name || '').filter(Boolean)
                  : [];
                if (reasoning) {
                  eventLogger?.log?.('subagent_thinking', {
                    agent: agentRef.agent.id,
                    text: reasoning,
                    iteration,
                    tools,
                  });
                }
                if (text) {
                  eventLogger?.log?.('subagent_assistant', {
                    agent: agentRef.agent.id,
                    text,
                    iteration,
                    stage: 'pre_tool',
                    tools,
                  });
                }
              },
              onToolCall: ({ tool, args }) => {
                logs.push({ event: 'tool_call', tool, args });
                if (registerToolResult) {
                  try {
                    registerToolResult(
                      `[sub:${agentRef.agent.id}] ${tool}`,
                      `call args: ${JSON.stringify(args).slice(0, 400)}`
                    );
                  } catch {
                    // ignore
                  }
                }
                eventLogger?.log?.('subagent_tool_call', { agent: agentRef.agent.id, tool, args });
              },
              onToolResult: ({ tool, result }) => {
                logs.push({ event: 'tool_result', tool, result });
                if (registerToolResult) {
                  try {
                    registerToolResult(`[sub:${agentRef.agent.id}] ${tool}`, result);
                  } catch {
                    // ignore logging failures
                  }
                }
                eventLogger?.log?.('subagent_tool_result', { agent: agentRef.agent.id, tool, result });
              },
            },
            2
          );
          break;
        } catch (err) {
          if (err?.name === 'AbortError') {
            if (signal?.aborted) {
              throw err;
            }
            if (pendingCorrections.length > 0) {
              continue;
            }
          }
          if (!usedFallbackModel && canFallbackToMain && shouldFallbackToCurrentModelOnError(err)) {
            const failedModel = activeModel;
            const info = describeModelError(err);
            const detail = [info.reason, info.status ? `HTTP ${info.status}` : null, info.message]
              .filter(Boolean)
              .join(' - ');
            const notice = `子流程模型 "${failedModel}" 调用失败（${detail || info.name}），本轮回退到主流程模型 "${fallbackModel}"。`;
            usedFallbackModel = true;
            activeModel = fallbackModel;
            try {
              registerToolResult?.(`[sub:${agentRef.agent.id}] model_fallback`, notice);
            } catch {
              // ignore
            }
            eventLogger?.log?.('subagent_notice', {
              agent: agentRef.agent.id,
              text: notice,
              source: 'system',
              kind: 'agent',
              fromModel: failedModel,
              toModel: fallbackModel,
              reason: info.reason,
              error: info,
            });
            continue;
          }
          throw err;
        } finally {
          if (activeController === controller) {
            activeController = null;
          }
        }
      }
    } finally {
      try {
        inboxListener?.close?.();
      } catch {
        // ignore
      }
      if (runId && sessionRoot) {
        try {
          appendRunPid({ runId, sessionRoot, pid: process.pid, kind: 'cli' });
        } catch {
          // ignore
        }
      }
    }

    if (registerToolResult) {
      try {
        registerToolResult(`[sub:${agentRef.agent.id}] done`, responseText ? responseText.slice(0, 400) : '<no text>');
      } catch {
        // ignore
      }
    }
    eventLogger?.log?.('subagent_done', {
      agent: agentRef.agent.id,
      model: activeModel,
      responsePreview: responseText ? responseText.slice(0, 400) : '',
    });
    summaryManager.maybeSummarize(subSession);
    const includeLogsInReturn = process.env.MODEL_CLI_SUBAGENT_RETURN_LOGS === '1';
    if (!includeLogsInReturn) {
      return (responseText || '').trim();
    }
    const logText = formatLogs(logs);
    return [responseText || '', '', '[logs]', logText || 'No tool logs recorded.'].join('\n').trim();
  },
});

async function ensureAgentsAvailable(manager) {
  if (manager.listAgents().length > 0) {
    return;
  }
  // 尝试安装 marketplace 默认插件
  try {
    const marketplace = manager.listMarketplace();
    marketplace.forEach((entry) => {
      try {
        manager.install(entry.id);
      } catch {
        // ignore individual failures
      }
    });
  } catch {
    // ignore install errors
  }
  // 触发一次读取以刷新缓存
  manager.listAgents();
}

function ensureDir(dirPath) {
  if (!dirPath) return;
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

function touchFile(filePath) {
  if (!filePath) return;
  try {
    ensureDir(path.dirname(filePath));
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
  } catch {
    // ignore
  }
}

function readCursor(cursorPath) {
  if (!cursorPath) return 0;
  try {
    if (!fs.existsSync(cursorPath)) return 0;
    const raw = fs.readFileSync(cursorPath, 'utf8').trim();
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  } catch {
    return 0;
  }
}

function persistCursor(cursorPath, cursor) {
  if (!cursorPath) return;
  const value = Number.isFinite(cursor) && cursor >= 0 ? Math.floor(cursor) : 0;
  try {
    const tmpPath = `${cursorPath}.tmp`;
    fs.writeFileSync(tmpPath, `${value}\n`, 'utf8');
    fs.renameSync(tmpPath, cursorPath);
  } catch {
    // ignore
  }
}

function createRunInboxListener({ runId, sessionRoot, consumerId, onEntry, skipExisting } = {}) {
  const rid = typeof runId === 'string' ? runId.trim() : '';
  const root = typeof sessionRoot === 'string' ? sessionRoot.trim() : '';
  if (!rid || !root) return null;
  const cb = typeof onEntry === 'function' ? onEntry : null;
  if (!cb) return null;
  const consumer = typeof consumerId === 'string' && consumerId.trim() ? consumerId.trim() : String(process.pid);
  const dir = resolveTerminalsDir(root);
  const inboxPath = path.join(dir, `${rid}.inbox.jsonl`);
  const cursorPath = path.join(dir, `${rid}.inbox.${consumer}.cursor`);
  ensureDir(dir);
  touchFile(inboxPath);

  let cursor = readCursor(cursorPath);
  if (skipExisting === true && !fs.existsSync(cursorPath)) {
    try {
      cursor = fs.statSync(inboxPath).size;
      persistCursor(cursorPath, cursor);
    } catch {
      // ignore
    }
  }
  let partial = '';
  let watcher = null;
  let poll = null;
  let draining = false;

  const drain = () => {
    if (draining) return;
    draining = true;
    try {
      const buf = fs.readFileSync(inboxPath);
      const total = buf.length;
      if (cursor > total) cursor = 0;
      if (total <= cursor) return;
      const chunk = buf.slice(cursor);
      cursor = total;
      persistCursor(cursorPath, cursor);
      partial += chunk.toString('utf8');
      const lines = partial.split('\n');
      partial = lines.pop() || '';
      lines.forEach((line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return;
        try {
          cb(JSON.parse(trimmed));
        } catch {
          // ignore parse errors
        }
      });
    } catch {
      // ignore
    } finally {
      draining = false;
    }
  };

  try {
    watcher = fs.watch(inboxPath, { persistent: false }, () => drain());
  } catch {
    watcher = null;
  }
  poll = setInterval(drain, 650);
  if (poll && typeof poll.unref === 'function') poll.unref();
  drain();

  const close = () => {
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

  return { close };
}

function createAbortError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

async function chatWithRetry(client, model, session, options, retries = 1) {
  let attempt = 0;
  let lastError;
  while (attempt <= retries) {
    try {
      return await client.chat(model, session, options);
    } catch (err) {
      lastError = err;
      if (!isTransientError(err) || attempt === retries) {
        throw err;
      }
      const delay = 200 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
  throw lastError;
}

function isTransientError(err) {
  if (!err) return false;
  const code = (err.code || '').toString().toLowerCase();
  const msg = (err.message || '').toLowerCase();
  const transientCodes = ['econnreset', 'etimedout', 'eai_again', 'enotfound', 'socket hang up'];
  if (transientCodes.includes(code)) return true;
  return (
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('timeout') ||
    msg.includes('network') ||
    msg.includes('connection reset')
  );
}

function formatLogs(logs = []) {
  if (!Array.isArray(logs) || logs.length === 0) {
    return 'No tool logs recorded.';
  }
  return logs
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      if (entry.event === 'tool_call') {
        return `-> ${entry.tool} ${JSON.stringify(entry.args || {})}`;
      }
      if (entry.event === 'tool_result') {
        const preview =
          typeof entry.result === 'string'
            ? entry.result.slice(0, 200)
            : JSON.stringify(entry.result || {}).slice(0, 200);
        return `<- ${entry.tool} ${preview}`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function withTaskTracking(systemPrompt, internalPrompt = '') {
  const trackingBlock = [
    'Task tracking rules:',
    '- First action: call mcp_task_manager_add_task (title=concise ask, details=context/acceptance). Mention the task ID in your reply.',
    '- Progress: use mcp_task_manager_update_task; completion: call mcp_task_manager_complete_task with a completion note (what was delivered + validation). If you lack access, say so.',
  ].join('\n');
  const promptText = (systemPrompt || '').trim();
  const combinedText = `${internalPrompt || ''}\n${promptText}`;
  if (combinedText.includes('mcp_task_manager_add_task')) {
    return promptText;
  }
  return `${trackingBlock}\n\n${promptText}`.trim();
}

function createSummaryManagerForSubagent() {
  const defaultThreshold = 60000;
  const envRaw = process.env.MODEL_CLI_SUMMARY_TOKENS;
  const envThreshold =
    envRaw === undefined || envRaw === null || String(envRaw).trim() === ''
      ? undefined
      : Number(envRaw);
  const threshold = [envThreshold, defaultThreshold].find((value) => Number.isFinite(value));
  return {
    maybeSummarize(session) {
      if (!(threshold > 0)) return;
      const messages = session.messages || [];
      const tokenCount = estimateTokenCount(messages);
      if (tokenCount <= threshold) return;
      summarizeSession(session);
    },
  };
}

function estimateTokenCount(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, msg) => {
    if (!msg || !msg.content) return sum;
    const text = Array.isArray(msg.content)
      ? msg.content.map((e) => (typeof e === 'string' ? e : e?.text || '')).join(' ')
      : String(msg.content);
    return sum + Math.ceil(Buffer.byteLength(text, 'utf8') / 3);
  }, 0);
}

function summarizeSession(session) {
  const lastUser = (() => {
    for (let i = session.messages.length - 1; i >= 0; i -= 1) {
      const msg = session.messages[i];
      if (msg && msg.role === 'user') {
        return { ...msg };
      }
    }
    return null;
  })();
  const historyText = session.messages
    .map((m) => `${m.role || 'unknown'}: ${typeof m.content === 'string' ? m.content : ''}`)
    .join('\n');
  const summary = `【Sub-agent summary】\n${historyText.slice(-5000)}`;
  const retained = [];
  if (session.systemPrompt) {
    retained.push({ role: 'system', content: session.systemPrompt });
  }
  if (typeof session.getExtraSystemPrompts === 'function') {
    retained.push(...session.getExtraSystemPrompts());
  }
  retained.push({ role: 'system', content: summary, name: 'conversation_summary' });
  if (lastUser) {
    retained.push(lastUser);
  }
  session.messages = retained;
}
