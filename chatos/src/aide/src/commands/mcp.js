import * as colors from '../colors.js';

export function printMcpServers(servers, configPath) {
  console.log(colors.cyan(`\nMCP config: ${configPath}`));
  if (!servers || servers.length === 0) {
    console.log(colors.yellow('No MCP servers configured. Use /mcp_set to add one.'));
    return;
  }
  servers.forEach((entry, idx) => {
    const endpoint = entry.url || '<none>';
    console.log(
      `  [${idx + 1}] ${entry.name || '<unnamed>'}\n      Endpoint: ${endpoint}\n      API key env: ${
        entry.api_key_env || '<none>'
      }\n      Description: ${entry.description || '<none>'}`
    );
  });
}

export function upsertMcpServer(servers, server, originalName = null) {
  const copy = Array.isArray(servers) ? servers.map((entry) => ({ ...entry })) : [];
  const targetName = originalName || server.name;
  const existingIndex = copy.findIndex((entry) => entry.name === targetName);
  if (existingIndex >= 0) {
    const prev = copy[existingIndex] || {};
    copy[existingIndex] = { ...prev, ...server };
    if (server?.name && server.name !== targetName) {
      const duplicateIndex = copy.findIndex((entry, idx) => idx !== existingIndex && entry.name === server.name);
      if (duplicateIndex >= 0) {
        copy.splice(duplicateIndex, 1);
      }
    }
  } else {
    const duplicateIndex = copy.findIndex((entry) => entry.name === server.name);
    if (duplicateIndex >= 0) {
      const prev = copy[duplicateIndex] || {};
      copy[duplicateIndex] = { ...prev, ...server };
    } else {
      copy.push({ ...server });
    }
  }
  return copy;
}

