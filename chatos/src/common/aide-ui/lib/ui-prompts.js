import { normalizeRunId, parseTimestampMs } from './runs.js';
import { RUN_FILTER_ALL, RUN_FILTER_UNKNOWN } from './storage.js';

export function listPendingUiPrompts(entries = []) {
  const requests = new Map();
  const responses = new Set();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (entry.type !== 'ui_prompt') return;
    const requestId = typeof entry.requestId === 'string' ? entry.requestId.trim() : '';
    if (!requestId) return;
    if (entry.action === 'request') {
      requests.set(requestId, entry);
    } else if (entry.action === 'response') {
      responses.add(requestId);
    }
  });

  const pending = [];
  requests.forEach((req, requestId) => {
    if (responses.has(requestId)) return;
    pending.push(req);
  });
  pending.sort((a, b) => parseTimestampMs(a?.ts) - parseTimestampMs(b?.ts));
  return pending;
}

export function pickActiveUiPrompt(pending = [], preferredRunId) {
  const list = Array.isArray(pending) ? pending : [];
  if (list.length === 0) return null;
  const prefer = normalizeRunId(preferredRunId);
  const preferable =
    prefer && prefer !== RUN_FILTER_ALL && prefer !== RUN_FILTER_UNKNOWN
      ? list.find((entry) => normalizeRunId(entry?.runId) === prefer)
      : null;
  return preferable || list[0];
}

