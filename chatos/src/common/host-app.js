function normalizeHostApp(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function getHostApp() {
  return normalizeHostApp(process.env.MODEL_CLI_HOST_APP);
}

export function isChatosHost() {
  return getHostApp() === 'chatos';
}

export function normalizeMcpServerName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function isExternalOnlyMcpServerName(name) {
  return normalizeMcpServerName(name) === 'aide_island_chat';
}

export function allowExternalOnlyMcpServers() {
  const override = normalizeHostApp(process.env.MODEL_CLI_ALLOW_EXTERNAL_ONLY_MCP);
  if (override === '1' || override === 'true' || override === 'yes') {
    return true;
  }
  return isChatosHost();
}

