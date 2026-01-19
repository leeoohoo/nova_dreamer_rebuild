export function detectLanguageFromPath(filePath = '') {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.diff') || lower.endsWith('.patch')) return 'diff';
  const baseName = lower.split(/[/\\]/).pop() || '';
  if (baseName === 'dockerfile') return 'dockerfile';
  if (baseName === 'makefile') return 'makefile';

  const ext = baseName.includes('.') ? baseName.split('.').pop() : '';
  if (!ext) return null;

  const map = {
    js: 'javascript',
    jsx: 'jsx',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    tsx: 'tsx',
    mts: 'typescript',
    cts: 'typescript',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    md: 'markdown',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    swift: 'swift',
    c: 'c',
    h: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    hxx: 'cpp',
    hh: 'cpp',
    cs: 'csharp',
    php: 'php',
    rb: 'ruby',
    sql: 'sql',
    html: 'xml',
    htm: 'xml',
    xml: 'xml',
    css: 'css',
    scss: 'scss',
    less: 'less',
    toml: 'toml',
    ini: 'ini',
    env: 'properties',
  };
  return map[ext] || ext;
}

