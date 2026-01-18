import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { allowExternalOnlyMcpServers, isExternalOnlyMcpServerName } from '../../src/common/host-app.js';
import { resolveEngineRoot } from '../../src/engine-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const ENGINE_ROOT = resolveEngineRoot({ projectRoot });
if (!ENGINE_ROOT) {
  throw new Error('Engine sources not found (expected ./src/engine relative to chatos).');
}

function resolveEngineModule(relativePath) {
  const rel = typeof relativePath === 'string' ? relativePath.trim() : '';
  if (!rel) throw new Error('relativePath is required');
  const srcPath = path.join(ENGINE_ROOT, 'src', rel);
  if (fs.existsSync(srcPath)) return srcPath;
  return path.join(ENGINE_ROOT, 'dist', rel);
}

const { listTools } = await import(pathToFileURL(resolveEngineModule('tools/index.js')).href);

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function resolveAllowedTools({ agent, mcpServers = [], allowedMcpPrefixes } = {}) {
  const agentRecord = agent && typeof agent === 'object' ? agent : {};
  const allowSubagents = Array.isArray(agentRecord.subagentIds) && agentRecord.subagentIds.length > 0;

  const legacyAllowedServers = new Set(['subagent_router', 'task_manager', 'project_files']);
  const serverAllowsMain = (server) => {
    if (isExternalOnlyMcpServerName(server?.name) && !allowExternalOnlyMcpServers()) {
      return false;
    }
    const explicit = server?.allowMain;
    if (explicit === true || explicit === false) {
      return explicit;
    }
    return legacyAllowedServers.has(normalize(server?.name));
  };

  const toolNames = listTools();
  const out = new Set();
  out.add('get_current_time');
  if (allowSubagents) out.add('invoke_sub_agent');

  const usePrefixAllowList = Array.isArray(allowedMcpPrefixes);
  if (usePrefixAllowList) {
    const prefixes = allowedMcpPrefixes.map((prefix) => String(prefix || '')).filter(Boolean);
    if (prefixes.length > 0) {
      for (const toolName of toolNames) {
        if (!toolName.startsWith('mcp_')) continue;
        for (const prefix of prefixes) {
          if (toolName.startsWith(prefix)) {
            out.add(toolName);
            break;
          }
        }
      }
    }
    return Array.from(out);
  }

  const allowedMcpNames = new Set(
    (Array.isArray(agentRecord.mcpServerIds) ? agentRecord.mcpServerIds : [])
      .map((id) => mcpServers.find((srv) => srv?.id === id))
      .filter((srv) => srv && srv.enabled !== false && serverAllowsMain(srv))
      .map((srv) => srv.name)
      .filter(Boolean)
      .map((name) => normalize(name))
  );

  if (allowedMcpNames.size > 0) {
    for (const toolName of toolNames) {
      if (!toolName.startsWith('mcp_')) continue;
      for (const server of allowedMcpNames) {
        const prefix = `mcp_${server}_`;
        if (toolName.startsWith(prefix)) {
          out.add(toolName);
          break;
        }
      }
    }
  }

  return Array.from(out);
}
