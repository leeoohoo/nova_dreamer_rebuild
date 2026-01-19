#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createFilesystemOps, resolveSessionRoot } from './filesystem/ops.js';
import { registerFilesystemTools } from './filesystem/register-tools.js';
import { resolveFileChangesPath } from '../shared/state-paths.js';

const fsp = fs.promises;

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const root = path.resolve(args.root || process.cwd());
const allowWrites = booleanFromArg(args.write) || /write/i.test(String(args.mode || ''));
const serverName = args.name || 'code_maintainer';
const maxFileBytes = clampNumber(args['max-bytes'], 1024, 1024 * 1024, 256 * 1024);
const searchLimit = clampNumber(args['max-search-results'], 1, 200, 40);
const workspaceNote = `Workspace root: ${root}. Paths must stay inside this directory; absolute or relative paths resolving outside will be rejected.`;

ensureDir(root, allowWrites);

const sessionRoot = resolveSessionRoot();
const fileChangeLogPath =
  process.env.MODEL_CLI_FILE_CHANGES || resolveFileChangesPath(sessionRoot);

const server = new McpServer({
  name: serverName,
  version: '0.1.0',
});

function logProgress(message) {
  console.error(`[${serverName}] ${message}`);
}

const fsOps = createFilesystemOps({
  root,
  serverName,
  fileChangeLogPath,
  logProgress,
});

registerFilesystemTools({
  server,
  z,
  workspaceNote,
  allowWrites,
  root,
  maxFileBytes,
  searchLimit,
  fsOps,
  logProgress,
});

