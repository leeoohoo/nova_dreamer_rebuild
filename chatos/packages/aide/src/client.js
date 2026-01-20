import { createProvider } from './providers/index.js';
import { resolveToolset } from './tools/index.js';
import {
  createAbortError,
  ensureTaskAddPayload,
  formatToolResultText,
  maybeAttachSessionIdForTaskTool,
  normalizeToolCalls,
  parseToolArguments,
  raceWithAbort,
  sanitizeToolResultForSession,
  throwIfAborted,
} from './client-helpers.js';

export { _internal } from './client-helpers.js';

export class ModelClient {
  constructor(config) {
    this.config = config;
    this.providerCache = new Map();
  }

  getModelNames() {
    return Object.keys(this.config.models);
  }

  getDefaultModel() {
    return this.config.getModel(null).name;
  }

  async chat(modelName, session, options = {}) {
    const settings = this.config.getModel(modelName);
    const provider = this.#getOrCreateProvider(settings);
    const shouldLogRequest = process.env.MODEL_CLI_LOG_REQUEST === '1';
    const toolNamesOverride = options.toolsOverride;
    const disableTools = options.disableTools === true;
    const toolset = disableTools
      ? []
      : resolveToolset(
          Array.isArray(toolNamesOverride) && toolNamesOverride.length > 0 ? toolNamesOverride : settings.tools
        );
    const stream = options.stream !== false;
    const onBeforeRequest = typeof options.onBeforeRequest === 'function' ? options.onBeforeRequest : null;

    const providerOptions = {
      stream,
      tools: toolset.map((tool) => tool.definition),
      onToken: options.onToken,
      onReasoning: options.onReasoning,
      signal: options.signal,
    };

    const maxToolPasses = options.maxToolPasses ?? 240;
    let iteration = 0;
    const caller = typeof options?.caller === 'string' && options.caller.trim() ? options.caller.trim() : '';
    const workdir = typeof options?.workdir === 'string' ? options.workdir.trim() : '';
    while (iteration < maxToolPasses) {
      throwIfAborted(options.signal);
      if (onBeforeRequest) {
        // Allow callers to inject maintenance work (e.g. summary compaction)
        // at safe boundaries before each model call.
        await onBeforeRequest({ iteration, model: settings.name, session });
      }
      throwIfAborted(options.signal);
      const messages = session.asDicts();
      if (shouldLogRequest) {
        const preview = {
          model: settings.name,
          iteration,
          stream,
          tools: Array.isArray(providerOptions.tools)
            ? providerOptions.tools.map((t) => t?.function?.name || t?.name || 'unknown')
            : [],
          messages,
        };
        // stderr to avoid interfering with CLI output/streams
        console.error('[model-cli] request payload:', JSON.stringify(preview, null, 2));
      }
      const result = await raceWithAbort(provider.complete(messages, providerOptions), options.signal);
      throwIfAborted(options.signal);
      const finalText = (result.content ?? '').trim();
      const toolCalls = normalizeToolCalls(result.toolCalls);
      const supportsReasoning =
        typeof provider.supportsReasoningContent === 'function' ? provider.supportsReasoningContent() : false;
      const reasoningContent = typeof result.reasoning === 'string' ? result.reasoning : supportsReasoning ? '' : undefined;
      const assistantMeta =
        reasoningContent !== undefined && reasoningContent !== null
          ? { reasoning_content: reasoningContent }
          : supportsReasoning
            ? { reasoning_content: '' }
            : null;
      if (toolCalls.length > 0) {
        if (disableTools) {
          session.addAssistant(finalText, null, assistantMeta);
          return finalText;
        }
        // Emit the assistant step that triggered tool calls so the event log/UI
        // can show intermediate thinking/content during tool scheduling.
        if (typeof options.onAssistantStep === 'function') {
          try {
            options.onAssistantStep({
              text: finalText,
              reasoning: reasoningContent,
              toolCalls,
              iteration,
              model: settings.name,
            });
          } catch {
            // ignore callback errors
          }
        }
        const checkpoint = session.checkpoint();
        session.addAssistant(finalText, toolCalls, assistantMeta);
        try {
          for (const call of toolCalls) {
            throwIfAborted(options.signal);
            const target = toolset.find((tool) => tool.name === call.function?.name);
            if (!target) {
              const errMsg = `Tool "${call.function?.name}" is not registered but was requested by the model`;
              session.addToolResult(call.id, `[error] ${errMsg}`);
              options.onToolResult?.({
                tool: call.function?.name || 'unknown',
                callId: call.id,
                result: `[error] ${errMsg}`,
              });
              continue;
            }
            const argsRaw = call.function?.arguments || '{}';
            let parsedArgs = {};
            try {
              parsedArgs = parseToolArguments(target.name, argsRaw, target.definition?.function?.parameters);
            } catch (err) {
              const errText = `[error] Failed to parse tool arguments: ${err.message}`;
              session.addToolResult(call.id, errText);
              options.onToolResult?.({
                tool: target.name,
                callId: call.id,
                result: errText,
              });
              continue;
            }
            const hydratedArgs = ensureTaskAddPayload(target.name, parsedArgs, session);
            const finalArgs = maybeAttachSessionIdForTaskTool(target.name, hydratedArgs, session);
            options.onToolCall?.({
              tool: target.name,
              callId: call.id,
              args: finalArgs,
            });
            try {
              const toolResult = await target.handler(finalArgs, {
                model: settings.name,
                session,
                signal: options.signal,
                toolCallId: call.id,
                ...(caller ? { caller } : {}),
                ...(workdir ? { workdir } : {}),
              });
              const toolResultText = formatToolResultText(toolResult);
              const toolResultForSession = sanitizeToolResultForSession(toolResultText, {
                tool: target.name,
              });
              session.addToolResult(call.id, toolResultForSession);
              options.onToolResult?.({
                tool: target.name,
                callId: call.id,
                result: toolResultText,
              });
            } catch (err) {
              if (err?.name === 'AbortError' || options.signal?.aborted) {
                throw err?.name === 'AbortError' ? err : createAbortError();
              }
              const errText = `[error] Tool "${target.name}" failed: ${err.message || err}`;
              session.addToolResult(call.id, errText);
              options.onToolResult?.({
                tool: target.name,
                callId: call.id,
                result: errText,
              });
            }
          }
        } catch (err) {
          if (err?.name === 'AbortError' || options.signal?.aborted) {
            session.restore(checkpoint);
          }
          throw err;
        }
        iteration += 1;
        continue;
      }
      session.addAssistant(finalText, null, assistantMeta);
      return finalText;
    }
    throw new Error('Too many consecutive tool calls. Aborting.');
  }

  #getOrCreateProvider(settings) {
    let provider = this.providerCache.get(settings.name);
    if (!provider) {
      provider = createProvider(settings.provider, settings);
      this.providerCache.set(settings.name, provider);
    }
    return provider;
  }
}
