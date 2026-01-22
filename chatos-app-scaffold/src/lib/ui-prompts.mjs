import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, nowIso, safeJsonParse, sleep } from './utils.mjs';

export const resolveUiPromptPath = (stateDir, fileName = 'ui-prompts.jsonl') => {
  if (!stateDir) throw new Error('stateDir is required');
  return path.join(stateDir, fileName);
};

export const appendUiPromptEntry = async (filePath, entry) => {
  if (!filePath) throw new Error('ui-prompts path is required');
  await ensureDir(path.dirname(filePath));
  const line = `${JSON.stringify(entry)}\n`;
  await fs.appendFile(filePath, line, 'utf8');
};

export const appendResultPrompt = async ({
  stateDir,
  filePath,
  requestId,
  runId,
  title = 'Task Result',
  message = 'Completed.',
  markdown = '',
  source = '',
  allowCancel = true,
} = {}) => {
  const targetPath = filePath || resolveUiPromptPath(stateDir);
  const entry = {
    ts: nowIso(),
    type: 'ui_prompt',
    action: 'request',
    requestId,
    runId,
    prompt: {
      kind: 'result',
      title,
      message,
      source,
      allowCancel,
      markdown,
    },
  };
  await appendUiPromptEntry(targetPath, entry);
  return entry;
};

export const appendResponsePrompt = async ({ stateDir, filePath, requestId, runId, status = 'ok' } = {}) => {
  const targetPath = filePath || resolveUiPromptPath(stateDir);
  const entry = {
    ts: nowIso(),
    type: 'ui_prompt',
    action: 'response',
    requestId,
    runId,
    response: {
      status,
    },
  };
  await appendUiPromptEntry(targetPath, entry);
  return entry;
};

export const readUiPromptEntries = async ({ stateDir, filePath, maxLines = 2000 } = {}) => {
  const targetPath = filePath || resolveUiPromptPath(stateDir);
  try {
    const content = await fs.readFile(targetPath, 'utf8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    const slice = maxLines > 0 ? lines.slice(-maxLines) : lines;
    return slice.map((line) => safeJsonParse(line)).filter(Boolean);
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
};

export const findResultEntry = (entries, requestId) => {
  if (!Array.isArray(entries) || !requestId) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type !== 'ui_prompt') continue;
    if (entry?.action !== 'request') continue;
    if (entry?.requestId !== requestId) continue;
    if (entry?.prompt?.kind !== 'result') continue;
    return entry;
  }
  return null;
};

export const pollForResult = async ({ stateDir, filePath, requestId, intervalMs = 1000, timeoutMs = 10 * 60 * 1000 } = {}) => {
  const start = Date.now();
  while (true) {
    const entries = await readUiPromptEntries({ stateDir, filePath });
    const result = findResultEntry(entries, requestId);
    if (result) return result;
    if (timeoutMs > 0 && Date.now() - start > timeoutMs) {
      throw new Error('ui prompt result timeout');
    }
    await sleep(intervalMs);
  }
};