registerCodeMaintenanceTools({
  server,
  z,
  fsOps,
  allowWrites,
  maxFileBytes,
  workspaceNote,
  logProgress,
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${serverName}] MCP code maintainer server ready (root=${root}, writes=${allowWrites ? 'on' : 'off'}).`);
}

main().catch((err) => {
  console.error(`[${serverName}] crashed:`, err);
  process.exit(1);
});

function registerCodeMaintenanceTools({
  server,
  z,
  fsOps,
  allowWrites,
  maxFileBytes,
  workspaceNote,
  logProgress,
} = {}) {
  if (!server) throw new Error('Missing MCP server');
  if (!z) throw new Error('Missing zod');
  if (!fsOps) throw new Error('Missing filesystem ops');

  const safeMaxFileBytes = clampNumber(maxFileBytes, 1024, 1024 * 1024, 256 * 1024);
  const note = typeof workspaceNote === 'string' ? workspaceNote : '';

  const { ensurePath, relativePath, logFileChange } = fsOps;

  server.registerTool(
    'read_file_raw',
    {
      title: 'Read file (raw)',
      description: ['Return UTF-8 file content without line numbers.', note].join('\n'),
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
      const rel = relativePath(target);
      const sha256 = hashContent(content);
      return structuredResponse(content, {
        path: rel,
        sha256,
        size_bytes: stats.size,
      });
    }
  );

  server.registerTool(
    'read_file_range',
    {
      title: 'Read file (line range)',
      description: [
        'Return UTF-8 content from start_line to end_line (1-based, inclusive).',
        `File size is limited by --max-bytes (${formatBytes(safeMaxFileBytes)} by default).`,
        note,
      ].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('File path relative to root'),
        start_line: z.number().int().min(1).describe('Start line (1-based, inclusive)'),
        end_line: z.number().int().min(1).describe('End line (1-based, inclusive)'),
        with_line_numbers: z.boolean().optional().describe('Prefix each line with its line number'),
      }),
    },
    async ({ path: filePath, start_line: startLine, end_line: endLine, with_line_numbers: withLineNumbers }) => {
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
      const totalLines = lines.length;
      const start = clampNumber(startLine, 1, totalLines, 1);
      const end = clampNumber(endLine, 1, totalLines, totalLines);
      if (start > end) {
        throw new Error(`Invalid range: start_line (${start}) must be <= end_line (${end}).`);
      }
      const extracted = lines.slice(start - 1, end);
      const rendered = withLineNumbers
        ? extracted.map((line, idx) => `${(start + idx).toString().padStart(6, ' ')} | ${line}`).join('\n')
        : extracted.join('\n');
      const rel = relativePath(target);
      const header = `# ${rel} (lines ${start}-${end} of ${totalLines})`;
      return structuredResponse(`${header}\n\n${rendered}`, {
        path: rel,
        start_line: start,
        end_line: end,
        total_lines: totalLines,
      });
    }
  );

  server.registerTool(
    'stat_path',
    {
      title: 'Stat path',
      description: ['Return basic info for a file/directory under the workspace root.', note].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('Path relative to root'),
      }),
    },
    async ({ path: targetPath }) => {
      const target = await ensurePath(targetPath);
      const stats = await safeStat(target);
      const rel = relativePath(target);
      if (!stats) {
        return structuredResponse(`✗ Not found: ${rel}`, { exists: false, path: rel });
      }

      const isFile = stats.isFile();
      const isDir = stats.isDirectory();
      const type = isFile ? 'file' : isDir ? 'directory' : 'other';
      const payload = {
        exists: true,
        path: rel,
        type,
        size_bytes: stats.size,
        mtime: stats.mtime?.toISOString?.() || null,
      };

      if (isFile && stats.size <= safeMaxFileBytes) {
        try {
          const content = await fsp.readFile(target, { encoding: 'utf8' });
          payload.sha256 = hashContent(content);
        } catch {
          // ignore hashing errors
        }
      }

      const summary = `✓ ${rel} (${type}${isFile ? `, ${formatBytes(stats.size)}` : ''})`;
      return structuredResponse(summary, payload);
    }
  );

  if (!allowWrites) {
    return;
  }

  server.registerTool(
    'move_path',
    {
      title: 'Move/rename path',
      description: ['Move or rename a file/directory within the workspace root.', note].join('\n'),
      inputSchema: z.object({
        from: z.string().describe('Source path relative to root'),
        to: z.string().describe('Destination path relative to root'),
        overwrite: z.boolean().optional().describe('Overwrite destination if it exists (default false)'),
      }),
    },
    async ({ from, to, overwrite }) => {
      const overwriteDest = Boolean(overwrite);
      const fromAbs = await ensurePath(from);
      const toAbs = await ensurePath(to);
      const fromRel = relativePath(fromAbs);
      const toRel = relativePath(toAbs);

      const fromStats = await safeStat(fromAbs);
      if (!fromStats) {
        throw new Error(`Source not found: ${fromRel}`);
      }

      const toStats = await safeStat(toAbs);
      if (toStats && !overwriteDest) {
        throw new Error(`Destination already exists: ${toRel} (set overwrite=true to replace)`);
      }

      if (toStats && overwriteDest) {
        await fsp.rm(toAbs, { recursive: true, force: true });
      }

      await fsp.mkdir(path.dirname(toAbs), { recursive: true });

      try {
        await fsp.rename(fromAbs, toAbs);
      } catch (err) {
        if (err && err.code === 'EXDEV') {
          await fsp.cp(fromAbs, toAbs, { recursive: true, force: overwriteDest });
          await fsp.rm(fromAbs, { recursive: true, force: true });
        } else {
          throw err;
        }
      }

      const patchText = `*** Begin Patch\n*** Update File: ${fromRel}\n*** Move to: ${toRel}\n*** End Patch\n`;
      await logFileChange?.({
        relPath: fromRel,
        absolutePath: fromAbs,
        before: { exists: true, content: '' },
        after: { exists: false, content: '' },
        tool: 'move_path',
        mode: overwriteDest ? 'move_overwrite' : 'move',
        patchText,
      });
      await logFileChange?.({
        relPath: toRel,
        absolutePath: toAbs,
        before: { exists: false, content: '' },
        after: { exists: true, content: '' },
        tool: 'move_path',
        mode: overwriteDest ? 'move_overwrite' : 'move',
        patchText,
      });

      logProgress?.(`Moved ${fromRel} -> ${toRel}`);
      return structuredResponse(`✓ Moved ${fromRel} -> ${toRel}`, {
        status: 'ok',
        from: fromRel,
        to: toRel,
        overwrite: overwriteDest,
      });
    }
  );

  server.registerTool(
    'copy_path',
    {
      title: 'Copy path',
      description: ['Copy a file/directory within the workspace root.', note].join('\n'),
      inputSchema: z.object({
        from: z.string().describe('Source path relative to root'),
        to: z.string().describe('Destination path relative to root'),
        overwrite: z.boolean().optional().describe('Overwrite destination if it exists (default false)'),
      }),
    },
    async ({ from, to, overwrite }) => {
      const overwriteDest = Boolean(overwrite);
      const fromAbs = await ensurePath(from);
      const toAbs = await ensurePath(to);
      const fromRel = relativePath(fromAbs);
      const toRel = relativePath(toAbs);

      const fromStats = await safeStat(fromAbs);
      if (!fromStats) {
        throw new Error(`Source not found: ${fromRel}`);
      }

      const toStats = await safeStat(toAbs);
      if (toStats && !overwriteDest) {
        throw new Error(`Destination already exists: ${toRel} (set overwrite=true to replace)`);
      }

      await fsp.mkdir(path.dirname(toAbs), { recursive: true });
      await fsp.cp(fromAbs, toAbs, { recursive: true, force: overwriteDest });

      const patchText = `*** Begin Patch\n*** Add File: ${toRel}\n+<copied from ${fromRel}>\n*** End Patch\n`;
      await logFileChange?.({
        relPath: toRel,
        absolutePath: toAbs,
        before: { exists: Boolean(toStats), content: '' },
        after: { exists: true, content: '' },
        tool: 'copy_path',
        mode: overwriteDest ? 'copy_overwrite' : 'copy',
        patchText,
      });

      logProgress?.(`Copied ${fromRel} -> ${toRel}`);
      return structuredResponse(`✓ Copied ${fromRel} -> ${toRel}`, {
        status: 'ok',
        from: fromRel,
        to: toRel,
        overwrite: overwriteDest,
      });
    }
  );
}

