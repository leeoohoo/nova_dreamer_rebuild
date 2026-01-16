import { composeSystemPrompt, loadSystemPromptFromDb } from '../prompts.js';

export function resolveSystemPrompt(client, modelName, systemOverride, options = {}) {
  const settings = client.config.getModel(modelName);
  const composed = composeSystemPrompt({
    configPath: options.configPath,
    systemOverride,
    modelPrompt: settings.system_prompt,
    systemConfig: options.systemConfigFromDb || loadSystemPromptFromDb([]),
  });
  return composed.prompt;
}

