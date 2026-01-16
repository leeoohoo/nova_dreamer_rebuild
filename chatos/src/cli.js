#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { resolveAideFileUrl, resolveAidePath } from './aide-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
process.env.MODEL_CLI_HOST_APP = 'chatos';

const srcEntrypoint = resolveAidePath({
  projectRoot,
  relativePath: 'src/cli.js',
  purpose: 'CLI entrypoint',
});
const distEntrypoint = resolveAidePath({
  projectRoot,
  relativePath: 'dist/cli.js',
  purpose: 'CLI entrypoint',
});
const entryUrl = fs.existsSync(srcEntrypoint)
  ? pathToFileURL(srcEntrypoint).href
  : fs.existsSync(distEntrypoint)
    ? pathToFileURL(distEntrypoint).href
    : resolveAideFileUrl({
        projectRoot,
        relativePath: 'src/cli.js',
        purpose: 'CLI entrypoint',
      });

await import(entryUrl);
