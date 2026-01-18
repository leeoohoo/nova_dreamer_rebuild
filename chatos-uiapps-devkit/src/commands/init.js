import path from 'path';
import readline from 'readline';

import { ensureDir, isDirectory, isFile, rmForce, writeText } from '../lib/fs.js';
import {
  copyTemplate,
  listTemplates,
  readTemplateMeta,
  maybeReplaceTokensInFile,
  writeScaffoldConfig,
  writeScaffoldManifest,
  writeScaffoldPackageJson,
} from '../lib/template.js';
import { COMPAT_STATE_ROOT_DIRNAME, STATE_ROOT_DIRNAME } from '../lib/state-constants.js';

function canPrompt() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function promptLine(question, { defaultValue = '' } = {}) {
  if (!canPrompt()) throw new Error(`Missing required value: ${question}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => rl.question(question, resolve));
    const v = String(answer || '').trim();
    return v || defaultValue;
  } finally {
    rl.close();
  }
}

export async function cmdInit({ positionals, flags }) {
  const list = Boolean(flags['list-templates'] || flags.listTemplates);
  if (list) {
    const templates = listTemplates();
    if (templates.length === 0) {
      // eslint-disable-next-line no-console
      console.log('No templates found.');
      return;
    }
    const lines = templates.map((t) => `- ${t.name}${t.description ? `: ${t.description}` : ''}`).join('\n');
    // eslint-disable-next-line no-console
    console.log(`Templates:\n${lines}\n\nUse:\n  chatos-uiapp init my-app --template <name>\n`);
    return;
  }

  const dirArg = String(positionals[0] || '').trim();
  if (!dirArg) throw new Error('init requires <dir>');

  const templateName = String(flags.template || flags.t || '').trim() || 'basic';
  const templateMeta = readTemplateMeta(templateName);

  const destDir = path.resolve(process.cwd(), dirArg);
  const force = Boolean(flags.force);

  if (isDirectory(destDir)) {
    const entries = await (async () => {
      try {
        return (await import('fs')).default.readdirSync(destDir);
      } catch {
        return [];
      }
    })();
    if (entries.length > 0 && !force) {
      throw new Error(`Target directory is not empty: ${destDir} (use --force to overwrite)`);
    }
    if (force) rmForce(destDir);
  }

  ensureDir(destDir);
  copyTemplate({ templateName, destDir });

  const pluginId =
    String(flags['plugin-id'] || flags.pluginId || '').trim() || (await promptLine('pluginId (e.g. com.example.myapp): '));
  const pluginName =
    String(flags.name || '').trim() ||
    (await promptLine('plugin name (display): ', { defaultValue: String(templateMeta?.defaults?.pluginName || '').trim() || pluginId }));

  const defaultAppId = String(templateMeta?.defaults?.appId || '').trim() || 'app';
  const appId =
    String(flags['app-id'] || flags.appId || '').trim() ||
    (await promptLine('appId (e.g. manager): ', { defaultValue: defaultAppId }));

  const version = String(flags.version || '').trim() || String(templateMeta?.defaults?.version || '').trim() || '0.1.0';

  const pluginDir = path.join(destDir, 'plugin');
  ensureDir(pluginDir);

  if (!isFile(path.join(pluginDir, 'plugin.json'))) {
    const withBackend = templateMeta?.defaults?.withBackend !== false;
    writeScaffoldManifest({ destPluginDir: pluginDir, pluginId, pluginName, version, appId, withBackend });
  }
  writeScaffoldPackageJson({ destDir, projectName: path.basename(destDir) });
  writeScaffoldConfig({ destDir, pluginDir: 'plugin', appId });

  // rename template app folder "app" -> actual appId
  const srcAppDir = path.join(pluginDir, 'apps', 'app');
  const dstAppDir = path.join(pluginDir, 'apps', appId);
  try {
    const fs = (await import('fs')).default;
    if (fs.existsSync(srcAppDir) && fs.statSync(srcAppDir).isDirectory()) {
      ensureDir(path.dirname(dstAppDir));
      fs.renameSync(srcAppDir, dstAppDir);
    }
  } catch {
    // ignore
  }

  // Token replacements inside README/template code.
  const replacements = {
    __PLUGIN_ID__: pluginId,
    __PLUGIN_NAME__: pluginName,
    __APP_ID__: appId,
    __VERSION__: version,
  };

  maybeReplaceTokensInFile(path.join(destDir, 'README.md'), replacements);
  maybeReplaceTokensInFile(path.join(destDir, 'chatos.config.json'), replacements);
  if (isFile(path.join(pluginDir, 'plugin.json'))) {
    maybeReplaceTokensInFile(path.join(pluginDir, 'plugin.json'), replacements);
  }
  maybeReplaceTokensInFile(path.join(pluginDir, 'backend', 'index.mjs'), replacements);
  maybeReplaceTokensInFile(path.join(dstAppDir, 'index.mjs'), replacements);
  maybeReplaceTokensInFile(path.join(dstAppDir, 'compact.mjs'), replacements);
  maybeReplaceTokensInFile(path.join(dstAppDir, 'mcp-server.mjs'), replacements);
  maybeReplaceTokensInFile(path.join(dstAppDir, 'mcp-prompt.zh.md'), replacements);
  maybeReplaceTokensInFile(path.join(dstAppDir, 'mcp-prompt.en.md'), replacements);

  // Ensure a helpful note exists even if template is edited later.
  writeText(
    path.join(destDir, '.gitignore'),
    `node_modules/\n.DS_Store\n${STATE_ROOT_DIRNAME}/\n${COMPAT_STATE_ROOT_DIRNAME}/\n*.log\n\n# build outputs (if you add bundling later)\ndist/\n`
  );

  // eslint-disable-next-line no-console
  console.log(`Created: ${destDir}

Next:
  cd ${dirArg}
  npm install
  npm run dev
`);
}
