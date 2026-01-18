#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createFilesystemOps, resolveSessionRoot } from './filesystem/ops.js';
import { resolveAppStateDir, STATE_ROOT_DIRNAME } from '../shared/state-paths.js';

const fsp = fs.promises;

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const root = path.resolve(args.root || process.cwd());
const allowWrites = booleanFromArg(args.write) || /write/i.test(String(args.mode || ''));
const serverName = args.name || 'lsp_bridge';
const configPathRaw = typeof args.config === 'string' ? args.config : '';
const maxFileBytes = clampNumber(args['max-bytes'], 1024, 5 * 1024 * 1024, 512 * 1024);
const requestTimeoutMs = clampNumber(args['timeout-ms'], 1000, 5 * 60 * 1000, 30 * 1000);

ensureDir(root);

const sessionRoot = resolveSessionRoot();
const fileChangeLogPath =
  process.env.MODEL_CLI_FILE_CHANGES || path.join(resolveAppStateDir(sessionRoot), 'file-changes.jsonl');

const workspaceNote = `Workspace root: ${root}. Paths must stay inside this directory; absolute or relative paths resolving outside will be rejected.`;

const fsOps = createFilesystemOps({
  root,
  serverName,
  fileChangeLogPath,
  logProgress: (msg) => console.error(`[${serverName}] ${msg}`),
});

const lspConfig = loadLspConfig({ root, configPathRaw });

