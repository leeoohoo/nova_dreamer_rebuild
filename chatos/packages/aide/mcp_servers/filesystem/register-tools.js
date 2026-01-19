import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const fsp = fs.promises;

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.min(Math.max(parsed, min), max);
  }
  return fallback;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return 'n/a';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]} (${bytes} B)`;
}

function textResponse(text) {
  return {
    content: [
      {
        type: 'text',
        text: text || '',
      },
    ],
  };
}

function structuredResponse(text, structuredContent) {
  return {
    content: [
      {
        type: 'text',
        text: text || '',
      },
    ],
    structuredContent: structuredContent && typeof structuredContent === 'object' ? structuredContent : undefined,
  };
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function detectLineEnding(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function restoreTrailingNewline(originalContent, modifiedContent) {
  const hadTrailingNewline = originalContent.endsWith('\n');
  if (hadTrailingNewline && !modifiedContent.endsWith('\n')) {
    return `${modifiedContent}\n`;
  }
  if (!hadTrailingNewline && modifiedContent.endsWith('\n')) {
    return modifiedContent.replace(/\n$/, '');
  }
  return modifiedContent;
}

function safeLiteralReplace(str, oldString, newString) {
  if (oldString === '' || !str.includes(oldString)) {
    return str;
  }
  return str.replaceAll(oldString, () => newString);
}

function isBinary(data, sampleSize = 512) {
  if (!data) {
    return false;
  }
  const sample = data.length > sampleSize ? data.subarray(0, sampleSize) : data;
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while (true) {
    const idx = haystack.indexOf(needle, cursor);
    if (idx === -1) {
      break;
    }
    count += 1;
    cursor = idx + needle.length;
  }
  return count;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function calculateExactReplacement({ currentContent, oldString, newString }) {
  const occurrences = countOccurrences(currentContent, oldString);
  if (occurrences <= 0) return null;
  const replaced = safeLiteralReplace(currentContent, oldString, newString);
  return { newContent: replaced, occurrences, strategy: 'exact' };
}

function calculateFlexibleReplacement({ currentContent, oldString, newString }) {
  const sourceLines = currentContent.split('\n');
  const searchLines = oldString.split('\n');
  const searchLinesStripped = searchLines.map((line) => line.trim());
  const replaceLines = newString.split('\n');

  if (searchLinesStripped.length === 0) return null;

  let occurrences = 0;
  let i = 0;
  while (i <= sourceLines.length - searchLinesStripped.length) {
    const window = sourceLines.slice(i, i + searchLinesStripped.length);
    const windowStripped = window.map((line) => line.trim());
    const isMatch = windowStripped.every((line, idx) => line === searchLinesStripped[idx]);
    if (!isMatch) {
      i += 1;
      continue;
    }

    occurrences += 1;
    const indentationMatch = String(sourceLines[i] || '').match(/^(\s*)/);
    const indentation = indentationMatch ? indentationMatch[1] : '';
    const newBlockWithIndent = replaceLines.map((line) => `${indentation}${line}`);
    sourceLines.splice(i, searchLinesStripped.length, ...newBlockWithIndent);
    i += newBlockWithIndent.length;
  }

  if (occurrences <= 0) return null;
  return { newContent: sourceLines.join('\n'), occurrences, strategy: 'flexible' };
}

function calculateRegexReplacement({ currentContent, oldString, newString }) {
  const delimiters = ['(', ')', ':', '[', ']', '{', '}', '>', '<', '='];

  let processed = oldString;
  for (const delim of delimiters) {
    processed = processed.split(delim).join(` ${delim} `);
  }

  const tokens = processed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const escapedTokens = tokens.map(escapeRegex);
  const pattern = escapedTokens.join('\\s*');

  const finalPattern = `^(\\s*)${pattern}`;
  const flexibleRegex = new RegExp(finalPattern, 'm');

  const match = flexibleRegex.exec(currentContent);
  if (!match) {
    return null;
  }

  const indentation = match[1] || '';
  const newLines = newString.split('\n');
  const newBlockWithIndent = newLines.map((line) => `${indentation}${line}`).join('\n');

  return {
    newContent: currentContent.replace(flexibleRegex, newBlockWithIndent),
    occurrences: 1,
    strategy: 'regex',
  };
}

async function safeStat(target) {
  try {
    return await fsp.stat(target);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function collectDirectoryEntries(startDir, options = {}) {
  const depth = clampNumber(options.depth, 1, 5, 1);
  const includeHidden = Boolean(options.includeHidden);
  const maxEntries = options.maxEntries || 200;
  const queue = [{ dir: startDir, level: 0 }];
  const results = [];
  while (queue.length > 0 && results.length < maxEntries) {
    const current = queue.shift();
    let children;
    try {
      children = await fsp.readdir(current.dir, { withFileTypes: true });
    } catch (err) {
      results.push({
        fullPath: current.dir,
        isDir: true,
        size: 0,
      });
      continue;
    }
    for (const entry of children) {
      if (!includeHidden && entry.name.startsWith('.')) {
        continue;
      }
      const fullPath = path.join(current.dir, entry.name);
      const stats = await safeStat(fullPath);
      results.push({
        fullPath,
        isDir: Boolean(stats?.isDirectory()),
        size: stats?.size || 0,
      });
      if (results.length >= maxEntries) {
        break;
      }
      if (entry.isDirectory() && current.level + 1 < depth) {
        queue.push({ dir: fullPath, level: current.level + 1 });
      }
    }
  }
  return results;
}

async function searchInTree(startDir, needle, options = {}) {
  const maxResults = clampNumber(options.maxResults, 1, 200, 20);
  const maxFiles = clampNumber(options.maxFiles, 1, 500, 120);
  const matches = [];
  const queue = [startDir];
  let filesScanned = 0;
  while (queue.length > 0 && matches.length < maxResults && filesScanned < maxFiles) {
    const current = queue.shift();
    const stats = await safeStat(current);
    if (!stats) {
      continue;
    }
    if (stats.isDirectory()) {
      let children = [];
      try {
        children = await fsp.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of children) {
        if (entry.name.startsWith('.')) {
          continue;
        }
        queue.push(path.join(current, entry.name));
      }
    } else if (stats.isFile()) {
      filesScanned += 1;
      const maxBytes = Number(options.maxFileBytes);
      if (Number.isFinite(maxBytes) && maxBytes > 0 && stats.size > maxBytes) {
        continue;
      }
      const content = await fsp.readFile(current, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].includes(needle)) {
          matches.push({
            file: typeof options.relativePath === 'function' ? options.relativePath(current) : current,
            line: i + 1,
            preview: lines[i].trim().slice(0, 200),
          });
          if (matches.length >= maxResults) {
            break;
          }
        }
      }
    }
  }
  return matches;
}

const APPLY_PATCH_DESCRIPTION = [
  'Apply patch to files. Supports standard unified diff format, and also Codex-style friendly patch (`*** Begin Patch ...`).',
  '',
  '**Path parameter usage:**',
  '- If omitted or ".", patch is applied from workspace root',
  '- If a directory path (e.g., "src"), patch is applied within that directory',
  '- If a file path, patch is applied to that file\'s directory',
  '- File paths in patch should be RELATIVE to the path parameter',
  '',
  '**Important: Path matching rules**',
  '- If path="src", patch should use "a/app.js" NOT "a/src/app.js"',
  '- If path=".", patch should use "a/src/app.js"',
  '- The path parameter sets the working directory for patch command',
  '',
  '**When to use:**',
  '- Making precise, localized changes (1-10 lines)',
  '- Modifying imports, function signatures, or variable names',
  '- Small refactoring tasks',
  '',
  '**When NOT to use (use write_file instead):**',
  '- Creating new files from scratch',
  '- Replacing entire file contents',
  '- Making changes to more than 50% of a file',
  '- Working with generated code or large data files',
  '',
  '**Patch format example:**',
  '```',
  '--- a/app.js',
  '+++ b/app.js',
  '@@ -10,7 +10,7 @@',
  " import { User } from './models';",
  ' ',
  ' function greet(name) {',
  "-  return 'Hello ' + name;",
  ' +  return `Hello ${name}`;',
  ' }',
  '```',
  '',
  '**Tips for success:**',
  '- Include 3-5 lines of context before and after changes',
  '- Ensure line numbers in @@ markers are accurate',
  '- Context lines (without +/-) must match exactly',
  '- Test with small changes first',
  '- If patch fails repeatedly, use write_file instead',
].join('\n');

