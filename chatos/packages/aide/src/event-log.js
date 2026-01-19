import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureRunId() {
  const existing = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
  if (existing) return existing;
  const short = crypto.randomUUID().split('-')[0];
  const generated = `run-${Date.now().toString(36)}-${short}`;
  process.env.MODEL_CLI_RUN_ID = generated;
  return generated;
}

export function createEventLogger(filePath, options = {}) {
  const target = filePath;
  ensureDir(target);
  const runId = (typeof options.runId === 'string' && options.runId.trim()) || ensureRunId();
  return {
    path: target,
    runId,
    log(type, payload) {
      const entry = {
        ts: new Date().toISOString(),
        type,
        payload,
        runId,
      };
      try {
        fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, 'utf8');
      } catch {
        // ignore file logging errors
      }
      if (typeof options.onEntry === 'function') {
        try {
          options.onEntry(entry);
        } catch {
          // ignore callback errors
        }
      }
    },
  };
}
