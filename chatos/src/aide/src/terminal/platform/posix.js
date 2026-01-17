import { execSync } from 'child_process';
import { PassThrough } from 'stream';

function isStdinUsable(stream) {
  if (!stream) return false;
  if (stream.destroyed) return false;
  if (stream.readableEnded) return false;
  const readableFlag = stream.readable;
  if (readableFlag === undefined) return true;
  return Boolean(readableFlag);
}

function fallbackInputWhenStdinUnavailable() {
  const input = new PassThrough();
  input.resume();
  return { input, close: () => input.destroy() };
}

export function createPosixTerminalPlatform() {
  return {
    ensureUtf8Console: () => () => {},

    createChatReadlineInput: () => {
      const stdin = process.stdin;
      const uiBridge = process.env.MODEL_CLI_UI_BRIDGE === '1';
      if (uiBridge && !isStdinUsable(stdin)) {
        return fallbackInputWhenStdinUnavailable();
      }
      return { input: stdin, close: null };
    },

    getTerminalControlPollIntervalMs: () => 800,

    getProcessGroupId: (pid) => {
      const num = Number(pid);
      if (!Number.isFinite(num) || num <= 0) return null;
      try {
        const out = execSync(`ps -o pgid= -p ${num}`, { encoding: 'utf8' });
        const parsed = Number(String(out || '').trim());
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      } catch {
        return null;
      }
    },
  };
}

