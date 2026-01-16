#!/usr/bin/env node
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const buildScript = path.join(projectRoot, 'scripts', 'build-ui.js');

// 在 Node 环境下获取 electron 可执行文件路径
const require = createRequire(import.meta.url);
let electronBinary;
try {
  electronBinary = require('electron');
} catch (err) {
  console.error('chatosui requires the optional dependency "electron".');
  console.error('Reinstall without `--omit=optional`, e.g.:');
  console.error('  npm i -g @leeoohoo/chatos');
  console.error('Or install Electron separately, e.g.:');
  console.error('  npm i -g electron');
  process.exit(1);
}

function ensureUiBuilt() {
  const result = spawn(process.execPath, [buildScript, '--skip-if-present'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  result.on('exit', (code) => {
    if (code !== 0) {
      process.exit(code ?? 1);
    } else {
      launchUi();
    }
  });
}

function launchUi() {
  const mainPath = path.join(projectRoot, 'electron', 'main.js');
  const child = spawn(electronBinary, [mainPath, ...process.argv.slice(2)], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

ensureUiBuilt();