function safeStat(target) {
  return fsp
    .stat(target)
    .catch((err) => {
      if (err && err.code === 'ENOENT') return null;
      throw err;
    });
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
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
    ...textResponse(text),
    structuredContent: structuredContent && typeof structuredContent === 'object' ? structuredContent : undefined,
  };
}

function parseArgs(input) {
  const result = { _: [] };
  for (let i = 0; i < input.length; i += 1) {
    const token = input[i];
    if (!token.startsWith('-')) {
      result._.push(token);
      continue;
    }
    const isLong = token.startsWith('--');
    const key = isLong ? token.slice(2) : token.slice(1);
    if (!key) continue;
    const [name, inline] = key.split('=');
    if (inline !== undefined) {
      result[name] = inline;
      continue;
    }
    const next = input[i + 1];
    if (next && !next.startsWith('-')) {
      result[name] = next;
      i += 1;
    } else {
      result[name] = true;
    }
  }
  return result;
}

function booleanFromArg(value) {
  if (value === true) return true;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  if (text === '1' || text === 'true' || text === 'yes' || text === 'y') return true;
  return false;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.min(Math.max(parsed, min), max);
  }
  return fallback;
}

function ensureDir(targetDir, writable) {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch {
    // ignore
  }
  try {
    fs.accessSync(targetDir, fs.constants.R_OK);
    if (writable) {
      fs.accessSync(targetDir, fs.constants.W_OK);
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      fs.mkdirSync(targetDir, { recursive: true });
      return;
    }
    throw err;
  }
}

function printHelp() {
  console.log(
    [
      'Usage: node code-maintainer-server.js [--root <path>] [--write] [--name <id>] [--max-bytes <n>]',
      '',
      'Options:',
      '  --root <path>            MCP root (default current directory)',
      '  --write                  Enable write/delete tools',
      '  --mode <read|write>      Compatibility flag; write == --write',
      '  --name <id>              MCP server name (for logging)',
      '  --max-bytes <n>          Max bytes to read per file (default 256KB)',
      '  --max-search-results <n> Max search hits to return (default 40)',
      '  --help                   Show help',
    ].join('\n')
  );
}
