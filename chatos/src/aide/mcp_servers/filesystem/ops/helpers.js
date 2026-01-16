import path from 'path';

export function createWorkspaceResolver({ root }) {
  const workspaceRoot = path.resolve(root || process.cwd());

  const isInsideWorkspace = (target) => {
    const normalized = path.resolve(target);
    return normalized === workspaceRoot || normalized.startsWith(workspaceRoot + path.sep);
  };

  const buildOutsideRootMessage = (relPath) => {
    return `Path "${relPath}" is outside the workspace root (${workspaceRoot}). Use paths inside this root or set cwd relative to it.`;
  };

  const relativePath = (target) => {
    const rel = path.relative(workspaceRoot, target) || '.';
    return rel.replace(/\\/g, '/');
  };

  const resolvePathWithinWorkspace = (rawPath, baseDir = workspaceRoot) => {
    const raw = rawPath === undefined || rawPath === null ? '.' : rawPath;
    const base = isInsideWorkspace(baseDir) ? baseDir : workspaceRoot;
    const input = String(raw).trim();
    if (!input || input === '.') {
      return base;
    }
    const isAbs = path.isAbsolute(input);
    if (isAbs) {
      const normalizedAbs = path.resolve(input);
      if (isInsideWorkspace(normalizedAbs)) {
        return normalizedAbs;
      }
      const trimmedAbs = input.replace(/^\/+/, '');
      const rerooted = path.resolve(workspaceRoot, trimmedAbs);
      if (isInsideWorkspace(rerooted)) {
        return rerooted;
      }
      throw new Error(buildOutsideRootMessage(rawPath));
    }
    const candidate = path.resolve(base, input);
    if (!isInsideWorkspace(candidate)) {
      throw new Error(buildOutsideRootMessage(rawPath));
    }
    return candidate;
  };

  const ensurePath = async (relPath = '.') => resolvePathWithinWorkspace(relPath, workspaceRoot);

  return {
    root: workspaceRoot,
    ensurePath,
    buildOutsideRootMessage,
    relativePath,
    resolvePathWithinWorkspace,
    isInsideWorkspace,
  };
}

function decodePayload(value, encoding) {
  if (!value) return '';
  if (encoding === 'base64') {
    return Buffer.from(value, 'base64').toString('utf8');
  }
  return value;
}

export async function resolveWritePayload(args) {
  let encoding = args.encoding || 'plain';
  if (typeof args.contents_base64 === 'string' && args.contents_base64.length > 0) {
    encoding = 'base64';
    return decodePayload(args.contents_base64, 'base64');
  }
  if (Array.isArray(args.chunks) && args.chunks.length > 0) {
    const pieces = args.chunks.map((chunk) => {
      const chunkEncoding = chunk.encoding || encoding;
      return decodePayload(chunk.content, chunkEncoding);
    });
    return pieces.join('');
  }
  if (typeof args.contents === 'string') {
    return decodePayload(args.contents, encoding);
  }
  return '';
}

export async function resolvePatchPayload(args) {
  let encoding = args.encoding || 'plain';
  let patchText = '';

  if (typeof args.patch_base64 === 'string' && args.patch_base64.length > 0) {
    encoding = 'base64';
    patchText = decodePayload(args.patch_base64, 'base64');
  } else if (Array.isArray(args.chunks) && args.chunks.length > 0) {
    const segments = args.chunks.map((chunk) => {
      const chunkEncoding = chunk.encoding || encoding;
      return decodePayload(chunk.content, chunkEncoding);
    });
    patchText = segments.join('');
  } else if (typeof args.patch === 'string') {
    patchText = decodePayload(args.patch, encoding);
  }

  // 确保 patch 以换行符结束
  if (patchText && !patchText.endsWith('\n')) {
    patchText += '\n';
  }

  return patchText;
}

export function isFriendlyPatch(patchText) {
  if (!patchText) return false;
  // Friendly patch must contain explicit file operation headers (Update/Add/Delete).
  // (Some models wrap a unified diff with "*** Begin Patch", which should be treated as unified diff.)
  return /^\s*\*{3}\s+(Add File|Delete File|Update File):/m.test(patchText);
}

