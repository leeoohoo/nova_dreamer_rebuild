import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { getHomeDir } from '../utils.js';
import { loadSystemPromptConfig, DEFAULT_INTERNAL_SYSTEM_PROMPT } from '../prompts.js';
import { importClaudeCodePlugin, indexClaudeCodeMarketplace } from './marketplace-import.js';
import { resolveAppStateDir } from '../../shared/state-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createSubAgentManager(options = {}) {
  return new SubAgentManager(options);
}

class SubAgentManager {
  constructor(options = {}) {
    const rootDir = options.baseDir || path.resolve(__dirname, '..', '..', 'subagents');
    this.baseDir = rootDir;
    this.marketplacePath = path.join(rootDir, 'marketplace.json');
    this.pluginsDir = path.join(rootDir, 'plugins');
    const explicitStateDir =
      typeof options.stateDir === 'string' && options.stateDir.trim()
        ? path.resolve(options.stateDir.trim())
        : '';
    const explicitSessionRoot =
      typeof options.sessionRoot === 'string' && options.sessionRoot.trim()
        ? path.resolve(options.sessionRoot.trim())
        : '';
    const envSessionRoot =
      typeof process.env.MODEL_CLI_SESSION_ROOT === 'string' &&
      process.env.MODEL_CLI_SESSION_ROOT.trim()
        ? path.resolve(process.env.MODEL_CLI_SESSION_ROOT.trim())
        : '';
    const home = getHomeDir() || process.cwd();
    const resolvedSessionRoot = explicitSessionRoot || envSessionRoot || home;
    const stateDir = explicitStateDir || resolveAppStateDir(resolvedSessionRoot);
    this.stateDir = stateDir;
    this.statePath = path.join(stateDir, 'subagents.json');
    this.userBaseDir = path.join(stateDir, 'subagents');
    this.userMarketplacePath = path.join(this.userBaseDir, 'marketplace.json');
    this.userPluginsDir = path.join(this.userBaseDir, 'plugins');
    this.userSourcesDir = path.join(this.userBaseDir, 'sources');
    this.userSourcesPath = path.join(this.userBaseDir, 'sources.json');
    this.marketplaceCache = null;
    this.userMarketplaceCache = null;
    this.sourcesCache = null;
    // Cache plugin manifests with mtime to support live reload when plugin.json changes
    // (e.g., updated via UI "set subagent model").
    this.pluginCache = new Map();
    this.installedCache = null;
    this.internalPrompt =
      typeof options.internalSystemPrompt === 'string'
        ? options.internalSystemPrompt.trim()
        : options.internalSystemPrompt;
    this.internalPromptResolved = options.internalSystemPrompt !== undefined;
    this.systemPromptPath = options.systemPromptPath || null;
  }

