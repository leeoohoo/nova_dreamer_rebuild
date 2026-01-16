import * as colors from '../colors.js';
import { ChatSession, generateSessionId } from '../session.js';
import { createResponsePrinter } from '../printer.js';
import { buildUserPromptMessages } from '../prompts.js';
import { routeCommandWithModel, routeWithModel } from '../subagents/router.js';
import { describeModelError, resolveSubagentInvocationModel, shouldFallbackToCurrentModelOnError } from '../subagents/model.js';
import { filterSubagentTools, withSubagentGuardrails } from '../subagents/tooling.js';
import { listTools } from '../tools/index.js';

function logSubagentModelFallback({ eventLogger, toolHistory, title, payload, text }) {
  if (toolHistory && typeof toolHistory.add === 'function') {
    try {
      toolHistory.add(title || 'subagent_model_fallback', text || '');
    } catch {
      // ignore
    }
  }
  if (eventLogger && typeof eventLogger.log === 'function') {
    try {
      eventLogger.log('subagent_model_fallback', payload || {});
    } catch {
      // ignore
    }
    if (text) {
      try {
        eventLogger.log('subagent_notice', { text, source: 'system', ...(payload || {}) });
      } catch {
        // ignore
      }
    }
  }
}

async function handleSubagentsCommand(argsText, context) {
  const manager = context.subAgents;
  if (!manager) {
    console.log(colors.yellow('Sub-agent manager is unavailable in this session.'));
    return null;
  }
  const trimmed = (argsText || '').trim();
  if (!trimmed || trimmed === 'help') {
    printSubagentHelp();
    return null;
  }
  const [subCommandRaw, ...restTokens] = trimmed.split(/\s+/);
  const subCommand = subCommandRaw.toLowerCase();
  const restText = restTokens.join(' ').trim();
  switch (subCommand) {
    case 'plugins':
    case 'market':
    case 'marketplace': {
      const action = (restTokens[0] || '').toLowerCase();
      const actionArgs = restTokens.slice(1).join(' ').trim();

      if (action === 'add') {
        if (!actionArgs) {
          console.log(colors.yellow('Usage: /sub marketplace add <owner/repo | git_url | local_path>'));
          return null;
        }
        try {
          const result = manager.addMarketplaceSource(actionArgs);
          console.log(colors.green(`✓ Added marketplace source "${result.sourceId}".`));
          console.log(colors.dim(`Indexed ${result.plugins} plugins.`));
          console.log(colors.dim('Tip: run /sub marketplace to see available plugins, then /sub install <id>.'));
        } catch (err) {
          console.error(colors.yellow(`Failed to add marketplace source: ${err.message}`));
        }
        return null;
      }

      if (action === 'sources') {
        const sources = manager.listMarketplaceSources();
        if (sources.length === 0) {
          console.log(colors.yellow('No marketplace sources added yet.'));
          console.log(colors.dim('Usage: /sub marketplace add <owner/repo | git_url | local_path>'));
          return null;
        }
        console.log(colors.cyan('\nMarketplace sources:'));
        sources.forEach((src) => {
          console.log(`  - ${src.id} (${src.type || 'git'})`);
          if (src.url) {
            console.log(colors.dim(`      ${src.url}`));
          }
        });
        return null;
      }

      const entries = manager.listMarketplace();
      if (entries.length === 0) {
        console.log(colors.yellow('Marketplace is empty. Add plugins to the subagents directory.'));
        console.log(colors.dim('Tip: /sub marketplace add <owner/repo> to import an external marketplace.'));
        return null;
      }
      console.log(colors.cyan('\nSub-agent marketplace:'));
      entries.forEach((entry) => {
        console.log(`  - ${entry.id} [${entry.category || 'general'}] ${entry.name}`);
        if (entry.description) {
          console.log(colors.dim(`      ${entry.description}`));
        }
      });
      console.log(colors.dim('\n使用 /sub install <plugin_id> 安装插件。'));
      console.log(colors.dim('可选：/sub marketplace sources 查看已添加的 marketplace 源。'));
      return null;
    }
    case 'install': {
      const pluginId = restTokens[0];
      if (!pluginId) {
        const entries = manager.listMarketplace();
        const installedSet = new Set(manager.listInstalledPlugins().map(p => p.id));
        
        const uninstalled = entries.filter(e => !installedSet.has(e.id));
        const installed = entries.filter(e => installedSet.has(e.id));

        if (uninstalled.length === 0 && installed.length === 0) {
          console.log(colors.yellow('Marketplace is empty. No plugins available to install.'));
          return null;
        }

        if (uninstalled.length > 0) {
          console.log(colors.cyan('\nAvailable plugins to install:'));
          uninstalled.forEach((entry) => {
            console.log(`  - ${entry.id}\n      ${entry.name} - ${entry.description || ''}`);
          });
        } else {
          console.log(colors.green('\nAll available plugins are already installed.'));
        }

        if (installed.length > 0) {
          console.log(colors.dim('\nInstalled plugins:'));
          installed.forEach((entry) => {
             console.log(colors.dim(`  - ${entry.id} (installed)`));
          });
        }
        
        console.log(colors.dim('\nUsage: /sub install <plugin_id> (Tip: press Tab to autocomplete)'));
        return null;
      }
      try {
        const changed = manager.install(pluginId);
        if (changed) {
          console.log(colors.green(`✓ Successfully installed plugin "${pluginId}".`));
          console.log(colors.dim('Use /sub agents to see available agents.'));
        } else {
          console.log(colors.green(`Plugin "${pluginId}" is already installed.`));
        }
      } catch (err) {
        console.error(colors.yellow(`Installation failed: ${err.message}`));
        console.log(colors.dim('Tip: Use /sub install to see valid plugin IDs.'));
      }
      return null;
    }
    case 'remove':
    case 'uninstall': {
      if (!restTokens[0]) {
        console.log(colors.yellow('Usage: /sub uninstall <plugin_id>'));
        return null;
      }
      const pluginId = restTokens[0];
      const removed = manager.uninstall(pluginId);
      if (removed) {
        console.log(colors.green(`Removed plugin "${pluginId}".`));
      } else {
        console.log(colors.yellow(`Plugin "${pluginId}" 未安装。`));
      }
      return null;
    }
    case 'agents':
    case 'list': {
      const agents = manager.listAgents();
      if (agents.length === 0) {
        console.log(colors.yellow('没有可用的 sub-agent。使用 /sub install <plugin> 安装插件。'));
        return null;
      }
      console.log(colors.cyan('\n已安装的 sub-agent：'));
      agents.forEach((agent) => {
        console.log(
          `  - ${agent.id} (${agent.name}) [${agent.pluginId}] model=${agent.model || 'current'}`
        );
        if (agent.description) {
          console.log(colors.dim(`      ${agent.description}`));
        }
        if (agent.skills.length > 0) {
          const skillNames = agent.skills.map((skill) => skill.id).join(', ');
          console.log(colors.dim(`      skills: ${skillNames}`));
        }
      });
      console.log(
        colors.dim('\n使用 /sub run <agent_id> <任务描述> [--skills skill1,skill2] 执行 sub-agent。')
      );
      return null;
    }
    case 'commands':
    case 'cmds': {
      const commands = manager.listCommands();
      if (commands.length === 0) {
        console.log(colors.yellow('当前已安装插件没有可用命令。'));
        return null;
      }
      console.log(colors.cyan('\n已安装的插件命令：'));
      commands.forEach((entry) => {
        console.log(`  - ${entry.pluginId}:${entry.id} (${entry.name})`);
        if (entry.description) {
          console.log(colors.dim(`      ${entry.description}`));
        }
      });
      console.log(colors.dim('直接输入 /<plugin>:<command> <参数> 运行该命令。'));
      return null;
    }
    case 'run':
    case 'use': {
      const parsed = parseSubAgentRunArgs(restText);
      if (!parsed || !parsed.agentId || !parsed.taskText) {
        console.log(
          colors.yellow(
            'Usage: /sub run <agent_id> <任务描述> [--skills skill1,skill2]\n例如：/sub run python-architect 设计新的API --skills async-patterns'
          )
        );
        return null;
      }
      const agentRef = manager.getAgent(parsed.agentId);
      if (!agentRef) {
        console.log(colors.yellow(`未找到 sub-agent "${parsed.agentId}"。`));
        return null;
      }
      try {
        await executeSubAgentTask(
          agentRef,
          parsed.taskText,
          parsed.skills,
          {
            manager,
            client: context.client,
            currentModel: context.currentModel,
            userPrompt: context.userPrompt,
            subagentUserPrompt: context.subagentUserPrompt,
            subagentMcpAllowPrefixes: context.subagentMcpAllowPrefixes,
            eventLogger: context.eventLogger,
          },
          { toolHistory: context.toolHistory }
        );
      } catch (err) {
        console.error(colors.yellow(`Sub-agent 调用失败: ${err.message}`));
      }
      return null;
    }
    default:
      printSubagentHelp();
      return null;
  }
}

