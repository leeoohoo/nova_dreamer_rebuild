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

function escapeAttr(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderTable(headers, rows) {
  const thead = `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`;
  const bodyRows = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? '')}</td>`).join('')}</tr>`)
    .join('');
  const tbody = `<tbody>${bodyRows}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

function formatMessages(messages = []) {
  if (!messages || messages.length === 0) {
    return '<p>No messages yet.</p>';
  }
  const cards = messages
    .map((msg, idx) => {
      const role = msg.role || 'assistant';
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content || '', null, 2);
      const meta = msg.name ? `${role} · ${msg.name}` : role;
      return `<div class="msg-card ${escapeHtml(role)}">
        <div class="msg-meta">#${idx + 1} · ${escapeHtml(meta)}</div>
        <div class="msg-body markdown" data-raw="${escapeAttr(content)}">${escapeHtml(content)}</div>
      </div>`;
    })
    .join('\n');
  return `<div class="messages">${cards}</div>`;
}

function formatToolHistory(toolHistory) {
  if (!toolHistory) return '<p>No tool outputs yet.</p>';
  const rows = (toolHistory.list ? toolHistory.list() : []).map((entry) => [
    entry.id,
    entry.tool,
    entry.timestamp ? entry.timestamp.toLocaleString() : '',
    typeof entry.content === 'string' ? entry.content.slice(0, 500) : JSON.stringify(entry.content || {}),
  ]);
  return renderTable(['ID', 'Tool', 'Time', 'Content (preview)'], rows);
}

function loadTasks(tasksPath) {
  if (!tasksPath || !fs.existsSync(tasksPath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(tasksPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.tasks)) {
      return parsed.tasks;
    }
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

function formatTasks(tasks) {
  if (!tasks || tasks.length === 0) {
    return '<p>No tasks recorded.</p>';
  }
  const rows = tasks.map((t) => [
    t.id || '',
    t.title || '',
    t.status || '',
    t.priority || '',
    (t.tags || []).join(', '),
    t.updatedAt || t.createdAt || '',
  ]);
  return renderTable(['ID', 'Title', 'Status', 'Priority', 'Tags', 'Updated'], rows);
}

function writeSessionReport({ session, toolHistory, tasksPath, reportPath, modelName, onWrite }) {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>model-cli session snapshot</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; margin: 20px; }
    h2 { margin-top: 18px; margin-bottom: 8px; }
    table { border-collapse: collapse; width: 100%; margin-top: 8px; }
    th, td { border: 1px solid #ddd; padding: 6px; vertical-align: top; font-size: 13px; }
    th { background: #f4f4f4; text-align: left; }
    pre { background: #f6f8fa; padding: 10px; border-radius: 4px; white-space: pre-wrap; }
    .controls { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; padding: 8px 12px; background: rgba(255,255,255,0.92); border: 1px solid #ddd; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); z-index: 2000; }
    .btn { padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; background: #fff; cursor: pointer; }
    .btn:hover { background: #f2f2f2; }
    .center { width: 100%; max-width: 100%; margin: 60px auto 0; padding: 0 16px; box-sizing: border-box; }
    .section { margin-bottom: 18px; }
    details { border: 1px solid #e5e5e5; border-radius: 6px; padding: 10px; background: #fafafa; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    details > summary { cursor: pointer; font-weight: 600; }
    .messages { display: flex; flex-direction: column; gap: 10px; }
    .msg-card { border: 1px solid #e5e5e5; border-radius: 8px; padding: 10px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    .msg-meta { font-size: 12px; color: #666; margin-bottom: 6px; }
    .msg-body { font-size: 14px; line-height: 1.5; }
    .markdown h1, .markdown h2, .markdown h3 { margin: 8px 0 4px; }
    .markdown p { margin: 6px 0; }
    .markdown code { background: #f6f8fa; padding: 2px 4px; border-radius: 4px; font-family: SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
    .markdown pre code { display: block; padding: 10px; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body>
  <h1>Session Snapshot (${escapeHtml(modelName || '')})</h1>
  <div class="center">
    <section class="section">
      <details open>
        <summary>聊天记录 (居中)</summary>
        ${formatMessages(session?.messages || [])}
      </details>
    </section>
  </div>
  <script>
    (() => {
      if (window.marked) {
        const els = document.querySelectorAll('.markdown');
        els.forEach((el) => {
          const raw = el.getAttribute('data-raw') || el.textContent || '';
          el.innerHTML = marked.parse(raw);
        });
      }
    })();
  </script>
</body>
</html>`;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, html, 'utf8');
  if (typeof onWrite === 'function') {
    try {
      onWrite({ html });
    } catch {
      // ignore callback errors
    }
  }
}

export { writeSessionReport };
