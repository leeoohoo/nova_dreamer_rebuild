import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

function normalizeDiffText(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function tailText(text, maxChars = 4000) {
  const value = typeof text === 'string' ? text : text == null ? '' : String(text);
  const limit = Number.isFinite(Number(maxChars)) ? Math.max(0, Math.floor(Number(maxChars))) : 4000;
  if (limit <= 0) return '';
  if (value.length <= limit) return value;
  return value.slice(value.length - limit);
}

function getLastNonEmptyLine(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = String(lines[i] || '').trimEnd();
    if (line.trim()) return line;
  }
  return '';
}

function detectInteractivePrompt(outputTail) {
  const lastLine = getLastNonEmptyLine(outputTail);
  if (!lastLine) return null;
  const trimmed = lastLine.trimEnd();

  if (/are you sure you want to continue connecting/i.test(trimmed)) {
    return { kind: 'ssh_hostkey', line: trimmed };
  }
  if (/\b(?:password|passphrase)[^:\n]*:\s*$/i.test(trimmed)) {
    return { kind: 'password', line: trimmed };
  }
  if (/enter file in which to save the key/i.test(trimmed)) {
    return { kind: 'ssh_keygen', line: trimmed };
  }
  if (/enter (?:passphrase|same passphrase again)[^:\n]*:\s*$/i.test(trimmed)) {
    return { kind: 'passphrase', line: trimmed };
  }
  if (/(?:\(|\[)\s*y\s*\/\s*n\s*(?:\)|\])\s*$/i.test(trimmed)) {
    return { kind: 'confirm_yn', line: trimmed };
  }
  if (/\(\s*yes\s*\/\s*no(?:\/[^\)\]]+)?\s*\)\s*$/i.test(trimmed)) {
    return { kind: 'confirm_yesno', line: trimmed };
  }
  if (/(?:\?|:|：)\s*$/i.test(trimmed) && /(enter|请输入|输入|please enter|type|confirm|continue|proceed)/i.test(trimmed)) {
    return { kind: 'prompt', line: trimmed };
  }
  return null;
}

const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function stripAnsi(text) {
  return String(text || '').replace(ANSI_REGEX, '');
}

function isBinaryBuffer(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (buf.length === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const byte = buf[i];
    if (byte === 0) return true;
    // Allow common whitespace and ANSI escape.
    if (byte === 9 || byte === 10 || byte === 13 || byte === 27) continue;
    // Control characters (excluding allowed ones) are suspicious.
    if (byte < 32) {
      suspicious += 1;
      continue;
    }
    // DEL
    if (byte === 127) {
      suspicious += 1;
    }
  }
  if (buf.length < 32) return suspicious >= 4;
  return suspicious / buf.length > 0.3;
}

function appendToRollingBuffer(state, chunk, maxBytes) {
  const limit = Number.isFinite(Number(maxBytes)) ? Math.max(16 * 1024, Math.floor(Number(maxBytes))) : 2 * 1024 * 1024;
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''), 'utf8');
  if (buf.length === 0) return state;
  state.chunks.push(buf);
  state.bytes += buf.length;
  while (state.bytes > limit && state.chunks.length > 0) {
    const removed = state.chunks.shift();
    if (removed) state.bytes -= removed.length;
    state.truncated = true;
  }
  return state;
}

function getShellInvocation(shellPath, commandText) {
  const shell = typeof shellPath === 'string' && shellPath.trim() ? shellPath.trim() : null;
  if (process.platform === 'win32') {
    const picked = shell || process.env.COMSPEC || process.env.ComSpec || 'cmd.exe';
    const base = path.basename(picked).toLowerCase();
    if (base === 'powershell.exe' || base === 'pwsh.exe' || base === 'powershell' || base === 'pwsh') {
      return { file: picked, args: ['-NoProfile', '-Command', commandText] };
    }
    return { file: picked, args: ['/d', '/s', '/c', commandText] };
  }

  const picked = shell || process.env.SHELL || '/bin/bash';
  return { file: picked, args: ['-c', commandText] };
}

function ensureBashGuard(commandText, shellPath) {
  const shell = typeof shellPath === 'string' ? shellPath : '';
  const base = path.basename(shell).toLowerCase();
  if (!base.includes('bash')) return commandText;
  const guard = 'shopt -u promptvars nullglob extglob nocaseglob dotglob;';
  const trimmed = String(commandText || '').trimStart();
  if (trimmed.startsWith(guard)) return commandText;
  return `${guard} ${commandText}`;
}