const server = new McpServer({
  name: serverName,
  version: '0.1.0',
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[${serverName}] MCP LSP bridge server ready (root=${root}, servers=${Object.keys(lspConfig?.servers || {}).length}, writes=${
      allowWrites ? 'on' : 'off'
    }).`
  );
}

function registerTools() {
  server.registerTool(
    'list_lsp_servers',
    {
      title: 'List LSP servers',
      description: [
        'List configured language servers (commands + file extension mapping).',
        'Note: To "support" a language, the corresponding language server must be installed on your machine and discoverable in PATH (or configured with an absolute command path).',
        workspaceNote,
      ].join('\n'),
      inputSchema: z.object({}),
    },
    async () => {
      const servers = lspManager.listServers();
      return structuredResponse(formatServerList(servers), {
        status: 'ok',
        servers,
      });
    }
  );

  server.registerTool(
    'start_lsp_server',
    {
      title: 'Start LSP server',
      description: ['Start a configured language server process and perform LSP initialize handshake.', workspaceNote].join('\n'),
      inputSchema: z.object({
        server_id: z.string().min(1).describe('Server id from list_lsp_servers'),
      }),
    },
    async ({ server_id: serverId }) => {
      const result = await lspManager.start(serverId);
      return structuredResponse(result.message, result);
    }
  );

  server.registerTool(
    'stop_lsp_server',
    {
      title: 'Stop LSP server',
      description: ['Shutdown + exit a running language server process.', workspaceNote].join('\n'),
      inputSchema: z.object({
        server_id: z.string().min(1).describe('Server id from list_lsp_servers'),
        force: z.boolean().optional().describe('Force kill if graceful shutdown fails'),
      }),
    },
    async ({ server_id: serverId, force }) => {
      const result = await lspManager.stop(serverId, { force: Boolean(force) });
      return structuredResponse(result.message, result);
    }
  );

  server.registerTool(
    'lsp_hover',
    {
      title: 'LSP hover',
      description: [
        'Get hover info at a 1-based (line, character) position.',
        'If server_id is omitted, we auto-pick by file extension from config.',
        workspaceNote,
      ].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('File path relative to root'),
        line: z.number().int().min(1).describe('Line (1-based)'),
        character: z.number().int().min(1).describe('Character (1-based, UTF-16 code unit)'),
        server_id: z.string().optional().describe('Optional server id override'),
      }),
    },
    async (input) => {
      const result = await lspManager.hover(input);
      return structuredResponse(renderJson(result.result), result);
    }
  );

  server.registerTool(
    'lsp_definition',
    {
      title: 'LSP definition',
      description: [
        'Go to definition at a 1-based (line, character) position.',
        'If server_id is omitted, we auto-pick by file extension from config.',
        workspaceNote,
      ].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('File path relative to root'),
        line: z.number().int().min(1).describe('Line (1-based)'),
        character: z.number().int().min(1).describe('Character (1-based, UTF-16 code unit)'),
        server_id: z.string().optional().describe('Optional server id override'),
      }),
    },
    async (input) => {
      const result = await lspManager.definition(input);
      return structuredResponse(renderJson(result.result), result);
    }
  );

  server.registerTool(
    'lsp_references',
    {
      title: 'LSP references',
      description: [
        'Find references at a 1-based (line, character) position.',
        'If server_id is omitted, we auto-pick by file extension from config.',
        workspaceNote,
      ].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('File path relative to root'),
        line: z.number().int().min(1).describe('Line (1-based)'),
        character: z.number().int().min(1).describe('Character (1-based, UTF-16 code unit)'),
        include_declaration: z.boolean().optional().describe('Include the declaration (default true)'),
        server_id: z.string().optional().describe('Optional server id override'),
      }),
    },
    async (input) => {
      const result = await lspManager.references(input);
      return structuredResponse(renderJson(result.result), result);
    }
  );

  server.registerTool(
    'lsp_completion',
    {
      title: 'LSP completion',
      description: [
        'Get completion at a 1-based (line, character) position.',
        'If server_id is omitted, we auto-pick by file extension from config.',
        workspaceNote,
      ].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('File path relative to root'),
        line: z.number().int().min(1).describe('Line (1-based)'),
        character: z.number().int().min(1).describe('Character (1-based, UTF-16 code unit)'),
        server_id: z.string().optional().describe('Optional server id override'),
      }),
    },
    async (input) => {
      const result = await lspManager.completion(input);
      return structuredResponse(renderJson(result.result), result);
    }
  );

  server.registerTool(
    'lsp_document_symbols',
    {
      title: 'LSP document symbols',
      description: [
        'List symbols for a document.',
        'If server_id is omitted, we auto-pick by file extension from config.',
        workspaceNote,
      ].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('File path relative to root'),
        server_id: z.string().optional().describe('Optional server id override'),
      }),
    },
    async (input) => {
      const result = await lspManager.documentSymbols(input);
      return structuredResponse(renderJson(result.result), result);
    }
  );

  server.registerTool(
    'lsp_workspace_symbols',
    {
      title: 'LSP workspace symbols',
      description: ['Search workspace symbols by query.', workspaceNote].join('\n'),
      inputSchema: z.object({
        query: z.string().describe('Search query'),
        server_id: z.string().min(1).describe('Server id (workspace symbol needs a running server)'),
      }),
    },
    async (input) => {
      const result = await lspManager.workspaceSymbols(input);
      return structuredResponse(renderJson(result.result), result);
    }
  );

  server.registerTool(
    'lsp_format_document',
    {
      title: 'LSP format document',
      description: [
        'Request document formatting edits.',
        'If apply=true, edits are applied to disk (requires --write).',
        workspaceNote,
      ].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('File path relative to root'),
        server_id: z.string().optional().describe('Optional server id override'),
        tab_size: z.number().int().min(1).max(16).optional().describe('Formatting option tabSize (default 2)'),
        insert_spaces: z.boolean().optional().describe('Formatting option insertSpaces (default true)'),
        apply: z.boolean().optional().describe('Apply edits to disk (default false)'),
      }),
    },
    async (input) => {
      const result = await lspManager.formatDocument(input);
      return structuredResponse(renderJson(result.result), result);
    }
  );

  server.registerTool(
    'lsp_rename',
    {
      title: 'LSP rename',
      description: [
        'Request a rename WorkspaceEdit.',
        'If apply=true, edits are applied to disk (requires --write).',
        workspaceNote,
      ].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('File path relative to root'),
        line: z.number().int().min(1).describe('Line (1-based)'),
        character: z.number().int().min(1).describe('Character (1-based, UTF-16 code unit)'),
        new_name: z.string().min(1).describe('New name'),
        server_id: z.string().optional().describe('Optional server id override'),
        apply: z.boolean().optional().describe('Apply edits to disk (default false)'),
      }),
    },
    async (input) => {
      const result = await lspManager.rename(input);
      return structuredResponse(renderJson(result.result), result);
    }
  );

  server.registerTool(
    'lsp_get_diagnostics',
    {
      title: 'Get last diagnostics',
      description: [
        'Return the latest diagnostics published by the language server for this file (if any).',
        'Diagnostics are updated via the LSP notification textDocument/publishDiagnostics.',
        workspaceNote,
      ].join('\n'),
      inputSchema: z.object({
        path: z.string().describe('File path relative to root'),
        server_id: z.string().optional().describe('Optional server id override'),
      }),
    },
    async (input) => {
      const result = await lspManager.getDiagnostics(input);
      return structuredResponse(renderJson(result.result), result);
    }
  );
}

class LspManager {
  constructor({ root, sessionRoot, serverName, fsOps, config, allowWrites, maxFileBytes, defaultTimeoutMs }) {
    this.root = root;
    this.sessionRoot = typeof sessionRoot === 'string' && sessionRoot.trim() ? sessionRoot.trim() : resolveSessionRoot();
    this.serverName = serverName;
    this.fsOps = fsOps;
    this.config = config || { servers: {} };
    this.allowWrites = Boolean(allowWrites);
    this.maxFileBytes = clampNumber(maxFileBytes, 1024, 5 * 1024 * 1024, 512 * 1024);
    this.defaultTimeoutMs = clampNumber(defaultTimeoutMs, 1000, 5 * 60 * 1000, 30 * 1000);
    this.clients = new Map();
  }

  listServers() {
    const servers = this.config?.servers || {};
    return Object.entries(servers).map(([id, value]) => ({
      id,
      command: String(value?.command || ''),
      args: Array.isArray(value?.args) ? value.args.map(String) : [],
      file_extensions: Array.isArray(value?.fileExtensions) ? value.fileExtensions.map(String) : [],
      languages: Array.isArray(value?.languages) ? value.languages.map(String) : [],
      initialization_options: value?.initializationOptions && typeof value.initializationOptions === 'object' ? value.initializationOptions : undefined,
    }));
  }

  resolveServerIdForPath(filePathRel, overrideId) {
    if (typeof overrideId === 'string' && overrideId.trim()) return overrideId.trim();
    const servers = this.config?.servers || {};
    const fileName = path.basename(String(filePathRel || ''));
    const ext = path.extname(fileName).toLowerCase();
    const matches = [];
    for (const [id, s] of Object.entries(servers)) {
      const exts = Array.isArray(s?.fileExtensions) ? s.fileExtensions.map((x) => String(x || '')) : [];
      if (exts.some((x) => x === fileName)) {
        matches.push(id);
        continue;
      }
      if (!ext) continue;
      if (exts.some((x) => String(x || '').toLowerCase() === ext)) {
        matches.push(id);
      }
    }
    if (matches.length > 0) return matches[0];
    return '';
  }

  getServerConfig(serverId) {
    const id = String(serverId || '').trim();
    const servers = this.config?.servers || {};
    const entry = servers[id];
    if (!entry) {
      throw new Error(`Unknown server_id "${id}". Use list_lsp_servers first.`);
    }
    const templateContext = {
      workspaceRoot: this.root,
      sessionRoot: this.sessionRoot,
      stateDir: resolveAppStateDir(this.sessionRoot),
      serverId: id,
    };
    const command = expandTemplate(String(entry?.command || '').trim(), templateContext);
    if (!command) {
      throw new Error(`Invalid config for "${id}": missing command.`);
    }
    const args = Array.isArray(entry?.args) ? entry.args.map((arg) => expandTemplate(String(arg), templateContext)) : [];
    const env = entry?.env && typeof entry.env === 'object' ? entry.env : null;
    const initializationOptions =
      entry?.initializationOptions && typeof entry.initializationOptions === 'object' ? entry.initializationOptions : null;
    return { id, command, args, env, initializationOptions };
  }

  async start(serverId) {
    const cfg = this.getServerConfig(serverId);
    let client = this.clients.get(cfg.id);
    if (client && client.isRunning()) {
      return { status: 'ok', server_id: cfg.id, running: true, message: `✓ ${cfg.id} already running.` };
    }
    client = new LspClient({
      id: cfg.id,
      command: cfg.command,
      args: cfg.args,
      cwd: this.root,
      env: cfg.env,
      initializationOptions: cfg.initializationOptions,
      rootUri: toFileUri(this.root),
      workspaceName: path.basename(this.root),
      serverName: this.serverName,
      fsOps: this.fsOps,
      allowWrites: this.allowWrites,
      maxFileBytes: this.maxFileBytes,
      defaultTimeoutMs: this.defaultTimeoutMs,
    });
    await client.start();
    this.clients.set(cfg.id, client);
    return { status: 'ok', server_id: cfg.id, running: true, message: `✓ Started ${cfg.id}.` };
  }

  async stop(serverId, { force } = {}) {
    const id = String(serverId || '').trim();
    const client = this.clients.get(id);
    if (!client) {
      return { status: 'ok', server_id: id, running: false, message: `✓ ${id} not running.` };
    }
    await client.stop({ force: Boolean(force) });
    this.clients.delete(id);
    return { status: 'ok', server_id: id, running: false, message: `✓ Stopped ${id}.` };
  }

  async ensureClientForPath(filePathRel, overrideId) {
    const serverId = this.resolveServerIdForPath(filePathRel, overrideId);
    if (!serverId) {
      throw new Error(
        `No language server configured for "${filePathRel}".\n` +
          `- Add a mapping in lsp-servers config (by fileExtensions)\n` +
          `- Or pass server_id explicitly\n` +
          `- Then run start_lsp_server`
      );
    }
    await this.start(serverId);
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Failed to start language server: ${serverId}`);
    }
    return { serverId, client };
  }

  async hover({ path: filePath, line, character, server_id: serverIdOverride }) {
    const { serverId, client } = await this.ensureClientForPath(filePath, serverIdOverride);
    const doc = await client.syncDocument({ path: filePath });
    const position = toLspPosition({ line, character });
    const result = await client.request('textDocument/hover', {
      textDocument: { uri: doc.uri },
      position,
    });
    return { status: 'ok', tool: 'lsp_hover', server_id: serverId, document: doc, position: { line, character }, result };
  }

  async definition({ path: filePath, line, character, server_id: serverIdOverride }) {
    const { serverId, client } = await this.ensureClientForPath(filePath, serverIdOverride);
    const doc = await client.syncDocument({ path: filePath });
    const position = toLspPosition({ line, character });
    const result = await client.request('textDocument/definition', {
      textDocument: { uri: doc.uri },
      position,
    });
    return { status: 'ok', tool: 'lsp_definition', server_id: serverId, document: doc, position: { line, character }, result };
  }

  async references({ path: filePath, line, character, include_declaration, server_id: serverIdOverride }) {
    const { serverId, client } = await this.ensureClientForPath(filePath, serverIdOverride);
    const doc = await client.syncDocument({ path: filePath });
    const position = toLspPosition({ line, character });
    const result = await client.request('textDocument/references', {
      textDocument: { uri: doc.uri },
      position,
      context: { includeDeclaration: include_declaration !== false },
    });
    return { status: 'ok', tool: 'lsp_references', server_id: serverId, document: doc, position: { line, character }, result };
  }

  async completion({ path: filePath, line, character, server_id: serverIdOverride }) {
    const { serverId, client } = await this.ensureClientForPath(filePath, serverIdOverride);
    const doc = await client.syncDocument({ path: filePath });
    const position = toLspPosition({ line, character });
    const result = await client.request('textDocument/completion', {
      textDocument: { uri: doc.uri },
      position,
    });
    return { status: 'ok', tool: 'lsp_completion', server_id: serverId, document: doc, position: { line, character }, result };
  }

  async documentSymbols({ path: filePath, server_id: serverIdOverride }) {
    const { serverId, client } = await this.ensureClientForPath(filePath, serverIdOverride);
    const doc = await client.syncDocument({ path: filePath });
    const result = await client.request('textDocument/documentSymbol', {
      textDocument: { uri: doc.uri },
    });
    return { status: 'ok', tool: 'lsp_document_symbols', server_id: serverId, document: doc, result };
  }

  async workspaceSymbols({ query, server_id: serverId }) {
    await this.start(serverId);
    const client = this.clients.get(serverId);
    if (!client) throw new Error(`Failed to start language server: ${serverId}`);
    const result = await client.request('workspace/symbol', { query: String(query || '') });
    return { status: 'ok', tool: 'lsp_workspace_symbols', server_id: serverId, query: String(query || ''), result };
  }

  async formatDocument({ path: filePath, server_id: serverIdOverride, tab_size, insert_spaces, apply }) {
    const { serverId, client } = await this.ensureClientForPath(filePath, serverIdOverride);
    const doc = await client.syncDocument({ path: filePath });
    const options = {
      tabSize: clampNumber(tab_size, 1, 16, 2),
      insertSpaces: insert_spaces !== false,
    };
    const edits = await client.request('textDocument/formatting', {
      textDocument: { uri: doc.uri },
      options,
    });

    let applied = null;
    if (apply) {
      applied = await client.applyTextEditsToDisk({ uri: doc.uri, edits });
    }

    return {
      status: 'ok',
      tool: 'lsp_format_document',
      server_id: serverId,
      document: doc,
      options,
      result: { edits, applied },
    };
  }

  async rename({ path: filePath, line, character, new_name, server_id: serverIdOverride, apply }) {
    const { serverId, client } = await this.ensureClientForPath(filePath, serverIdOverride);
    const doc = await client.syncDocument({ path: filePath });
    const position = toLspPosition({ line, character });
    const edit = await client.request('textDocument/rename', {
      textDocument: { uri: doc.uri },
      position,
      newName: String(new_name || ''),
    });

    let applied = null;
    if (apply) {
      applied = await client.applyWorkspaceEditToDisk(edit);
    }

    return {
      status: 'ok',
      tool: 'lsp_rename',
      server_id: serverId,
      document: doc,
      position: { line, character },
      result: { edit, applied },
    };
  }

  async getDiagnostics({ path: filePath, server_id: serverIdOverride }) {
    const { serverId, client } = await this.ensureClientForPath(filePath, serverIdOverride);
    const doc = await client.syncDocument({ path: filePath });
    const diagnostics = client.getDiagnostics(doc.uri);
    return { status: 'ok', tool: 'lsp_get_diagnostics', server_id: serverId, document: doc, result: diagnostics || [] };
  }
}

