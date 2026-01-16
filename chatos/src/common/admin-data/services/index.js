import { TABLE_SCHEMAS } from '../schema.js';
import { ModelService } from './model-service.js';
import { SecretService } from './secret-service.js';
import { McpService } from './mcp-service.js';
import { SubagentService } from './subagent-service.js';
import { PromptService } from './prompt-service.js';
import { EventService } from './event-service.js';
import { TaskService } from './task-service.js';
import { SettingsService } from './settings-service.js';

function migratePromptAllowFlags(db) {
  const prompts = db.list('prompts') || [];
  prompts.forEach((prompt) => {
    if (!prompt?.id) return;
    const resolvedAllowMain =
      typeof prompt.allowMain === 'boolean'
        ? prompt.allowMain
        : typeof prompt.useInMain === 'boolean'
          ? prompt.useInMain
          : true;
    const resolvedAllowSub =
      typeof prompt.allowSub === 'boolean'
        ? prompt.allowSub
        : typeof prompt.useInSubagent === 'boolean'
          ? prompt.useInSubagent
          : false;
    const needsPatch =
      typeof prompt.allowMain !== 'boolean' ||
      typeof prompt.allowSub !== 'boolean' ||
      Object.prototype.hasOwnProperty.call(prompt, 'useInMain') ||
      Object.prototype.hasOwnProperty.call(prompt, 'useInSubagent');
    if (!needsPatch) return;
    try {
      db.update('prompts', prompt.id, {
        allowMain: resolvedAllowMain,
        allowSub: resolvedAllowSub,
        useInMain: undefined,
        useInSubagent: undefined,
      });
    } catch {
      // ignore migration errors
    }
  });
}

export function createAdminServices(db) {
  migratePromptAllowFlags(db);
  const models = new ModelService(db);
  const secrets = new SecretService(db);
  const mcpServers = new McpService(db);
  const subagents = new SubagentService(db);
  const prompts = new PromptService(db);
  const events = new EventService(db);
  const tasks = new TaskService(db);
  const settings = new SettingsService(db);
  settings.ensureRuntime();

  const snapshot = () => ({
    models: models.list(),
    secrets: secrets.list(),
    mcpServers: mcpServers.list(),
    subagents: subagents.list(),
    prompts: prompts.list(),
    events: events.list(),
    tasks: tasks.list(),
    settings: settings.list(),
  });

  return {
    models,
    secrets,
    mcpServers,
    subagents,
    prompts,
    events,
    tasks,
    settings,
    snapshot,
    schema: () => TABLE_SCHEMAS,
    dbPath: db.path,
  };
}
