import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

const shouldSkip = (name) => name === 'node_modules' || name === 'dist';

const copyDir = async (src, dest) => {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
};

export const runBuild = async () => {
  await copyDir(srcDir, distDir);
  console.log(`Build complete: ${distDir}`);
};

const isMain = () => {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
};

if (isMain()) {
  runBuild().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
