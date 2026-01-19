#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const internalEngineRoot = path.resolve(projectRoot, 'packages', 'aide');

try {
  fs.rmSync(internalEngineRoot, { recursive: true, force: true });
  console.log(`[clean:engine] Removed vendored engine directory: ${internalEngineRoot}`);
} catch (err) {
  console.error(`[clean:engine] Failed to remove ${internalEngineRoot}: ${err?.message || String(err)}`);
  process.exitCode = 1;
}