export function preprocessPatchText(patchText = '') {
  if (!patchText) return '';
  const scorePatchCandidate = (candidate) => {
    if (!candidate) return 0;
    let score = 0;
    if (/^\s*\*{3}\s+(Add File|Delete File|Update File):/m.test(candidate)) score += 100;
    if (/^---\s+/m.test(candidate) && /^\+\+\+\s+/m.test(candidate)) score += 50;
    if (/^diff --git /m.test(candidate)) score += 20;
    if (/^@@/m.test(candidate)) score += 10;
    if (/\*\*\* Begin Patch/.test(candidate)) score += 5;
    return score;
  };

  const extractBestFencedBlock = (source) => {
    const lines = String(source).split('\n');
    const blocks = [];
    for (let i = 0; i < lines.length; i += 1) {
      const open = lines[i].match(/^\s*```([^`]*)$/);
      if (!open) continue;
      const lang = (open[1] || '').trim().toLowerCase();
      const start = i + 1;
      i = start;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        i += 1;
      }
      const content = lines.slice(start, i).join('\n');
      blocks.push({ lang, content });
    }
    let best = null;
    for (const block of blocks) {
      let score = scorePatchCandidate(block.content);
      if (block.lang === 'diff' || block.lang === 'patch') score += 5;
      if (!best || score > best.score) {
        best = { ...block, score };
      }
    }
    return best && best.score > 0 ? best.content : null;
  };

  const stripSurroundingFence = (source) => {
    const trimmed = String(source).trim();
    if (!trimmed.startsWith('```')) {
      return String(source);
    }
    let text = String(source);
    text = text.replace(/^\s*```[^\n]*\n/, '');
    text = text.replace(/\n```[\s]*$/, '\n');
    return text;
  };

  const trimToFirstPatchMarker = (source) => {
    const lines = String(source).split('\n');
    const markerRegex =
      /^\s*(?:\*{3}\s+(?:Begin Patch|End Patch)|\*{3}\s+(?:Add File|Delete File|Update File):|diff --git |--- |\+\+\+ |@@)/;
    const startIndex = lines.findIndex((line) => markerRegex.test(line));
    if (startIndex <= 0) {
      return String(source);
    }
    return lines.slice(startIndex).join('\n');
  };

  const stripCommonIndent = (source) => {
    const lines = String(source).split('\n');
    const markerRegex =
      /^(\s+)(diff --git |--- |\+\+\+ |@@|\*{3}\s+(?:Begin Patch|End Patch)|\*{3}\s+(?:Add File|Delete File|Update File|Move to):)/;
    let minIndent = Infinity;
    for (const line of lines) {
      const match = line.match(markerRegex);
      if (!match) continue;
      minIndent = Math.min(minIndent, match[1].length);
    }
    if (!Number.isFinite(minIndent) || minIndent <= 0) {
      return String(source);
    }
    return lines
      .map((line) => {
        let idx = 0;
        while (idx < minIndent && idx < line.length && (line[idx] === ' ' || line[idx] === '\t')) {
          idx += 1;
        }
        return line.slice(idx);
      })
      .join('\n');
  };

  const stripFriendlyWrapperLinesForUnified = (source) => {
    const lines = String(source).split('\n');
    return lines
      .filter((line) => {
        const trimmed = line.trim();
        return trimmed !== '*** Begin Patch' && trimmed !== '*** End Patch' && trimmed !== '*** End of File';
      })
      .join('\n');
  };

  let text = String(patchText).replace(/\r\n/g, '\n');

  const fenced = extractBestFencedBlock(text);
  if (fenced) {
    text = fenced;
  } else {
    text = stripSurroundingFence(text);
  }

  text = trimToFirstPatchMarker(text);
  text = stripCommonIndent(text);

  // If this isn't the Codex-friendly file-ops format, drop "Begin/End Patch" wrapper lines.
  if (!isFriendlyPatch(text)) {
    text = stripFriendlyWrapperLinesForUnified(text);
  }

  // Left-trim only control lines that are often indented by models.
  const controlLine =
    /^(\s+)(--- |\+\+\+ |@@|diff --git |\*\*\* Begin Patch|\*\*\* End Patch|\*\*\* (Add File|Delete File|Update File|Move to):)/;
  const lines = text.split('\n').map((line) => {
    if (controlLine.test(line)) {
      return line.trimStart();
    }
    return line;
  });

  text = lines.join('\n').replace(/^\s*\n+/, '');
  if (text && !text.endsWith('\n')) {
    text += '\n';
  }
  return text;
}

