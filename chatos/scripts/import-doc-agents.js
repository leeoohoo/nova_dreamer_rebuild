import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const engineRoot = path.resolve(projectRoot, 'packages', 'aide');
const docRoot = path.join(projectRoot, 'doc', 'agents');
const sourcePluginsDir = path.join(docRoot, 'plugins');
const destinationRoot = path.join(engineRoot, 'subagents');
const destinationPluginsDir = path.join(destinationRoot, 'plugins');
const marketplacePath = path.join(destinationRoot, 'marketplace.json');
const pluginDocsPath = path.join(docRoot, 'docs', 'plugins.md');

run();

function run() {
  ensureDir(destinationPluginsDir);
  const pluginMeta = parsePluginDocs(pluginDocsPath);
  const pluginIds = listDirs(sourcePluginsDir);
  const marketplace = [];

  pluginIds.forEach((pluginId) => {
    const sourceDir = path.join(sourcePluginsDir, pluginId);
    const targetDir = path.join(destinationPluginsDir, pluginId);
    fs.rmSync(targetDir, { recursive: true, force: true });
    ensureDir(targetDir);
    const meta = pluginMeta.get(pluginId) || {};
    const plugin = {
      id: pluginId,
      name: toTitleCase(pluginId),
      description: meta.description || 'Imported from doc/agents.',
      category: meta.category || 'general',
      agents: [],
      skills: [],
      commands: [],
    };

    plugin.agents = importAgents(sourceDir, targetDir);
    plugin.skills = importSkills(sourceDir, targetDir);
    plugin.commands = importCommands(sourceDir, targetDir);
    plugin.agents = plugin.agents.map((agent) => ({
      ...agent,
      // If agent.skills is empty/undefined, runtime will fall back to plugin.skillMap (all skills)
      skills: agent.skills && agent.skills.length > 0 ? agent.skills : undefined,
      defaultSkills: agent.defaultSkills || [],
    }));

    writeJson(path.join(targetDir, 'plugin.json'), plugin);

    marketplace.push({
      id: plugin.id,
      name: plugin.name,
      category: plugin.category,
      description: plugin.description,
    });
    console.log(`Imported plugin ${plugin.id} (${plugin.agents.length} agents, ${plugin.skills.length} skills)`);
  });

  writeJson(
    marketplacePath,
    marketplace.sort((a, b) => a.name.localeCompare(b.name))
  );
  console.log(`Marketplace updated with ${marketplace.length} plugins.`);
}

function importAgents(sourceDir, targetDir) {
  const agentsDir = path.join(sourceDir, 'agents');
  const targetAgentsDir = path.join(targetDir, 'agents');
  ensureDir(targetAgentsDir);
  if (!fs.existsSync(agentsDir)) {
    return [];
  }
  const files = fs
    .readdirSync(agentsDir)
    .filter((file) => file.toLowerCase().endsWith('.md'));
  return files.map((file) => {
    const sourcePath = path.join(agentsDir, file);
    const { data, body } = parseFrontmatter(fs.readFileSync(sourcePath, 'utf8'));
    const id = String(data.name || path.parse(file).name).trim();
    const prompt = body.trim();
    const targetPath = path.join(targetAgentsDir, `${id}.md`);
    fs.writeFileSync(targetPath, prompt ? `${prompt}\n` : '', 'utf8');
    const model = mapModel(data.model);
    return {
      id,
      name: toTitleCase(data.displayName || data.title || id),
      description: data.description || '',
      model,
      reasoning: model === 'deepseek_reasoner',
      systemPromptPath: `agents/${id}.md`,
    };
  });
}

function importSkills(sourceDir, targetDir) {
  const skillsDir = path.join(sourceDir, 'skills');
  const targetSkillsDir = path.join(targetDir, 'skills');
  ensureDir(targetSkillsDir);
  if (!fs.existsSync(skillsDir)) {
    return [];
  }
  const skillDirs = listDirs(skillsDir);
  return skillDirs
    .map((skillFolder) => {
      const skillRoot = path.join(skillsDir, skillFolder);
      const skillFile = path.join(skillRoot, 'SKILL.md');
      if (!fs.existsSync(skillFile)) {
        return null;
      }
      const { data, body } = parseFrontmatter(fs.readFileSync(skillFile, 'utf8'));
      const id = String(data.name || skillFolder).trim();
      const instructions = body.trim();
      const targetPath = path.join(targetSkillsDir, `${id}.md`);
      fs.writeFileSync(targetPath, instructions ? `${instructions}\n` : '', 'utf8');
      return {
        id,
        name: toTitleCase(data.title || id),
        description: data.description || '',
        instructionsPath: `skills/${id}.md`,
      };
    })
    .filter(Boolean);
}

function importCommands(sourceDir, targetDir) {
  const commandsDir = path.join(sourceDir, 'commands');
  const targetCommandsDir = path.join(targetDir, 'commands');
  ensureDir(targetCommandsDir);
  if (!fs.existsSync(commandsDir)) {
    return [];
  }
  const files = fs
    .readdirSync(commandsDir)
    .filter((file) => file.toLowerCase().endsWith('.md'));
  return files.map((file) => {
    const sourcePath = path.join(commandsDir, file);
    const raw = fs.readFileSync(sourcePath, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const heading = extractHeading(body);
    const id = String(data.name || path.parse(file).name).trim();
    const instructions = body.trim();
    const targetPath = path.join(targetCommandsDir, `${id}.md`);
    fs.writeFileSync(targetPath, instructions ? `${instructions}\n` : '', 'utf8');
    const resolvedTitle = data.title || (heading.level === 1 ? heading.title : '') || id;
    return {
      id,
      name: toTitleCase(resolvedTitle),
      description: data.description || heading.description || '',
      instructionsPath: `commands/${id}.md`,
      model: data.model ? mapModel(data.model) : null,
    };
  });
}

function parsePluginDocs(mdPath) {
  const meta = new Map();
  if (!fs.existsSync(mdPath)) {
    return meta;
  }
  const lines = fs.readFileSync(mdPath, 'utf8').split('\n');
  let currentCategory = 'general';
  lines.forEach((line) => {
    const heading = line.match(/^###\s+(.+)/);
    if (heading) {
      const clean = heading[1]
        .replace(/^[^A-Za-z0-9]+/, '')
        .replace(/\(.*/, '')
        .trim();
      if (clean) {
        currentCategory = clean;
      }
      return;
    }
    const row = line.match(/^\|\s*\*\*([^*]+)\*\*\s*\|\s*([^|]+?)\s*\|/);
    if (row) {
      const id = row[1].trim();
      const description = row[2].trim();
      meta.set(id, { description, category: currentCategory });
    }
  });
  return meta;
}

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
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!title && /^#+\s+/.test(trimmed)) {
      level = (trimmed.match(/^#+/) || [''])[0].length;
      title = trimmed.replace(/^#+\s+/, '').trim();
      return;
    }
    if (!description && trimmed) {
      description = trimmed.replace(/^>\s*/, '').trim();
    }
  });
  return { title, description, level };
}

function toTitleCase(slug) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function mapModel(raw) {
  const normalized = String(raw || '').toLowerCase();
  const map = {
    opus: 'deepseek_reasoner',
    sonnet: 'deepseek_chat',
    haiku: 'deepseek_chat',
  };
  return map[normalized] || 'deepseek_chat';
}

function listDirs(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((entry) => fs.statSync(path.join(dir, entry)).isDirectory());
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}
