#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveAideFileUrl } from './aide-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
process.env.MODEL_CLI_HOST_APP = 'chatos';

const entryUrl = resolveAideFileUrl({
  projectRoot,
  relativePath: 'src/cli.js',
  purpose: 'CLI entrypoint',
});

await import(entryUrl);