export function registerFilesystemTools({
  server,
  z,
  workspaceNote,
  allowWrites,
  root,
  maxFileBytes,
  searchLimit,
  fsOps,
  logProgress,
  confirmFileChangeIfNeeded,
} = {}) {
  if (!server) throw new Error('Missing MCP server');
  if (!z) throw new Error('Missing zod');
  if (!fsOps) throw new Error('Missing filesystem ops');

  const {
    applyPatch,
    ensurePatchDirs,
    ensurePath,
    formatPatchError,
    isFriendlyPatch,
    listPatchFiles,
    logFileChange,
    logPatchChanges,
    preprocessPatchText,
    readFileSnapshot,
    relativePath,
    rewritePatchWorkingDir,
    snapshotFiles,
    validateFriendlyPatchFormat,
    validatePatchFormat,
    resolvePatchPayload,
    resolveWritePayload,
  } = fsOps;

  const note = typeof workspaceNote === 'string' ? workspaceNote : '';
  const safeMaxFileBytes = clampNumber(maxFileBytes, 1024, 1024 * 1024, 256 * 1024);
  const safeSearchLimit = clampNumber(searchLimit, 1, 200, 40);
  const safeRoot = typeof root === 'string' && root.trim() ? root.trim() : process.cwd();

  server.registerTool(
    'list_directory',
    {
      title: 'List directory',
      description: [
        'List files/directories under the workspace root (up to 200 entries) with optional recursion depth.',
        note,
        'Examples: {"path":"src","depth":1} or {"path":".","depth":2,"includeHidden":true}',
      ].join('\n'),
      inputSchema: z.object({
        path: z.string().optional().describe('Directory relative to root (default ".")'),
        depth: z.number().int().min(1).max(5).optional().describe('Recursion depth (1-5)'),
        includeHidden: z.boolean().optional().describe('Include dotfiles'),
      }),
    },
    async ({ path: dirPath = '.', depth = 1, includeHidden = false }) => {
      const target = await ensurePath(dirPath);
      const stats = await safeStat(target);
      if (!stats || !stats.isDirectory()) {
        throw new Error('Target is not a directory or does not exist.');
      }
      const entries = await collectDirectoryEntries(target, {
        depth,
        includeHidden,
        maxEntries: 200,
      });
      const lines = entries.map((entry) => {
        const rel = relativePath(entry.fullPath);
        const indicator = entry.isDir ? '📁' : '📄';
        const size = entry.isDir ? '-' : formatBytes(entry.size);
        return `${indicator} ${rel} (${size})`;
      });
      const body = lines.length > 0 ? lines.join('\n') : '<empty>';
      return textResponse(body);
    }
  );

  server.registerTool(
    'read_file',
    {
      title: 'Read file',
      description: [
        'Return UTF-8 file content with line numbers (size limited by --max-bytes).',
        note,
        'Example: {"path":"src/app.js"}.',
      ].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('File path relative to root'),
      }),
    },
    async ({ path: filePath }) => {
      const target = await ensurePath(filePath);
      const stats = await safeStat(target);
      if (!stats || !stats.isFile()) {
        throw new Error('Target file does not exist or is not a regular file.');
      }
      if (stats.size > safeMaxFileBytes) {
        throw new Error(`File too large (${formatBytes(stats.size)}), exceeds limit ${formatBytes(safeMaxFileBytes)}.`);
      }
      const content = await fsp.readFile(target, { encoding: 'utf8' });
      const lines = content.split(/\r?\n/);
      const numberedContent = lines.map((line, i) => `${(i + 1).toString().padStart(6, ' ')} | ${line}`).join('\n');
      const header = `# ${relativePath(target)} (size: ${formatBytes(stats.size)})`;
      return textResponse(`${header}\n\n${numberedContent}`);
    }
  );

  server.registerTool(
    'search_text',
    {
      title: 'Search text',
      description: [
        'Search for a substring (case-sensitive) in text files under a directory. Returns file:line + preview.',
        note,
      ].join('\n'),
      inputSchema: z.object({
        query: z.string().min(1).describe('Search keyword (case-sensitive)'),
        path: z.string().optional().describe('Start directory relative to root (default ".")'),
        max_results: z.number().int().min(1).max(safeSearchLimit).optional().describe('Max matches to return'),
      }),
    },
    async ({ query, path: startPath = '.', max_results: maxResults }) => {
      const limit = Math.min(maxResults || safeSearchLimit, safeSearchLimit);
      const start = await ensurePath(startPath);
      const stats = await safeStat(start);
      if (!stats) {
        throw new Error('Search root does not exist.');
      }
      const matches = await searchInTree(start, query, {
        maxResults: limit,
        maxFiles: 120,
        maxFileBytes: safeMaxFileBytes,
        relativePath,
      });
      if (matches.length === 0) {
        return textResponse('No matches found.');
      }
      const body = matches.map((match) => `${match.file}:${match.line} ${match.preview}`).join('\n');
      return textResponse(body);
    }
  );

  if (!allowWrites) {
    return;
  }

  server.registerTool(
    'write_file',
    {
      title: 'Write file',
      description: `Write/append UTF-8 text. Use this for whole-block writes or appends; small edits should use apply_patch.
Examples:
- Append log: {"path":"logs/app.log","mode":"append","contents":"[INFO] started\\n"}
- Overwrite generated file: {"path":"dist/output.txt","mode":"overwrite","contents":"...build output..."}
${note}`,
      inputSchema: z.object({
        path: z.string().describe('File path relative to root'),
        contents: z.string().optional().describe('Payload (plain text)'),
        contents_base64: z.string().optional().describe('Payload (base64-encoded)'),
        chunks: z
          .array(
            z.object({
              content: z.string(),
              encoding: z.enum(['plain', 'base64']).optional(),
            })
          )
          .optional()
          .describe('Optional chunked payload, each with its own encoding'),
        encoding: z.enum(['plain', 'base64']).optional().describe('Default plain'),
        mode: z.enum(['overwrite', 'append']).optional().describe('Write mode (default overwrite)'),
      }),
    },
    async (args) => {
      const target = await ensurePath(args.path);
      const relPathLabel = relativePath(target);
      const before = await readFileSnapshot(target);
      const mode = typeof args.mode === 'string' ? args.mode.toLowerCase() : 'overwrite';
      if (mode !== 'overwrite' && mode !== 'append') {
        throw new Error('mode must be overwrite or append');
      }
      const payload = await resolveWritePayload(args);
      if (!payload) {
        throw new Error('No content to write; aborted.');
      }
      const confirmResult = await confirmFileChangeIfNeeded?.({
        tool: 'write_file',
        path: relPathLabel,
        mode,
        before,
        afterContent: mode === 'append' ? `${before?.content ?? ''}${payload}` : payload,
      });
      if (confirmResult?.status === 'canceled') {
        return structuredResponse(`✗ Canceled write_file ${relativePath(target)}.`, {
          status: 'canceled',
          request_id: confirmResult.requestId,
          remark: confirmResult.remark || '',
        });
      }
      const stats = await safeStat(target);
      if (stats && stats.isDirectory()) {
        throw new Error('Target is a directory; cannot write file.');
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      logProgress?.(`Writing (${mode}) ${relativePath(target)} (${payload.length} chars)...`);
      if (mode === 'append') {
        await fsp.appendFile(target, payload, 'utf8');
      } else {
        await fsp.writeFile(target, payload, 'utf8');
      }
      const after = await readFileSnapshot(target);
      await logFileChange({
        relPath: relPathLabel,
        absolutePath: target,
        before,
        after,
        tool: 'write_file',
        mode,
      });
      const summary = mode === 'append' ? 'Appended' : 'Overwrote';
      const remark = confirmResult?.remark ? `\nUser remark: ${confirmResult.remark}` : '';
      return structuredResponse(`✓ ${summary} ${relativePath(target)} (${payload.length} chars).${remark}`, {
        status: 'ok',
        confirmed: Boolean(confirmResult?.status === 'ok'),
        remark: confirmResult?.remark || '',
        path: relPathLabel,
        tool: 'write_file',
        mode,
      });
    }
  );

  server.registerTool(
    'edit_file',
    {
      title: 'Edit file (string replace)',
      description: [
        'Edit a UTF-8 text file by replacing `old_string` with `new_string`.',
        'This is often more reliable than generating a full patch when you already have the exact snippet.',
        '',
        '**Rules:**',
        '- You MUST read_file first to get the exact snippet and confirm context',
        '- Default expected_replacements=1 (fails if match count differs)',
        '- To create a new file: old_string="" and target must not exist',
        '- For large rewrites (>50%), use write_file instead',
        note,
      ].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('File path relative to root'),
        old_string: z.string().describe('Exact text to replace (empty means create new file)'),
        new_string: z.string().describe('Replacement text (or full content for new file)'),
        expected_replacements: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Expected number of matches (default 1)'),
      }),
    },
    async ({ path: filePath, old_string: oldRaw, new_string: newRaw, expected_replacements: expectedRaw }) => {
      const target = await ensurePath(filePath);
      const relPathLabel = relativePath(target);
      const expectedReplacements = Number.isFinite(Number(expectedRaw)) ? Number(expectedRaw) : 1;

      const stats = await safeStat(target);
      if (stats && stats.isDirectory()) {
        throw new Error('Target is a directory; cannot edit file.');
      }

      // Read as buffer first to detect binary files.
      let currentContentRaw = null;
      let fileExists = false;
      try {
        const currentBuffer = await fsp.readFile(target);
        if (isBinary(currentBuffer)) {
          throw new Error('Target appears to be a binary file; edit_file only supports UTF-8 text.');
        }
        currentContentRaw = currentBuffer.toString('utf8');
        fileExists = true;
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          fileExists = false;
          currentContentRaw = null;
        } else {
          throw err;
        }
      }

      const oldString = String(oldRaw ?? '');
      const newString = String(newRaw ?? '');

      const isCreateNewFile = oldString === '' && !fileExists;

      if (!isCreateNewFile && !fileExists) {
        throw new Error(`File not found: ${relPathLabel}. To create a new file, set old_string="" or use write_file.`);
      }

      if (fileExists && oldString === '') {
        throw new Error(
          `Refusing to create file that already exists: ${relPathLabel}. Provide old_string to edit, or use write_file to overwrite.`
        );
      }

      const originalLineEnding = fileExists ? detectLineEnding(currentContentRaw) : '\n';
      const currentContentNormalized = fileExists ? currentContentRaw.replace(/\r\n/g, '\n') : '';

      let nextContentToWriteRaw = '';
      let occurrences = 0;
      let strategy = isCreateNewFile ? 'create' : 'exact';

      if (isCreateNewFile) {
        occurrences = 1;
        nextContentToWriteRaw = newString;
      } else {
        const normalizedSearch = oldString.replace(/\r\n/g, '\n');
        const normalizedReplace = newString.replace(/\r\n/g, '\n');

        if (normalizedSearch === '') {
          throw new Error('old_string is empty; to create a new file, the target path must not exist.');
        }
        if (normalizedSearch === normalizedReplace) {
          throw new Error('No changes to apply: old_string and new_string are identical.');
        }

        const exact = calculateExactReplacement({
          currentContent: currentContentNormalized,
          oldString: normalizedSearch,
          newString: normalizedReplace,
        });
        const flexible = exact
          ? null
          : calculateFlexibleReplacement({
              currentContent: currentContentNormalized,
              oldString: normalizedSearch,
              newString: normalizedReplace,
            });
        const regex =
          exact || flexible
            ? null
            : calculateRegexReplacement({
                currentContent: currentContentNormalized,
                oldString: normalizedSearch,
                newString: normalizedReplace,
              });

        const result = exact || flexible || regex;
        if (!result) {
          throw new Error(
            `Failed to edit ${relPathLabel}: could not find old_string.\n` +
              `Tips:\n` +
              `- Use read_file to copy the exact snippet (including whitespace)\n` +
              `- Include more surrounding context in old_string\n` +
              `- If the change is large, prefer apply_patch or write_file`
          );
        }

        occurrences = result.occurrences;
        strategy = result.strategy;

        if (occurrences !== expectedReplacements) {
          throw new Error(
            `Failed to edit ${relPathLabel}: expected ${expectedReplacements} occurrence(s) but found ${occurrences}.\n` +
              `Tips:\n` +
              `- Make old_string more specific\n` +
              `- Or set expected_replacements to ${occurrences} if that is intended`
          );
        }

        const nextContentNormalized = restoreTrailingNewline(currentContentNormalized, result.newContent);

        // Restore original line endings if the existing file uses CRLF.
        nextContentToWriteRaw =
          originalLineEnding === '\r\n' ? nextContentNormalized.replace(/\n/g, '\r\n') : nextContentNormalized;
      }

      const before = fileExists ? { exists: true, content: currentContentRaw } : { exists: false, content: '' };

      const confirmResult = await confirmFileChangeIfNeeded?.({
        tool: 'edit_file',
        path: relPathLabel,
        mode: isCreateNewFile ? 'create' : 'edit',
        before,
        afterContent: nextContentToWriteRaw,
      });
      if (confirmResult?.status === 'canceled') {
        return structuredResponse(`✗ Canceled edit_file ${relativePath(target)}.`, {
          status: 'canceled',
          request_id: confirmResult.requestId,
          remark: confirmResult.remark || '',
          path: relPathLabel,
          tool: 'edit_file',
        });
      }

      // Concurrency safety: verify file content didn't change while waiting for confirmation.
      if (!isCreateNewFile) {
        const onDisk = await fsp.readFile(target);
        if (isBinary(onDisk)) {
          throw new Error('Target appears to be a binary file; aborting edit.');
        }
        const onDiskRaw = onDisk.toString('utf8');
        if (hashContent(onDiskRaw) !== hashContent(currentContentRaw)) {
          throw new Error(
            `Aborted edit_file for ${relPathLabel}: file changed on disk since it was read.\n` +
              `Re-run read_file and then retry the edit.`
          );
        }
      } else {
        const existsNow = await safeStat(target);
        if (existsNow) {
          throw new Error(
            `Aborted create for ${relPathLabel}: file appeared during confirmation.\n` +
              `Re-run read_file and then retry, or use write_file to overwrite.`
          );
        }
      }

      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, nextContentToWriteRaw, 'utf8');

      const after = await readFileSnapshot(target);
      await logFileChange({
        relPath: relPathLabel,
        absolutePath: target,
        before,
        after,
        tool: 'edit_file',
        mode: isCreateNewFile ? 'create' : 'edit',
      });

      const remark = confirmResult?.remark ? `\nUser remark: ${confirmResult.remark}` : '';
      return structuredResponse(
        isCreateNewFile
          ? `✓ Created ${relativePath(target)} via edit_file.${remark}`
          : `✓ Edited ${relativePath(target)} via edit_file (${occurrences} replacement(s), ${strategy}).${remark}`,
        {
          status: 'ok',
          confirmed: Boolean(confirmResult?.status === 'ok'),
          remark: confirmResult?.remark || '',
          path: relPathLabel,
          tool: 'edit_file',
          mode: isCreateNewFile ? 'create' : 'edit',
          occurrences,
          strategy,
        }
      );
    }
  );

  server.registerTool(
    'delete_path',
    {
      title: 'Delete file or directory',
      description: ['Delete a file or directory (recursive).', note].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('Path relative to root'),
      }),
    },
    async ({ path: targetPath }) => {
      const target = await ensurePath(targetPath);
      const relPathLabel = relativePath(target);
      const before = await readFileSnapshot(target);
      const confirmResult = await confirmFileChangeIfNeeded?.({
        tool: 'delete_path',
        path: relPathLabel,
        mode: 'delete',
        before,
        afterContent: '',
      });
      if (confirmResult?.status === 'canceled') {
        return structuredResponse(`✗ Canceled delete_path ${relativePath(target)}.`, {
          status: 'canceled',
          request_id: confirmResult.requestId,
          remark: confirmResult.remark || '',
        });
      }
      await fsp.rm(target, { recursive: true, force: true });
      await logFileChange({
        relPath: relPathLabel,
        absolutePath: target,
        before,
        after: { exists: false, content: '' },
        tool: 'delete_path',
        mode: 'delete',
      });
      const remark = confirmResult?.remark ? `\nUser remark: ${confirmResult.remark}` : '';
      return structuredResponse(`✓ Deleted ${relativePath(target)}.${remark}`, {
        status: 'ok',
        confirmed: Boolean(confirmResult?.status === 'ok'),
        remark: confirmResult?.remark || '',
        path: relPathLabel,
        tool: 'delete_path',
        mode: 'delete',
      });
    }
  );

  server.registerTool(
    'apply_patch',
    {
      title: 'Apply patch',
      description: `${APPLY_PATCH_DESCRIPTION}\n\n${note}`,
      inputSchema: z.object({
        path: z.string().optional().describe('Working directory relative to root (default ".")'),
        patch: z.string().optional().describe('Patch text (unified diff or friendly patch format)'),
        patch_base64: z.string().optional().describe('Patch content (base64 encoded)'),
        chunks: z
          .array(
            z.object({
              content: z.string(),
              encoding: z.enum(['plain', 'base64']).optional(),
            })
          )
          .optional()
          .describe('Split patch into chunks if needed'),
        encoding: z.enum(['plain', 'base64']).optional().describe('Default plain'),
      }),
    },
    async (args) => {
      const rawPath = args.path || '.';

      // 解析工作目录
      let workDir = await ensurePath(rawPath);
      let workDirStats = await safeStat(workDir);

      // 如果路径不存在,创建目录
      if (!workDirStats) {
        const looksLikeFilePath = (input) => {
          const value = typeof input === 'string' ? input.trim() : '';
          if (!value) return false;
          if (value.endsWith('/') || value.endsWith('\\')) return false;
          const base = path.basename(value);
          if (!base || base === '.' || base === '..') return false;
          return base.includes('.');
        };
        const targetDir = looksLikeFilePath(rawPath) ? path.dirname(workDir) : workDir;
        await fsp.mkdir(targetDir, { recursive: true });
        workDir = targetDir;
        workDirStats = await safeStat(workDir);
      }

      // 如果是文件,使用其父目录
      if (workDirStats && workDirStats.isFile()) {
        workDir = path.dirname(workDir);
        workDirStats = await safeStat(workDir);
      }

      if (!workDirStats || !workDirStats.isDirectory()) {
        throw new Error(`Work dir ${rawPath} is not a valid directory; cannot apply patch.`);
      }

      const relWorkDir = relativePath(workDir);
      const rawPatchText = await resolvePatchPayload(args);
      const patchText = preprocessPatchText(rawPatchText);

      if (!patchText || !patchText.trim()) {
        throw new Error('Patch content is empty; nothing to apply.');
      }

      // 验证 patch 格式（friendly patch 使用不同语法）
      try {
        if (isFriendlyPatch(patchText)) {
          validateFriendlyPatchFormat(patchText);
        } else {
          validatePatchFormat(patchText);
        }
      } catch (err) {
        throw new Error(
          `Invalid patch format: ${err.message}\n\n` +
            `Tips:\n` +
            `- Ensure patch has proper headers (---, +++) or friendly file ops (*** Update File/Add File/Delete File)\n` +
            `- Include hunk markers (@@) for unified diff patches\n` +
            `- Use correct line prefixes (+, -, space for context)\n` +
            `- Verify file paths are relative to: ${relWorkDir}`
        );
      }

      const safeRootAbs = path.resolve(safeRoot);
      const patchForWorkDir = relWorkDir === '.' ? patchText : rewritePatchWorkingDir(patchText, relWorkDir);
      const pathsForRoot = listPatchFiles(patchText);
      const pathsForWorkDir = listPatchFiles(patchForWorkDir);

      const countExistingFiles = async (paths, baseDir) => {
        let hits = 0;
        if (!Array.isArray(paths) || paths.length === 0) return hits;
        for (const rel of paths) {
          if (!rel) continue;
          const abs = path.resolve(baseDir, rel);
          const relToRoot = path.relative(safeRootAbs, abs);
          if (relToRoot === '' || (!relToRoot.startsWith(`..${path.sep}`) && relToRoot !== '..' && !path.isAbsolute(relToRoot))) {
            const st = await safeStat(abs);
            if (st && st.isFile()) hits += 1;
          }
        }
        return hits;
      };

      // Choose apply dir by checking which interpretation matches more existing files.
      // (Also handles common mistake: path points to a subdir but patch paths are root-relative, or vice versa.)
      let applyDir = workDir;
      let normalizedPatch = patchForWorkDir;
      if (relWorkDir === '.') {
        applyDir = safeRootAbs;
        normalizedPatch = patchText;
      } else {
        const [rootHits, workHits] = await Promise.all([
          countExistingFiles(pathsForRoot, safeRootAbs),
          countExistingFiles(pathsForWorkDir, workDir),
        ]);

        if (rootHits > workHits && rootHits > 0) {
          applyDir = safeRootAbs;
          normalizedPatch = patchText;
        } else if (workHits > rootHits && workHits > 0) {
          applyDir = workDir;
          normalizedPatch = patchForWorkDir;
        } else {
          // Fallback: if patch mixes root-relative + workdir-prefixed files, apply from root.
          const hasWorkdirPrefix = pathsForRoot.some((p) => p.startsWith(`${relWorkDir}/`));
          const hasOutsideWorkdir = hasWorkdirPrefix && pathsForRoot.some((p) => !p.startsWith(`${relWorkDir}/`));
          if (hasOutsideWorkdir) {
            applyDir = safeRootAbs;
            normalizedPatch = patchText;
          }
        }
      }

      const relApplyDir = relativePath(applyDir);
      const affectedPaths = listPatchFiles(normalizedPatch);

      if (affectedPaths.length === 0) {
        throw new Error('No files found in patch. Check patch format.');
      }

      const beforeSnapshots = await snapshotFiles(affectedPaths, applyDir);

      const confirmResult = await confirmFileChangeIfNeeded?.({
        tool: 'apply_patch',
        path: affectedPaths.length === 1 ? affectedPaths[0] : `${affectedPaths.length} files`,
        mode: 'patch',
        diffOverride: normalizedPatch,
        messageOverride: `Apply patch in ${relApplyDir}/ (files: ${affectedPaths.join(', ')})`,
      });
      if (confirmResult?.status === 'canceled') {
        return structuredResponse(`✗ Canceled apply_patch in ${relativePath(applyDir)}/.`, {
          status: 'canceled',
          request_id: confirmResult.requestId,
          remark: confirmResult.remark || '',
          tool: 'apply_patch',
        });
      }

      // 确保目标目录存在
      await ensurePatchDirs(applyDir, normalizedPatch);

      logProgress?.(`Applying patch in ${relApplyDir}/ (${normalizedPatch.length} chars)...`);
      logProgress?.(`Affected files: ${affectedPaths.join(', ')}`);

      try {
        await applyPatch(applyDir, normalizedPatch);
        logProgress?.(`✓ Patch applied successfully in ${relApplyDir}/`);
      } catch (err) {
        // 提供详细的错误信息和建议
        const errorMsg = formatPatchError(err);
        const suggestions = [
          '\n\n🔧 Troubleshooting tips:',
          `1. Working directory: ${relApplyDir}/`,
          `2. Expected files: ${affectedPaths.join(', ')}`,
          '3. Verify patch file paths are relative to working directory',
          '4. Check that line numbers in @@ markers match current file state',
          '5. Ensure context lines (without +/-) match exactly',
          '6. For large changes, consider using write_file instead',
          '\n📝 Patch preview:',
          normalizedPatch.split('\n').slice(0, 20).join('\n'),
          normalizedPatch.split('\n').length > 20 ? '...(truncated)' : '',
        ].join('\n');

        throw new Error(`${errorMsg}${suggestions}`);
      }

      const afterSnapshots = await snapshotFiles(affectedPaths, applyDir);
      await logPatchChanges({
        affectedPaths,
        before: beforeSnapshots,
        after: afterSnapshots,
        patchText: normalizedPatch,
        workDir: applyDir,
      });

      const remark = confirmResult?.remark ? `\nUser remark: ${confirmResult.remark}` : '';
      return structuredResponse(
        `✓ Applied patch in ${relativePath(applyDir)}/\n` + `Modified files: ${affectedPaths.join(', ')}${remark}`,
        {
          status: 'ok',
          confirmed: Boolean(confirmResult?.status === 'ok'),
          remark: confirmResult?.remark || '',
          tool: 'apply_patch',
          files: affectedPaths,
        }
      );
    }
  );
}
