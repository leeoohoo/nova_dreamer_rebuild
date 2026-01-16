import * as colors from '../colors.js';
import { runModelPicker, runMcpSetup, runMcpToolsConfigurator } from '../ui/index.js';
import { loadMcpConfig, saveMcpConfig } from '../mcp.js';
import { renderMarkdown } from '../markdown.js';
import { loadSystemPromptFromDb } from '../prompts.js';
import { estimateTokenCount, loadSummaryPromptConfig } from '../chat/summary.js';
import { getHostApp } from '../../shared/host-app.js';

import { printMcpServers, upsertMcpServer } from './mcp.js';
import { executeSubAgentCommand, handleSubagentsCommand } from './subagents.js';
import { resolveSystemPrompt } from './system-prompt.js';

export async function handleSlashCommand(input, context) {
  const command = input.slice(1).trim();
  if (!command) {
    printSlashCommandHelp();
    return null;
  }
  const [nameRaw] = command.split(/\s+/);
  const name = nameRaw.toLowerCase();
  const argsText = command.slice(nameRaw.length).trim();
  const uiControl = createUiControl(context.rl);
  // 支持插件命令格式：/plugin-id:command-id <args>
  const colonIndex = command.indexOf(':');
  if (colonIndex > 0 && !name.startsWith('sub')) {
    const pluginId = command.slice(0, colonIndex).trim();
    const rest = command.slice(colonIndex + 1);
    const tokens = rest.trim().split(/\s+/).filter(Boolean);
    if (pluginId && tokens.length > 0) {
      const commandId = tokens[0];
      const argumentText = rest.trim().slice(commandId.length).trim();
      const manager = context.subAgents;
      if (manager) {
        const cmdRef = manager.getCommand(pluginId, commandId);
        if (cmdRef) {
          await executeSubAgentCommand(
            cmdRef,
            argumentText,
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
          return null;
        }
      }
    }
  }
  switch (name) {
    case 'summary': {
      const summaryManager = context.summaryManager;
      if (!summaryManager) {
        console.log(colors.yellow('当前会话未启用自动总结管理器。'));
        return null;
      }
      const tokens = argsText.split(/\s+/).filter(Boolean);
      const sub = (tokens[0] || '').toLowerCase();
      const sessionTokenCount = estimateTokenCount(context.session?.messages || []);
      const threshold = summaryManager.threshold;
      const enabled = threshold > 0;

      if (!sub || ['status', 'info'].includes(sub)) {
        const promptConfig = loadSummaryPromptConfig({ configPath: context.configPath });
        console.log(colors.cyan('\n=== Auto Summary ==='));
        console.log(`Enabled: ${enabled ? 'yes' : 'no'}`);
        console.log(`Threshold: ~${threshold} tokens`);
        console.log(`Current: ~${sessionTokenCount} tokens`);
        console.log(`Keep ratio: ${summaryManager.keepRatio}`);
        console.log(`Prompt: ${promptConfig.path}`);
        console.log(colors.dim('Commands: /summary now | /summary prompt'));
        return null;
      }

      if (['now', 'run', 'force'].includes(sub)) {
        const before = sessionTokenCount;
        const did = await summaryManager.forceSummarize(context.session, context.client, context.currentModel);
        const after = estimateTokenCount(context.session?.messages || []);
        if (did) {
          console.log(colors.green(`已执行总结：~${before} → ~${after} tokens`));
        } else {
          console.log(colors.yellow(`未产生总结（对话可能过短或总结失败）：~${before} → ~${after} tokens`));
        }
        return null;
      }

      if (sub === 'prompt') {
        const promptConfig = loadSummaryPromptConfig({ configPath: context.configPath });
        const action = (tokens[1] || '').toLowerCase();
        if (!action || ['show', 'view'].includes(action)) {
          console.log(colors.cyan(`\n=== Summary Prompt (${promptConfig.path}) ===`));
          console.log(colors.dim('\n[system]\n') + promptConfig.system);
          console.log(colors.dim('\n[user]\n') + promptConfig.user);
          console.log(colors.dim('\n(可编辑该文件；支持 {{history}} 占位符)'));
          return null;
        }
        if (action === 'path') {
          console.log(promptConfig.path);
          return null;
        }
        console.log(colors.yellow('未知的 /summary prompt 子命令。可用：/summary prompt | /summary prompt path'));
        return null;
      }

      console.log(colors.yellow('未知的 /summary 子命令。可用：/summary | /summary now | /summary prompt'));
      return null;
    }
    case 'prompt':
    case 'propmt': {
      const promptStore = context.promptStore;
      if (argsText && promptStore) {
        const tokens = argsText.split(/\s+/).filter(Boolean);
        const [subRaw, ...restTokens] = tokens;
        const sub = (subRaw || '').toLowerCase();
        if (['list', 'ls'].includes(sub)) {
          const names = Object.keys(promptStore.prompts || {});
          if (names.length === 0) {
            console.log(colors.yellow('提示词列表为空，请在管理 UI 或 admin.db 中维护。'));
            return null;
          }
          console.log(colors.cyan('\n可用提示词:'));
          names.forEach((entry) => console.log(`  - ${entry}`));
          console.log(colors.dim(`数据源: ${promptStore.path}`));
          return null;
        }
        if (['show', 'view'].includes(sub) && restTokens.length > 0) {
          const key = restTokens.join(' ');
          const profile = promptStore.prompts?.[key];
          if (!profile) {
            console.log(colors.yellow(`未找到提示词 "${key}"。`));
            return null;
          }
          console.log(colors.cyan(`\n=== ${key} ===`));
          console.log(profile);
          return null;
        }
        if (['use', 'apply'].includes(sub) && restTokens.length > 0) {
          const key = restTokens.join(' ');
          const profile = promptStore.prompts?.[key];
          if (!profile) {
            console.log(colors.yellow(`未找到提示词 "${key}"。`));
            return null;
          }
          console.log(colors.green(`已切换到提示词 "${key}"。`));
          return { type: 'prompt-update', systemOverride: profile };
        }
        if (promptStore.prompts?.[argsText]) {
          console.log(colors.green(`已切换到提示词 "${argsText}"。`));
          return { type: 'prompt-update', systemOverride: promptStore.prompts[argsText] };
        }
        console.log(colors.yellow('未知的提示词指令。使用 /prompt list 查看可用名称。'));
        return null;
      }
      const current = resolveSystemPrompt(
        context.client,
        context.currentModel,
        context.systemOverride,
        { configPath: context.configPath, systemConfigFromDb: context.systemConfigFromDb }
      );
      console.log(colors.cyan('\n=== 当前 System Prompt ==='));
      console.log(current ? current : colors.dim('<未设置，将发送无 system prompt>'));
      console.log(
        colors.dim(
          '输入新的 prompt 并回车即可生效。留空表示保持原样，"." 清空，输入 "!default" 使用内置开发提示，输入 "!config" 回到模型配置，输入 "!list" 查看 admin.db/管理台中维护的候选项。'
        )
      );
      const next = await context.askLine(colors.magenta('新 prompt: '));
      const trimmed = next.trim();
      if (!trimmed) {
        console.log(colors.yellow('System prompt 未修改。'));
        return null;
      }
      if (trimmed === '.') {
        return { type: 'prompt-update', systemOverride: '' };
      }
      if (trimmed.toLowerCase() === '!default') {
        const systemConfig = context.systemConfigFromDb || loadSystemPromptFromDb([]);
        return { type: 'prompt-update', systemOverride: systemConfig.defaultPrompt };
      }
      if (trimmed.toLowerCase() === '!config') {
        return { type: 'prompt-update', useConfigDefault: true };
      }
      if (trimmed.toLowerCase() === '!list' && promptStore) {
        const names = Object.keys(promptStore.prompts || {});
        if (names.length === 0) {
          console.log(colors.yellow('提示词列表为空，请在管理 UI 或 admin.db 中维护。'));
        } else {
          console.log(colors.cyan('\n可用提示词:'));
          names.forEach((entry) => console.log(`  - ${entry}`));
          console.log(colors.dim(`数据源: ${promptStore.path}`));
        }
        return null;
      }
      return { type: 'prompt-update', systemOverride: trimmed };
    }
    case 'tool':
    case 'tool_result': {
      if (!context.toolHistory) {
        console.log(colors.yellow('暂无工具输出记录。'));
        return null;
      }
      if (!argsText) {
        const entries = context.toolHistory.list();
        if (entries.length === 0) {
          console.log(colors.yellow('暂无工具输出记录。'));
          return null;
        }
        console.log(colors.cyan('\n最近的工具输出：'));
        entries.forEach((entry) => {
          const timeLabel = entry.timestamp
            ? entry.timestamp.toLocaleTimeString()
            : '';
          console.log(`  [${entry.id}] ${entry.tool} ${timeLabel ? `@ ${timeLabel}` : ''}`);
        });
        console.log(colors.dim('使用 /tool <ID> 查看完整内容。'));
        return null;
      }
      const target = context.toolHistory.get(argsText);
      if (!target) {
        console.log(colors.yellow(`未找到编号为 ${argsText} 的工具输出。`));
        return null;
      }
      console.log(colors.cyan(`\n=== Tool ${target.tool} (${target.id}) ===`));
      if (typeof target.content === 'string') {
        console.log(renderMarkdown(target.content));
      } else {
        console.log(JSON.stringify(target.content, null, 2));
      }
      return null;
    }
    case 'sub': {
      return handleSubagentsCommand(argsText, context);
    }
    case 'model': {
      if (!context.allowUi) {
        console.log(colors.yellow('Interactive setup is only available in interactive terminals.'));
        return null;
      }
      const selection = await runModelPicker(
        context.askLine,
        context.client.config,
        context.currentModel,
        uiControl
      );
      if (!selection) {
        console.log(colors.yellow('Model selection cancelled.'));
        return null;
      }
      if (selection === context.currentModel) {
        console.log(colors.green(`Continuing with model '${selection}'.`));
        return null;
      }
      const sessionPrompt = resolveSystemPrompt(
        context.client,
        selection,
        context.systemOverride,
        { configPath: context.configPath }
      );
      return {
        type: 'switch-model',
        model: selection,
        sessionPrompt,
      };
    }
    case 'mcp': {
      try {
        const { path: mcpPath, servers } = loadMcpConfig(context.configPath);
        printMcpServers(servers, mcpPath);
      } catch (err) {
        console.error(colors.yellow(`Failed to load MCP config: ${err.message}`));
      }
      return null;
    }
    case 'mcp_set': {
      if (!context.allowUi) {
        console.log(colors.yellow('MCP configuration UI is only available in interactive terminals.'));
        return null;
      }
      try {
        const { path: mcpPath, servers, allServers } = loadMcpConfig(context.configPath);
        const result = await runMcpSetup(context.askLine, servers, uiControl);
        if (!result) {
          console.log(colors.yellow('No changes applied to MCP configuration.'));
          return null;
        }
        const hostApp = getHostApp() || 'aide';
        const serverWithApp = {
          ...(result.server || {}),
          app_id: hostApp,
        };
        const updated = upsertMcpServer(allServers || servers, serverWithApp, result.originalName);
        saveMcpConfig(mcpPath, updated);
        console.log(colors.green(`Saved MCP config (${updated.length} entries) to ${mcpPath}.`));
      } catch (err) {
        console.error(colors.yellow(`Failed to configure MCP: ${err.message}`));
      }
      return null;
    }
    case 'mcp_tools': {
      if (!context.allowUi) {
        console.log(colors.yellow('Tool configuration UI requires an interactive terminal.'));
        return null;
      }
      try {
        const selection = await runMcpToolsConfigurator(
          context.askLine,
          context.client.config,
          context.currentModel,
          uiControl
        );
        if (selection === null) {
          console.log(colors.yellow('Tool selection cancelled.'));
          return null;
        }
        context.client.config.models[context.currentModel].tools = selection;
        const summary = selection.length > 0 ? selection.join(', ') : '<none>';
        console.log(colors.green(`Active tools for ${context.currentModel}: ${summary}`));
        return { type: 'tools-updated', tools: selection };
      } catch (err) {
        console.error(colors.yellow(`Tool configuration failed: ${err.message}`));
        return null;
      }
    }
    default:
      console.log(colors.yellow('Unknown slash command. Try /model or /mcp_tools.'));
      return null;
  }
}

function createUiControl(rl) {
  if (!rl || typeof rl.pause !== 'function' || typeof rl.resume !== 'function') {
    return {};
  }
  return {
    pause: () => {
      try {
        rl.pause();
      } catch {
        // ignore
      }
    },
    resume: () => {
      try {
        rl.resume();
      } catch {
        // ignore
      }
    },
  };
}

function printSlashCommandHelp() {
  const commands = [
    { name: '/mcp', description: 'List configured MCP tools' },
    { name: '/mcp_set', description: 'Configure MCP servers (interactive)' },
    { name: '/mcp_tools', description: 'Select active MCP tools for current model' },
    { name: '/model', description: 'Choose what model to use' },
    { name: '/prompt', description: 'Manage system prompts' },
    { name: '/summary', description: 'Inspect/force auto summary' },
    { name: '/sub', description: 'Manage and run sub-agents' },
    { name: '/tool', description: 'View tool execution history' },
  ];

  console.log('');
  const maxLength = Math.max(...commands.map(c => c.name.length));
  commands.forEach(cmd => {
    const paddedName = cmd.name.padEnd(maxLength + 4, ' ');
    console.log(`${colors.cyan(paddedName)}${colors.dim(cmd.description)}`);
  });
  console.log('');
}
