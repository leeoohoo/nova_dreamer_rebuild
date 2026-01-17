import readline from 'readline';

import * as colors from './colors.js';
import { createResponsePrinter } from './printer.js';
import {
  getCommandCompleter,
  handleCommand,
  handleSlashCommand,
  maybeHandleAutoSubagentRequest,
  resolveSystemPrompt,
} from './commands.js';
import { DEFAULT_SYSTEM_PROMPT } from './prompts.js';
import { createSubAgentManager } from './subagents/index.js';
import { setSubAgentContext } from './subagents/runtime.js';
import { runChatInput } from './ui/index.js';

import { createToolHistory } from './chat/tool-history.js';
import { chatWithContextRecovery, discardLatestTurn, ensureSessionId } from './chat/context-recovery.js';
import { createInputCollector, runComposeBox } from './chat/input.js';
import { createSummaryManager, estimateTokenCount, throwIfAborted } from './chat/summary.js';
import { appendRunPid, createTerminalControl, hardKillCurrentRunFromSignal } from './chat/terminal.js';
import { terminalPlatform } from './terminal/platform/index.js';

export async function chatLoop(initialClient, initialModel, session, options = {}) {
  let client = initialClient;
  let systemOverride = options.systemOverride;
  let streamResponses = options.stream !== undefined ? options.stream : true;
  let configPath = options.configPath || null;
  const systemConfigFromDb = options.systemConfigFromDb || null;
  const landConfigActive = options.landConfigActive === true;
  const landConfigPrompt =
    typeof options.landConfigPrompt === 'string' ? options.landConfigPrompt : undefined;
  const landConfigInfo =
    options.landConfigInfo && typeof options.landConfigInfo === 'object' ? options.landConfigInfo : null;
  let userPromptText =
    typeof options.userPrompt === 'string' ? options.userPrompt.trim() : '';
  let subagentUserPromptText =
    typeof options.subagentUserPrompt === 'string' ? options.subagentUserPrompt.trim() : '';
  const mainTools = typeof options.mainTools === 'function' ? options.mainTools : null;
  const promptStore = options.promptStore || null;
  const autoRouteEnabled = process.env.MODEL_CLI_AUTO_ROUTE === '1';
  const toolHistory = createToolHistory();
  const eventLogger = options.eventLogger || null;
  const onSessionSnapshot =
    typeof options.onSessionSnapshot === 'function' ? options.onSessionSnapshot : null;
  if (typeof options.onToolHistoryAvailable === 'function') {
    options.onToolHistoryAvailable(toolHistory);
  }
  const summaryManager = createSummaryManager(options);
  let pendingSummaryNow = false;
  const subAgentManager = createSubAgentManager({
    internalSystemPrompt: '',
  });
  const updateSessionReport =
    typeof options.updateSessionReport === 'function' ? options.updateSessionReport : null;
  const allowInlineUi =
    options.allowUi !== undefined
      ? options.allowUi
      : Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const updateSubContext = () =>
    setSubAgentContext({
      manager: subAgentManager,
      getClient: () => client,
      getCurrentModel: () => currentModel,
      userPrompt: userPromptText,
      subagentUserPrompt: subagentUserPromptText,
      subagentMcpAllowPrefixes: options.subagentMcpAllowPrefixes,
      toolHistory,
      registerToolResult: toolHistory
        ? (toolName, content) => toolHistory.add(toolName, content)
        : null,
      eventLogger,
  });
  updateSubContext();
  console.log(
    colors.cyan(
      `Connected to ${initialModel}. Type messages and press Enter to send. Use :help for inline commands.`
    )
  );

  const rl = createChatReadline({
    completer: getCommandCompleter({ subAgents: subAgentManager }),
  });
  const keepAliveOnClose = process.env.MODEL_CLI_UI_BRIDGE === '1';
  const inputBox = createInputCollector(rl, {
    prompt: colors.green('│ you> '),
    contPrompt: colors.green('│ ...> '),
    keepAliveOnClose,
  });

  let terminalControl = null;
  rl.on('SIGINT', () => {
    try {
      terminalControl?.writeStatus({ state: 'exited' });
    } catch {}
    // Ctrl+C should hard-stop everything (including MCP servers/sub-agent workers).
    hardKillCurrentRunFromSignal();
    // If hard kill failed for some reason, fall back to a normal exit.
    console.log('\nExiting chat.');
    rl.close();
    try {
      process.exit(130);
    } catch {
      // ignore
    }
  });

  const askLine = (promptText) => inputBox.ask(promptText);

  const runId = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
  const terminalSessionRoot =
    typeof process.env.MODEL_CLI_SESSION_ROOT === 'string' && process.env.MODEL_CLI_SESSION_ROOT.trim()
      ? process.env.MODEL_CLI_SESSION_ROOT.trim()
      : process.cwd();
  appendRunPid({ runId, sessionRoot: terminalSessionRoot, pid: process.pid, kind: 'cli' });
  let activeController = null;
  const abortCurrent = () => {
    if (activeController && !activeController.signal.aborted) {
      try {
        activeController.abort();
      } catch {
        // ignore
      }
    }
  };
  terminalControl = createTerminalControl({
    runId,
    sessionRoot: terminalSessionRoot,
    rl,
    onStop: abortCurrent,
    onAction: (cmd) => {
      const action = typeof cmd?.action === 'string' ? cmd.action.trim() : '';
      if (action === 'summary_now') {
        pendingSummaryNow = true;
      }
    },
  });
  terminalControl?.writeStatus({ state: 'idle' });

  // Setup global cleanup hooks for process exit and uncaught errors
  let cleanupHooksRegistered = false;
  const registerCleanupHooks = () => {
    if (cleanupHooksRegistered) return;
    cleanupHooksRegistered = true;

    // Update terminal status on normal exit
    process.on('exit', (code) => {
      try {
        terminalControl?.writeStatus({ state: 'exited' });
      } catch {}
    });

    // Handle uncaught exceptions - update status then propagate
    const originalUncaughtExceptionListeners = process.listeners('uncaughtException').slice();
    process.removeAllListeners('uncaughtException');
    process.on('uncaughtException', (err) => {
      try {
        terminalControl?.writeStatus({ state: 'exited' });
      } catch {}
      // Call original listeners
      for (const listener of originalUncaughtExceptionListeners) {
        try {
          listener(err);
        } catch {}
      }
      // If no listeners were present, default behavior
      if (originalUncaughtExceptionListeners.length === 0) {
        console.error('Uncaught Exception:', err);
        process.exit(1);
      }
    });

    // Handle unhandled rejections - update status then propagate
    const originalUnhandledRejectionListeners = process.listeners('unhandledRejection').slice();
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', (reason, promise) => {
      try {
        terminalControl?.writeStatus({ state: 'exited' });
      } catch {}
      // Call original listeners
      for (const listener of originalUnhandledRejectionListeners) {
        try {
          listener(reason, promise);
        } catch {}
      }
      // If no listeners were present, default behavior
      if (originalUnhandledRejectionListeners.length === 0) {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      }
    });
  };

  // Register hooks now that terminalControl is available
  registerCleanupHooks();


  let currentModel = initialModel;
  const maxToolPasses = Number.isFinite(options.maxToolPasses)
    ? Number(options.maxToolPasses)
    : undefined;
  let sawAnyUserInput = false;
  while (true) {
    let inputInfo;
    try {
      let inkResult;
      if (allowInlineUi) {
        inkResult = await runChatInput('you> ', {
          pause: () => {
             rl.pause();
             // Manually detach readline's keypress listener if necessary, or just rely on pause
             // In Node readline, pause() stops 'line' events but might not stop raw mode keypress reading if something else is doing it.
             // But here we just want to stop RL from echoing or handling line buffering.
          },
          resume: () => {
             rl.resume();
          }
        });
      }

      if (inkResult !== undefined) {
        if (inkResult === null) break;
        inputInfo = { text: inkResult };
        console.log(colors.green('│ you> ') + inkResult);
      } else {
        inputInfo = await inputBox.readMessage();
      }
      sawAnyUserInput = true;
    } catch (err) {
      const message = String(err?.message || '');
      if (message === 'Input closed') {
        if (!sawAnyUserInput) {
          // Signal early stdin-close so Windows launcher shims can retry with a different stdin strategy (with/without CONIN$).
          process.exitCode = 2;
        }
        console.log(
          colors.yellow(
            [
              '',
              '终端输入流已关闭，无法接收键盘输入。',
              'Windows 建议：',
              '- 如果你是从桌面版安装的命令：请打开一个新的终端窗口再试；或用 `cmd /c "aide-desktop chat"` 运行（旧版本可能是 `cmd /c "aide chat"`）。',
              '- 可尝试强制使用控制台输入：设置 `MODEL_CLI_FORCE_CONSOLE_STDIN=1`。',
              '- 若你希望仅由 UI 发送消息到该进程：设置 `MODEL_CLI_DISABLE_CONSOLE_STDIN=1`。',
              '',
            ].join('\n')
          )
        );
      }
      break;
    }
    const input = inputInfo?.text || '';
    const meta = inputInfo?.meta || {};
    const needsComposeUi = meta.multiline;
    let finalInput = input;
    if (needsComposeUi) {
      finalInput = await runComposeBox({
        initialText: input,
        meta,
        inputBox,
      });
      if (!finalInput) {
        continue;
      }
    }
    const hasNewline = finalInput.includes('\n');
    if (!finalInput) {
      if (pendingSummaryNow) {
        pendingSummaryNow = false;
        try {
          const did = await summaryManager.forceSummarize(session, client, currentModel);
          if (!did) {
            console.log(colors.yellow('未产生总结（对话可能过短或总结失败）。'));
          }
          updateSessionReport?.();
          if (onSessionSnapshot) {
            try {
              onSessionSnapshot(null);
            } catch {
              // ignore
            }
          }
        } catch (err) {
          if (err?.name === 'AbortError') {
            throw err;
          }
          console.error(colors.yellow(`[summary] Failed: ${err?.message || String(err)}`));
        }
      }
      continue;
    }
    if (finalInput.startsWith('/') && !hasNewline) {
      const slashResult = await handleSlashCommand(finalInput, {
        askLine,
        client,
        session,
        currentModel,
        streamResponses,
        systemOverride,
        configPath,
        systemConfigFromDb,
        landConfigActive,
        landConfigPrompt,
        landConfigInfo,
        allowUi: allowInlineUi,
        rl,
        toolHistory,
        promptStore,
        summaryManager,
        subAgents: subAgentManager,
        userPrompt: userPromptText,
        subagentUserPrompt: subagentUserPromptText,
        subagentMcpAllowPrefixes: options.subagentMcpAllowPrefixes,
        eventLogger,
        updateSessionReport,
      });
      if (slashResult?.type === 'reconfigure') {
        client = slashResult.client;
        configPath = slashResult.configPath;
        currentModel = slashResult.model;
        if (slashResult.stream !== undefined) {
          streamResponses = slashResult.stream;
        }
        systemOverride = slashResult.systemOverride;
        const nextPrompt =
          slashResult.sessionPrompt !== undefined
            ? slashResult.sessionPrompt
            : resolveSystemPrompt(client, currentModel, systemOverride, {
                configPath,
                systemConfigFromDb,
                landConfigPrompt,
              });
        session.reset(nextPrompt);
        session.setSessionId(null);
        updateSubContext();
        console.log(colors.yellow('Session updated. Conversation restarted.'));
        console.log(
          colors.cyan(
            `Connected to ${currentModel}. Type messages and press Enter to send. Use :help for inline commands.`
          )
        );
      } else if (slashResult?.type === 'switch-model') {
        currentModel = slashResult.model;
        const nextPrompt = slashResult.sessionPrompt;
        session.reset(nextPrompt);
        session.setSessionId(null);
        updateSubContext();
        console.log(colors.yellow(`Switched to model '${currentModel}'.`));
      } else if (slashResult?.type === 'prompt-update') {
        systemOverride = slashResult.useConfigDefault ? undefined : slashResult.systemOverride;
        const nextPrompt = resolveSystemPrompt(
          client,
          currentModel,
          systemOverride,
          { configPath, systemConfigFromDb, landConfigPrompt }
        );
        session.reset(nextPrompt);
        session.setSessionId(null);
        console.log(colors.yellow('System prompt updated for this conversation.'));
      } else if (slashResult?.type === 'tools-updated') {
        // Tools updated, no session reset needed usually, but context might need refresh if we cache anything
        // For now just continue
      }
      continue;
    }
    if (finalInput.startsWith(':') && !hasNewline) {
      const result = handleCommand(
        finalInput,
        client,
        session,
        currentModel,
        systemOverride,
        configPath,
        systemConfigFromDb,
        { landConfigPrompt }
      );
      if (result === null) {
        break;
      }
      currentModel = result;
      continue;
    }

    const controller = new AbortController();
    activeController = controller;
    const { signal } = controller;
    terminalControl?.writeStatus({ state: 'running', currentMessage: finalInput });

    try {
      const sessionId = ensureSessionId(session, finalInput);
      eventLogger?.log?.('user', { text: finalInput, sessionId });
      if (autoRouteEnabled) {
        const autoHandled = await maybeHandleAutoSubagentRequest(finalInput, {
          rawInput: finalInput,
          subAgents: subAgentManager,
          client,
          currentModel,
          toolHistory,
          session,
          eventLogger,
          updateSessionReport,
          userPrompt: userPromptText,
          subagentUserPrompt: subagentUserPromptText,
          subagentMcpAllowPrefixes: options.subagentMcpAllowPrefixes,
          signal,
        });
        if (autoHandled) {
          continue;
        }
      }

      session.addUser(finalInput);
      let printer = null;
      try {
        await summaryManager.maybeSummarize(session, client, currentModel, { signal });
        printer = createResponsePrinter(currentModel, streamResponses, {
          registerToolResult: (toolName, content) => {
            const id = toolHistory.add(toolName, content);
            updateSessionReport?.();
            return id;
          },
        });
        if (signal && typeof signal.addEventListener === 'function') {
          signal.addEventListener(
            'abort',
            () => {
              try {
                printer?.onAbort?.();
              } catch {
                // ignore
              }
            },
            { once: true }
          );
        }
        // Capture streamed content/reasoning so the event log (and UI) can show
        // both AI thinking and final answer even when providers don't return
        // a non-empty finalText in streaming mode.
        let streamedContent = '';
        let streamedReasoning = '';
        const onToken = (chunk) => {
          if (signal.aborted) return;
          printer?.onToken?.(chunk);
          if (typeof chunk === 'string' && chunk.length > 0) {
            streamedContent += chunk;
          }
        };
        const onReasoning = (chunk) => {
          if (signal.aborted) return;
          printer?.onReasoning?.(chunk);
          if (typeof chunk === 'string' && chunk.length > 0) {
            streamedReasoning += chunk;
          }
        };

        const keypressStream = rl?.input || process.stdin;
        const wasRaw = keypressStream?.isRaw;
        const keyHandler = (_ch, key) => {
          if (key && key.name === 'escape') {
            if (!signal.aborted) {
              process.stdout.write(colors.yellow('\n(已中止)\n'));
              controller.abort();
            }
          }
        };
        if (keypressStream?.isTTY && typeof keypressStream.setRawMode === 'function') {
          readline.emitKeypressEvents(keypressStream, rl);
          keypressStream.on('keypress', keyHandler);
          keypressStream.setRawMode(true);
          keypressStream.resume();
        }

        let finalText;
        try {
          const chatOptions = {
            stream: streamResponses,
            toolsOverride: mainTools ? mainTools(currentModel) : undefined,
            maxToolPasses,
            onBeforeRequest: async () => {
              if (!pendingSummaryNow) return;
              pendingSummaryNow = false;
              await summaryManager.forceSummarize(session, client, currentModel, { signal });
              updateSessionReport?.();
            },
            onToken,
            onReasoning,
            onAssistantStep: (step) => {
              const reasoning = typeof step?.reasoning === 'string' ? step.reasoning.trim() : '';
              const text = typeof step?.text === 'string' ? step.text.trim() : '';
              const iteration = step?.iteration;
              const tools = Array.isArray(step?.toolCalls)
                ? step.toolCalls
                    .map((c) => c?.function?.name || '')
                    .filter(Boolean)
                : [];
              if (reasoning) {
                eventLogger?.log?.('assistant_thinking', {
                  text: reasoning,
                  iteration,
                  tools,
                });
              }
              if (text) {
                eventLogger?.log?.('assistant', {
                  text,
                  iteration,
                  stage: 'pre_tool',
                  tools,
                });
              }
            },
            onToolCall: (info) => {
              if (signal.aborted) return;
              printer?.onToolCall?.(info);
              eventLogger?.log?.('tool_call', info);
            },
            onToolResult: (info) => {
              if (signal.aborted) return;
              printer?.onToolResult?.(info);
              eventLogger?.log?.('tool_result', info);
            },
            caller: 'main',
            signal,
          };
          finalText = await chatWithContextRecovery({
            client,
            model: currentModel,
            session,
            options: chatOptions,
            summaryManager,
          });
        } finally {
          if (keypressStream?.isTTY && typeof keypressStream.setRawMode === 'function') {
            try {
              keypressStream.setRawMode(Boolean(wasRaw));
            } catch {
              // ignore
            }
            keypressStream.removeListener('keypress', keyHandler);
          }
        }

        if (pendingSummaryNow) {
          pendingSummaryNow = false;
          await summaryManager.forceSummarize(session, client, currentModel, { signal });
        } else {
          await summaryManager.maybeSummarize(session, client, currentModel, { signal });
        }
        updateSessionReport?.();
        if (onSessionSnapshot) {
          try {
            onSessionSnapshot(null);
          } catch {
            // ignore
          }
        }
        printer?.onComplete?.(finalText);
        const reasoningText = streamedReasoning.trim();
        if (reasoningText) {
          eventLogger?.log?.('assistant_thinking', { text: reasoningText });
        }
        const finalTextRaw = typeof finalText === 'string' ? finalText : '';
        const assistantTextForLog = finalTextRaw.trim().length > 0 ? finalTextRaw : streamedContent;
        eventLogger?.log?.('assistant', { text: assistantTextForLog });
      } catch (err) {
        try {
          printer?.onAbort?.();
        } catch {
          // ignore
        }
        reportRequestJsonParseError(err, session);
        discardLatestTurn(session);
        if (err.name === 'AbortError' || err.message.includes('aborted')) {
          console.log(colors.yellow('对话已由用户中止。'));
        } else {
          console.error(colors.yellow(`Request failed: ${err.message}`));
        }
      }
    } finally {
      activeController = null;
      terminalControl?.writeStatus({ state: 'idle' });
    }
  }
  terminalControl?.writeStatus({ state: 'exited' });
  terminalControl?.close();
  rl.close();
  setSubAgentContext(null);
}

