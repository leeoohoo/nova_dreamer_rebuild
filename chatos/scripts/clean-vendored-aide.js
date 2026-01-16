#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const internalAideRoot = path.resolve(projectRoot, 'src', 'aide');

try {
  fs.rmSync(internalAideRoot, { recursive: true, force: true });
  console.log(`[clean:aide] Removed vendored aide directory: ${internalAideRoot}`);
} catch (err) {
  console.error(`[clean:aide] Failed to remove ${internalAideRoot}: ${err?.message || String(err)}`);
  process.exitCode = 1;
}

