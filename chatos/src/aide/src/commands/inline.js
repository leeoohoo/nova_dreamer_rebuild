import fs from 'fs';
import path from 'path';
import * as colors from '../colors.js';
import { expandHomePath } from '../utils.js';
import { resolveSystemPrompt } from './system-prompt.js';

export function handleCommand(
  command,
  client,
  session,
  currentModel,
  systemOverride,
  configPath,
  systemConfigFromDb,
  options = {}
) {
  const [name, ...rest] = command.slice(1).trim().split(/\s+/);
  const argument = rest.join(' ').trim();
  const promptOptions = {
    configPath,
    systemConfigFromDb,
    landConfigPrompt: options.landConfigPrompt,
  };
  switch (name) {
    case 'exit':
    case 'quit':
    case 'q':
      return null;
    case 'help':
      console.log(`Commands:
:help   Show this message
:models List available models
:use    Switch to another model
:reset  Start a new conversation
:save   Save transcript to a Markdown file
:exit   Leave the chat`);
      return currentModel;
    case 'models':
      console.log(renderAvailableModels(client));
      return currentModel;
    case 'reset': {
      const systemPrompt = resolveSystemPrompt(client, currentModel, systemOverride, promptOptions);
      session.reset(systemPrompt);
      if (typeof session.setSessionId === 'function') {
        session.setSessionId(null);
      }
      console.log(colors.yellow('Conversation cleared.'));
      return currentModel;
    }
    case 'use':
      if (!argument) {
        console.log(colors.yellow('Usage: :use <model_name>'));
        return currentModel;
      }
      try {
        client.config.getModel(argument);
      } catch (err) {
        console.error(colors.yellow(err.message));
        return currentModel;
      }
      session.reset(
        resolveSystemPrompt(client, argument, systemOverride, promptOptions)
      );
      console.log(colors.yellow(`Switched to model '${argument}'.`));
      return argument;
    case 'save':
      if (!argument) {
        console.log(colors.yellow('Usage: :save <path>'));
        return currentModel;
      }
      const targetPath = path.resolve(expandHomePath(argument));
      writeTranscript(targetPath, session);
      console.log(colors.green(`Transcript saved to ${targetPath}.`));
      return currentModel;
    default:
      console.log(colors.yellow('Unknown command. Use :help for options.'));
      return currentModel;
  }
}

function renderAvailableModels(client) {
  const names = client.getModelNames();
  const defaultModel = client.getDefaultModel();
  const lines = ['Available models:'];
  for (const name of names) {
    const settings = client.config.models[name];
    const marker = name === defaultModel ? ' (default)' : '';
    lines.push(`- ${name}${marker} [${settings.provider}]`);
  }
  return lines.join('\n');
}

function writeTranscript(targetPath, session) {
  const lines = ['# model-cli transcript', ''];
  for (const message of session.messages) {
    let heading = 'Assistant';
    if (message.role === 'system') heading = 'System';
    else if (message.role === 'user') heading = 'You';
    else if (message.role === 'tool') heading = `Tool (${message.tool_call_id || 'call'})`;
    lines.push(`## ${heading}`);
    if (message.content && message.content.trim()) {
      lines.push(message.content);
    } else {
      lines.push('<no content>');
    }
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      lines.push('');
      lines.push('Tool calls:');
      for (const call of message.tool_calls) {
        const args = call.function?.arguments || '{}';
        lines.push(`- ${call.function?.name || 'unknown'} (${call.id || 'no-id'}): ${args}`);
      }
    }
    lines.push('');
  }
  fs.writeFileSync(targetPath, lines.join('\n'), 'utf8');
}
