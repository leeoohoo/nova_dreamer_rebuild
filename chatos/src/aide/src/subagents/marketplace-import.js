import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

function parseFrontmatter(content) {
  const raw = typeof content === 'string' ? content : '';
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.startsWith('---')) {
    return { data: {}, body: raw };
  }
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: raw };
  }
  const data = YAML.parse(match[1]) || {};
  return { data, body: match[2] || '' };
}

function extractHeading(body) {
  const lines = String(body || '').split('\n');
  let title = '';
  let description = '';
  let level = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!title && /^#+\s+/.test(trimmed)) {
      level = (trimmed.match(/^#+/) || [''])[0].length;
      title = trimmed.replace(/^#+\s+/, '').trim();
      continue;
    }
    if (!description && trimmed) {
      description = trimmed.replace(/^>\s*/, '').trim();
    }
  }
  return { title, description, level };
}

function toTitleCase(value) {
  return String(value || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function mapMarketplaceModel(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const key = value.toLowerCase();
  if (!value || key === 'inherit' || key === 'default') {
    return null;
  }
  const map = {
    opus: 'deepseek_reasoner',
    sonnet: 'deepseek_chat',
    haiku: 'deepseek_chat',
  };
  return map[key] || value;
}

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((entry) => fs.statSync(path.join(dir, entry)).isDirectory());
  } catch {
    return [];
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeRelativePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('./')) return raw.slice(2);
  return raw;
}

export function readClaudeCodeMarketplace(repoRoot) {
  const resolvedRoot = path.resolve(repoRoot || '');
  if (!resolvedRoot) {
    return { plugins: [] };
  }
  const marketplacePath = path.join(resolvedRoot, '.claude-plugin', 'marketplace.json');
  if (!fs.existsSync(marketplacePath)) {
    return { plugins: [] };
  }
  const raw = fs.readFileSync(marketplacePath, 'utf8');
  const parsed = JSON.parse(raw);
  const plugins = Array.isArray(parsed?.plugins) ? parsed.plugins : [];
  return { plugins };
}

export function indexClaudeCodeMarketplace(repoRoot, sourceMeta = {}) {
  const { plugins } = readClaudeCodeMarketplace(repoRoot);
  const entries = [];
  plugins.forEach((plugin) => {
    const id = String(plugin?.name || '').trim();
    if (!id) return;
    const category = plugin?.category ? toTitleCase(plugin.category) : 'general';
    const sourcePath = plugin?.source ? normalizeRelativePath(plugin.source) : `plugins/${id}`;
    entries.push({
      id,
      name: toTitleCase(id),
      category,
      description: plugin?.description || '',
      source: {
        ...sourceMeta,
        pluginPath: sourcePath,
      },
    });
  });
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export function importClaudeCodePlugin({
  repoRoot,
  pluginId,
  pluginPath,
  outPluginsDir,
  pluginMeta = {},
} = {}) {
  const resolvedRoot = path.resolve(repoRoot || '');
  const id = String(pluginId || '').trim();
  if (!resolvedRoot) {
    throw new Error('repoRoot is required.');
  }
  if (!id) {
    throw new Error('pluginId is required.');
  }
  const relativePluginPath = normalizeRelativePath(pluginPath || `plugins/${id}`);
  const sourceDir = path.join(resolvedRoot, relativePluginPath);
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Plugin source directory not found: ${sourceDir}`);
  }
  const targetDir = path.join(path.resolve(outPluginsDir || ''), id);
  if (!outPluginsDir) {
    throw new Error('outPluginsDir is required.');
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  ensureDir(targetDir);
  const agentsDir = path.join(targetDir, 'agents');
  const skillsDir = path.join(targetDir, 'skills');
  const commandsDir = path.join(targetDir, 'commands');
  ensureDir(agentsDir);
  ensureDir(skillsDir);
  ensureDir(commandsDir);

  const manifest = {
    id,
    name: pluginMeta.name || toTitleCase(id),
    description: pluginMeta.description || '',
    category: pluginMeta.category || 'general',
    agents: [],
    skills: [],
    commands: [],
  };

  const sourceAgentsDir = path.join(sourceDir, 'agents');
  if (fs.existsSync(sourceAgentsDir)) {
    const agentFiles = fs
      .readdirSync(sourceAgentsDir)
      .filter((file) => file.toLowerCase().endsWith('.md'));
    agentFiles.forEach((file) => {
      const sourcePath = path.join(sourceAgentsDir, file);
      const { data, body } = parseFrontmatter(fs.readFileSync(sourcePath, 'utf8'));
      const agentId = String(data.name || path.parse(file).name).trim();
      if (!agentId) return;
      const prompt = body.trim();
      fs.writeFileSync(path.join(agentsDir, `${agentId}.md`), prompt ? `${prompt}\n` : '', 'utf8');
      manifest.agents.push({
        id: agentId,
        name: toTitleCase(data.displayName || data.title || agentId),
        description: data.description || '',
        model: mapMarketplaceModel(data.model),
        reasoning: false,
        systemPromptPath: `agents/${agentId}.md`,
        defaultSkills: [],
      });
    });
  }

  const sourceSkillsDir = path.join(sourceDir, 'skills');
  if (fs.existsSync(sourceSkillsDir)) {
    const skillFolders = listDirs(sourceSkillsDir);
    skillFolders.forEach((folder) => {
      const skillRoot = path.join(sourceSkillsDir, folder);
      const skillFile = path.join(skillRoot, 'SKILL.md');
      if (!fs.existsSync(skillFile)) return;
      const { data, body } = parseFrontmatter(fs.readFileSync(skillFile, 'utf8'));
      const skillId = String(data.name || folder).trim();
      if (!skillId) return;
      const instructions = body.trim();
      fs.writeFileSync(path.join(skillsDir, `${skillId}.md`), instructions ? `${instructions}\n` : '', 'utf8');
      manifest.skills.push({
        id: skillId,
        name: toTitleCase(data.title || skillId),
        description: data.description || '',
        instructionsPath: `skills/${skillId}.md`,
      });
    });
  }

  const sourceCommandsDir = path.join(sourceDir, 'commands');
  if (fs.existsSync(sourceCommandsDir)) {
    const commandFiles = fs
      .readdirSync(sourceCommandsDir)
      .filter((file) => file.toLowerCase().endsWith('.md'));
    commandFiles.forEach((file) => {
      const sourcePath = path.join(sourceCommandsDir, file);
      const raw = fs.readFileSync(sourcePath, 'utf8');
      const { data, body } = parseFrontmatter(raw);
      const heading = extractHeading(body);
      const cmdId = String(data.name || path.parse(file).name).trim();
      if (!cmdId) return;
      const instructions = body.trim();
      fs.writeFileSync(path.join(commandsDir, `${cmdId}.md`), instructions ? `${instructions}\n` : '', 'utf8');
      const resolvedTitle = data.title || (heading.level === 1 ? heading.title : '') || cmdId;
      manifest.commands.push({
        id: cmdId,
        name: toTitleCase(resolvedTitle),
        description: data.description || heading.description || '',
        instructionsPath: `commands/${cmdId}.md`,
        model: mapMarketplaceModel(data.model),
        reasoning: false,
      });
    });
  }

  writeJson(path.join(targetDir, 'plugin.json'), manifest);
  return { pluginDir: targetDir, plugin: manifest };
}