async function execCommandWithPromptAbort({
  command,
  options,
  maxTailChars,
  abortOnPrompt,
  promptIdleMs,
  abortSignal,
} = {}) {
  const tailLimit = Number.isFinite(Number(maxTailChars)) ? Math.max(256, Math.floor(Number(maxTailChars))) : 4000;
  const promptIdle = Number.isFinite(Number(promptIdleMs)) ? Math.max(100, Math.floor(Number(promptIdleMs))) : 500;
  const abortEnabled = abortOnPrompt !== false;

  return await new Promise((resolve) => {
    let combinedTail = '';
    let lastOutputAt = Date.now();
    let promptInfo = null;
    let promptTimer = null;
    let killedForPrompt = false;
    let timedOut = false;
    let aborted = false;
    let binaryDetected = false;
    let bytesReceived = 0;
    let exitCode = null;
    let exitSignal = null;
    let settled = false;

    const maxBufferBytes = options?.maxBuffer;
    const stdoutState = { chunks: [], bytes: 0, truncated: false };
    const stderrState = { chunks: [], bytes: 0, truncated: false };

    const sniffBuffers = [];
    const MAX_SNIFF_SIZE = 4096;
    let sniffedBytes = 0;
    let killedForTimeout = false;
    let requestedKill = false;

    const cleanup = (child, abortHandler) => {
      if (promptTimer) clearTimeout(promptTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (abortSignal && typeof abortSignal.removeEventListener === 'function' && abortHandler) {
        abortSignal.removeEventListener('abort', abortHandler);
      }
      try {
        child?.stdout?.removeAllListeners?.('data');
      } catch {
        // ignore
      }
      try {
        child?.stderr?.removeAllListeners?.('data');
      } catch {
        // ignore
      }
    };

    const finalize = (child, abortHandler) => {
      if (settled) return;
      settled = true;
      cleanup(child, abortHandler);

      const interruptedForPrompt = killedForPrompt === true && Boolean(promptInfo);
      const stdoutBuf = stdoutState.chunks.length > 0 ? Buffer.concat(stdoutState.chunks) : Buffer.from('');
      const stderrBuf = stderrState.chunks.length > 0 ? Buffer.concat(stderrState.chunks) : Buffer.from('');

      const stdoutText = binaryDetected ? '' : stripAnsi(stdoutBuf.toString('utf8')).replace(/\r\n/g, '\n');
      const stderrText = binaryDetected ? '' : stripAnsi(stderrBuf.toString('utf8')).replace(/\r\n/g, '\n');

      const truncationNote =
        stdoutState.truncated || stderrState.truncated
          ? `\n[WARNING: Output truncated to last ${Math.round(
              (Number.isFinite(Number(maxBufferBytes)) ? Number(maxBufferBytes) : 2 * 1024 * 1024) / (1024 * 1024)
            )}MB per stream.]`
          : '';
      const binaryNote = binaryDetected ? `\n[NOTE: Binary output detected; received ${bytesReceived} bytes.]` : '';

      resolve({
        stdout: stdoutText + (stdoutText && truncationNote ? truncationNote : '') + (stdoutText && binaryNote ? binaryNote : ''),
        stderr: stderrText + (!stdoutText && truncationNote ? truncationNote : '') + (!stdoutText && binaryNote ? binaryNote : ''),
        exitCode,
        signal: exitSignal,
        timedOut,
        aborted,
        interruptedForPrompt,
        prompt: promptInfo,
        binaryDetected,
        bytesReceived,
        truncated: stdoutState.truncated || stderrState.truncated,
      });
    };

    const requestKill = async (child, reason) => {
      if (requestedKill) return;
      requestedKill = true;
      const pid = child?.pid;
      if (!pid) return;

      if (process.platform === 'win32') {
        try {
          spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
        } catch {
          // ignore
        }
        return;
      }

      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
      }

      const killTimer = setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
      }, 200);
      if (killTimer && typeof killTimer.unref === 'function') killTimer.unref();
    };

    const schedulePromptCheck = (child) => {
      if (!abortEnabled || !child || killedForPrompt) return;
      if (promptTimer) clearTimeout(promptTimer);
      promptTimer = setTimeout(() => {
        if (killedForPrompt) return;
        if (!promptInfo) return;
        const idleFor = Date.now() - lastOutputAt;
        if (idleFor >= promptIdle) {
          killedForPrompt = true;
          requestKill(child, 'prompt');
          return;
        }
        schedulePromptCheck(child);
      }, promptIdle);
      if (promptTimer && typeof promptTimer.unref === 'function') promptTimer.unref();
    };

    const timeoutMs = Number.isFinite(Number(options?.timeout)) ? Math.max(0, Math.floor(Number(options.timeout))) : 0;
    const timeoutTimer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killedForTimeout = true;
            requestKill(child, 'timeout');
          }, timeoutMs)
        : null;
    if (timeoutTimer && typeof timeoutTimer.unref === 'function') timeoutTimer.unref();

    const abortHandler = () => {
      aborted = true;
      requestKill(child, 'abort');
    };
    if (abortSignal && typeof abortSignal.addEventListener === 'function') {
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    }

    let child = null;
    try {
      const usedShell = options?.shell;
      const guardedCommand = ensureBashGuard(command, usedShell);
      const { file, args } = getShellInvocation(usedShell, guardedCommand);
      child = spawn(file, args, {
        cwd: options?.cwd,
        env: options?.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (err) {
      exitCode = 1;
      exitSignal = null;
      appendToRollingBuffer(stderrState, Buffer.from(String(err?.message || err || 'spawn failed'), 'utf8'), maxBufferBytes);
      finalize(null, abortHandler);
      return;
    }

    const handleChunk = (chunk) => {
      lastOutputAt = Date.now();
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''), 'utf8');
      bytesReceived += buf.length;

      if (!binaryDetected && sniffedBytes < MAX_SNIFF_SIZE) {
        sniffBuffers.push(buf);
        sniffedBytes += buf.length;
        const sniffBuf = Buffer.concat(sniffBuffers);
        if (sniffBuf.length >= 32 && isBinaryBuffer(sniffBuf)) {
          binaryDetected = true;
        }
      }

      const chunkText = stripAnsi(buf.toString('utf8')).replace(/\r\n/g, '\n');
      combinedTail = tailText(combinedTail + chunkText, tailLimit);
      if (!abortEnabled || killedForPrompt || binaryDetected) return;
      const detected = detectInteractivePrompt(combinedTail);
      if (detected) {
        promptInfo = detected;
        schedulePromptCheck(child);
      }
    };

    try {
      if (child?.stdout && typeof child.stdout.on === 'function') {
        child.stdout.on('data', (chunk) => {
          appendToRollingBuffer(stdoutState, chunk, maxBufferBytes);
          handleChunk(chunk);
        });
      }
      if (child?.stderr && typeof child.stderr.on === 'function') {
        child.stderr.on('data', (chunk) => {
          appendToRollingBuffer(stderrState, chunk, maxBufferBytes);
          handleChunk(chunk);
        });
      }
    } catch {
      // ignore
    }

    child.on('error', (err) => {
      exitCode = 1;
      exitSignal = null;
      appendToRollingBuffer(stderrState, Buffer.from(String(err?.message || err || 'spawn error'), 'utf8'), maxBufferBytes);
      finalize(child, abortHandler);
    });

    child.on('exit', (code, signal) => {
      exitCode = typeof code === 'number' ? code : null;
      exitSignal = signal || null;
      // If we were killed for timeout, prefer timedOut=true even if signal isn't SIGTERM.
      if (killedForTimeout) {
        timedOut = true;
      }
      finalize(child, abortHandler);
    });
  });
}

