import fs from 'fs';
import path from 'path';

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTable(headers, rows) {
  const thead = `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`;
  const bodyRows = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? '')}</td>`).join('')}</tr>`)
    .join('');
  const tbody = `<tbody>${bodyRows}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

function generateConfigReport({
  modelsPath,
  models,
  activeModel,
  mcpPath,
  mcpServers,
  systemPromptPath,
  systemPrompt,
  promptProfiles,
  subAgents,
}) {
  const modelRows = Object.entries(models || {}).map(([name, cfg]) => {
    const tools = Array.isArray(cfg.tools) ? cfg.tools.join(', ') : '';
    const system = (cfg.system_prompt || '').trim();
    const preview = system.length > 120 ? `${system.slice(0, 117)}...` : system;
    const mark = name === activeModel ? '★ ' : '';
    return [mark + name, cfg.provider || '', cfg.model || '', tools, preview || '<none>'];
  });

  const mcpRows = (mcpServers || []).map((srv) => [
    srv.name || '',
    srv.url || '',
    srv.description || '',
  ]);

  const subAgentRows = (subAgents || []).map((agent) => [
    agent.id,
    agent.name,
    agent.pluginId || '',
    agent.model || 'current',
    (agent.skills || []).map((s) => s.id).join(', '),
  ]);

  const promptNames = promptProfiles ? Object.keys(promptProfiles) : [];

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>model-cli config snapshot</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; margin: 20px; }
    h2 { margin-top: 32px; }
    table { border-collapse: collapse; width: 100%; margin-top: 8px; }
    th, td { border: 1px solid #ddd; padding: 6px; vertical-align: top; font-size: 13px; }
    th { background: #f4f4f4; text-align: left; }
    code, pre { font-family: SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
    pre { background: #f6f8fa; padding: 10px; border-radius: 4px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>model-cli config snapshot</h1>
  <section>
    <h2>Models (config: ${escapeHtml(modelsPath || '')})</h2>
    ${renderTable(['Name', 'Provider', 'Model ID', 'Tools', 'System Prompt'], modelRows)}
  </section>
  <section>
    <h2>MCP Servers (config: ${escapeHtml(mcpPath || '')})</h2>
    ${renderTable(['Name', 'URL', 'Description'], mcpRows)}
  </section>
  <section>
    <h2>System Prompt (file: ${escapeHtml(systemPromptPath || '')})</h2>
    <pre>${escapeHtml(systemPrompt || '')}</pre>
  </section>
  <section>
    <h2>Prompt Profiles</h2>
    <p>Profiles: ${promptNames.length > 0 ? escapeHtml(promptNames.join(', ')) : '<none>'}</p>
  </section>
  <section>
    <h2>Sub-Agents (${subAgentRows.length})</h2>
    ${renderTable(['ID', 'Name', 'Plugin', 'Model', 'Skills'], subAgentRows)}
  </section>
</body>
</html>`;
}

function writeReport(filePath, html) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, html, 'utf8');
}

export { generateConfigReport, writeReport };