class LspClient {
  constructor({
    id,
    command,
    args,
    cwd,
    env,
    initializationOptions,
    rootUri,
    workspaceName,
    serverName,
    fsOps,
    allowWrites,
    maxFileBytes,
    defaultTimeoutMs,
  }) {
    this.id = id;
    this.command = command;
    this.args = Array.isArray(args) ? args : [];
    this.cwd = cwd;
    this.env = env && typeof env === 'object' ? env : null;
    this.initializationOptions = initializationOptions && typeof initializationOptions === 'object' ? initializationOptions : null;
    this.rootUri = rootUri;
    this.workspaceName = workspaceName || 'workspace';
    this.serverName = serverName || 'lsp_bridge';
    this.fsOps = fsOps;
    this.writesEnabled = Boolean(allowWrites);
    this.maxFileBytes = clampNumber(maxFileBytes, 1024, 5 * 1024 * 1024, 512 * 1024);
    this.defaultTimeoutMs = clampNumber(defaultTimeoutMs, 1000, 5 * 60 * 1000, 30 * 1000);

    this.proc = null;
    this.buffer = Buffer.alloc(0);
    this.nextRequestId = 1;
    this.pending = new Map();
    this.initialized = false;
    this.documentState = new Map(); // uri -> { version, sha256, absPath, languageId }
    this.diagnosticsByUri = new Map();
  }

