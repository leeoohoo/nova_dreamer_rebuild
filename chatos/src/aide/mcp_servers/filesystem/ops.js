import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import {
  applyFriendlyBlocks,
  ensurePatchDirs as ensurePatchDirsImpl,
  normalizeFriendlyPath,
  parseFriendlyPatch,
} from './ops/friendly-patch.js';
import { createWorkspaceResolver, preprocessPatchText, resolvePatchPayload, resolveWritePayload } from './ops/helpers.js';
import { resolveAppStateDir } from '../../shared/state-paths.js';

const fsp = fs.promises;

export function resolveSessionRoot() {
  if (process.env.MODEL_CLI_SESSION_ROOT) {
    return path.resolve(process.env.MODEL_CLI_SESSION_ROOT);
  }
  const home = os.homedir();
  if (home) return path.resolve(home);
  return process.cwd();
}

export function createFilesystemOps({
  root: rootArg,
  serverName: serverNameArg,
  fileChangeLogPath: logPathArg,
  logProgress: logProgressArg,
  appendRunPid: appendRunPidArg
} = {}) {
  const root = path.resolve(rootArg || process.cwd());
  const serverName = typeof serverNameArg === 'string' && serverNameArg.trim() ? serverNameArg.trim() : 'project_files';
  const fileChangeLogPath = typeof logPathArg === 'string' && logPathArg.trim() ? logPathArg.trim() : path.join(resolveAppStateDir(resolveSessionRoot()), 'file-changes.jsonl');

  const logProgress = typeof logProgressArg === 'function' ? logProgressArg : (msg) => console.error(`[${serverName}] ${msg}`);
  const appendRunPid = typeof appendRunPidArg === 'function' ? appendRunPidArg : () => {};

  const { ensurePath, buildOutsideRootMessage, relativePath, resolvePathWithinWorkspace, isInsideWorkspace } =
    createWorkspaceResolver({ root });

  function validateFriendlyPatchFormat(patchText) {
    const ops = parseFriendlyPatch(patchText);
    if (!ops || ops.length === 0) {
      throw new Error('Missing friendly patch operations (*** Add/Update/Delete File)');
    }
    logProgress(`✓ Friendly patch validation passed: ${ops.length} operations`);
  }

  // 改进的 patch 格式验证
  function validatePatchFormat(patchText) {
    if (!patchText || !patchText.trim()) {
      throw new Error('Patch is empty');
    }

    const lines = patchText.split('\n');

    // 检查文件头
    const hasMinusHeader = lines.some(line => line.startsWith('---'));
    const hasPlusHeader = lines.some(line => line.startsWith('+++'));

    if (!hasMinusHeader || !hasPlusHeader) {
      throw new Error('Missing file headers (--- or +++)');
    }

    // 检查 hunk 标记
    const hunkLines = lines.filter(line => line.startsWith('@@'));
    if (hunkLines.length === 0) {
      throw new Error('Missing hunk markers (@@)');
    }

    // 验证 hunk 格式
    const hunkRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;
    const invalidHunks = [];
    for (const hunk of hunkLines) {
      if (!hunkRegex.test(hunk)) {
        invalidHunks.push(hunk);
      }
    }

    if (invalidHunks.length > 0) {
      throw new Error(`Invalid hunk format: ${invalidHunks[0]}`);
    }

    // 检查是否有实际的修改内容
    const changeLines = lines.filter(line =>
        line.startsWith('+') || line.startsWith('-')
    ).filter(line =>
        !line.startsWith('+++') && !line.startsWith('---')
    );

    if (changeLines.length === 0) {
      throw new Error('Patch contains no actual changes (no +/- lines)');
    }

    logProgress(`✓ Patch validation passed: ${lines.length} lines, ${hunkLines.length} hunks, ${changeLines.length} changes`);
  }

  // 改进的 patch 应用函数
  async function applyPatch(workDir, patchText) {
    // 先尝试 friendly patch
    if (isFriendlyPatch(patchText)) {
      await applyFriendlyPatch(workDir, patchText);
      return;
    }

    // 改进的策略顺序 - 最常用的放在前面
    const stripLevels = [1, 0, 2, 3];
    const strategies = [];
    for (const strip of stripLevels) {
      strategies.push({ args: [`-p${strip}`, '-t'], label: `-p${strip} (standard)` });
    }
    for (const strip of stripLevels) {
      strategies.push({ args: [`-p${strip}`, '-t', '-l'], label: `-p${strip} (ignore whitespace)` });
    }
    for (const strip of stripLevels) {
      strategies.push({ args: [`-p${strip}`, '-t', '-F', '3'], label: `-p${strip} (fuzzy match)` });
    }
    for (const strip of stripLevels) {
      strategies.push({
        args: [`-p${strip}`, '-t', '-l', '-F', '3'],
        label: `-p${strip} (ignore ws + fuzz)`,
      });
    }

    const errors = [];

    for (const strategy of strategies) {
      try {
        if (errors.length > 0) {
          logProgress(`Retrying with ${strategy.label}...`);
        }
        await runPatchCommand(workDir, patchText, strategy.args);
        if (errors.length > 0) {
          logProgress(`✓ Success with ${strategy.label}`);
        }
        return;
      } catch (err) {
        errors.push({ strategy: strategy.label, err });

        // 致命错误,不需要重试
        if (err && err.code === 'ENOENT') {
          throw new Error(
              'patch command not found. Please install patch:\n' +
              '  • macOS: brew install patch\n' +
              '  • Ubuntu/Debian: apt-get install patch\n' +
              '  • Windows: Install Git for Windows or use WSL'
          );
        }
        if (err && err.code === 'ENOTDIR') {
          throw new Error(`patch failed: working directory is invalid (${workDir}).`);
        }
      }
    }

    // 所有策略都失败
    const errorDetails = errors.map((entry) =>
        `  • ${entry.strategy}: ${formatPatchError(entry.err)}`
    ).join('\n');

    throw new Error(
        `❌ Failed to apply patch with all strategies:\n${errorDetails}`
    );
  }

  async function runPatchCommand(workDir, patchText, args = ['-p1', '-t']) {
    return new Promise((resolve, reject) => {
      const child = spawn('patch', args, {
        cwd: workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
      appendRunPid({ pid: child.pid, kind: 'child', name: 'patch' });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => {
        reject({
          code: err?.code,
          message: err?.message || String(err),
          stdout,
          stderr,
        });
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject({
            code,
            stdout,
            stderr: stderr || `patch exited with code ${code}`,
          });
        }
      });
      child.stdin.write(patchText);
      child.stdin.end();
    });
  }

  // 改进的错误格式化
  function formatPatchError(err) {
    const parts = [];

    if (err?.stderr) {
      const stderr = err.stderr.trim();
      const lines = stderr.split('\n');

      // 提取关键错误信息
      const keyErrors = lines.filter(line =>
          line.includes('can\'t find file') ||
          line.includes('No such file') ||
          line.includes('FAILED') ||
          line.includes('malformed patch') ||
          line.includes('unexpected end of file') ||
          line.includes('Only garbage')
      );

      if (keyErrors.length > 0) {
        parts.push(keyErrors.slice(0, 3).join('; '));
      } else if (stderr.length > 0) {
        parts.push(stderr.slice(0, 300));
      }
    }

    if (err?.stdout && err.stdout.trim()) {
      const stdout = err.stdout.trim();
      if (!parts.some(p => p.includes(stdout.slice(0, 50)))) {
        parts.push(stdout.slice(0, 150));
      }
    }

    if (parts.length === 0 && err?.message) {
      parts.push(err.message);
    }

    return parts.filter(Boolean).join(' | ') || 'Unknown error';
  }

  function isFriendlyPatch(patchText) {
    if (!patchText) return false;
    // Friendly patch must contain explicit file operation headers (Update/Add/Delete).
    // (Some models wrap a unified diff with "*** Begin Patch", which should be treated as unified diff.)
    return /^\s*\*{3}\s+(Add File|Delete File|Update File):/m.test(patchText);
  }

  async function applyFriendlyPatch(workDir, patchText) {
    const ops = parseFriendlyPatch(patchText);
    if (!ops.length) {
      throw new Error('Failed to parse friendly patch format.');
    }
    for (const op of ops) {
      if (op.type === 'add') {
        const target = resolveFriendlyTarget(workDir, op.path);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        const payloadLines = op.lines.map((line) =>
            line.startsWith('+') ? line.slice(1) : line
        );
        const payload = payloadLines.join('\n');
        await fsp.writeFile(target, payload, 'utf8');
        continue;
      }
      if (op.type === 'delete') {
        const target = resolveFriendlyTarget(workDir, op.path);
        await fsp.rm(target, { recursive: true, force: true });
        continue;
      }
      if (op.type === 'update') {
        const sourcePath = resolveFriendlyTarget(workDir, op.path);
        const targetPath =
            op.newPath && op.newPath !== op.path
                ? resolveFriendlyTarget(workDir, op.newPath)
                : sourcePath;
        if (targetPath !== sourcePath) {
          await fsp.mkdir(path.dirname(targetPath), { recursive: true });
          try {
            await fsp.rename(sourcePath, targetPath);
          } catch (err) {
            const content = await fsp.readFile(sourcePath, 'utf8');
            await fsp.writeFile(targetPath, content, 'utf8');
            await fsp.rm(sourcePath, { force: true });
          }
        }
        let content;
        try {
          content = await fsp.readFile(targetPath, 'utf8');
        } catch (err) {
          if (err && err.code === 'ENOENT') {
            throw new Error(`Target file not found: ${relativePath(targetPath)}`);
          }
          throw err;
        }
        const updated = applyFriendlyBlocks(content, op.blocks, relativePath(targetPath));
        await fsp.writeFile(targetPath, updated, 'utf8');
      }
    }
  }

  function resolveFriendlyTarget(workDir, relPath) {
    const normalized = normalizeFriendlyPath(relPath);
    return resolvePathWithinWorkspace(normalized || '.', workDir);
  }
  const ensurePatchDirs = async (workDir, patchText) =>
    ensurePatchDirsImpl({
      workDir,
      patchText,
      resolvePathWithinWorkspace,
      fsp,
    });

  // If patch paths accidentally include the workDir prefix (common with LLMs),
  // strip it so patch can be applied from workDir reliably.
  function rewritePatchWorkingDir(patchText, relWorkDir) {
    if (!patchText) {
      return patchText;
    }
    const normalizedDir = String(relWorkDir || '')
        .replace(/\\/g, '/')
        .replace(/^\.\/?/, '')
        .replace(/\/+$/, '');
    if (!normalizedDir) {
      return patchText;
    }
    const headerRegex = /^(---|\+\+\+)\s+([^\n]+)/gm;
    let rewritten = patchText.replace(headerRegex, (full, marker, pathPartRaw) => {
      const [pathPart, ...meta] = pathPartRaw.split(/\t+/);
      const suffix = meta.length > 0 ? `\t${meta.join('\t')}` : '';
      if (!pathPart) return full;
      const adjusted = stripWorkdirPrefix(pathPart.trim(), normalizedDir);
      return `${marker} ${adjusted}${suffix}`;
    });

    const diffGitRegex = /^diff --git\s+(\S+)\s+(\S+)(.*)$/gm;
    rewritten = rewritten.replace(diffGitRegex, (full, aPath, bPath, rest = '') => {
      const adjustedA = stripWorkdirPrefix(String(aPath || '').trim(), normalizedDir);
      const adjustedB = stripWorkdirPrefix(String(bPath || '').trim(), normalizedDir);
      return `diff --git ${adjustedA} ${adjustedB}${rest || ''}`;
    });

    const friendlyHeaderRegex = /^\*\*\* (Add File|Delete File|Update File):\s+([^\n]+)/gm;
    rewritten = rewritten.replace(friendlyHeaderRegex, (full, action, filePathRaw) => {
      const adjusted = stripWorkdirPrefix(filePathRaw.trim(), normalizedDir);
      return `*** ${action}: ${adjusted}`;
    });

    const moveRegex = /^\*\*\* Move to:\s+([^\n]+)/gm;
    rewritten = rewritten.replace(moveRegex, (full, targetRaw) => {
      const adjusted = stripWorkdirPrefix(targetRaw.trim(), normalizedDir);
      return `*** Move to: ${adjusted}`;
    });

    return rewritten;
  }

  function stripWorkdirPrefix(rawPath, normalizedDir) {
    if (!rawPath) return rawPath;
    let candidate = rawPath.replace(/\\/g, '/');
    let prefix = '';
    if (candidate.startsWith('a/')) {
      prefix = 'a/';
      candidate = candidate.slice(2);
    } else if (candidate.startsWith('b/')) {
      prefix = 'b/';
      candidate = candidate.slice(2);
    }
    const withSlash = normalizedDir ? `${normalizedDir}/` : '';
    if (withSlash && candidate.startsWith(withSlash)) {
      const trimmed = candidate.slice(withSlash.length);
      if (trimmed.length > 0) {
        return `${prefix}${trimmed}`;
      }
    }
    return `${prefix}${candidate}`;
  }

  async function readFileSnapshot(target) {
    try {
      const content = await fsp.readFile(target, 'utf8');
      return { exists: true, content };
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        return { exists: false, content: '' };
      }
      console.error(`[${serverName}] Failed to read snapshot for ${target}: ${err?.message || err}`);
      return { exists: true, content: '' };
    }
  }

  async function snapshotFiles(paths, workDir = root) {
    const map = new Map();
    if (!Array.isArray(paths) || paths.length === 0) {
      return map;
    }
    for (const rel of paths) {
      if (!rel) continue;
      try {
        const target = resolvePathWithinWorkspace(rel, workDir);
        const relPathLabel = relativePath(target);
        if (map.has(relPathLabel)) continue;
        const snap = await readFileSnapshot(target);
        map.set(relPathLabel, { ...snap, absolutePath: target });
      } catch (err) {
        console.error(
            `[${serverName}] Skip logging for ${rel}: ${err?.message || err}`
        );
      }
    }
    return map;
  }

  async function buildChangeEntry({ relPath, absolutePath, before, after, tool, mode, patchText }) {
    const resolvedRel = relPath || (absolutePath ? relativePath(absolutePath) : '');
    if (!resolvedRel && !absolutePath) {
      return null;
    }
    const beforeExists = Boolean(before?.exists);
    const afterExists = Boolean(after?.exists);
    const beforeContent = before?.content ?? '';
    const afterContent = after?.content ?? '';
    if (!beforeExists && !afterExists) {
      return null;
    }
    if (beforeExists && afterExists && beforeContent === afterContent && !patchText) {
      return null;
    }
    const changeType = !beforeExists && afterExists ? 'created' : beforeExists && !afterExists ? 'deleted' : 'modified';
    const diffText =
        patchText || (await generateUnifiedDiff(resolvedRel, beforeContent, afterContent));
    const runId = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
    return {
      ts: new Date().toISOString(),
      ...(runId ? { runId } : {}),
      path: resolvedRel,
      absolutePath,
      workspaceRoot: root,
      changeType,
      tool,
      mode,
      server: serverName,
      diff: diffText,
    };
  }

  async function logFileChange(payload) {
    try {
      const entry = await buildChangeEntry(payload);
      if (entry) {
        appendFileChanges([entry]);
      }
    } catch (err) {
      console.error(
          `[${serverName}] Failed to log file change ${payload?.relPath || payload?.absolutePath || ''}: ${
              err?.message || err
          }`
      );
    }
  }

  async function logPatchChanges({ affectedPaths = [], before, after, patchText, workDir }) {
    try {
      const entries = [];
      const keys = new Set();
      if (Array.isArray(affectedPaths)) {
        affectedPaths.filter(Boolean).forEach((p) => keys.add(p));
      }
      if (before instanceof Map) {
        before.forEach((_value, key) => keys.add(key));
      }
      if (after instanceof Map) {
        after.forEach((_value, key) => keys.add(key));
      }
      for (const relKey of Array.from(keys)) {
        let absolutePath = null;
        const beforeSnap = before instanceof Map ? before.get(relKey) : null;
        const afterSnap = after instanceof Map ? after.get(relKey) : null;
        absolutePath =
            afterSnap?.absolutePath ||
            beforeSnap?.absolutePath ||
            resolvePathWithinWorkspace(relKey, workDir || root);
        try {
          const entry = await buildChangeEntry({
            relPath: relKey,
            absolutePath,
            before: beforeSnap,
            after: afterSnap,
            tool: 'apply_patch',
            mode: 'patch',
          });
          if (entry) {
            entries.push(entry);
          }
        } catch (err) {
          console.error(
              `[${serverName}] Skip patch log for ${relKey}: ${err?.message || err}`
          );
        }
      }
      if (entries.length === 0 && patchText) {
        const runId = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
        entries.push({
          ts: new Date().toISOString(),
          ...(runId ? { runId } : {}),
          path: 'patch',
          workspaceRoot: root,
          changeType: 'modified',
          tool: 'apply_patch',
          mode: 'patch',
          server: serverName,
          diff: patchText,
        });
      }
      appendFileChanges(entries);
    } catch (err) {
      console.error(`[${serverName}] Failed to log patch changes: ${err?.message || err}`);
    }
  }

  function appendFileChanges(entries = []) {
    if (!entries || entries.length === 0) return;
    const payload = entries
        .filter(Boolean)
        .map((entry) => JSON.stringify(entry))
        .join('\n');
    if (!payload) return;
    try {
      fs.mkdirSync(path.dirname(fileChangeLogPath), { recursive: true });
      fs.appendFileSync(fileChangeLogPath, `${payload}\n`, 'utf8');
    } catch (err) {
      console.error(`[${serverName}] Failed to append file changes: ${err?.message || err}`);
    }
  }

  async function generateUnifiedDiff(relPathLabel, beforeContent, afterContent) {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-diff-'));
    const oldPath = path.join(tempDir, 'old');
    const newPath = path.join(tempDir, 'new');
    await fsp.writeFile(oldPath, beforeContent ?? '', 'utf8');
    await fsp.writeFile(newPath, afterContent ?? '', 'utf8');
    try {
      const diffOutput = await runDiffCommand(['-u', oldPath, newPath]);
      const adjusted = rewriteDiffHeaders(diffOutput, relPathLabel);
      return adjusted || buildFallbackDiff(relPathLabel, beforeContent, afterContent);
    } catch (err) {
      return buildFallbackDiff(relPathLabel, beforeContent, afterContent);
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  function runDiffCommand(args = []) {
    return new Promise((resolve, reject) => {
      const child = spawn('diff', args);
      appendRunPid({ pid: child.pid, kind: 'child', name: 'diff' });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code === 0 || code === 1) {
          resolve(stdout || stderr || '');
        } else {
          reject(new Error(stderr || stdout || `diff exited with code ${code}`));
        }
      });
    });
  }

  function rewriteDiffHeaders(diffText, relPathLabel) {
    if (!diffText) return diffText;
    const lines = diffText.replace(/\r\n/g, '\n').split('\n');
    let sawHeader = 0;
    const rewritten = lines.map((line) => {
      if (line.startsWith('--- ')) {
        sawHeader += 1;
        return `--- a/${relPathLabel}`;
      }
      if (line.startsWith('+++ ')) {
        sawHeader += 1;
        return `+++ b/${relPathLabel}`;
      }
      return line;
    });
    if (sawHeader === 0) {
      rewritten.unshift(`--- a/${relPathLabel}`, `+++ b/${relPathLabel}`);
    }
    return rewritten.join('\n');
  }

  function buildFallbackDiff(relPathLabel, beforeContent, afterContent) {
    const beforeLines = String(beforeContent ?? '').replace(/\r\n/g, '\n').split('\n');
    const afterLines = String(afterContent ?? '').replace(/\r\n/g, '\n').split('\n');
    const body = ['@@'];
    beforeLines.forEach((line) => {
      body.push(`-${line}`);
    });
    afterLines.forEach((line) => {
      body.push(`+${line}`);
    });
    return [`--- a/${relPathLabel}`, `+++ b/${relPathLabel}`, ...body].join('\n');
  }

  function listPatchFiles(patchText = '') {
    if (!patchText) return [];
    const files = new Set();
    const lines = patchText.replace(/\r\n/g, '\n').split('\n');
    for (const line of lines) {
      if (line.startsWith('diff --git ')) {
        const parts = line.split(' ').filter(Boolean);
        if (parts[2]) files.add(normalizePatchPath(parts[2]));
        if (parts[3]) files.add(normalizePatchPath(parts[3]));
        continue;
      }
      if (line.startsWith('--- ')) {
        const filePath = normalizePatchPath(line.slice(4));
        if (filePath) files.add(filePath);
        continue;
      }
      if (line.startsWith('+++ ')) {
        const filePath = normalizePatchPath(line.slice(4));
        if (filePath) files.add(filePath);
        continue;
      }
      if (line.startsWith('*** Add File:')) {
        files.add(normalizePatchPath(line.slice('*** Add File:'.length)));
        continue;
      }
      if (line.startsWith('*** Delete File:')) {
        files.add(normalizePatchPath(line.slice('*** Delete File:'.length)));
        continue;
      }
      if (line.startsWith('*** Update File:')) {
        files.add(normalizePatchPath(line.slice('*** Update File:'.length)));
        continue;
      }
      if (line.startsWith('*** Move to:')) {
        files.add(normalizePatchPath(line.slice('*** Move to:'.length)));
      }
    }
    return Array.from(files).filter(Boolean);
  }

  function normalizePatchPath(raw) {
    if (!raw) return '';
    const [candidate] = String(raw).trim().split(/\s+/);
    if (!candidate || candidate === '/dev/null') return '';
    return normalizeFriendlyPath(candidate);
  }


  return {
    applyPatch,
    buildOutsideRootMessage,
    ensurePatchDirs,
    ensurePath,
    formatPatchError,
    generateUnifiedDiff,
    isFriendlyPatch,
    listPatchFiles,
    logFileChange,
    logPatchChanges,
    preprocessPatchText,
    readFileSnapshot,
    relativePath,
    rewritePatchWorkingDir,
    snapshotFiles,
    stripWorkdirPrefix,
    validateFriendlyPatchFormat,
    validatePatchFormat,
    resolvePatchPayload,
    resolveWritePayload,
  };
}
