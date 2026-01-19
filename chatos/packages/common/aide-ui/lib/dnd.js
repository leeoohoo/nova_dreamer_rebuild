export const AIDE_DND_MIME = 'application/x-aide-dnd';

export function setAideDragData(event, payload, fallbackText) {
  const dataTransfer = event?.dataTransfer;
  if (!dataTransfer) return;
  if (!payload || typeof payload !== 'object') return;
  const json = JSON.stringify(payload);
  try {
    dataTransfer.setData(AIDE_DND_MIME, json);
  } catch {
    // ignore setData errors
  }
  try {
    dataTransfer.setData('application/json', json);
  } catch {
    // ignore setData errors
  }
  const text =
    typeof fallbackText === 'string'
      ? fallbackText
      : typeof payload?.text === 'string'
        ? payload.text
        : typeof payload?.path === 'string'
          ? payload.path
          : '';
  if (text) {
    try {
      dataTransfer.setData('text/plain', text);
    } catch {
      // ignore setData errors
    }
  }
  try {
    dataTransfer.effectAllowed = 'copy';
  } catch {
    // ignore effectAllowed errors
  }
}

export function getAideDragPayload(event) {
  const dataTransfer = event?.dataTransfer;
  if (!dataTransfer) return null;
  const raw =
    dataTransfer.getData(AIDE_DND_MIME) ||
    dataTransfer.getData('application/x-aide-dnd') ||
    dataTransfer.getData('application/json');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function getAideDragText(event) {
  const dataTransfer = event?.dataTransfer;
  if (!dataTransfer) return '';
  const text = dataTransfer.getData('text/plain');
  return typeof text === 'string' ? text : '';
}

export function formatAideDropText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const kind = typeof payload.kind === 'string' ? payload.kind.trim() : '';

  if (kind === 'workspace_node') {
    const abs = typeof payload.absolutePath === 'string' ? payload.absolutePath.trim() : '';
    if (abs) return abs;
    const rel = typeof payload.path === 'string' ? payload.path.trim() : '';
    if (!rel) return '';
    const root = typeof payload.workspaceRoot === 'string' ? payload.workspaceRoot.trim().replace(/[\\/]+$/, '') : '';
    if (!root) return rel;
    const separator = root.includes('\\') ? '\\' : '/';
    const cleanedRel = rel.replace(/^[\\/]+/, '').replace(/[\\/]+/g, separator);
    return `${root}${separator}${cleanedRel}`;
  }

  if (kind === 'file_change') {
    const lines = [];
    const rel = typeof payload.path === 'string' ? payload.path.trim() : '';
    const abs = typeof payload.absolutePath === 'string' ? payload.absolutePath.trim() : '';
    const titlePath = rel || abs || '未知路径';
    lines.push(`文件变更: ${titlePath}`);

    const workspaceRoot = typeof payload.workspaceRoot === 'string' ? payload.workspaceRoot.trim() : '';
    const changeType = typeof payload.changeType === 'string' ? payload.changeType.trim() : '';
    const ts = typeof payload.ts === 'string' ? payload.ts.trim() : '';
    const tool = typeof payload.tool === 'string' ? payload.tool.trim() : '';
    const mode = typeof payload.mode === 'string' ? payload.mode.trim() : '';
    const server = typeof payload.server === 'string' ? payload.server.trim() : '';

    if (changeType) lines.push(`changeType: ${changeType}`);
    if (ts) lines.push(`ts: ${ts}`);
    if (tool) lines.push(`tool: ${tool}`);
    if (mode) lines.push(`mode: ${mode}`);
    if (server) lines.push(`server: ${server}`);
    if (workspaceRoot) lines.push(`workspaceRoot: ${workspaceRoot}`);

    const diff = typeof payload.diff === 'string' ? payload.diff : '';
    if (diff && diff.trim()) {
      const cleaned = diff.trimEnd();
      lines.push('```diff');
      lines.push(cleaned);
      lines.push('```');
    }
    return lines.join('\n');
  }

  return '';
}