  isRunning() {
    return Boolean(this.proc && !this.proc.killed);
  }

  async start() {
    if (this.proc) {
      throw new Error(`LSP client already started: ${this.id}`);
    }
    const env = { ...process.env, ...(this.env || {}) };
    this.proc = spawn(this.command, this.args, {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.on('data', (chunk) => this.onStdout(chunk));
    this.proc.stderr.on('data', (chunk) => this.onStderr(chunk));
    this.proc.on('exit', (code, signal) => this.onExit(code, signal));
    this.proc.on('error', (err) => this.onError(err));

    await this.initialize();
  }

  async stop({ force } = {}) {
    const proc = this.proc;
    if (!proc) return;
    try {
      if (this.initialized) {
        await this.request('shutdown', null, { timeoutMs: 5000 }).catch(() => {});
        this.notify('exit', null);
      }
    } catch {
      // ignore
    }

    await waitForExit(proc, 1500).catch(() => {});
    if (!proc.killed) {
      if (force) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
      } else {
        try {
          proc.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
    }
    this.proc = null;
    this.initialized = false;
    this.documentState.clear();
    this.diagnosticsByUri.clear();
    this.rejectAllPending(new Error(`LSP server stopped: ${this.id}`));
  }

  onStdout(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    while (true) {
      const headerEnd = findHeaderEnd(this.buffer);
      if (headerEnd < 0) break;
      const headerText = this.buffer.slice(0, headerEnd).toString('ascii');
      const contentLength = parseContentLength(headerText);
      if (!Number.isFinite(contentLength) || contentLength < 0) {
        this.buffer = this.buffer.slice(headerEnd + headerDelimiterLength(this.buffer, headerEnd));
        continue;
      }
      const bodyStart = headerEnd + headerDelimiterLength(this.buffer, headerEnd);
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.length < bodyEnd) break;
      const body = this.buffer.slice(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.slice(bodyEnd);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      this.handleMessage(message).catch(() => {});
    }
  }

  onStderr(chunk) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    const trimmed = text.trim();
    if (trimmed) {
      console.error(`[${this.serverName}:${this.id}] ${trimmed}`);
    }
  }

  onExit(code, signal) {
    const err = new Error(`LSP server exited: ${this.id} (code=${code ?? 'n/a'}, signal=${signal ?? 'n/a'})`);
    this.rejectAllPending(err);
  }

  onError(err) {
    const e = err instanceof Error ? err : new Error(String(err || 'LSP process error'));
    this.rejectAllPending(e);
  }

  rejectAllPending(err) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(err);
    }
    this.pending.clear();
  }

