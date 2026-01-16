import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const defaultsDir = path.join(projectRoot, 'shared', 'defaults');

function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : '';
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function shouldIncludePromptFile(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (!(base.endsWith('.yaml') || base.endsWith('.yml'))) return false;
  if (base.includes('.prompt.')) return true;
  return (
    base === 'system-prompt.yaml' ||
    base === 'system-prompt.en.yaml' ||
    base === 'system-default-prompt.yaml' ||
    base === 'system-default-prompt.en.yaml' ||
    base === 'system-user-prompt.yaml' ||
    base === 'subagent-system-prompt.yaml' ||
    base === 'subagent-system-prompt.en.yaml' ||
    base === 'subagent-user-prompt.yaml'
  );
}

function walkDefaultsShallow(dirPath) {
  const results = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      // Keep it shallow (defaults/*/*) like the runtime loader.
      let nested = [];
      try {
        nested = fs.readdirSync(fullPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of nested) {
        if (!child.isFile()) continue;
        results.push(path.join(fullPath, child.name));
      }
      continue;
    }
    if (entry.isFile()) results.push(fullPath);
  }
  return results;
}

function parseJsonFile(filePath, errors) {
  let raw = '';
  try {
    raw = stripBom(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    errors.push(`${filePath}: failed to read (${err.message || String(err)})`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    errors.push(`${filePath}: invalid JSON (${err.message || String(err)})`);
    return null;
  }
}

function parseYamlFile(filePath, errors) {
  let raw = '';
  try {
    raw = stripBom(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    errors.push(`${filePath}: failed to read (${err.message || String(err)})`);
    return null;
  }
  try {
    const doc = YAML.parseDocument(raw, { prettyErrors: true });
    if (doc.errors.length > 0) {
      errors.push(`${filePath}: invalid YAML (${doc.errors[0].message})`);
      return null;
    }
    return doc.toJS();
  } catch (err) {
    errors.push(`${filePath}: invalid YAML (${err.message || String(err)})`);
    return null;
  }
}

function collectPrompts({ yamlFiles, errors }) {
  const promptEntries = new Map(); // name -> { name, type, allowMain, allowSub, sources: string[] }

  const register = (name, meta) => {
    if (!name) return;
    const normalized = normalizeName(name);
    if (!normalized) return;
    const existing = promptEntries.get(normalized);
    if (!existing) {
      promptEntries.set(normalized, { name: normalized, ...meta, sources: [meta.source] });
      return;
    }
    existing.sources.push(meta.source);
  };

  yamlFiles.forEach((filePath) => {
    if (!shouldIncludePromptFile(filePath)) return;
    const parsed = parseYamlFile(filePath, errors);
    if (!parsed || typeof parsed !== 'object') return;

    const nodes = Array.isArray(parsed.prompts) ? parsed.prompts : [parsed];
    const fileBase = path.basename(filePath).replace(/\.(ya?ml)$/i, '');
    const inferredName = normalizeName(fileBase.replace(/\.prompt\.[^.]+$/i, ''));

    nodes.forEach((node) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      const content =
        typeof node.content === 'string'
          ? node.content
          : typeof node.prompt === 'string'
            ? node.prompt
            : typeof node.text === 'string'
              ? node.text
              : '';
      if (!content || !content.trim()) return;
      const name = normalizeName(node.name || node.id || inferredName);
      if (!name) {
        errors.push(`${filePath}: prompt entry missing name/id and cannot infer a name`);
        return;
      }
      const type = typeof node.type === 'string' ? node.type.trim().toLowerCase() : 'system';
      register(name, {
        type,
        allowMain: node.allowMain === true,
        allowSub: node.allowSub === true,
        source: filePath,
      });
    });
  });

  const duplicates = Array.from(promptEntries.values()).filter((entry) => entry.sources.length > 1);
  duplicates.forEach((entry) => {
    errors.push(`Duplicate prompt "${entry.name}" found in: ${entry.sources.join(', ')}`);
  });

  return promptEntries;
}

function validateMcpPrompts({ mcpServers, promptEntries, errors, warnings }) {
  (Array.isArray(mcpServers) ? mcpServers : []).forEach((srv) => {
    if (!srv || typeof srv !== 'object') return;
    const serverName = typeof srv.name === 'string' ? srv.name.trim() : '';
    if (!serverName) return;

    const basePromptName = `mcp_${normalizeName(serverName)}`;
    const zhPrompt = promptEntries.get(basePromptName);
    const enPrompt = promptEntries.get(`${basePromptName}__en`);

    if (!zhPrompt) {
      errors.push(`Missing MCP prompt "${basePromptName}" for server "${serverName}" (from mcp.config.json)`);
    }
    if (!enPrompt) {
      warnings.push(`Missing optional MCP prompt "${basePromptName}__en" for server "${serverName}"`);
    }

    const expectAllowMain = srv.allowMain === true;
    const expectAllowSub = srv.allowSub !== false;
    const checkFlags = (prompt, label) => {
      if (!prompt) return;
      if (prompt.allowMain !== expectAllowMain) {
        warnings.push(
          `${label}: allowMain=${prompt.allowMain} does not match server.allowMain=${expectAllowMain} (${serverName})`
        );
      }
      if (prompt.allowSub !== expectAllowSub) {
        warnings.push(
          `${label}: allowSub=${prompt.allowSub} does not match server.allowSub=${expectAllowSub} (${serverName})`
        );
      }
      if (prompt.type !== 'system') {
        warnings.push(`${label}: type=${prompt.type} (expected system) (${serverName})`);
      }
    };
    checkFlags(zhPrompt, basePromptName);
    checkFlags(enPrompt, `${basePromptName}__en`);
  });
}

function main() {
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(defaultsDir)) {
    console.error(`[defaults] Directory not found: ${defaultsDir}`);
    process.exit(2);
  }

  const defaultsFiles = walkDefaultsShallow(defaultsDir);
  const yamlFiles = defaultsFiles.filter((filePath) => /\.(ya?ml)$/i.test(filePath));

  // Syntax check: parse all YAML under defaults (shallow).
  yamlFiles.forEach((filePath) => {
    parseYamlFile(filePath, errors);
  });

  // Syntax check: parse key JSON defaults.
  const mcpConfigPath = path.join(defaultsDir, 'mcp.config.json');
  const mcpConfig = fs.existsSync(mcpConfigPath) ? parseJsonFile(mcpConfigPath, errors) : null;

  // Semantic check: ensure each MCP server has a corresponding MCP prompt.
  const promptEntries = collectPrompts({ yamlFiles, errors });
  if (mcpConfig && typeof mcpConfig === 'object') {
    validateMcpPrompts({
      mcpServers: mcpConfig.servers,
      promptEntries,
      errors,
      warnings,
    });
  }

  if (warnings.length > 0) {
    console.log(`[defaults] Warnings (${warnings.length}):`);
    warnings.forEach((line) => console.log(`- ${line}`));
  }
  if (errors.length > 0) {
    console.error(`[defaults] Errors (${errors.length}):`);
    errors.forEach((line) => console.error(`- ${line}`));
    process.exit(1);
  }

  console.log(
    `[defaults] OK: parsed ${yamlFiles.length} YAML file(s), found ${promptEntries.size} prompt(s), validated MCP prompts for ${
      Array.isArray(mcpConfig?.servers) ? mcpConfig.servers.length : 0
    } server(s).`
  );
}

main();

