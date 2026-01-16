import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createSubAgentManager } from './index.js';
import { importClaudeCodePlugin, indexClaudeCodeMarketplace } from './marketplace-import.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_ROOT = path.join(__dirname, '__fixtures__', 'claude-marketplace');

test('indexClaudeCodeMarketplace reads .claude-plugin marketplace', () => {
  const entries = indexClaudeCodeMarketplace(FIXTURE_ROOT, { id: 'fixture', type: 'local' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'sample-plugin');
  assert.equal(entries[0].category, 'Development');
  assert.equal(entries[0].source.id, 'fixture');
  assert.equal(entries[0].source.pluginPath, 'plugins/sample-plugin');
});

test('importClaudeCodePlugin converts repo plugin to internal format', (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagents-import-'));
  t.after(() => {
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });
  const result = importClaudeCodePlugin({
    repoRoot: FIXTURE_ROOT,
    pluginId: 'sample-plugin',
    pluginPath: 'plugins/sample-plugin',
    outPluginsDir: outDir,
    pluginMeta: { category: 'Development', description: 'desc' },
  });

  const manifestPath = path.join(result.pluginDir, 'plugin.json');
  assert.ok(fs.existsSync(manifestPath));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.id, 'sample-plugin');
  assert.equal(manifest.category, 'Development');
  assert.equal(manifest.agents[0].id, 'sample-agent');
  assert.equal(manifest.agents[0].model, 'deepseek_reasoner');
  assert.deepEqual(manifest.agents[0].defaultSkills, []);
  assert.equal(manifest.commands[0].id, 'sample-command');
  assert.equal(manifest.commands[0].model, 'deepseek_chat');
  assert.equal(manifest.commands[0].reasoning, false);

  const agentPrompt = fs.readFileSync(path.join(result.pluginDir, 'agents', 'sample-agent.md'), 'utf8');
  assert.ok(!agentPrompt.startsWith('---'));
  assert.ok(agentPrompt.includes('You are a sample agent.'));
});

test('SubAgentManager installs marketplace plugin by importing it first', (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'subagents-manager-'));
  t.after(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });
  const builtinRoot = path.join(tmpRoot, 'builtin-subagents');
  fs.mkdirSync(path.join(builtinRoot, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(builtinRoot, 'marketplace.json'), '[]', 'utf8');

  const previousHome = process.env.HOME;
  process.env.HOME = tmpRoot;
  try {
    const manager = createSubAgentManager({ baseDir: builtinRoot });
    manager.addMarketplaceSource(FIXTURE_ROOT);

    const marketplace = manager.listMarketplace();
    assert.ok(marketplace.some((e) => e.id === 'sample-plugin'));

    manager.install('sample-plugin');

    const agentRef = manager.getAgent('sample-agent');
    assert.ok(agentRef);
    const promptResult = manager.buildSystemPrompt(agentRef, []);
    assert.deepEqual(promptResult.usedSkills, []);
  } finally {
    process.env.HOME = previousHome;
  }
});
