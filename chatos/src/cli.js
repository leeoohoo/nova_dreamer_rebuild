#!/usr/bin/env node
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
process.env.MODEL_CLI_HOST_APP = 'chatos';

const entryPath = path.resolve(__dirname, '..', 'cli', 'src', 'index.js');
await import(pathToFileURL(entryPath).href);
