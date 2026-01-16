import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { resolveSessionRoot } from './session-root.js';

function isDirectory(dirPath) {
  if (!dirPath) return false;
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function normalizeHostApp(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function looksLikeAideRoot(rootDir) {
  const dir = typeof rootDir === 'string' ? rootDir.trim() : '';
  if (!dir) return false;
  try {
    const distEntry = path.join(dir, 'dist', 'cli.js');
    if (fs.existsSync(distEntry) && fs.statSync(distEntry).isFile()) return true;
    const legacyEntry = path.join(dir, 'src', 'cli.js');
    return fs.existsSync(legacyEntry) && fs.statSync(legacyEntry).isFile();
  } catch {
    return false;
  }
}

function isPathInsideAsar(targetPath) {
  const raw = typeof targetPath === 'string' ? targetPath : '';
  if (!raw) return false;
  const normalized = path.normalize(raw);
  const parts = normalized.split(path.sep).filter(Boolean);
  return parts.some((part) => String(part).toLowerCase().endsWith('.asar'));
}

function resolveInstalledAideRoot() {
  const sessionRoot = resolveSessionRoot();
  const hostApp = normalizeHostApp(process.env.MODEL_CLI_HOST_APP || 'chatos') || 'chatos';
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir() || sessionRoot || process.cwd();
  const stateDir = path.join(homeDir, '.deepseek_cli', hostApp);
  const candidate = path.join(stateDir, 'aide');
  if (isDirectory(candidate) && looksLikeAideRoot(candidate)) {
    return candidate;
  }

  // Legacy installs (app-scoped, but sessionRoot was customized): <sessionRoot>/.deepseek_cli/<hostApp>/aide
  const legacyScopedCandidate = path.join(sessionRoot, '.deepseek_cli', hostApp, 'aide');
  if (isDirectory(legacyScopedCandidate) && looksLikeAideRoot(legacyScopedCandidate)) {
    return legacyScopedCandidate;
  }

  // Legacy installs (pre app-scoped stateDir) lived at <sessionRoot>/.deepseek_cli/aide
  const legacyCandidate = path.join(sessionRoot, '.deepseek_cli', 'aide');
  if (isDirectory(legacyCandidate) && looksLikeAideRoot(legacyCandidate)) {
    return legacyCandidate;
  }

  return null;
}

export function resolveAideRoot({ projectRoot }) {
  const root = typeof projectRoot === 'string' ? projectRoot.trim() : '';
  if (!root) return null;

  // In a packaged Electron app (app.asar), lock to the bundled engine and ignore external installs/env overrides.
  if (isPathInsideAsar(root)) {
    const internal = path.resolve(root, 'src', 'aide');
    if (isDirectory(internal) && looksLikeAideRoot(internal)) return internal;
    return null;
  }

  const explicit =
    typeof process.env.MODEL_CLI_AIDE_ROOT === 'string' ? process.env.MODEL_CLI_AIDE_ROOT.trim() : '';
  if (explicit && isDirectory(explicit) && looksLikeAideRoot(explicit)) {
    return path.resolve(explicit);
  }

  const external = path.resolve(root, '..', 'aide');
  const internal = path.resolve(root, 'src', 'aide');

  // Prefer local sources (development) over stateDir installs to avoid surprises when both exist.
  if (isDirectory(external) && looksLikeAideRoot(external)) return external;
  if (isDirectory(internal) && looksLikeAideRoot(internal)) return internal;

  const installed = resolveInstalledAideRoot();
  if (installed) return installed;
  return null;
}

export function resolveAidePath({ projectRoot, relativePath, purpose = '' }) {
  const root = resolveAideRoot({ projectRoot });
  if (!root) {
    const normalizedPurpose = typeof purpose === 'string' ? purpose.trim() : '';
    const label = normalizedPurpose ? `${normalizedPurpose}: ` : '';
    const external = path.resolve(projectRoot || '', '..', 'aide');
    const internal = path.resolve(projectRoot || '', 'src', 'aide');
    throw new Error(
      `${label}AIDE sources not found.\n` +
        `Expected one of:\n` +
        `- ${external}\n` +
        `- ${internal}\n` +
        `\n` +
        `If you're using the desktop app, the AIDE engine is bundled by default.\n` +
        `If it's missing, reinstall/rebuild the app; for development you can set MODEL_CLI_AIDE_ROOT.\n`
    );
  }
  const rel = typeof relativePath === 'string' ? relativePath.trim() : '';
  if (!rel) {
    throw new Error('relativePath is required');
  }
  return path.join(root, rel);
}

export function resolveAideFileUrl(options) {
  const filePath = resolveAidePath(options);
  return pathToFileURL(filePath).href;
}
