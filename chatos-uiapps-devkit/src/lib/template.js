import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { copyDir, ensureDir, isDirectory, isFile, readJson, writeJson, writeText } from './fs.js';

function packageRoot() {
  // src/lib/template.js -> src -> package root
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..');
}

export function getTemplateDir(name) {
  const root = packageRoot();
  const dir = path.join(root, 'templates', name);
  if (!isDirectory(dir)) throw new Error(`template not found: ${name}`);
  return dir;
}

function readSelfPackage() {
  const root = packageRoot();
  const pkgPath = path.join(root, 'package.json');
  if (!isFile(pkgPath)) return { name: '@leeoohoo/ui-apps-devkit', version: '0.1.0' };
  try {
    const pkg = readJson(pkgPath);
    return pkg && typeof pkg === 'object' ? pkg : { name: '@leeoohoo/ui-apps-devkit', version: '0.1.0' };
  } catch {
    return { name: '@leeoohoo/ui-apps-devkit', version: '0.1.0' };
  }
}

export function readTemplateMeta(name) {
  const dir = getTemplateDir(name);
  const metaPath = path.join(dir, 'template.json');
  if (!isFile(metaPath)) return { name, description: '', defaults: null };
  try {
    const meta = readJson(metaPath);
    return {
      name,
      description: typeof meta?.description === 'string' ? meta.description.trim() : '',
      defaults: meta?.defaults && typeof meta.defaults === 'object' ? meta.defaults : null,
    };
  } catch {
    return { name, description: '', defaults: null };
  }
}

export function listTemplates() {
  const root = packageRoot();
  const templatesDir = path.join(root, 'templates');
  let entries = [];
  try {
    entries = fs.readdirSync(templatesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  for (const ent of entries) {
    if (!ent?.isDirectory?.()) continue;
    const name = String(ent.name || '').trim();
    if (!name || name.startsWith('.')) continue;
    if (!isDirectory(path.join(templatesDir, name))) continue;
    out.push(readTemplateMeta(name));
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function copyTemplate({ templateName, destDir }) {
  const srcDir = getTemplateDir(templateName);
  ensureDir(destDir);

  copyDir(srcDir, destDir, {
    filter: (src) => {
      const base = path.basename(src);
      if (base === 'node_modules') return false;
      if (base === '.DS_Store') return false;
      return true;
    },
  });
}

export function writeScaffoldManifest({ destPluginDir, pluginId, pluginName, version, appId, withBackend = true }) {
  const manifest = {
    manifestVersion: 1,
    id: pluginId,
    name: pluginName,
    version: version || '0.1.0',
    description: 'A ChatOS UI Apps plugin.',
    ...(withBackend ? { backend: { entry: 'backend/index.mjs' } } : {}),
    apps: [
      {
        id: appId,
        name: 'My App',
        description: 'A ChatOS module app.',
        entry: {
          type: 'module',
          path: `apps/${appId}/index.mjs`,
          compact: { type: 'module', path: `apps/${appId}/compact.mjs` },
        },
        ai: {
          // Keep the default scaffold dependency-free: prompt is safe, MCP server is opt-in.
          mcpPrompt: {
            title: 'My App · MCP Prompt',
            zh: `apps/${appId}/mcp-prompt.zh.md`,
            en: `apps/${appId}/mcp-prompt.en.md`,
          },
        },
      },
    ],
  };

  writeJson(path.join(destPluginDir, 'plugin.json'), manifest);
  return manifest;
}

export function writeScaffoldPackageJson({ destDir, projectName }) {
  const selfPkg = readSelfPackage();
  const devkitName = typeof selfPkg?.name === 'string' && selfPkg.name.trim() ? selfPkg.name.trim() : '@leeoohoo/ui-apps-devkit';
  const devkitVersion = typeof selfPkg?.version === 'string' && selfPkg.version.trim() ? selfPkg.version.trim() : '0.1.0';
  const devkitRange = `^${devkitVersion}`;

  const baseScripts = {
    dev: 'chatos-uiapp dev',
    validate: 'chatos-uiapp validate',
    pack: 'chatos-uiapp pack',
    'install:chatos': 'chatos-uiapp install --host-app chatos',
  };

  const pkgPath = path.join(destDir, 'package.json');
  const existing = isFile(pkgPath) ? readJson(pkgPath) : {};
  const pkg = existing && typeof existing === 'object' ? existing : {};

  pkg.name = projectName;
  pkg.private = true;
  pkg.type = 'module';

  pkg.scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  for (const [key, value] of Object.entries(baseScripts)) {
    if (!pkg.scripts[key]) pkg.scripts[key] = value;
  }

  pkg.devDependencies = pkg.devDependencies && typeof pkg.devDependencies === 'object' ? pkg.devDependencies : {};
  if (!pkg.devDependencies[devkitName]) {
    pkg.devDependencies[devkitName] = devkitRange;
  }

  writeJson(pkgPath, pkg);
  return pkg;
}

export function writeScaffoldConfig({ destDir, pluginDir = 'plugin', appId = '' }) {
  const cfgPath = path.join(destDir, 'chatos.config.json');
  const existing = isFile(cfgPath) ? readJson(cfgPath) : {};
  const cfg = existing && typeof existing === 'object' ? existing : {};
  cfg.pluginDir = pluginDir;
  cfg.appId = appId;
  writeJson(cfgPath, cfg);
  return cfg;
}

export function maybeReplaceTokensInFile(filePath, replacements) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let next = raw;
  for (const [key, value] of Object.entries(replacements || {})) {
    next = next.split(key).join(String(value));
  }
  if (next !== raw) {
    writeText(filePath, next);
  }
}
