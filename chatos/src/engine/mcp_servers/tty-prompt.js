import fs from 'fs';
import { createInterface } from 'readline/promises';

import { getDefaultTtyPaths } from '../shared/terminal/tty-paths.js';

function normalizeBackend(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return 'auto';
  if (raw === 'auto') return 'auto';
  if (raw === 'tty' || raw === 'terminal' || raw === 'console' || raw === 'cli') return 'tty';
  if (raw === 'ui' || raw === 'file' || raw === 'jsonl' || raw === 'log') return 'file';
  return 'auto';
}

function resolvePromptBackend() {
  const candidates = [
    process.env.MODEL_CLI_UI_PROMPT_BACKEND,
    process.env.MODEL_CLI_PROMPT_BACKEND,
    process.env.MODEL_CLI_UI_PROMPTS_BACKEND,
    process.env.MODEL_CLI_PROMPTS_BACKEND,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeBackend(candidate);
    if (candidate && typeof candidate === 'string' && candidate.trim()) return normalized;
  }
  return 'auto';
}

export function createTtyPrompt() {
  if (process.env.MODEL_CLI_DISABLE_TTY_PROMPTS === '1') {
    return null;
  }
  const backend = resolvePromptBackend();
  if (backend === 'file') {
    return null;
  }

  const { inputPath, outputPath } = getDefaultTtyPaths();
  let inputFd = null;
  let outputFd = null;
  let input = null;
  let output = null;
  try {
    inputFd = fs.openSync(inputPath, 'r');
    outputFd = fs.openSync(outputPath, 'w');
    input = fs.createReadStream(inputPath, { fd: inputFd, encoding: 'utf8', autoClose: true });
    output = fs.createWriteStream(outputPath, { fd: outputFd, encoding: 'utf8', autoClose: true });
  } catch {
    try {
      if (typeof inputFd === 'number') fs.closeSync(inputFd);
    } catch {
      // ignore
    }
    try {
      if (typeof outputFd === 'number') fs.closeSync(outputFd);
    } catch {
      // ignore
    }
    try {
      input?.destroy?.();
    } catch {
      // ignore
    }
    try {
      output?.destroy?.();
    } catch {
      // ignore
    }
    return null;
  }

  let closing = false;
  let rl = null;
  const safeClose = () => {
    if (closing) return;
    closing = true;
    try {
      rl?.close?.();
    } catch {
      // ignore
    }
    try {
      input?.destroy?.();
    } catch {
      // ignore
    }
    try {
      output?.end?.();
    } catch {
      // ignore
    }
    try {
      output?.destroy?.();
    } catch {
      // ignore
    }
  };

  input.on('error', safeClose);
  output.on('error', safeClose);

  rl = createInterface({
    input,
    output,
    terminal: true,
  });

  const ask = async (question, options = {}) => {
    try {
      const answer = await rl.question(String(question ?? ''), options);
      return String(answer ?? '');
    } catch (err) {
      if (err && typeof err === 'object' && err.name === 'AbortError') {
        return null;
      }
      throw err;
    }
  };

  const write = (text) => {
    try {
      output.write(String(text ?? ''));
    } catch {
      // ignore
    }
  };
  const writeln = (text = '') => write(`${String(text ?? '')}\n`);

  const close = () => {
    safeClose();
  };

  return { ask, write, writeln, close, backend };
}