function parseSubAgentRunArgs(text) {
  if (!text) {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const skillsIndex = trimmed.indexOf('--skills');
  let skillList = [];
  let statement = trimmed;
  if (skillsIndex >= 0) {
    statement = trimmed.slice(0, skillsIndex).trim();
    const rawSkill = trimmed.slice(skillsIndex + '--skills'.length).trim();
    skillList = rawSkill
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (!statement) {
    return null;
  }
  const firstSpace = statement.indexOf(' ');
  if (firstSpace < 0) {
    return { agentId: statement, taskText: '', skills: skillList };
  }
  const agentId = statement.slice(0, firstSpace).trim();
  const taskText = statement.slice(firstSpace + 1).trim();
  return { agentId, taskText, skills: skillList };
}

function printSubagentHelp() {
  console.log(
    colors.cyan(
      '\n/sub 命令：\n  /sub marketplace                       列出可用插件\n  /sub marketplace add <repo|url|path>    添加外部 marketplace（会转换为内置 sub-agent 格式）\n  /sub marketplace sources                查看已添加的 marketplace 源\n  /sub install <id>                       安装插件\n  /sub uninstall <id>                     卸载插件\n  /sub agents                             查看已安装的 sub-agent\n  /sub commands                           查看可用插件命令 (/plugin:command)\n  /sub run <agent> <任务> [--skills skill1,skill2] 运行子代理'
    )
  );
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

export async function executeSubAgentTask(agentRef, taskText, requestedSkills, context, options = {}) {
  if (!agentRef || !agentRef.agent || !agentRef.plugin) {
    throw new Error('Invalid sub-agent reference.');
  }
  if (!taskText || !taskText.trim()) {
    throw new Error('Task description is required for sub-agent execution.');
  }
  const manager = context.manager || context.subAgents;
  if (!manager) {
    throw new Error('Sub-agent manager unavailable.');
  }
  const client = context.client;
  if (!client) {
    throw new Error('Model client unavailable.');
  }
  const normalizedSkills = Array.isArray(requestedSkills)
    ? requestedSkills.map((entry) => entry.trim()).filter(Boolean)
    : [];
  const promptResult = manager.buildSystemPrompt(agentRef, normalizedSkills);
  const internalPrompt = promptResult.internalPrompt || '';
  const systemPrompt = withSubagentGuardrails(withTaskTracking(promptResult.systemPrompt, internalPrompt));
  const usedSkills = promptResult.usedSkills || [];
  const extraConfig = promptResult.extra || {};
  const configuredModel = typeof agentRef.agent.model === 'string' ? agentRef.agent.model.trim() : '';
  const currentModel = typeof context.currentModel === 'string' ? context.currentModel.trim() : '';
  const eventLogger =
    context.eventLogger && typeof context.eventLogger.log === 'function' ? context.eventLogger : null;
  const targetModel = resolveSubagentInvocationModel({
    configuredModel,
    currentModel,
    client,
  });
  if (!targetModel) {
    throw new Error('No model available for sub-agent invocation.');
  }
  const subSessionId = generateSessionId(taskText || '');
  const extraSystemPrompts = buildUserPromptMessages(context.subagentUserPrompt, 'subagent_user_prompt');
  const subSession = new ChatSession(systemPrompt, {
    sessionId: subSessionId,
    trailingSystemPrompts: internalPrompt ? [internalPrompt] : [],
    extraSystemPrompts,
  });
  subSession.addUser(taskText);
  const reasonLabel = options.reason ? colors.dim(` [${options.reason}]`) : '';
  console.log(
    colors.cyan(
      `\n[sub:${agentRef.agent.id}] ${agentRef.agent.name} (${agentRef.plugin.name}) -> 模型 ${targetModel}${reasonLabel}`
    )
  );
  if (usedSkills.length > 0) {
    const skillLabel = usedSkills.map((skill) => skill.id).join(', ');
    console.log(colors.dim(`激活技能: ${skillLabel}`));
  }
  const toolHistory = options.toolHistory || null;
  const signal = options.signal || context.signal;
  if (configuredModel && currentModel && configuredModel !== targetModel && targetModel === currentModel) {
    const notice = `子流程模型 "${configuredModel}" 不可用或未配置 Key，本轮使用主流程模型 "${currentModel}"。`;
    console.log(colors.yellow(notice));
    logSubagentModelFallback({
      eventLogger,
      toolHistory,
      title: `[sub:${agentRef.agent.id}] model_fallback`,
      text: notice,
      payload: {
        kind: 'agent',
        agent: agentRef.agent.id,
        plugin: agentRef.plugin.id,
        fromModel: configuredModel,
        toModel: currentModel,
        reason: 'model_unavailable',
      },
    });
  }
  const reasoningEnabled =
    extraConfig.reasoning !== undefined ? extraConfig.reasoning : agentRef.agent.reasoning;
  const allowMcpPrefixes = Array.isArray(context.subagentMcpAllowPrefixes)
    ? context.subagentMcpAllowPrefixes
    : null;
  const requestedTools =
    Array.isArray(options.toolsOverride) && options.toolsOverride.length > 0
      ? options.toolsOverride
      : listTools();
  const toolsOverride = filterSubagentTools(requestedTools, { allowMcpPrefixes });
  const runWithPrinter = async (modelName) => {
    const printer = createResponsePrinter(`[sub:${agentRef.agent.id}]`, true, {
      registerToolResult: toolHistory
        ? (toolName, content) => toolHistory.add(toolName, content)
        : null,
    });
    try {
      const response = await client.chat(modelName, subSession, {
        stream: true,
        onToken: printer.onToken,
        onReasoning: printer.onReasoning,
        onToolCall: printer.onToolCall,
        onToolResult: printer.onToolResult,
        reasoning: reasoningEnabled,
        toolsOverride,
        signal,
      });
      printer.onComplete(response);
      return response;
    } catch (err) {
      printer.onAbort?.();
      throw err;
    }
  };

  try {
    const response = await runWithPrinter(targetModel);
    return { response, usedSkills, model: targetModel };
  } catch (err) {
    if (!currentModel || currentModel === targetModel || !shouldFallbackToCurrentModelOnError(err)) {
      throw err;
    }
    const info = describeModelError(err);
    const detail = [info.reason, info.status ? `HTTP ${info.status}` : null, info.message]
      .filter(Boolean)
      .join(' - ');
    const notice = `子流程模型 "${targetModel}" 调用失败（${detail || info.name}），本轮回退到主流程模型 "${currentModel}"。`;
    console.log(colors.yellow(notice));
    logSubagentModelFallback({
      eventLogger,
      toolHistory,
      title: `[sub:${agentRef.agent.id}] model_fallback`,
      text: notice,
      payload: {
        kind: 'agent',
        agent: agentRef.agent.id,
        plugin: agentRef.plugin.id,
        fromModel: targetModel,
        toModel: currentModel,
        reason: info.reason,
        error: info,
      },
    });
    try {
      const response = await runWithPrinter(currentModel);
      return { response, usedSkills, model: currentModel, modelFallback: { fromModel: targetModel, toModel: currentModel, error: info } };
    } catch (fallbackErr) {
      const fallbackInfo = describeModelError(fallbackErr);
      const fallbackDetail = [fallbackInfo.reason, fallbackInfo.status ? `HTTP ${fallbackInfo.status}` : null, fallbackInfo.message]
        .filter(Boolean)
        .join(' - ');
      throw new Error(
        `Sub-agent 调用失败。模型 "${targetModel}" 错误：${detail || info.name}；回退模型 "${currentModel}" 错误：${fallbackDetail || fallbackInfo.name}`
      );
    }
  }
}

export async function executeSubAgentCommand(commandRef, argumentText, context, options = {}) {
  if (!commandRef || !commandRef.command || !commandRef.plugin) {
    throw new Error('Invalid command reference.');
  }
  const manager = context.manager || context.subAgents;
  if (!manager) {
    throw new Error('Sub-agent manager unavailable.');
  }
  const client = context.client;
  if (!client) {
    throw new Error('Model client unavailable.');
  }
  const promptResult = manager.buildCommandPrompt(commandRef, argumentText || '');
  const internalPrompt = promptResult.internalPrompt || '';
  const systemPrompt = withSubagentGuardrails(withTaskTracking(promptResult.systemPrompt, internalPrompt));
  const extraConfig = promptResult.extra || {};
  const configuredModel = typeof commandRef.command.model === 'string' ? commandRef.command.model.trim() : '';
  const currentModel = typeof context.currentModel === 'string' ? context.currentModel.trim() : '';
  const eventLogger =
    context.eventLogger && typeof context.eventLogger.log === 'function' ? context.eventLogger : null;
  const targetModel = resolveSubagentInvocationModel({
    configuredModel,
    currentModel,
    client,
  });
  if (!targetModel) {
    throw new Error('No model available for command invocation.');
  }
  const subSessionId = generateSessionId(argumentText || '');
  const extraSystemPrompts = buildUserPromptMessages(context.subagentUserPrompt, 'subagent_user_prompt');
  const subSession = new ChatSession(systemPrompt, {
    sessionId: subSessionId,
    trailingSystemPrompts: internalPrompt ? [internalPrompt] : [],
    extraSystemPrompts,
  });
  const userMessage = argumentText && argumentText.trim()
    ? argumentText.trim()
    : 'Follow the command instructions and produce the output.';
  subSession.addUser(userMessage);
  const reasonLabel = options.reason ? colors.dim(` [${options.reason}]`) : '';
  console.log(
    colors.cyan(
      `\n[cmd:${commandRef.plugin.id}:${commandRef.command.id}] ${commandRef.command.name} (${commandRef.plugin.name}) -> 模型 ${targetModel}${reasonLabel}`
    )
  );
  const toolHistory = options.toolHistory || null;
  const signal = options.signal || context.signal;
  if (configuredModel && currentModel && configuredModel !== targetModel && targetModel === currentModel) {
    const notice = `子流程模型 "${configuredModel}" 不可用或未配置 Key，本轮使用主流程模型 "${currentModel}"。`;
    console.log(colors.yellow(notice));
    logSubagentModelFallback({
      eventLogger,
      toolHistory,
      title: `[cmd:${commandRef.plugin.id}:${commandRef.command.id}] model_fallback`,
      text: notice,
      payload: {
        kind: 'command',
        plugin: commandRef.plugin.id,
        command: commandRef.command.id,
        fromModel: configuredModel,
        toModel: currentModel,
        reason: 'model_unavailable',
      },
    });
  }
  const reasoningEnabled =
    extraConfig.reasoning !== undefined ? extraConfig.reasoning : commandRef.command.reasoning;
  const allowMcpPrefixes = Array.isArray(context.subagentMcpAllowPrefixes)
    ? context.subagentMcpAllowPrefixes
    : null;
  const requestedTools =
    Array.isArray(options.toolsOverride) && options.toolsOverride.length > 0
      ? options.toolsOverride
      : listTools();
  const toolsOverride = filterSubagentTools(requestedTools, { allowMcpPrefixes });
  const runWithPrinter = async (modelName) => {
    const printer = createResponsePrinter(`[cmd:${commandRef.command.id}]`, true, {
      registerToolResult: toolHistory
        ? (toolName, content) => toolHistory.add(toolName, content)
        : null,
    });
    try {
      const response = await client.chat(modelName, subSession, {
        stream: true,
        onToken: printer.onToken,
        onReasoning: printer.onReasoning,
        onToolCall: printer.onToolCall,
        onToolResult: printer.onToolResult,
        reasoning: reasoningEnabled,
        toolsOverride,
        signal,
      });
      printer.onComplete(response);
      return response;
    } catch (err) {
      printer.onAbort?.();
      throw err;
    }
  };

  try {
    const response = await runWithPrinter(targetModel);
    return { response, model: targetModel };
  } catch (err) {
    if (!currentModel || currentModel === targetModel || !shouldFallbackToCurrentModelOnError(err)) {
      throw err;
    }
    const info = describeModelError(err);
    const detail = [info.reason, info.status ? `HTTP ${info.status}` : null, info.message]
      .filter(Boolean)
      .join(' - ');
    const notice = `子流程模型 "${targetModel}" 调用失败（${detail || info.name}），本轮回退到主流程模型 "${currentModel}"。`;
    console.log(colors.yellow(notice));
    logSubagentModelFallback({
      eventLogger,
      toolHistory,
      title: `[cmd:${commandRef.plugin.id}:${commandRef.command.id}] model_fallback`,
      text: notice,
      payload: {
        kind: 'command',
        plugin: commandRef.plugin.id,
        command: commandRef.command.id,
        fromModel: targetModel,
        toModel: currentModel,
        reason: info.reason,
        error: info,
      },
    });
    try {
      const response = await runWithPrinter(currentModel);
      return { response, model: currentModel, modelFallback: { fromModel: targetModel, toModel: currentModel, error: info } };
    } catch (fallbackErr) {
      const fallbackInfo = describeModelError(fallbackErr);
      const fallbackDetail = [fallbackInfo.reason, fallbackInfo.status ? `HTTP ${fallbackInfo.status}` : null, fallbackInfo.message]
        .filter(Boolean)
        .join(' - ');
      throw new Error(
        `Command 调用失败。模型 "${targetModel}" 错误：${detail || info.name}；回退模型 "${currentModel}" 错误：${fallbackDetail || fallbackInfo.name}`
      );
    }
  }
}

export async function maybeHandleAutoSubagentRequest(rawInput, context) {
  const text = (rawInput || '').trim();
  if (!text || text.startsWith('/')) {
    return false;
  }
  const manager = context.subAgents;
  if (!manager || !context.client) {
    return false;
  }
  const signal = context?.signal;
  if (signal?.aborted) {
    return true;
  }
  const report = (message) => {
    if (!message) return;
    console.log(colors.dim(message));
  };
  const recordHistory = (title, content) => {
    if (!context.toolHistory || typeof context.toolHistory.add !== 'function') {
      return null;
    }
    const id = context.toolHistory.add(title, content);
    if (typeof context.updateSessionReport === 'function') {
      try {
        context.updateSessionReport();
      } catch {
        // ignore
      }
    }
    return id;
  };
  const logEvent = (type, payload) => context.eventLogger?.log?.(type, payload);

  try {
    report('自动路由：正在分析输入，尝试匹配子代理命令/agent…');
    logEvent?.('auto_route_start', { text, model: context.currentModel });
    const route = await routeCommandWithModel(
      context.client,
      context.currentModel,
      manager,
      text,
      { signal }
    );
    if (route && route.commandRef) {
      const cmdLabel = `${route.commandRef.plugin.id}:${route.commandRef.command.id}`;
      const reason = route.reason || '';
      report(`自动路由：已匹配命令 ${cmdLabel}${reason ? `（理由：${reason}）` : ''}，正在执行…`);
      recordHistory('auto_router', `命中命令 ${cmdLabel}\n理由：${reason || '未提供'}\n参数：${route.argumentsText || text}`);
      logEvent?.('auto_route_match_command', {
        plugin: route.commandRef.plugin.id,
        command: route.commandRef.command.id,
        reason,
        model: context.currentModel,
      });
      const args = route.argumentsText && route.argumentsText.trim() ? route.argumentsText : text;
      await executeSubAgentCommand(
        route.commandRef,
        args,
        {
          manager,
          client: context.client,
          currentModel: context.currentModel,
          userPrompt: context.userPrompt,
          subagentUserPrompt: context.subagentUserPrompt,
          subagentMcpAllowPrefixes: context.subagentMcpAllowPrefixes,
          eventLogger: context.eventLogger,
        },
        { toolHistory: context.toolHistory, reason: route.reason, signal }
      );
      report(`自动路由：命令 ${cmdLabel} 执行完成。`);
      logEvent?.('auto_route_command_done', { plugin: route.commandRef.plugin.id, command: route.commandRef.command.id });
      return true;
    }
    const agentRoute = await routeWithModel(
      context.client,
      context.currentModel,
      manager,
      text,
      { signal }
    );
    if (agentRoute && agentRoute.agentRef) {
      const agentLabel = `${agentRoute.agentRef.agent.id} [${agentRoute.agentRef.plugin.id}]`;
      const reason = agentRoute.reason || '';
      const skillList = Array.isArray(agentRoute.skills) ? agentRoute.skills.join(', ') : '';
      report(
        `自动路由：已匹配 sub-agent ${agentLabel}${reason ? `（理由：${reason}）` : ''}，正在执行…`
      );
      recordHistory(
        'auto_router',
        `命中 agent ${agentLabel}\n理由：${reason || '未提供'}\nskills：${skillList || '<none>'}`
      );
      logEvent?.('auto_route_match_agent', {
        agent: agentRoute.agentRef.agent.id,
        plugin: agentRoute.agentRef.plugin.id,
        skills: agentRoute.skills,
        reason,
        model: context.currentModel,
      });
      const skills = Array.isArray(agentRoute.skills) ? agentRoute.skills : [];
      await executeSubAgentTask(
        agentRoute.agentRef,
        text,
        skills,
        {
          manager,
          client: context.client,
          currentModel: context.currentModel,
          userPrompt: context.userPrompt,
          subagentUserPrompt: context.subagentUserPrompt,
          subagentMcpAllowPrefixes: context.subagentMcpAllowPrefixes,
          eventLogger: context.eventLogger,
        },
        { toolHistory: context.toolHistory, reason: agentRoute.reason, signal }
      );
      report(`自动路由：agent ${agentRoute.agentRef.agent.id} 执行完成。`);
      logEvent?.('auto_route_agent_done', {
        agent: agentRoute.agentRef.agent.id,
        plugin: agentRoute.agentRef.plugin.id,
      });
      return true;
    }
    report('自动路由：未匹配到合适的命令或 agent，交回主对话。');
    logEvent?.('auto_route_no_match', { text, model: context.currentModel });
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) {
      logEvent?.('auto_route_abort', { text });
      return true;
    }
    console.error(colors.dim(`自动命令路由失败: ${err.message}`));
    logEvent?.('auto_route_error', { error: err.message, text });
  }
  return false;
}

function inferCategoryFromText(text) {
  if (!text) {
    return null;
  }
  if (text.includes('python')) return 'python';
  if (text.includes('spring') || text.includes('java') || text.includes('jvm')) {
    return 'java';
  }
  if (text.includes('javascript') || text.includes('typescript') || /\bjs\b/.test(text)) {
    return 'javascript';
  }
  if (text.includes('kubernetes') || text.includes('k8')) {
    return 'kubernetes';
  }
  if (text.includes('security') || text.includes('安全')) {
    return 'security';
  }
  if (text.includes('cloud') || text.includes('aws') || text.includes('azure') || text.includes('gcp')) {
    return 'cloud';
  }
  return null;
}

function inferSkillHints(text) {
  const hints = new Set();
  if (!text) {
    return [];
  }
  if (text.includes('async') || text.includes('异步')) {
    hints.add('async-patterns');
  }
  if (text.includes('test') || text.includes('测试')) {
    hints.add('python-testing');
  }
  return Array.from(hints);
}


export { handleSubagentsCommand };
