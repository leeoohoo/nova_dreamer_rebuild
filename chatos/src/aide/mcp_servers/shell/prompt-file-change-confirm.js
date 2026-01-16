import fs from 'fs';
import crypto from 'crypto';

import { createTtyPrompt } from '../tty-prompt.js';

function normalizeResponseStatus(status) {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (value === 'ok' || value === 'canceled' || value === 'timeout') {
    return value;
  }
  if (!value) return 'ok';
  return 'ok';
}

export function createPromptFileChangeConfirm({
  promptLogPath,
  serverName,
  runId,
  ensureFileExists,
  truncateForUi,
}) {
  const safeEnsureFileExists = typeof ensureFileExists === 'function' ? ensureFileExists : () => {};
  const safeTruncateForUi = typeof truncateForUi === 'function' ? truncateForUi : (value) => value;

  function appendPromptEntry(entry) {
    try {
      safeEnsureFileExists(promptLogPath);
      fs.appendFileSync(promptLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // ignore
    }
  }

  function findLatestPromptResponse(requestId) {
    try {
      if (!fs.existsSync(promptLogPath)) {
        return null;
      }
      const raw = fs.readFileSync(promptLogPath, 'utf8');
      const lines = raw.split('\n').filter((line) => line && line.trim().length > 0);
      let match = null;
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (
            parsed &&
            typeof parsed === 'object' &&
            parsed.type === 'ui_prompt' &&
            parsed.action === 'response' &&
            parsed.requestId === requestId
          ) {
            match = parsed;
          }
        } catch {
          // ignore parse errors
        }
      }
      return match;
    } catch {
      return null;
    }
  }

  async function waitForPromptResponse({ requestId }) {
    let watcher = null;
    let poll = null;
    const cleanup = () => {
      if (watcher) {
        try {
          watcher.close();
        } catch {
          // ignore
        }
        watcher = null;
      }
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    };

    return await new Promise((resolve) => {
      const tryRead = () => {
        const found = findLatestPromptResponse(requestId);
        if (found) {
          cleanup();
          resolve(found);
        }
      };
      try {
        watcher = fs.watch(promptLogPath, { persistent: false }, () => tryRead());
        if (watcher && typeof watcher.on === 'function') {
          watcher.on('error', (err) => {
            try {
              console.error(`[${serverName}] prompt log watcher error: ${err?.message || err}`);
            } catch {
              // ignore
            }
            try {
              watcher?.close?.();
            } catch {
              // ignore
            }
            watcher = null;
          });
        }
      } catch {
        watcher = null;
      }
      poll = setInterval(tryRead, 800);
      if (poll && typeof poll.unref === 'function') {
        poll.unref();
      }
      tryRead();
    });
  }

  return async function promptFileChangeConfirm({ title, message, command, cwd, diff, path: filePath, source } = {}) {
    const requestId = crypto.randomUUID();
    const promptPayload = {
      kind: 'file_change_confirm',
      title: title || '文件变更确认',
      message: message || '',
      allowCancel: true,
      source: source || `${serverName}/run_shell_command`,
      path: typeof filePath === 'string' ? filePath : '',
      command: typeof command === 'string' ? command : '',
      cwd: typeof cwd === 'string' ? cwd : '',
      diff: safeTruncateForUi(typeof diff === 'string' ? diff : '', 60_000),
    };
    appendPromptEntry({
      ts: new Date().toISOString(),
      type: 'ui_prompt',
      action: 'request',
      requestId,
      ...(runId ? { runId } : {}),
      prompt: promptPayload,
    });

    const tty = createTtyPrompt();
    const runTtyConfirm = async ({ signal } = {}) => {
      if (!tty) return null;
      tty.writeln('');
      tty.writeln(`[${serverName}] ${promptPayload.title || '文件变更确认'}`);
      tty.writeln('可在 UI 或本终端确认；输入 y 确认继续，直接回车取消。');
      if (promptPayload.message) tty.writeln(promptPayload.message);
      if (promptPayload.cwd) tty.writeln(`cwd: ${promptPayload.cwd}`);
      if (promptPayload.command) tty.writeln(`$ ${promptPayload.command}`);
      if (promptPayload.path) tty.writeln(`path: ${promptPayload.path}`);
      if (promptPayload.source) tty.writeln(`source: ${promptPayload.source}`);
      const rawDiff = typeof diff === 'string' ? diff : '';
      const shownDiff = rawDiff ? safeTruncateForUi(rawDiff, 20_000) : '';
      if (shownDiff && shownDiff.trim()) {
        tty.writeln('');
        tty.writeln('--- diff (truncated) ---');
        tty.writeln(shownDiff.trimEnd());
        tty.writeln('--- end diff ---');
      }
      const answerRaw = await tty.ask('确认继续？(y/N) ', { signal });
      if (answerRaw == null) return null;
      const answer = answerRaw.trim().toLowerCase();
      const ok = answer === 'y' || answer === 'yes';
      const remarkRaw = await tty.ask('备注（可选，直接回车跳过）： ', { signal });
      if (remarkRaw == null) return null;
      const remark = remarkRaw.trim();
      return { status: ok ? 'ok' : 'canceled', remark };
    };

    if (tty && tty.backend === 'tty') {
      try {
        const terminalResult = await runTtyConfirm();
        if (!terminalResult) return { status: 'canceled', requestId, remark: '' };
        appendPromptEntry({
          ts: new Date().toISOString(),
          type: 'ui_prompt',
          action: 'response',
          requestId,
          ...(runId ? { runId } : {}),
          response: terminalResult,
        });
        return { status: terminalResult.status, requestId, remark: terminalResult.remark || '' };
      } finally {
        tty.close();
      }
    }

    if (tty && tty.backend === 'auto') {
      const abort = new AbortController();
      try {
        const uiWait = waitForPromptResponse({ requestId }).then((entry) => ({ kind: 'ui', entry }));
        const ttyWait = runTtyConfirm({ signal: abort.signal }).then((res) => ({ kind: 'tty', res }));
        const first = await Promise.race([uiWait, ttyWait]);
        if (first.kind === 'ui') {
          abort.abort();
          const response = first.entry;
          const status = normalizeResponseStatus(response?.response?.status);
          const remark = typeof response?.response?.remark === 'string' ? response.response.remark : '';
          return { status, requestId, remark };
        }
        const terminalResult = first.res;
        if (!terminalResult) {
          const ui = await uiWait;
          const response = ui.entry;
          const status = normalizeResponseStatus(response?.response?.status);
          const remark = typeof response?.response?.remark === 'string' ? response.response.remark : '';
          return { status, requestId, remark };
        }
        appendPromptEntry({
          ts: new Date().toISOString(),
          type: 'ui_prompt',
          action: 'response',
          requestId,
          ...(runId ? { runId } : {}),
          response: terminalResult,
        });
        return {
          status: terminalResult.status,
          requestId,
          remark: terminalResult?.remark || '',
        };
      } finally {
        abort.abort();
        tty.close();
      }
    }

    const response = await waitForPromptResponse({ requestId });
    const status = normalizeResponseStatus(response?.response?.status);
    const remark = typeof response?.response?.remark === 'string' ? response.response.remark : '';
    return { status, requestId, remark };
  };
}

