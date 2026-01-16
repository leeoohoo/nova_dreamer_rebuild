#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, '..');
const sharedUiSrc = path.resolve(root, 'src', 'common', 'aide-ui');
const uiSrc = path.join(root, 'apps', 'ui');
const entry = path.join(uiSrc, 'src', 'index.jsx');
const dist = path.join(uiSrc, 'dist');
const htmlSrc = path.join(uiSrc, 'index.html');
const htmlOut = path.join(dist, 'index.html');
const iconSrc = path.join(uiSrc, 'icon.png');
const iconOut = path.join(dist, 'icon.png');
const skipIfPresent = process.argv.includes('--skip-if-present');
const release = process.argv.includes('--release');

function hasExistingBuild() {
  const required = ['bundle.js', 'bundle.css', 'index.html', 'icon.png'];
  return required.every((file) => fs.existsSync(path.join(dist, file)));
}

function listFilesRecursive(dirPath) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }
  return results;
}

function getLatestMtimeMs(filePaths = []) {
  let latest = 0;
  for (const filePath of filePaths) {
    try {
      const stat = fs.statSync(filePath);
      const ms = typeof stat.mtimeMs === 'number' ? stat.mtimeMs : 0;
      latest = Math.max(latest, ms);
    } catch {
      // ignore missing/invalid files
    }
  }
  return latest;
}

function buildIsFresh() {
  if (!hasExistingBuild()) return false;
  if (release) {
    const mapFiles = ['bundle.js.map', 'bundle.css.map'].map((file) => path.join(dist, file));
    if (mapFiles.some((file) => fs.existsSync(file))) return false;
  }
  const sources = listFilesRecursive(path.join(uiSrc, 'src')).concat([htmlSrc, iconSrc]);
  sources.push(...listFilesRecursive(sharedUiSrc));
  const newestSource = getLatestMtimeMs(sources);
  if (!newestSource) return true;

  const outputs = ['bundle.js', 'bundle.css', 'index.html', 'icon.png'].map((file) => path.join(dist, file));
  return outputs.every((out) => {
    try {
      const stat = fs.statSync(out);
      return typeof stat.mtimeMs === 'number' ? stat.mtimeMs >= newestSource : true;
    } catch {
      return false;
    }
  });
}

async function main() {
  if (skipIfPresent && buildIsFresh()) {
    console.log(`UI dist already exists at ${dist}; skipped rebuild.`);
    return;
  }
  const { build } = await import('esbuild');
  fs.mkdirSync(dist, { recursive: true });
  if (release) {
    try {
      fs.rmSync(path.join(dist, 'bundle.js.map'), { force: true });
      fs.rmSync(path.join(dist, 'bundle.css.map'), { force: true });
    } catch {
      // ignore
    }
  }
  await build({
    entryPoints: [entry],
    outfile: path.join(dist, 'bundle.js'),
    bundle: true,
    format: 'esm',
    sourcemap: !release,
    minify: release,
    target: ['chrome120', 'node18'],
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'css' },
    external: [],
    nodePaths: [
      path.resolve(root, '..', 'node_modules'),
      path.join(root, 'node_modules'),
      path.resolve(root, 'src', 'aide', 'node_modules'),
    ],
  });
  const html = fs.readFileSync(htmlSrc, 'utf8');
  fs.writeFileSync(htmlOut, html, 'utf8');
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, iconOut);
  }
  console.log(`UI built to ${dist}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