function stripDiffPathPrefix(rawPath) {
  const value = String(rawPath || '').trim();
  if (!value) return '';
  if (value === '/dev/null') return value;
  if (value.startsWith('a/')) return value.slice(2);
  if (value.startsWith('b/')) return value.slice(2);
  return value;
}

function parseDiffBlockMeta(diffBlock) {
  const lines = normalizeDiffText(diffBlock).split('\n');
  let aPath = '';
  let bPath = '';
  for (const line of lines) {
    if (!aPath && line.startsWith('--- ')) {
      const [token] = line.slice(4).split(/\t+/);
      aPath = String(token || '').trim();
      continue;
    }
    if (!bPath && line.startsWith('+++ ')) {
      const [token] = line.slice(4).split(/\t+/);
      bPath = String(token || '').trim();
      continue;
    }
    if (aPath && bPath) break;
  }
  if (!aPath && !bPath) return null;
  const beforeExists = aPath !== '/dev/null';
  const afterExists = bPath !== '/dev/null';
  const picked = afterExists ? bPath : aPath;
  const relPath = stripDiffPathPrefix(picked);
  if (!relPath || relPath === '/dev/null') return null;
  return {
    relPath: relPath.replace(/\\/g, '/').replace(/^\.\/+/, ''),
    beforeExists,
    afterExists,
  };
}