  listMarketplace() {
    const entries = this.#loadMarketplace();
    return entries.slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  listMarketplaceSources() {
    const sources = this.#loadSources();
    return sources.slice().sort((a, b) => a.id.localeCompare(b.id));
  }

  listInstalledPlugins() {
    const installedIds = this.#loadInstalledIds();
    return installedIds
      .map((id) => {
        try {
          return this.#loadPlugin(id);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  install(pluginId) {
    const entry = this.#getMarketplaceEntry(pluginId);
    if (!entry) {
      throw new Error(`Plugin "${pluginId}" not found in marketplace.`);
    }
    if (!this.#resolvePluginDir(pluginId)) {
      const source = entry?.source;
      if (source && typeof source === 'object') {
        this.#importMarketplacePlugin({ pluginId, source, meta: entry });
      }
    }
    const installed = new Set(this.#loadInstalledIds());
    if (installed.has(pluginId)) {
      return false;
    }
    installed.add(pluginId);
    this.#saveInstalled(Array.from(installed));
    return true;
  }

  uninstall(pluginId) {
    const installed = new Set(this.#loadInstalledIds());
    if (!installed.delete(pluginId)) {
      return false;
    }
    this.#saveInstalled(Array.from(installed));
    return true;
  }

  addMarketplaceSource(sourceInput) {
    const raw = typeof sourceInput === 'string' ? sourceInput.trim() : '';
    if (!raw) {
      throw new Error('Source is required (e.g. "wshobson/agents" or a local path).');
    }

    const now = new Date().toISOString();
    const sources = this.#loadSources();
    const repoInfo = this.#resolveSourceRepo(raw);
    const sourceId = repoInfo.id;
    const existingIndex = sources.findIndex((s) => s.id === sourceId);
    const record = {
      id: sourceId,
      type: repoInfo.type,
      url: repoInfo.url || null,
      repoRoot: repoInfo.repoRoot,
      createdAt: existingIndex >= 0 ? sources[existingIndex]?.createdAt || now : now,
      updatedAt: now,
    };
    if (existingIndex >= 0) {
      sources[existingIndex] = record;
    } else {
      sources.push(record);
    }
    this.#saveSources(sources);

    const entries = indexClaudeCodeMarketplace(repoInfo.repoRoot, { id: sourceId, type: repoInfo.type, url: repoInfo.url || null });
    if (!entries || entries.length === 0) {
      throw new Error('No plugins found in the given marketplace source.');
    }
    const merged = this.#mergeUserMarketplaceEntries(entries, sourceId);
    this.#saveUserMarketplace(merged);
    this.#invalidateMarketplaceCaches();
    return { sourceId, plugins: entries.length };
  }

  listAgents() {
    const plugins = this.listInstalledPlugins();
    const agents = [];
    plugins.forEach((plugin) => {
      const commands = Array.isArray(plugin.commands)
        ? plugin.commands
            .map((command) => ({
              id: command?.id || command?.name || '',
              name: command?.name || command?.id || '',
              description: command?.description || '',
            }))
            .filter((c) => c.id || c.name)
        : [];
      plugin.agents.forEach((agent) => {
        const availableSkills = this.#resolveAgentSkills(agent, plugin);
        const defaultSkills = this.#resolveDefaultSkills(agent, plugin, availableSkills);
        agents.push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          pluginDescription: plugin.description || '',
          pluginCategory: plugin.category || 'general',
          id: agent.id,
          name: agent.name,
          description: agent.description || '',
          model: agent.model || null,
          defaultSkills,
          defaultCommand: agent.defaultCommand || null,
          skills: availableSkills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description || '',
          })),
          commands,
        });
      });
    });
    return agents;
  }

  listCommands() {
    const plugins = this.listInstalledPlugins();
    const commands = [];
    plugins.forEach((plugin) => {
      plugin.commands.forEach((command) => {
        commands.push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          id: command.id,
          name: command.name,
          description: command.description || '',
          model: command.model || null,
        });
      });
    });
    return commands;
  }

  getAgent(agentId) {
    if (!agentId) {
      return null;
    }
    const plugins = this.listInstalledPlugins();
    for (const plugin of plugins) {
      const agent = plugin.agentMap.get(agentId);
      if (agent) {
        return { plugin, agent };
      }
    }
    return null;
  }

  getCommand(pluginId, commandId) {
    if (!pluginId || !commandId) {
      return null;
    }
    const installed = new Set(this.#loadInstalledIds());
    if (!installed.has(pluginId)) {
      return null;
    }
    let plugin;
    try {
      plugin = this.#loadPlugin(pluginId);
    } catch {
      return null;
    }
    const command = plugin.commandMap.get(commandId);
    if (!command) {
      return null;
    }
    return { plugin, command };
  }

  buildSystemPrompt(agentRef, requestedSkills = []) {
    if (!agentRef || !agentRef.agent || !agentRef.plugin) {
      throw new Error('Invalid agent reference.');
    }
    const agent = agentRef.agent;
    const plugin = agentRef.plugin;
    const basePrompt = this.#loadAgentPrompt(agent);
    const skillMap = this.#agentSkillMap(agent, plugin);
    const desiredSkills =
      requestedSkills && requestedSkills.length > 0
        ? requestedSkills
        : this.#resolveDefaultSkills(agent, plugin);
    const usedSkills = [];
    desiredSkills.forEach((skillId) => {
      const skill = skillMap.get(skillId);
      if (!skill) {
        return;
      }
      const instructions = this.#loadSkillInstructions(skill);
      if (!instructions) {
        return;
      }
      usedSkills.push({
        id: skill.id,
        name: skill.name,
        instructions,
      });
    });
    const sections = [];
    if (basePrompt && basePrompt.trim()) {
      sections.push(basePrompt.trim());
    }
    usedSkills.forEach((skill) => {
      sections.push(`# Skill: ${skill.name}\n${skill.instructions.trim()}`);
    });
    const composedPrompt = this.#composePromptPayload(sections.join('\n\n'));
    return {
      systemPrompt: composedPrompt.basePrompt,
      internalPrompt: composedPrompt.internalPrompt,
      combinedPrompt: composedPrompt.combinedPrompt,
      usedSkills: usedSkills.map((skill) => ({ id: skill.id, name: skill.name })),
      extra: {
        reasoning: agent.reasoning === undefined ? true : Boolean(agent.reasoning),
      },
    };
  }

  buildCommandPrompt(commandRef, argText = '') {
    if (!commandRef || !commandRef.command || !commandRef.plugin) {
      throw new Error('Invalid command reference.');
    }
    const instructions = this.#loadCommandInstructions(commandRef.command);
    const filled = this.#fillArguments(instructions, argText);
    const sections = [];
    if (filled && filled.trim()) {
      sections.push(filled.trim());
    }
    if (argText && argText.trim()) {
      sections.push(`User arguments:\n${argText.trim()}`);
    }
    const composedPrompt = this.#composePromptPayload(sections.join('\n\n'));
    return {
      systemPrompt: composedPrompt.basePrompt,
      internalPrompt: composedPrompt.internalPrompt,
      combinedPrompt: composedPrompt.combinedPrompt,
      extra: {
        reasoning: commandRef.command.reasoning === undefined ? true : Boolean(commandRef.command.reasoning),
      },
    };
  }

  #loadMarketplace() {
    if (this.marketplaceCache) return this.marketplaceCache;
    const builtin = this.#loadBuiltinMarketplace();
    const user = this.#loadUserMarketplace();
    const map = new Map();
    builtin.forEach((entry) => {
      if (entry?.id) map.set(entry.id, entry);
    });
    user.forEach((entry) => {
      if (entry?.id) map.set(entry.id, entry);
    });
    this.marketplaceCache = Array.from(map.values());
    return this.marketplaceCache;
  }

  #loadBuiltinMarketplace() {
    try {
      const data = fs.readFileSync(this.marketplacePath, 'utf8');
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  #loadUserMarketplace() {
    if (this.userMarketplaceCache) return this.userMarketplaceCache;
    try {
      if (!fs.existsSync(this.userMarketplacePath)) {
        this.userMarketplaceCache = [];
        return this.userMarketplaceCache;
      }
      const data = fs.readFileSync(this.userMarketplacePath, 'utf8');
      const parsed = JSON.parse(data);
      this.userMarketplaceCache = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.userMarketplaceCache = [];
    }
    return this.userMarketplaceCache;
  }

  #saveUserMarketplace(entries) {
    try {
      fs.mkdirSync(this.userBaseDir, { recursive: true });
      fs.writeFileSync(this.userMarketplacePath, JSON.stringify(entries, null, 2), 'utf8');
      this.userMarketplaceCache = entries.slice();
    } catch (err) {
      throw new Error(`Failed to write user marketplace: ${err.message}`);
    }
  }

  #mergeUserMarketplaceEntries(newEntries, sourceId) {
    const existing = this.#loadUserMarketplace();
    const next = existing.filter((entry) => entry?.source?.id !== sourceId);
    newEntries.forEach((entry) => next.push(entry));
    const deduped = new Map();
    next.forEach((entry) => {
      if (entry?.id) {
        deduped.set(entry.id, entry);
      }
    });
    return Array.from(deduped.values());
  }

  #invalidateMarketplaceCaches() {
    this.marketplaceCache = null;
    this.userMarketplaceCache = null;
  }

  #loadSources() {
    if (this.sourcesCache) return this.sourcesCache;
    try {
      if (!fs.existsSync(this.userSourcesPath)) {
        this.sourcesCache = [];
        return this.sourcesCache;
      }
      const raw = fs.readFileSync(this.userSourcesPath, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sources) ? parsed.sources : [];
      this.sourcesCache = list
        .map((s) => (s && typeof s === 'object' ? s : null))
        .filter(Boolean)
        .map((s) => ({
          id: String(s.id || '').trim(),
          type: s.type || 'git',
          url: s.url || null,
          repoRoot: s.repoRoot || s.path || null,
          createdAt: s.createdAt || null,
          updatedAt: s.updatedAt || null,
        }))
        .filter((s) => s.id && s.repoRoot);
    } catch {
      this.sourcesCache = [];
    }
    return this.sourcesCache;
  }

  #saveSources(sources) {
    try {
      fs.mkdirSync(this.userBaseDir, { recursive: true });
      fs.writeFileSync(this.userSourcesPath, JSON.stringify({ sources }, null, 2), 'utf8');
      this.sourcesCache = sources.slice();
    } catch (err) {
      throw new Error(`Failed to write marketplace sources: ${err.message}`);
    }
  }

  #resolveSourceRepo(input) {
    const raw = String(input || '').trim();
    if (!raw) {
      throw new Error('Source input is empty.');
    }

    if (fs.existsSync(raw) && fs.statSync(raw).isDirectory()) {
      const repoRoot = path.resolve(raw);
      return { id: `local:${repoRoot}`, type: 'local', url: null, repoRoot };
    }

    const normalized = raw.replace(/^https?:\/\//i, '');
    const cleaned = normalized.replace(/\.git$/i, '');
    const repoSlug = cleaned.includes('github.com/')
      ? cleaned.split('github.com/')[1]
      : cleaned;
    const sourceId = repoSlug;
    const url = raw.includes('://') ? raw : `https://github.com/${repoSlug}.git`;
    const dirName = sourceId.replace(/[^a-z0-9_-]+/gi, '_');
    const repoRoot = path.join(this.userSourcesDir, dirName, 'repo');
    if (!fs.existsSync(repoRoot)) {
      fs.mkdirSync(path.dirname(repoRoot), { recursive: true });
      this.#runGit(['clone', '--depth', '1', url, repoRoot], { cwd: process.cwd() });
    }
    return { id: sourceId, type: 'git', url, repoRoot };
  }

  #runGit(args, options = {}) {
    try {
      return execFileSync('git', args, {
        cwd: options.cwd || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      });
    } catch (err) {
      const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
      const hint = stderr ? `\n${stderr}` : '';
      throw new Error(`Git command failed: git ${args.join(' ')}${hint}`);
    }
  }

  #getMarketplaceEntry(pluginId) {
    const needle = String(pluginId || '').trim();
    if (!needle) return null;
    const list = this.#loadMarketplace();
    return list.find((entry) => entry?.id === needle) || null;
  }

  #importMarketplacePlugin({ pluginId, source, meta }) {
    const sourceId = String(source?.id || '').trim();
    if (!sourceId) {
      throw new Error(`Plugin "${pluginId}" is not available locally and has no source metadata.`);
    }
    const sources = this.#loadSources();
    const src = sources.find((s) => s.id === sourceId);
    if (!src || !src.repoRoot) {
      throw new Error(`Marketplace source "${sourceId}" not found. Run "/sub marketplace add <repo>" first.`);
    }
    const pluginPath = typeof source?.pluginPath === 'string' ? source.pluginPath : `plugins/${pluginId}`;
    fs.mkdirSync(this.userPluginsDir, { recursive: true });
    importClaudeCodePlugin({
      repoRoot: src.repoRoot,
      pluginId,
      pluginPath,
      outPluginsDir: this.userPluginsDir,
      pluginMeta: {
        name: meta?.name,
        description: meta?.description,
        category: meta?.category,
      },
    });
    this.pluginCache.delete(pluginId);
  }

  #loadInstalledIds() {
    if (this.installedCache) {
      return this.installedCache;
    }
    try {
      const raw = fs.readFileSync(this.statePath, 'utf8');
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed.plugins) ? parsed.plugins : [];
      this.installedCache = entries
        .map((entry) => {
          if (!entry) return null;
          if (typeof entry === 'string') {
            return entry;
          }
          if (entry.enabled === false) {
            return null;
          }
          return entry.id || entry.plugin || entry.name || null;
        })
        .filter(Boolean);
    } catch {
      this.installedCache = [];
    }
    const defaults = this.#defaultInstalled();
    const set = new Set(this.installedCache);
    defaults.forEach((id) => set.add(id));
    if (set.size !== this.installedCache.length) {
      this.installedCache = Array.from(set);
      this.#saveInstalled(this.installedCache);
    }
    return this.installedCache;
  }

  #saveInstalled(ids) {
    this.installedCache = ids.slice();
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      const payload = ids.map((entry) => {
        if (entry && typeof entry === 'object' && entry.id) {
          return { id: entry.id, enabled: entry.enabled !== false };
        }
        return { id: entry, enabled: true };
      });
      fs.writeFileSync(this.statePath, JSON.stringify({ plugins: payload }, null, 2), 'utf8');
    } catch (err) {
      throw new Error(`Failed to write subagent state: ${err.message}`);
    }
  }

  #loadPlugin(pluginId) {
    const pluginDir = this.#resolvePluginDir(pluginId);
    if (!pluginDir) {
      throw new Error(`Plugin "${pluginId}" is not installed locally.`);
    }
    const manifestPath = path.join(pluginDir, 'plugin.json');
    let manifestMtimeMs = null;
    try {
      manifestMtimeMs = fs.statSync(manifestPath).mtimeMs;
    } catch {
      manifestMtimeMs = null;
    }
    const cached = this.pluginCache.get(pluginId);
    if (cached?.plugin) {
      if (cached.manifestPath === manifestPath) {
        if (manifestMtimeMs === null) return cached.plugin;
        if (cached.mtimeMs === manifestMtimeMs) return cached.plugin;
      }
    }
    let manifest;
    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      manifest = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to read plugin ${pluginId}: ${err.message}`);
    }
    const normalized = {
      id: manifest.id || pluginId,
      name: manifest.name || pluginId,
      description: manifest.description || '',
      category: manifest.category || 'general',
      directory: pluginDir,
    };
    normalized.skills = Array.isArray(manifest.skills)
      ? manifest.skills.map((skill) => ({
          ...skill,
          instructionsPath: skill.instructionsPath
            ? path.join(pluginDir, skill.instructionsPath)
            : null,
        }))
      : [];
    normalized.skillMap = new Map(
      normalized.skills.map((skill) => [skill.id, skill])
    );
    normalized.commands = Array.isArray(manifest.commands)
      ? manifest.commands.map((command) => ({
          ...command,
          instructionsPath: command.instructionsPath
            ? path.join(pluginDir, command.instructionsPath)
            : null,
        }))
      : [];
    normalized.commandMap = new Map(
      normalized.commands.map((command) => [command.id, command])
    );
    normalized.agents = Array.isArray(manifest.agents)
      ? manifest.agents.map((agent) => ({
          ...agent,
          pluginId: normalized.id,
          systemPromptPath: agent.systemPromptPath
            ? path.join(pluginDir, agent.systemPromptPath)
            : null,
        }))
      : [];
    normalized.agentMap = new Map(
      normalized.agents.map((agent) => [agent.id, agent])
    );
    this.pluginCache.set(pluginId, { plugin: normalized, mtimeMs: manifestMtimeMs, manifestPath });
    return normalized;
  }

  #resolvePluginDir(pluginId) {
    if (!pluginId) return null;
    const candidates = [
      path.join(this.userPluginsDir, pluginId),
      path.join(this.pluginsDir, pluginId),
    ];
    for (const dir of candidates) {
      try {
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
          return dir;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  #resolveAgentSkills(agent, plugin) {
    const skillIds = Array.isArray(agent.skills) && agent.skills.length > 0
      ? agent.skills
      : Array.from(plugin.skillMap.keys());
    return skillIds
      .map((id) => plugin.skillMap.get(id))
      .filter(Boolean);
  }

  #agentSkillMap(agent, plugin) {
    const map = new Map();
    this.#resolveAgentSkills(agent, plugin).forEach((skill) => {
      map.set(skill.id, skill);
    });
    return map;
  }

  #resolveDefaultSkills(agent, plugin, availableSkills = null) {
    // Priority: explicit defaultSkills (including empty) -> agent.skills -> plugin.skills -> availableSkills (computed)
    if (Array.isArray(agent.defaultSkills)) {
      return agent.defaultSkills;
    }
    const fallbackSource =
      (Array.isArray(agent.skills) && agent.skills.length > 0
        ? agent.skills
        : Array.isArray(plugin?.skills) && plugin.skills.length > 0
          ? plugin.skills
          : availableSkills) || [];
    return fallbackSource
      .map((s) => (typeof s === 'string' ? s : s?.id || s?.name || ''))
      .map((s) => String(s || '').trim())
      .filter(Boolean);
  }

  #loadAgentPrompt(agent) {
    if (agent._systemPrompt !== undefined) {
      return agent._systemPrompt;
    }
    if (agent.system) {
      agent._systemPrompt = agent.system;
      return agent._systemPrompt;
    }
    if (!agent.systemPromptPath) {
      agent._systemPrompt = '';
      return agent._systemPrompt;
    }
    try {
      agent._systemPrompt = fs.readFileSync(agent.systemPromptPath, 'utf8');
    } catch {
      agent._systemPrompt = '';
    }
    return agent._systemPrompt;
  }

  #loadSkillInstructions(skill) {
    if (skill._instructions !== undefined) {
      return skill._instructions;
    }
    if (skill.instructions) {
      skill._instructions = skill.instructions;
      return skill._instructions;
    }
    if (!skill.instructionsPath) {
      skill._instructions = '';
      return skill._instructions;
    }
    try {
      skill._instructions = fs.readFileSync(skill.instructionsPath, 'utf8');
    } catch {
      skill._instructions = '';
    }
    return skill._instructions;
  }

  #loadCommandInstructions(command) {
    if (command._instructions !== undefined) {
      return command._instructions;
    }
    if (command.instructions) {
      command._instructions = command.instructions;
      return command._instructions;
    }
    if (!command.instructionsPath) {
      command._instructions = '';
      return command._instructions;
    }
    try {
      command._instructions = fs.readFileSync(command.instructionsPath, 'utf8');
    } catch {
      command._instructions = '';
    }
    return command._instructions;
  }

  #fillArguments(text, argText) {
    if (!text) return '';
    const argValue = argText || '';
    return text.replace(/\$ARGUMENTS/gi, argValue);
  }

  #composePromptPayload(promptText) {
    const basePrompt = typeof promptText === 'string' ? promptText.trim() : '';
    const internal = this.#getInternalPrompt();
    const internalPrompt = typeof internal === 'string' ? internal.trim() : '';
    const combinedPrompt = [internalPrompt, basePrompt].filter(Boolean).join('\n\n');
    return { basePrompt, internalPrompt, combinedPrompt };
  }

  #getInternalPrompt() {
    if (this.internalPromptResolved) {
      return this.internalPrompt || '';
    }
    try {
      const config = loadSystemPromptConfig(this.systemPromptPath);
      this.internalPrompt = config.subagentInternal || DEFAULT_INTERNAL_SYSTEM_PROMPT;
    } catch {
      this.internalPrompt = DEFAULT_INTERNAL_SYSTEM_PROMPT;
    }
    this.internalPromptResolved = true;
    return this.internalPrompt || '';
  }

  #defaultInstalled() {
    const projectRoot = path.resolve(this.baseDir || '.', '..');
    const defaultsPath = path.join(projectRoot, 'shared', 'defaults', 'subagents.json');
    let defaults = [];
    try {
      const raw = fs.readFileSync(defaultsPath, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed?.plugins) ? parsed.plugins : [];
      defaults = list.map((id) => String(id || '').trim()).filter(Boolean);
    } catch {
      defaults = [];
    }
    if (defaults.length === 0) {
      defaults = ['python-development', 'spring-boot-development', 'frontend-react'];
    }
    return defaults.filter((id) => Boolean(this.#resolvePluginDir(id)));
  }
}