function createChatReadline({ completer } = {}) {
  const output = process.stdout;
  const { input, close } = terminalPlatform.createChatReadlineInput();
  const rl = readline.createInterface({
    input,
    output,
    historySize: 0,
    completer,
    terminal: Boolean(output?.isTTY || input?.isTTY),
  });
  if (close) {
    let cleaned = false;
    rl.on('close', () => {
      if (cleaned) return;
      cleaned = true;
      try {
        close();
      } catch {
        // ignore
      }
    });
  }
  return rl;
}

function reportRequestJsonParseError(err, session) {
  const message = String(err?.message || '');
  if (!message) return;
  if (!message.toLowerCase().includes('failed to parse the request body as json')) {
    return;
  }
  const match = message.match(/messages\[(\d+)\]\.content/i);
  if (!match) {
    console.error(
      colors.yellow(
        '提示：服务端报告请求 JSON 解析失败；通常是某条 message 内容过大或包含异常控制字符。可尝试缩短输入、减少工具输出，或开启 MODEL_CLI_LOG_REQUEST=1 排查。'
      )
    );
    return;
  }
  const index = Number(match[1]);
  if (!Number.isInteger(index) || index < 0) {
    return;
  }
  const sentMessages =
    session && typeof session.asDicts === 'function' ? session.asDicts() : session?.messages;
  if (!Array.isArray(sentMessages) || index >= sentMessages.length) {
    console.error(
      colors.yellow(
        `提示：服务端报告 messages[${match[1]}].content JSON 解析失败，但本地无法定位该 message（可能已被裁剪/清理）。`
      )
    );
    return;
  }
  const target = sentMessages[index];
  const role = target?.role || 'unknown';
  const content = typeof target?.content === 'string' ? target.content : String(target?.content || '');
  const snippetLimit = 240;
  const snippet = content
    .slice(0, snippetLimit)
    .replace(/\r?\n/g, '\\n');
  const suffix = content.length > snippetLimit ? '...' : '';
  const extra =
    role === 'tool' && target?.tool_call_id
      ? ` tool_call_id=${String(target.tool_call_id)}`
      : '';
  console.error(
    colors.yellow(
      `提示：服务端解析 messages[${index}].content 失败（role=${role}${extra}，len=${content.length}）。`
    )
  );
  if (snippet) {
    console.error(colors.dim(`content[0:${snippetLimit}]=${snippet}${suffix}`));
  }
  console.error(
    colors.dim(
      '建议：该条内容通常来自“工具输出/粘贴的大段文本”。可尝试缩短输出（更精确的命令/grep）、清理会话，或设置 MODEL_CLI_MAX_TOOL_RESULT_CHARS 更小以避免请求过大。'
    )
  );
}


export { DEFAULT_SYSTEM_PROMPT };