function splitCombinedDiffIntoBlocks(diffText) {
  const normalized = normalizeDiffText(diffText);
  if (!normalized.trim()) return [];
  const lines = normalized.split('\n');
  const blocks = [];
  let current = [];
  let sawHeaderA = false;
  let sawHeaderB = false;

  const flush = () => {
    const joined = current.join('\n').trimEnd();
    if (joined.trim()) blocks.push(joined);
    current = [];
    sawHeaderA = false;
    sawHeaderB = false;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1] : '';
    if (line.startsWith('diff --git ')) {
      flush();
    } else if (line.startsWith('--- ') && next.startsWith('+++ ') && sawHeaderA && sawHeaderB) {
      // Some diffs (e.g. synthetic untracked blocks) may be concatenated after git diff output.
      // A single file diff should only contain one header pair, so treat a second header as a new block.
      flush();
    }

    current.push(line);
    if (line.startsWith('--- ')) sawHeaderA = true;
    if (line.startsWith('+++ ')) sawHeaderB = true;
  }
  flush();
  return blocks;
}

function isInsideWorkspaceRoot(workspaceRoot, targetPath) {
  const root = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : '';
  if (!root) return false;
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
}

async function logFileChangesFromDiff({ diffText, workspaceRoot, fsOps, tool, mode } = {}) {
  if (!fsOps || typeof fsOps.logFileChange !== 'function') return;
  const root = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : '';
  if (!root) return;
  const blocks = splitCombinedDiffIntoBlocks(diffText);
  for (const block of blocks) {
    const meta = parseDiffBlockMeta(block);
    if (!meta?.relPath) continue;
    const absPath = path.resolve(root, meta.relPath);
    if (!isInsideWorkspaceRoot(root, absPath)) continue;
    // eslint-disable-next-line no-await-in-loop
    await fsOps.logFileChange({
      relPath: meta.relPath,
      absolutePath: absPath,
      before: { exists: meta.beforeExists, content: '' },
      after: { exists: meta.afterExists, content: '' },
      tool: tool || 'run_shell_command',
      mode: mode || 'shell',
      patchText: block,
    });
  }
}

