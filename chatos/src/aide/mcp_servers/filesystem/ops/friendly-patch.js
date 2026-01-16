import path from 'path';

function normalizeFriendlyPath(input) {
  if (!input) return '';
  let candidate = input.trim().replace(/\\/g, '/');
  if (candidate.startsWith('a/')) {
    candidate = candidate.slice(2);
  } else if (candidate.startsWith('b/')) {
    candidate = candidate.slice(2);
  }
  if (candidate.startsWith('./')) {
    candidate = candidate.slice(2);
  }
  return candidate.replace(/\/+$/, '');
}

function parseFriendlyPatch(patchText) {
  const lines = patchText.replace(/\r\n/g, '\n').split('\n');
  const ops = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '*** Begin Patch') {
      i += 1;
      continue;
    }
    if (trimmed === '*** End Patch') {
      break;
    }
    if (trimmed.startsWith('*** Add File:')) {
      const filePath = normalizeFriendlyPath(trimmed.slice('*** Add File:'.length));
      i += 1;
      const body = [];
      while (i < lines.length) {
        const candidate = lines[i];
        const lookahead = candidate.trim();
        if (
          lookahead.startsWith('*** Add File:') ||
          lookahead.startsWith('*** Update File:') ||
          lookahead.startsWith('*** Delete File:') ||
          lookahead === '*** End Patch'
        ) {
          break;
        }
        if (lookahead === '*** End of File') {
          i += 1;
          break;
        }
        body.push(candidate);
        i += 1;
      }
      ops.push({ type: 'add', path: filePath, lines: body });
      continue;
    }
    if (trimmed.startsWith('*** Delete File:')) {
      const filePath = normalizeFriendlyPath(trimmed.slice('*** Delete File:'.length));
      ops.push({ type: 'delete', path: filePath });
      i += 1;
      continue;
    }
    if (trimmed.startsWith('*** Update File:')) {
      const filePath = normalizeFriendlyPath(trimmed.slice('*** Update File:'.length));
      i += 1;
      let newPath = filePath;
      if (i < lines.length && lines[i].trim().startsWith('*** Move to:')) {
        newPath = normalizeFriendlyPath(lines[i].trim().slice('*** Move to:'.length));
        i += 1;
      }
      const blocks = [];
      let currentBlock = null;
      while (i < lines.length) {
        const candidate = lines[i];
        const lookahead = candidate.trim();
        if (
          lookahead.startsWith('*** Add File:') ||
          lookahead.startsWith('*** Update File:') ||
          lookahead.startsWith('*** Delete File:') ||
          lookahead === '*** End Patch'
        ) {
          break;
        }
        if (lookahead === '*** End of File') {
          i += 1;
          break;
        }
        if (candidate.startsWith('@@')) {
          if (currentBlock && currentBlock.length > 0) {
            blocks.push(currentBlock);
          }
          currentBlock = [];
          i += 1;
          continue;
        }
        if (currentBlock) {
          currentBlock.push(candidate);
        }
        i += 1;
      }
      if (currentBlock && currentBlock.length > 0) {
        blocks.push(currentBlock);
      }
      ops.push({ type: 'update', path: filePath, newPath, blocks });
      continue;
    }
    i += 1;
  }
  return ops;
}

function splitBlock(lines) {
  const oldLines = [];
  const newLines = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('+')) {
      newLines.push(line.slice(1));
    } else if (line.startsWith('-')) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      const value = line.slice(1);
      oldLines.push(value);
      newLines.push(value);
    }
  }
  return {
    oldBlock: oldLines.join('\n'),
    newBlock: newLines.join('\n'),
  };
}

function locateBlock(content, block, startIndex) {
  if (block.length === 0) {
    return { index: startIndex, length: 0 };
  }
  const variants = [block];
  if (!block.endsWith('\n')) {
    variants.push(`${block}\n`);
  } else {
    variants.push(block.slice(0, -1));
  }
  for (const variant of variants) {
    const idx = content.indexOf(variant, startIndex);
    if (idx !== -1) {
      return { index: idx, length: variant.length };
    }
  }
  return { index: -1, length: 0 };
}

function applyFriendlyBlocks(content, blocks, label) {
  if (!blocks || blocks.length === 0) {
    return content;
  }
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  let normalized = content.replace(/\r\n/g, '\n');
  let cursor = 0;
  for (const block of blocks) {
    const { oldBlock, newBlock } = splitBlock(block);
    const located = locateBlock(normalized, oldBlock, cursor);
    if (located.index === -1) {
      throw new Error(`Failed to match patch hunk in ${label || 'file'}.`);
    }
    normalized = normalized.slice(0, located.index) + newBlock + normalized.slice(located.index + located.length);
    cursor = located.index + newBlock.length;
  }
  return normalized.replace(/\n/g, eol);
}

async function ensurePatchDirs({ workDir, patchText, resolvePathWithinWorkspace, fsp }) {
  const headerRegex = /^(?:---|[+]{3})\s+([^\n\t\r]+)/gm;
  let match;
  const dirs = new Set();
  while ((match = headerRegex.exec(patchText)) !== null) {
    const rawPath = (match[1] || '').trim();
    if (!rawPath || rawPath === '/dev/null') continue;
    let candidate = rawPath;
    if (candidate.startsWith('a/')) candidate = candidate.slice(2);
    else if (candidate.startsWith('b/')) candidate = candidate.slice(2);
    const dir = path.dirname(candidate);
    if (dir && dir !== '.' && dir !== '/') {
      dirs.add(dir.replace(/\\/g, '/'));
    }
  }
  const friendlyRegex = /^\*{3}\s+(Add File|Update File):\s+([^\n\r]+)/gm;
  while ((match = friendlyRegex.exec(patchText)) !== null) {
    const friendlyPath = normalizeFriendlyPath(match[2] || '');
    const dir = path.dirname(friendlyPath);
    if (dir && dir !== '.' && dir !== '/') {
      dirs.add(dir);
    }
  }
  const moveRegex = /^\*{3}\s+Move to:\s+([^\n\r]+)/gm;
  while ((match = moveRegex.exec(patchText)) !== null) {
    const movePath = normalizeFriendlyPath(match[1] || '');
    const dir = path.dirname(movePath);
    if (dir && dir !== '.' && dir !== '/') {
      dirs.add(dir);
    }
  }
  for (const dir of Array.from(dirs)) {
    const targetDir = resolvePathWithinWorkspace(dir, workDir);
    await fsp.mkdir(targetDir, { recursive: true });
  }
}

export { applyFriendlyBlocks, ensurePatchDirs, normalizeFriendlyPath, parseFriendlyPatch };

