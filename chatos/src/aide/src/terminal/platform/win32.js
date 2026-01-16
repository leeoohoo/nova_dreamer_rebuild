import fs from 'fs';
import tty from 'tty';
import { PassThrough } from 'stream';

import { ensureWindowsUtf8Console } from '../../terminal-encoding.js';

function isStdinUsable(stream) {
  if (!stream) return false;
  if (stream.destroyed) return false;
  if (stream.readableEnded) return false;
  const readableFlag = stream.readable;
  if (readableFlag === undefined) return true;
  return Boolean(readableFlag);
}

function fallbackInputWhenStdinUnavailable() {
  const stdin = process.stdin;
  if (isStdinUsable(stdin)) {
    return { input: stdin, close: null };
  }

  const uiBridge = process.env.MODEL_CLI_UI_BRIDGE === '1';
  if (uiBridge) {
    const input = new PassThrough();
    input.resume();
    return { input, close: () => input.destroy() };
  }
  return { input: process.stdin, close: null };
}

export function createWin32TerminalPlatform() {
  return {
    ensureUtf8Console: () => ensureWindowsUtf8Console(),

    createChatReadlineInput: () => {
      if (process.env.MODEL_CLI_DISABLE_CONSOLE_STDIN === '1') {
        return { input: process.stdin, close: null };
      }

      const stdin = process.stdin;
      const stdout = process.stdout;
      const stdinUsable = isStdinUsable(stdin);
      const stdinIsTty = Boolean(stdin?.isTTY);
      const stdoutIsTty = Boolean(stdout?.isTTY);
      const uiBridge = process.env.MODEL_CLI_UI_BRIDGE === '1';
      const forceConsole =
        process.env.MODEL_CLI_FORCE_CONSOLE_STDIN === '1' ||
        // Electron (GUI subsystem) on Windows may start with a closed/unusable stdin even when launched from a terminal.
        // If we're not in UI-bridge mode, try to attach CONIN$ automatically so `aide chat` doesn't exit immediately.
        (!uiBridge && !stdinUsable) ||
        (stdoutIsTty && (!stdinIsTty || !stdinUsable));
      if (!forceConsole) {
        return { input: process.stdin, close: null };
      }

      const tryOpenConin = (inputPath) => {
        let fd = null;
        try {
          fd = fs.openSync(inputPath, 'r');
        } catch {
          return null;
        }

        let stream = null;
        try {
          stream = new tty.ReadStream(fd);
        } catch {
          try {
            stream = fs.createReadStream(inputPath, { fd, autoClose: true });
            fd = null;
          } catch {
            try {
              fs.closeSync(fd);
            } catch {
              // ignore
            }
            return null;
          }
        }

        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          try {
            stream?.destroy?.();
          } catch {
            // ignore
          }
          try {
            if (typeof fd === 'number') fs.closeSync(fd);
          } catch {
            // ignore
          }
        };
        try {
          stream.on('error', close);
        } catch {
          // ignore
        }

        return { input: stream, close };
      };

      return (
        tryOpenConin('\\\\.\\CONIN$') ||
        tryOpenConin('CONIN$') ||
        fallbackInputWhenStdinUnavailable()
      );
    },

    getTerminalControlPollIntervalMs: () => 200,

    getProcessGroupId: () => null,
  };
}