export function registerShellTools(context = {}) {
  const {
    server,
    z,
    serverName,
    workspaceNote,
    workspaceRoot,
    defaultTimeout,
    maxBuffer,
    defaultShell,
    execAsync,
    sessions,
    fsOps,
    ensurePath,
    safeStat,
    assertCommandPathsWithinRoot,
    clampNumber,
    shouldConfirmFileChanges,
    looksLikeFileMutationCommand,
    isSafeGitPreviewCommand,
    canPreviewGitDiff,
    getGitStatusPorcelain,
    getGitDiff,
    buildUntrackedPseudoDiff,
    rollbackGitWorkspace,
    promptFileChangeConfirm,
    normalizeEnv,
    formatCommandResult,
    textResponse,
    structuredResponse,
    truncateForUi,
  } = context;

  if (!server) throw new Error('Missing MCP server');
  if (!z) throw new Error('Missing zod');
  if (!sessions) throw new Error('Missing session manager');

  server.registerTool(
    'run_shell_command',
    {
      title: 'Run shell command',
      description:
        [
          'Execute a command inside the restricted workspace root and return stdout/stderr. Use this for short-lived commands (seconds to ~1-2 minutes). For long-running/streaming/daemon tasks, use session_run + session_capture_output to avoid timeouts.',
          workspaceNote,
          'Short examples: {"command":"ls -la"}, {"command":"cat package.json"}, {"command":"npm test -- --help","cwd":"frontend"}, {"command":"git status"}.',
        ].join('\n'),
      inputSchema: z.object({
        command: z.string().min(1).describe('Full command to execute'),
        cwd: z.string().optional().describe('Working directory relative to root (default root)'),
        timeout_ms: z.number().int().min(1000).max(10 * 60 * 1000).optional().describe('Custom timeout (ms)'),
        shell: z.string().optional().describe('Optional shell override'),
        env: z.record(z.string()).optional().describe('Extra environment variables'),
      }),
    },
    async ({ command, cwd = '.', timeout_ms: timeout, shell, env }, extra) => {
      const workingDir = await ensurePath(cwd);
      const referencedPaths = assertCommandPathsWithinRoot(command, workingDir) || [];
      const effectiveTimeout = clampNumber(timeout, 1000, 15 * 60 * 1000, defaultTimeout);
      const usedShell = shell || defaultShell;
      const confirmEnabled = shouldConfirmFileChanges();
      const looksMutating = looksLikeFileMutationCommand(command);
      const wantsChangeTracking = confirmEnabled || looksMutating;
      const gitPreviewCapable =
        wantsChangeTracking && isSafeGitPreviewCommand(command) && (await canPreviewGitDiff(workingDir));
      let preConfirmedRemark = '';
      const snapshotCandidates = [];
      if (
        wantsChangeTracking &&
        looksMutating &&
        !gitPreviewCapable &&
        workspaceRoot &&
        fsOps &&
        typeof fsOps.snapshotFiles === 'function' &&
        Array.isArray(referencedPaths) &&
        referencedPaths.length > 0
      ) {
        const root = path.resolve(String(workspaceRoot));
        for (const absPath of referencedPaths) {
          if (!absPath) continue;
          const resolved = path.resolve(String(absPath));
          if (!isInsideWorkspaceRoot(root, resolved)) continue;
          const rel = path.relative(root, resolved).replace(/\\/g, '/');
          if (!rel || rel === '.') continue;
          let stats = null;
          try {
            // eslint-disable-next-line no-await-in-loop
            stats = await safeStat(resolved);
          } catch {
            stats = null;
          }
          if (stats?.isDirectory?.()) continue;
          snapshotCandidates.push(rel);
          if (snapshotCandidates.length >= 25) break;
        }
      }

      const snapshotCapable =
        wantsChangeTracking &&
        looksMutating &&
        !gitPreviewCapable &&
        snapshotCandidates.length > 0 &&
        fsOps &&
        typeof fsOps.snapshotFiles === 'function' &&
        typeof fsOps.generateUnifiedDiff === 'function' &&
        typeof fsOps.logFileChange === 'function';
      const beforeSnapshots = snapshotCapable
        ? await fsOps.snapshotFiles(snapshotCandidates, path.resolve(String(workspaceRoot)))
        : null;

      if (confirmEnabled && looksMutating && !gitPreviewCapable && !snapshotCapable) {
        const pre = await promptFileChangeConfirm({
          title: '文件变更确认（Shell）',
          message:
            '检测到该命令可能会改动文件，但当前无法预览 diff（非 git 仓库/工作区不干净/命令不安全）。确认后将继续执行。',
          command,
          cwd: workingDir,
          diff: '',
          path: '',
          source: `${serverName}/run_shell_command`,
        });
        if (pre.status !== 'ok') {
          return structuredResponse(`✗ Canceled shell command.\n\n$ ${command}\ncwd: ${workingDir}`, {
            status: 'canceled',
            request_id: pre.requestId,
          });
        }
        preConfirmedRemark = pre.remark || '';
      }
      const options = {
        cwd: workingDir,
        timeout: effectiveTimeout,
        maxBuffer,
        shell: usedShell,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          PAGER: 'cat',
          GIT_PAGER: 'cat',
          GIT_TERMINAL_PROMPT: '0',
          ...normalizeEnv(env),
        },
      };
      let formatted = '';
      let execResult = {
        stdout: '',
        stderr: '',
        exitCode: 0,
        signal: null,
        timedOut: false,
        interruptedForPrompt: false,
        prompt: null,
      };
      execResult = await execCommandWithPromptAbort({
        command,
        options,
        maxTailChars: 8000,
        abortOnPrompt: true,
        promptIdleMs: 500,
        abortSignal: extra?.signal,
      });

      formatted = formatCommandResult({
        command,
        cwd: workingDir,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
        signal: execResult.signal,
        timedOut: execResult.timedOut,
      });

      if (execResult.interruptedForPrompt) {
        const promptLine = execResult?.prompt?.line ? `\nDetected prompt: ${execResult.prompt.line}` : '';
        const hint = [
          formatted,
          '',
          'NOTE: Command appears to be waiting for interactive input (Y/n, password, multi-step prompt, etc.).',
          'The command was stopped early to avoid hanging until timeout.',
          'Next: re-run via mcp_shell_tasks_session_run, then use session_capture_output and session_send_input to respond.',
          'Alternatively: prefer non-interactive flags (--yes/--no-input/--force, ssh-keygen -f/-N, etc.).',
          promptLine.trim() ? promptLine : '',
        ]
          .filter(Boolean)
          .join('\n');
        return structuredResponse(hint, {
          status: 'needs_input',
          prompt_kind: execResult?.prompt?.kind || 'unknown',
          prompt_line: execResult?.prompt?.line || '',
        });
      }

      if (gitPreviewCapable) {
        const afterStatus = await getGitStatusPorcelain(workingDir);
        const trackedDiff = await getGitDiff(workingDir);
        const untrackedDiff = await buildUntrackedPseudoDiff(workingDir, afterStatus);
        const combinedDiff = `${trackedDiff || ''}${trackedDiff && untrackedDiff ? '\n' : ''}${untrackedDiff || ''}`;
        if (!combinedDiff.trim()) {
          return textResponse(formatted);
        }

        if (!confirmEnabled) {
          await logFileChangesFromDiff({
            diffText: combinedDiff,
            workspaceRoot,
            fsOps,
            tool: 'run_shell_command',
            mode: 'shell',
          });
          return textResponse(formatted);
        }

        const review = await promptFileChangeConfirm({
          title: '文件变更确认（Shell）',
          message: '检测到 shell 命令产生了文件变更。确认后保留变更，取消则回滚这些变更。',
          command,
          cwd: workingDir,
          diff: combinedDiff,
          path: '',
          source: `${serverName}/run_shell_command`,
        });
        if (review.status !== 'ok') {
          await rollbackGitWorkspace(workingDir);
          return structuredResponse(`${formatted}\n\n✗ 用户取消文件变更，已回滚。`, {
            status: 'canceled',
            request_id: review.requestId,
          });
        }

        await logFileChangesFromDiff({
          diffText: combinedDiff,
          workspaceRoot,
          fsOps,
          tool: 'run_shell_command',
          mode: 'shell',
        });

        const remark = review.remark ? `\n\nUser remark: ${review.remark}` : '';
        return structuredResponse(`${formatted}\n\n✓ 用户确认文件变更。${remark}`, {
          status: 'ok',
          confirmed: true,
          remark: review.remark || '',
          diff_truncated: truncateForUi(combinedDiff, 60_000),
        });
      }

      if (snapshotCapable && beforeSnapshots) {
        const afterSnapshots = await fsOps.snapshotFiles(snapshotCandidates, path.resolve(String(workspaceRoot)));
        const keys = new Set();
        beforeSnapshots.forEach((_v, key) => keys.add(key));
        afterSnapshots.forEach((_v, key) => keys.add(key));

        const changed = [];
        for (const relPath of Array.from(keys)) {
          const before = beforeSnapshots.get(relPath) || { exists: false, content: '' };
          const after = afterSnapshots.get(relPath) || { exists: false, content: '' };
          const beforeExists = Boolean(before?.exists);
          const afterExists = Boolean(after?.exists);
          const beforeContent = before?.content ?? '';
          const afterContent = after?.content ?? '';
          if (!beforeExists && !afterExists) continue;
          if (beforeExists && afterExists && beforeContent === afterContent) continue;
          const diff = await fsOps.generateUnifiedDiff(relPath, beforeContent, afterContent);
          changed.push({
            relPath,
            absolutePath: after?.absolutePath || before?.absolutePath || path.resolve(String(workspaceRoot), relPath),
            before: { exists: beforeExists, content: beforeContent },
            after: { exists: afterExists, content: afterContent },
            diff,
          });
        }

        if (changed.length === 0) {
          return textResponse(formatted);
        }

        const combinedDiff = changed.map((entry) => entry.diff).join('\n\n');
        if (!confirmEnabled) {
          for (const entry of changed) {
            const absPath = entry?.absolutePath;
            if (!absPath || !isInsideWorkspaceRoot(String(workspaceRoot), absPath)) continue;
            // eslint-disable-next-line no-await-in-loop
            await fsOps.logFileChange({
              relPath: entry.relPath,
              absolutePath: absPath,
              before: entry.before,
              after: entry.after,
              tool: 'run_shell_command',
              mode: 'shell',
              patchText: entry.diff,
            });
          }
          return textResponse(formatted);
        }

        const review = await promptFileChangeConfirm({
          title: '文件变更确认（Shell）',
          message: '检测到 shell 命令产生了文件变更。确认后保留变更，取消则回滚这些变更。',
          command,
          cwd: workingDir,
          diff: combinedDiff,
          path: changed[0]?.relPath || '',
          source: `${serverName}/run_shell_command`,
        });
        if (review.status !== 'ok') {
          for (const entry of changed) {
            const absPath = entry?.absolutePath;
            if (!absPath || !isInsideWorkspaceRoot(String(workspaceRoot), absPath)) continue;
            try {
              if (entry.before.exists) {
                // eslint-disable-next-line no-await-in-loop
                await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
                // eslint-disable-next-line no-await-in-loop
                await fs.promises.writeFile(absPath, entry.before.content || '', 'utf8');
              } else {
                // eslint-disable-next-line no-await-in-loop
                await fs.promises.rm(absPath, { force: true });
              }
            } catch {
              // ignore rollback failures
            }
          }
          return structuredResponse(`${formatted}\n\n✗ 用户取消文件变更，已回滚。`, {
            status: 'canceled',
            request_id: review.requestId,
          });
        }

        for (const entry of changed) {
          const absPath = entry?.absolutePath;
          if (!absPath || !isInsideWorkspaceRoot(String(workspaceRoot), absPath)) continue;
          // eslint-disable-next-line no-await-in-loop
          await fsOps.logFileChange({
            relPath: entry.relPath,
            absolutePath: absPath,
            before: entry.before,
            after: entry.after,
            tool: 'run_shell_command',
            mode: 'shell',
            patchText: entry.diff,
          });
        }

        const remark = review.remark ? `\n\nUser remark: ${review.remark}` : '';
        return structuredResponse(`${formatted}\n\n✓ 用户确认文件变更。${remark}`, {
          status: 'ok',
          confirmed: true,
          remark: review.remark || '',
          diff_truncated: truncateForUi(combinedDiff, 60_000),
        });
      }

      if (confirmEnabled && looksMutating && !gitPreviewCapable) {
        const remark = preConfirmedRemark ? `\n\nUser remark: ${preConfirmedRemark}` : '';
        return structuredResponse(`${formatted}${remark}`, {
          status: 'ok',
          confirmed: true,
          remark: preConfirmedRemark || '',
          preview: 'unavailable',
        });
      }

      return textResponse(formatted);
    }
  );

  server.registerTool(
    'list_workspace_files',
    {
      title: 'List workspace files',
      description: ['Quickly list first-level files/directories under root (or a subpath).', workspaceNote].join('\n'),
      inputSchema: z.object({
        path: z.string().optional().describe('Start directory relative to root'),
      }),
    },
    async ({ path: listPath = '.' }) => {
      const target = await ensurePath(listPath);
      const stats = await safeStat(target);
      if (!stats || !stats.isDirectory()) {
        throw new Error('Target is not a directory.');
      }
      const entries = await fs.promises.readdir(target);
      const lines = entries.slice(0, 100).map((name) => `- ${name}`);
      return textResponse(lines.join('\n') || '<empty>');
    }
  );

  server.registerTool(
    'session_run',
    {
      title: 'Run long command in session',
      description:
        [
          'Start or reuse a long-running session for streaming/daemon commands (>~1-2 minutes: services/watch/build/log tail, etc.). Use session_capture_output to read output.',
          workspaceNote,
          'Long-run examples: {"command":"npm run dev","session":"frontend","cwd":"app"}, {"command":"mvn spring-boot:run","session":"svc"}, {"command":"pytest -vv --maxfail=1","session":"tests","cwd":"backend"}, {"command":"tail -f logs/app.log","session":"logs"}, {"command":"node server.js","session":"api"}.',
        ].join('\n'),
      inputSchema: z.object({
        command: z.string().min(1).describe('Full command to execute'),
        session: z.string().optional().describe('Session name (auto-generated if omitted)'),
        cwd: z.string().optional().describe('Working directory relative to root (default root)'),
        env: z.record(z.string()).optional().describe('Extra environment variables'),
        window: z.string().optional().describe('Optional window name'),
        preview_lines: z
          .number()
          .int()
          .min(10)
          .max(5000)
          .optional()
          .describe('After starting, include a preview of the latest output lines (default 120)'),
        preview_wait_ms: z
          .number()
          .int()
          .min(0)
          .max(5000)
          .optional()
          .describe('Wait up to this long for initial output before previewing (default 300; 0 disables)'),
      }),
    },
    async ({ command, session, cwd = '.', env, window, preview_lines, preview_wait_ms }) => {
      const workingDir = await ensurePath(cwd);
      const sessionName = sessions.sanitizeName(session || `sess_${Date.now().toString(36)}`);
      const windowName = window ? sessions.sanitizeName(window) : null;
      const envVars = normalizeEnv(env);
      const result = await sessions.start({
        sessionName,
        command,
        workingDir,
        envVars,
        windowName,
      });
      const paths = result.outputPath
        ? `\noutput: ${result.outputPath}\ncontrol: ${result.controlPath}\nstatus: ${result.statusPath}`
        : '';
      const reuseRemark = result.reused ? ' (reused)' : '';

      const previewLines = clampNumber(preview_lines, 10, 5000, 120);
      const previewWaitMs = clampNumber(preview_wait_ms, 0, 5000, 300);
      let previewText = '';
      if (previewWaitMs > 0) {
        const startAt = Date.now();
        // eslint-disable-next-line no-await-in-loop
        while (Date.now() - startAt <= previewWaitMs) {
          try {
            // eslint-disable-next-line no-await-in-loop
            previewText = await sessions.captureOutput({ sessionName: result.sessionName, lineCount: previewLines });
          } catch {
            previewText = '';
          }
          if (previewText && previewText.trim()) break;
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 60));
        }
      } else if (previewWaitMs === 0) {
        previewText = '';
      }

      const previewBlock =
        previewWaitMs > 0
          ? `\n\n--- preview (last ${previewLines} lines) ---\n${previewText || '<empty>'}\n--- end preview ---`
          : '';
      return textResponse(
        `Started session "${result.sessionName}"${reuseRemark}${result.windowName ? ` window "${result.windowName}"` : ''}.${paths}${previewBlock}`
      );
    }
  );

  server.registerTool(
    'session_capture_output',
    {
      title: 'Capture session output',
      description: 'Fetch recent output from a session (paired with session_run). Example: {"session":"svc","lines":300}',
      inputSchema: z.object({
        session: z.string().min(1).describe('Session name'),
        lines: z.number().int().min(10).max(5000).optional().describe('Max lines to return (default 500)'),
      }),
    },
    async ({ session, lines }) => {
      const sessionName = sessions.sanitizeName(session);
      const lineCount = Number.isFinite(Number(lines)) ? Math.max(10, Math.min(5000, Math.floor(Number(lines)))) : 500;
      const output = await sessions.captureOutput({ sessionName, lineCount });
      return textResponse(`Session: ${sessionName}\nLines: ${lineCount}\n\n${output || '<empty>'}`);
    }
  );

  server.registerTool(
    'session_send_input',
    {
      title: 'Send input to session',
      description: 'Send text to a running session. Example: {"session":"svc","data":"q","enter":true}',
      inputSchema: z.object({
        session: z.string().min(1).describe('Session name'),
        data: z.string().optional().describe('Text to write'),
        enter: z.boolean().optional().describe('Append newline'),
      }),
    },
    async ({ session, data, enter }) => {
      const sessionName = sessions.sanitizeName(session);
      await sessions.sendInput({ sessionName, data: data || '', enter: enter === true });
      return textResponse(`OK: wrote to session "${sessionName}"${enter ? ' (enter)' : ''}.`);
    }
  );

  server.registerTool(
    'session_send_signal',
    {
      title: 'Send signal to session',
      description: 'Send a signal to a session. Example: {"session":"svc","signal":"SIGINT"}',
      inputSchema: z.object({
        session: z.string().min(1).describe('Session name'),
        signal: z.string().optional().describe('Signal (SIGINT/SIGTERM/SIGKILL/SIGHUP/SIGQUIT)'),
      }),
    },
    async ({ session, signal }) => {
      const sessionName = sessions.sanitizeName(session);
      const sig = typeof signal === 'string' && signal.trim() ? signal.trim() : 'SIGTERM';
      await sessions.sendSignal({ sessionName, signal: sig });
      return textResponse(`OK: sent ${sig} to session "${sessionName}".`);
    }
  );

  server.registerTool(
    'session_kill',
    {
      title: 'Kill session',
      description: 'Stop a long-running session. Example: {"session":"svc"}',
      inputSchema: z.object({
        session: z.string().min(1).describe('Session name'),
      }),
    },
    async ({ session }) => {
      const sessionName = sessions.sanitizeName(session);
      await sessions.killSession({ sessionName });
      return textResponse(`OK: kill requested for session "${sessionName}".`);
    }
  );

  server.registerTool(
    'session_list',
    {
      title: 'List sessions',
      description: 'List long-running sessions created by this server.',
      inputSchema: z.object({}),
    },
    async () => {
      const list = sessions.listSessions();
      return textResponse(JSON.stringify({ count: list.length, sessions: list }, null, 2));
    }
  );
}