  async initialize() {
    const capabilities = buildClientCapabilities();
    const params = {
      processId: process.pid,
      clientInfo: { name: this.serverName, version: '0.1.0' },
      rootUri: this.rootUri,
      workspaceFolders: [{ uri: this.rootUri, name: this.workspaceName }],
      capabilities,
      initializationOptions: this.initializationOptions || undefined,
    };
    await this.request('initialize', params, { timeoutMs: this.defaultTimeoutMs });
    this.notify('initialized', {});
    this.initialized = true;
  }

  send(message) {
    const proc = this.proc;
    if (!proc || !proc.stdin || proc.stdin.destroyed) {
      throw new Error(`LSP stdin not available: ${this.id}`);
    }
    const json = JSON.stringify(message);
    const bytes = Buffer.byteLength(json, 'utf8');
    const payload = `Content-Length: ${bytes}\r\n\r\n${json}`;
    proc.stdin.write(payload, 'utf8');
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params: params === undefined ? null : params });
  }

  request(method, params, { timeoutMs } = {}) {
    const id = this.nextRequestId++;
    const msg = { jsonrpc: '2.0', id, method, params: params === undefined ? null : params };
    const ms = clampNumber(timeoutMs, 100, 5 * 60 * 1000, this.defaultTimeoutMs);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timeout: ${method} (${ms}ms)`));
      }, ms);
      this.pending.set(id, { resolve, reject, timeout, method });
      try {
        this.send(msg);
      } catch (err) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  async handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
    const hasMethod = typeof message.method === 'string' && message.method;

    if (hasId && hasMethod) {
      const id = message.id;
      const method = message.method;
      try {
        const result = await this.handleServerRequest(method, message.params);
        this.send({ jsonrpc: '2.0', id, result: result === undefined ? null : result });
      } catch (err) {
        this.send({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: err?.message || String(err || 'Internal error') },
        });
      }
      return;
    }

    if (hasId && !hasMethod) {
      const id = message.id;
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      if (message.error) {
        pending.reject(new Error(message.error.message || 'LSP error'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!hasId && hasMethod) {
      this.handleServerNotification(message.method, message.params);
    }
  }

  async handleServerRequest(method, params) {
    if (method === 'workspace/configuration') {
      const items = Array.isArray(params?.items) ? params.items : [];
      return items.map(() => ({}));
    }
    if (method === 'workspace/workspaceFolders') {
      return [{ uri: this.rootUri, name: this.workspaceName }];
    }
    if (method === 'client/registerCapability' || method === 'client/unregisterCapability') {
      return null;
    }
    if (method === 'window/workDoneProgress/create') {
      return null;
    }
    if (method === 'window/showMessageRequest') {
      return null;
    }
    return null;
  }

  handleServerNotification(method, params) {
    if (method === 'textDocument/publishDiagnostics') {
      const uri = typeof params?.uri === 'string' ? params.uri : '';
      const diagnostics = Array.isArray(params?.diagnostics) ? params.diagnostics : [];
      if (uri) {
        this.diagnosticsByUri.set(uri, diagnostics);
      }
      return;
    }
    // ignore: window/logMessage, $/progress, telemetry/event, etc.
  }

  getDiagnostics(uri) {
    return this.diagnosticsByUri.get(uri) || null;
  }

  async syncDocument({ path: filePathRel }) {
    if (!this.initialized) {
      throw new Error(`LSP client not initialized: ${this.id}`);
    }
    const absPath = await this.fsOps.ensurePath(filePathRel);
    const stats = await safeStat(absPath);
    if (!stats || !stats.isFile()) {
      throw new Error(`File not found: ${this.fsOps.relativePath(absPath)}`);
    }
    if (stats.size > this.maxFileBytes) {
      throw new Error(`File too large (${formatBytes(stats.size)}), exceeds limit ${formatBytes(this.maxFileBytes)}.`);
    }
    const rawContent = await fsp.readFile(absPath, { encoding: 'utf8' });
    const lineEnding = rawContent.includes('\r\n') ? '\r\n' : '\n';
    const content = lineEnding === '\r\n' ? rawContent.replace(/\r\n/g, '\n') : rawContent;
    const uri = toFileUri(absPath);
    const sha256 = hashContent(content);
    const existing = this.documentState.get(uri);
    const languageId = guessLanguageId(absPath);
    if (!existing) {
      const version = 1;
      this.documentState.set(uri, { version, sha256, absPath, languageId, lineEnding });
      this.notify('textDocument/didOpen', {
        textDocument: { uri, languageId, version, text: content },
      });
      return { uri, path: this.fsOps.relativePath(absPath), version, sha256, language_id: languageId };
    }
    if (existing.sha256 !== sha256) {
      const version = clampNumber(existing.version + 1, 1, Number.MAX_SAFE_INTEGER, existing.version + 1);
      this.documentState.set(uri, { ...existing, version, sha256, absPath, languageId, lineEnding });
      this.notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text: content }],
      });
      return { uri, path: this.fsOps.relativePath(absPath), version, sha256, language_id: languageId };
    }
    return { uri, path: this.fsOps.relativePath(absPath), version: existing.version, sha256: existing.sha256, language_id: languageId };
  }

  async applyTextEditsToDisk({ uri, edits }) {
    if (!this.writesEnabled) {
      throw new Error('Writes are disabled. Start this MCP server with --write to apply edits.');
    }
    const absPath = fromFileUri(uri);
    if (!absPath) {
      throw new Error('Only file:// URIs are supported for applyTextEditsToDisk.');
    }
    const target = await this.fsOps.ensurePath(absPath);
    const before = await this.fsOps.readFileSnapshot(target);
    if (!before?.exists) {
      throw new Error(`Target does not exist: ${this.fsOps.relativePath(target)}`);
    }
    const currentRaw = before.content ?? '';
    const originalLineEnding = currentRaw.includes('\r\n') ? '\r\n' : '\n';
    const current = originalLineEnding === '\r\n' ? currentRaw.replace(/\r\n/g, '\n') : currentRaw;
    const normalizedEdits = normalizeTextEdits(edits);
    const applied = applyTextEdits(current, normalizedEdits);
    if (!applied.changed) {
      return { status: 'noop', path: this.fsOps.relativePath(target), edits: normalizedEdits.length };
    }
    const nextRaw = originalLineEnding === '\r\n' ? applied.text.replace(/\n/g, '\r\n') : applied.text;
    await fsp.writeFile(target, nextRaw, 'utf8');
    const after = await this.fsOps.readFileSnapshot(target);
    await this.fsOps.logFileChange({
      relPath: this.fsOps.relativePath(target),
      absolutePath: target,
      before,
      after,
      tool: 'lsp_apply_text_edits',
      mode: 'edit',
    });
    return { status: 'ok', path: this.fsOps.relativePath(target), edits: normalizedEdits.length };
  }

  async applyWorkspaceEditToDisk(edit) {
    if (!this.writesEnabled) {
      throw new Error('Writes are disabled. Start this MCP server with --write to apply edits.');
    }
    if (!edit || typeof edit !== 'object') {
      throw new Error('Invalid WorkspaceEdit.');
    }
    if (edit.documentChanges) {
      throw new Error('WorkspaceEdit.documentChanges is not supported yet (only "changes" is supported).');
    }
    const changes = edit.changes && typeof edit.changes === 'object' ? edit.changes : null;
    if (!changes) {
      return { status: 'noop', files: 0, edits: 0 };
    }
    const uris = Object.keys(changes);
    let totalEdits = 0;
    const results = [];
    for (const uri of uris) {
      const edits = changes[uri];
      const applied = await this.applyTextEditsToDisk({ uri, edits });
      totalEdits += Array.isArray(edits) ? edits.length : 0;
      results.push({ uri, ...applied });
    }
    return { status: 'ok', files: results.length, edits: totalEdits, results };
  }
}

function applyTextEdits(text, edits) {
  const sorted = edits
    .slice()
    .sort((a, b) => {
      const aStart = a.range?.start || { line: 0, character: 0 };
      const bStart = b.range?.start || { line: 0, character: 0 };
      if (aStart.line !== bStart.line) return bStart.line - aStart.line;
      return bStart.character - aStart.character;
    });

  let changed = false;
  let current = text;
  for (const edit of sorted) {
    const range = edit.range;
    if (!range || !range.start || !range.end) {
      continue;
    }
    const start = lspPositionToOffsetUtf16(current, range.start);
    const end = lspPositionToOffsetUtf16(current, range.end);
    if (start < 0 || end < 0 || start > end) {
      throw new Error('Invalid text edit range.');
    }
    const newText = typeof edit.newText === 'string' ? edit.newText : '';
    current = current.slice(0, start) + newText + current.slice(end);
    changed = true;
  }
  return { changed, text: current };
}

function lspPositionToOffsetUtf16(text, pos) {
  const line = Number(pos?.line);
  const character = Number(pos?.character);
  if (!Number.isFinite(line) || !Number.isFinite(character) || line < 0 || character < 0) {
    return -1;
  }
  const lines = text.split('\n');
  if (line >= lines.length) {
    return text.length;
  }
  let offset = 0;
  for (let i = 0; i < line; i += 1) {
    offset += lines[i].length + 1;
  }
  const lineText = lines[line] || '';
  const slice = lineText.slice(0, character);
  return offset + slice.length;
}

function normalizeTextEdits(edits) {
  if (!Array.isArray(edits)) return [];
  return edits
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      range: e.range,
      newText: typeof e.newText === 'string' ? e.newText : '',
    }));
}

function buildClientCapabilities() {
  return {
    workspace: {
      workspaceFolders: true,
      configuration: true,
    },
    textDocument: {
      synchronization: {
        dynamicRegistration: false,
        didSave: true,
        willSave: false,
        willSaveWaitUntil: false,
      },
      hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
      definition: { dynamicRegistration: false, linkSupport: true },
      references: { dynamicRegistration: false },
      completion: {
        dynamicRegistration: false,
        completionItem: {
          snippetSupport: true,
          commitCharactersSupport: true,
          documentationFormat: ['markdown', 'plaintext'],
        },
      },
      documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
      rename: { dynamicRegistration: false, prepareSupport: false },
      formatting: { dynamicRegistration: false },
    },
  };
}

function findHeaderEnd(buffer) {
  const idxCrlf = buffer.indexOf('\r\n\r\n');
  if (idxCrlf !== -1) return idxCrlf;
  const idxLf = buffer.indexOf('\n\n');
  if (idxLf !== -1) return idxLf;
  return -1;
}

function headerDelimiterLength(buffer, headerEnd) {
  if (buffer.slice(headerEnd, headerEnd + 4).toString('ascii') === '\r\n\r\n') return 4;
  if (buffer.slice(headerEnd, headerEnd + 2).toString('ascii') === '\n\n') return 2;
  return 4;
}

function parseContentLength(headerText) {
  const match = headerText.match(/Content-Length:\s*(\d+)/i);
  if (!match) return NaN;
  return Number(match[1]);
}

function waitForExit(proc, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('Process exit timeout'));
    }, timeoutMs);
    proc.once('exit', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    });
  });
}

function safeStat(target) {
  return fsp
    .stat(target)
    .catch((err) => {
      if (err && err.code === 'ENOENT') return null;
      throw err;
    });
}

function toFileUri(p) {
  return pathToFileURL(path.resolve(p)).toString();
}

function fromFileUri(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:') return null;
    return url.pathname ? decodeURIComponent(url.pathname) : null;
  } catch {
    return null;
  }
}

function guessLanguageId(absPath) {
  const name = path.basename(absPath);
  if (name === 'Dockerfile') return 'dockerfile';
  const ext = path.extname(name).toLowerCase();
  const map = {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.json': 'json',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.kt': 'kotlin',
    '.c': 'c',
    '.h': 'c',
    '.cc': 'cpp',
    '.cpp': 'cpp',
    '.cxx': 'cpp',
    '.hpp': 'cpp',
    '.cs': 'csharp',
    '.php': 'php',
    '.rb': 'ruby',
    '.swift': 'swift',
    '.lua': 'lua',
    '.sh': 'shellscript',
    '.bash': 'shellscript',
    '.zsh': 'shellscript',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.md': 'markdown',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
  };
  return map[ext] || 'plaintext';
}

function toLspPosition({ line, character }) {
  const l = clampNumber(line, 1, Number.MAX_SAFE_INTEGER, 1) - 1;
  const c = clampNumber(character, 1, Number.MAX_SAFE_INTEGER, 1) - 1;
  return { line: l, character: c };
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.min(Math.max(parsed, min), max);
  }
  return fallback;
}

function booleanFromArg(value) {
  if (value === true) return true;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  if (text === '1' || text === 'true' || text === 'yes' || text === 'y') return true;
  return false;
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

function ensureDir(targetDir) {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch {
    // ignore
  }
  try {
    fs.accessSync(targetDir, fs.constants.R_OK);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      fs.mkdirSync(targetDir, { recursive: true });
      return;
    }
    throw err;
  }
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

function renderJson(value) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function formatServerList(servers) {
  if (!Array.isArray(servers) || servers.length === 0) return '<no servers configured>';
  return servers
    .map((s) => {
      const exts = Array.isArray(s.file_extensions) ? s.file_extensions.join(', ') : '';
      const langs = Array.isArray(s.languages) ? s.languages.join(', ') : '';
      const cmd = [s.command, ...(Array.isArray(s.args) ? s.args : [])].join(' ');
      return `- ${s.id}\n  - cmd: ${cmd}\n  - extensions: ${exts || '<none>'}\n  - languages: ${langs || '<none>'}`;
    })
    .join('\n');
}

function loadLspConfig({ root, configPathRaw }) {
  const defaults = defaultLspConfig();
  const candidatePaths = [];
  if (typeof configPathRaw === 'string' && configPathRaw.trim()) {
    candidatePaths.push(path.isAbsolute(configPathRaw) ? configPathRaw : path.resolve(root, configPathRaw));
  } else {
    candidatePaths.push(path.join(resolveAppStateDir(root), 'lsp-servers.json'));
  }

  for (const p of candidatePaths) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw);
      const servers = parsed?.servers && typeof parsed.servers === 'object' ? parsed.servers : null;
      if (!servers) continue;
      return { servers };
    } catch {
      // ignore parse errors and fall back
    }
  }

  return defaults;
}

function defaultLspConfig() {
  return {
    servers: {
      typescript: {
        command: 'typescript-language-server',
        args: ['--stdio'],
        fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
        languages: ['typescript', 'javascript'],
      },
      java: {
        command: 'jdtls',
        args: ['-data', '${stateDir}/lsp-workspaces/jdtls'],
        fileExtensions: ['.java'],
        languages: ['java'],
      },
      pyright: {
        command: 'pyright-langserver',
        args: ['--stdio'],
        fileExtensions: ['.py'],
        languages: ['python'],
      },
      gopls: {
        command: 'gopls',
        args: ['serve'],
        fileExtensions: ['.go'],
        languages: ['go'],
      },
      csharp: {
        command: 'csharp-ls',
        args: [],
        fileExtensions: ['.cs'],
        languages: ['csharp'],
      },
      rust_analyzer: {
        command: 'rust-analyzer',
        args: [],
        fileExtensions: ['.rs'],
        languages: ['rust'],
      },
      clangd: {
        command: 'clangd',
        args: [],
        fileExtensions: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp'],
        languages: ['c', 'cpp'],
      },
      php: {
        command: 'intelephense',
        args: ['--stdio'],
        fileExtensions: ['.php'],
        languages: ['php'],
      },
      lua: {
        command: 'lua-language-server',
        args: [],
        fileExtensions: ['.lua'],
        languages: ['lua'],
      },
      bash: {
        command: 'bash-language-server',
        args: ['start'],
        fileExtensions: ['.sh', '.bash', '.zsh'],
        languages: ['shellscript'],
      },
      yaml: {
        command: 'yaml-language-server',
        args: ['--stdio'],
        fileExtensions: ['.yml', '.yaml'],
        languages: ['yaml'],
      },
      json: {
        command: 'vscode-json-language-server',
        args: ['--stdio'],
        fileExtensions: ['.json'],
        languages: ['json'],
      },
      html: {
        command: 'vscode-html-language-server',
        args: ['--stdio'],
        fileExtensions: ['.html', '.htm'],
        languages: ['html'],
      },
      css: {
        command: 'vscode-css-language-server',
        args: ['--stdio'],
        fileExtensions: ['.css', '.scss', '.less'],
        languages: ['css', 'scss', 'less'],
      },
      dockerfile: {
        command: 'docker-langserver',
        args: ['--stdio'],
        fileExtensions: ['Dockerfile'],
        languages: ['dockerfile'],
      },
    },
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

function expandTemplate(value, context) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (!text.includes('${')) return text;
  const workspaceRoot = typeof context?.workspaceRoot === 'string' ? context.workspaceRoot : '';
  const sessionRoot = typeof context?.sessionRoot === 'string' ? context.sessionRoot : '';
  const stateDir = typeof context?.stateDir === 'string' ? context.stateDir : '';
  const serverId = typeof context?.serverId === 'string' ? context.serverId : '';
  return text
    .replaceAll('${workspaceRoot}', workspaceRoot)
    .replaceAll('${sessionRoot}', sessionRoot)
    .replaceAll('${stateDir}', stateDir)
    .replaceAll('${serverId}', serverId);
}

function printHelp() {
  console.log(
    [
      'Usage: node lsp-bridge-server.js [--root <path>] [--config <path>] [--name <id>] [--timeout-ms <n>] [--max-bytes <n>] [--write]',
      '',
      'Options:',
      '  --root <path>            Workspace root (default current directory)',
      `  --config <path>          LSP config JSON (default: ${STATE_ROOT_DIRNAME}/<app>/lsp-servers.json if present, else built-in defaults)`,
      '  --name <id>              MCP server name (default lsp_bridge)',
      '  --timeout-ms <n>         Default LSP request timeout (default 30000)',
      '  --max-bytes <n>          Max bytes to read per file for syncing (default 512KB)',
      '  --write                  Allow applying formatting/rename edits to disk',
      '  --help                   Show help',
      '',
      'Config format:',
      '  { "servers": { "typescript": { "command": "typescript-language-server", "args":["--stdio"], "fileExtensions":[".ts",".js"] } } }',
      '',
      'Template variables (in command/args):',
      '  ${workspaceRoot}  workspace root (absolute path)',
      '  ${sessionRoot}    session root (usually HOME)',
      `  ${'{'}stateDir${'}'}       per-app state dir (sessionRoot/${STATE_ROOT_DIRNAME}/<app>)`,
      '  ${serverId}       current server id',
    ].join('\n')
  );
}

const lspManager = new LspManager({
  root,
  sessionRoot,
  serverName,
  fsOps,
  config: lspConfig,
  allowWrites,
  maxFileBytes,
  defaultTimeoutMs: requestTimeoutMs,
});

registerTools();

main().catch((err) => {
  console.error(`[${serverName}] crashed:`, err);
  process.exit(1);
});
