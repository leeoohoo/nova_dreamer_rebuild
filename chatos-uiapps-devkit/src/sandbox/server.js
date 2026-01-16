import fs from 'fs';
import http from 'http';
import path from 'path';
import url from 'url';

import { ensureDir, isDirectory, isFile } from '../lib/fs.js';
import { loadPluginManifest, pickAppFromManifest } from '../lib/plugin.js';
import { resolveInsideDir } from '../lib/path-boundary.js';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN_REGEX = /--ds-[a-z0-9-]+/gi;
const GLOBAL_STYLES_CANDIDATES = [
  path.resolve(__dirname, '..', '..', '..', 'common', 'aide-ui', 'components', 'GlobalStyles.jsx'),
  path.resolve(process.cwd(), 'common', 'aide-ui', 'components', 'GlobalStyles.jsx'),
];

function loadTokenNames() {
  for (const candidate of GLOBAL_STYLES_CANDIDATES) {
    try {
      if (!isFile(candidate)) continue;
      const raw = fs.readFileSync(candidate, 'utf8');
      const matches = raw.match(TOKEN_REGEX) || [];
      const names = Array.from(new Set(matches.map((v) => v.toLowerCase())));
      if (names.length > 0) return names.sort();
    } catch {
      // ignore
    }
  }
  return [];
}


function sendJson(res, status, obj) {
  const raw = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(raw);
}

function sendText(res, status, text, contentType) {
  res.writeHead(status, {
    'content-type': contentType || 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.mjs' || ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

function serveStaticFile(res, filePath) {
  if (!isFile(filePath)) return false;
  const ct = guessContentType(filePath);
  const buf = fs.readFileSync(filePath);
  res.writeHead(200, { 'content-type': ct, 'cache-control': 'no-store' });
  res.end(buf);
  return true;
}

function startRecursiveWatcher(rootDir, onChange) {
  const root = path.resolve(rootDir);
  if (!isDirectory(root)) return () => {};

  const watchers = new Map();

  const shouldIgnore = (p) => {
    const base = path.basename(p);
    if (!base) return false;
    if (base === 'node_modules') return true;
    if (base === '.git') return true;
    if (base === '.DS_Store') return true;
    return false;
  };

  const scan = (dir) => {
    const abs = path.resolve(dir);
    if (!isDirectory(abs)) return;
    if (shouldIgnore(abs)) return;
    if (!watchers.has(abs)) {
      try {
        const w = fs.watch(abs, (eventType, filename) => {
          const relName = filename ? String(filename) : '';
          const filePath = relName ? path.join(abs, relName) : abs;
          try {
            onChange({ eventType, filePath });
          } catch {
            // ignore
          }
          scheduleRescan();
        });
        watchers.set(abs, w);
      } catch {
        // ignore
      }
    }

    let entries = [];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent?.isDirectory?.()) continue;
      const child = path.join(abs, ent.name);
      if (shouldIgnore(child)) continue;
      scan(child);
    }
  };

  let rescanTimer = null;
  const scheduleRescan = () => {
    if (rescanTimer) return;
    rescanTimer = setTimeout(() => {
      rescanTimer = null;
      scan(root);
    }, 250);
  };

  scan(root);

  return () => {
    if (rescanTimer) {
      try {
        clearTimeout(rescanTimer);
      } catch {
        // ignore
      }
      rescanTimer = null;
    }
    for (const w of watchers.values()) {
      try {
        w.close();
      } catch {
        // ignore
      }
    }
    watchers.clear();
  };
}

function htmlPage() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ChatOS UI Apps Sandbox</title>
    <style>
      :root {
        color-scheme: light;
        --ds-accent: #00d4ff;
        --ds-accent-2: #7c3aed;
        --ds-panel-bg: rgba(255, 255, 255, 0.86);
        --ds-panel-border: rgba(15, 23, 42, 0.08);
        --ds-subtle-bg: rgba(255, 255, 255, 0.62);
        --ds-selected-bg: linear-gradient(90deg, rgba(0, 212, 255, 0.14), rgba(124, 58, 237, 0.08));
        --ds-focus-ring: rgba(0, 212, 255, 0.32);
        --ds-nav-hover-bg: rgba(15, 23, 42, 0.06);
        --ds-code-bg: #f7f9fb;
        --ds-code-border: #eef2f7;
        --sandbox-bg: #f5f7fb;
        --sandbox-text: #111;
      }
      :root[data-theme='dark'] {
        color-scheme: dark;
        --ds-accent: #00d4ff;
        --ds-accent-2: #a855f7;
        --ds-panel-bg: rgba(17, 19, 28, 0.82);
        --ds-panel-border: rgba(255, 255, 255, 0.14);
        --ds-subtle-bg: rgba(255, 255, 255, 0.04);
        --ds-selected-bg: linear-gradient(90deg, rgba(0, 212, 255, 0.18), rgba(168, 85, 247, 0.14));
        --ds-focus-ring: rgba(0, 212, 255, 0.5);
        --ds-nav-hover-bg: rgba(255, 255, 255, 0.08);
        --ds-code-bg: #0d1117;
        --ds-code-border: #30363d;
        --sandbox-bg: #0f1115;
        --sandbox-text: #eee;
      }
      body {
        margin:0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        background: var(--sandbox-bg);
        color: var(--sandbox-text);
      }
      #appRoot { height: 100vh; display:flex; flex-direction:column; }
      #sandboxToolbar {
        flex: 0 0 auto;
        border-bottom: 1px solid var(--ds-panel-border);
        padding: 10px 12px;
        background: var(--ds-panel-bg);
      }
      #headerSlot {
        flex: 0 0 auto;
        border-bottom: 1px solid var(--ds-panel-border);
        padding: 10px 12px;
        background: var(--ds-panel-bg);
      }
      #container { flex: 1 1 auto; min-height:0; overflow:hidden; }
      #containerInner { height:100%; overflow:auto; }
      .muted { opacity: 0.7; font-size: 12px; }
      .bar { display:flex; gap:10px; align-items:center; justify-content:space-between; }
      .btn {
        border:1px solid var(--ds-panel-border);
        background: var(--ds-subtle-bg);
        padding:6px 10px;
        border-radius:10px;
        cursor:pointer;
        font-weight:650;
        color: inherit;
      }
      .btn[data-active='1'] {
        background: var(--ds-selected-bg);
        box-shadow: 0 0 0 2px var(--ds-focus-ring);
      }
      .btn:active { transform: translateY(1px); }
      #promptsPanel {
        position: fixed;
        right: 12px;
        bottom: 12px;
        width: 420px;
        max-height: 70vh;
        display:none;
        flex-direction:column;
        background: var(--ds-panel-bg);
        color: inherit;
        border:1px solid var(--ds-panel-border);
        border-radius:14px;
        overflow:hidden;
        box-shadow: 0 18px 60px rgba(0,0,0,0.18);
      }
      #promptsPanelHeader { padding: 10px 12px; display:flex; align-items:center; justify-content:space-between; border-bottom: 1px solid var(--ds-panel-border); }
      #promptsPanelBody { padding: 10px 12px; overflow:auto; display:flex; flex-direction:column; gap:10px; }
      #promptsFab { position: fixed; right: 16px; bottom: 16px; width: 44px; height: 44px; border-radius: 999px; display:flex; align-items:center; justify-content:center; }
      .card { border: 1px solid var(--ds-panel-border); border-radius: 12px; padding: 10px; background: var(--ds-panel-bg); }
      .row { display:flex; gap:10px; }
      .toolbar-group { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .segmented { display:flex; gap:6px; align-items:center; }
      #sandboxInspector {
        position: fixed;
        right: 12px;
        top: 72px;
        width: 360px;
        max-height: 70vh;
        display: none;
        flex-direction: column;
        background: var(--ds-panel-bg);
        border: 1px solid var(--ds-panel-border);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 14px 40px rgba(0,0,0,0.16);
        z-index: 10;
      }
      #sandboxInspectorHeader {
        padding: 10px 12px;
        display:flex;
        align-items:center;
        justify-content: space-between;
        border-bottom: 1px solid var(--ds-panel-border);
      }
      #sandboxInspectorBody {
        padding: 10px 12px;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .section-title { font-size: 12px; font-weight: 700; opacity: 0.8; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; white-space: pre-wrap; }
      input, textarea, select {
        width:100%;
        padding:8px;
        border-radius:10px;
        border:1px solid var(--ds-panel-border);
        background: var(--ds-subtle-bg);
        color: inherit;
      }
      textarea { min-height: 70px; resize: vertical; }
      label { font-size: 12px; opacity: 0.8; }
      .danger { border-color: rgba(255,0,0,0.35); }
    </style>
  </head>
  <body>
    <div id="appRoot">
      <div id="sandboxToolbar">
        <div class="bar">
          <div>
            <div style="font-weight:800">ChatOS UI Apps Sandbox</div>
            <div class="muted">Host API mock · 模拟 module mount({ container, host, slots })</div>
          </div>
          <div class="row toolbar-group">
            <span class="muted">Theme</span>
            <div class="segmented" role="group" aria-label="Theme">
              <button id="btnThemeLight" class="btn" type="button">Light</button>
              <button id="btnThemeDark" class="btn" type="button">Dark</button>
              <button id="btnThemeSystem" class="btn" type="button">System</button>
            </div>
            <div id="themeStatus" class="muted"></div>
            <div id="sandboxContext" class="muted"></div>
            <button id="btnInspectorToggle" class="btn" type="button">Inspect</button>
            <button id="btnReload" class="btn" type="button">Reload</button>
          </div>
        </div>
      </div>
      <div id="headerSlot"></div>
      <div id="container"><div id="containerInner"></div></div>
    </div>

    <button id="promptsFab" class="btn" type="button">:)</button>

    <div id="promptsPanel">
      <div id="promptsPanelHeader">
        <div style="font-weight:800">UI Prompts</div>
        <button id="promptsClose" class="btn" type="button">Close</button>
      </div>
      <div id="promptsPanelBody"></div>
    </div>

    <div id="sandboxInspector" aria-hidden="true">
      <div id="sandboxInspectorHeader">
        <div style="font-weight:800">Sandbox Inspector</div>
        <div class="row">
          <button id="btnInspectorRefresh" class="btn" type="button">Refresh</button>
          <button id="btnInspectorClose" class="btn" type="button">Close</button>
        </div>
      </div>
      <div id="sandboxInspectorBody">
        <div>
          <div class="section-title">Host Context</div>
          <pre id="inspectorContext" class="mono"></pre>
        </div>
        <div>
          <div class="section-title">Theme</div>
          <pre id="inspectorTheme" class="mono"></pre>
        </div>
        <div>
          <div class="section-title">Tokens</div>
          <pre id="inspectorTokens" class="mono"></pre>
        </div>
      </div>
    </div>

    <script type="module" src="/sandbox.mjs"></script>
  </body>
</html>`;
}

function sandboxClientJs() {
  return `const $ = (sel) => document.querySelector(sel);

const container = $('#containerInner');
const headerSlot = $('#headerSlot');
const fab = $('#promptsFab');
const panel = $('#promptsPanel');
const panelBody = $('#promptsPanelBody');
const panelClose = $('#promptsClose');
const btnThemeLight = $('#btnThemeLight');
const btnThemeDark = $('#btnThemeDark');
const btnThemeSystem = $('#btnThemeSystem');
const themeStatus = $('#themeStatus');
const sandboxContext = $('#sandboxContext');
const btnInspectorToggle = $('#btnInspectorToggle');
const sandboxInspector = $('#sandboxInspector');
const btnInspectorClose = $('#btnInspectorClose');
const btnInspectorRefresh = $('#btnInspectorRefresh');
const inspectorContext = $('#inspectorContext');
const inspectorTheme = $('#inspectorTheme');
const inspectorTokens = $('#inspectorTokens');

const setPanelOpen = (open) => { panel.style.display = open ? 'flex' : 'none'; };
fab.addEventListener('click', () => setPanelOpen(panel.style.display !== 'flex'));
panelClose.addEventListener('click', () => setPanelOpen(false));
window.addEventListener('chatos:uiPrompts:open', () => setPanelOpen(true));
window.addEventListener('chatos:uiPrompts:close', () => setPanelOpen(false));
window.addEventListener('chatos:uiPrompts:toggle', () => setPanelOpen(panel.style.display !== 'flex'));

const THEME_STORAGE_KEY = 'chatos:sandbox:theme-mode';
const themeListeners = new Set();
const themeButtons = [
  { mode: 'light', el: btnThemeLight },
  { mode: 'dark', el: btnThemeDark },
  { mode: 'system', el: btnThemeSystem },
];
const systemQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

const normalizeThemeMode = (mode) => (mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'system');

const loadThemeMode = () => {
  try {
    return normalizeThemeMode(String(localStorage.getItem(THEME_STORAGE_KEY) || ''));
  } catch {
    return 'system';
  }
};

let themeMode = loadThemeMode();
let currentTheme = 'light';
let inspectorEnabled = false;
let inspectorTimer = null;

const resolveTheme = () => {
  if (themeMode === 'light' || themeMode === 'dark') return themeMode;
  return systemQuery && systemQuery.matches ? 'dark' : 'light';
};

const emitThemeChange = (theme) => {
  for (const fn of themeListeners) { try { fn(theme); } catch {} }
};

const updateThemeControls = () => {
  for (const { mode, el } of themeButtons) {
    if (!el) continue;
    const active = mode === themeMode;
    el.dataset.active = active ? '1' : '0';
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  if (themeStatus) {
    themeStatus.textContent = themeMode === 'system' ? 'system -> ' + currentTheme : currentTheme;
  }
};

const updateContextStatus = () => {
  if (!sandboxContext) return;
  sandboxContext.textContent = __SANDBOX__.pluginId + ':' + __SANDBOX__.appId;
};

const isInspectorOpen = () => sandboxInspector && sandboxInspector.style.display === 'flex';

const formatJson = (value) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const tokenNameList = Array.isArray(__SANDBOX__.tokenNames) ? __SANDBOX__.tokenNames : [];

const collectTokens = () => {
  const style = getComputedStyle(document.documentElement);
  const names = new Set(tokenNameList);
  for (let i = 0; i < style.length; i += 1) {
    const name = style[i];
    if (name && name.startsWith('--ds-')) names.add(name);
  }
  return [...names]
    .sort()
    .map((name) => {
      const value = style.getPropertyValue(name).trim();
      return name + ': ' + (value || '(unset)');
    })
    .join('\\n');
};

const readHostContext = () => {
  if (!inspectorEnabled) return null;
  if (typeof host?.context?.get === 'function') return host.context.get();
  return { pluginId: __SANDBOX__.pluginId, appId: __SANDBOX__.appId, theme: currentTheme, bridge: { enabled: true } };
};

const readThemeInfo = () => ({
  themeMode,
  currentTheme,
  dataTheme: document.documentElement.dataset.theme || '',
  dataThemeMode: document.documentElement.dataset.themeMode || '',
  prefersColorScheme: systemQuery ? (systemQuery.matches ? 'dark' : 'light') : 'unknown',
});

const updateInspector = () => {
  if (!inspectorEnabled) return;
  if (inspectorContext) inspectorContext.textContent = formatJson(readHostContext());
  if (inspectorTheme) inspectorTheme.textContent = formatJson(readThemeInfo());
  if (inspectorTokens) inspectorTokens.textContent = collectTokens();
};

const startInspectorTimer = () => {
  if (inspectorTimer) return;
  inspectorTimer = setInterval(updateInspector, 1000);
};

const stopInspectorTimer = () => {
  if (!inspectorTimer) return;
  clearInterval(inspectorTimer);
  inspectorTimer = null;
};

const setInspectorOpen = (open) => {
  if (!sandboxInspector) return;
  sandboxInspector.style.display = open ? 'flex' : 'none';
  sandboxInspector.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) {
    updateInspector();
    startInspectorTimer();
  } else {
    stopInspectorTimer();
  }
};

const updateInspectorIfOpen = () => {
  if (!inspectorEnabled) return;
  if (isInspectorOpen()) updateInspector();
};

const applyThemeMode = (mode, { persist = true } = {}) => {
  themeMode = normalizeThemeMode(mode);
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // ignore
    }
  }
  const nextTheme = resolveTheme();
  const prevTheme = currentTheme;
  currentTheme = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.dataset.themeMode = themeMode;
  updateThemeControls();
  updateInspectorIfOpen();
  if (nextTheme !== prevTheme) emitThemeChange(nextTheme);
};

if (systemQuery && typeof systemQuery.addEventListener === 'function') {
  systemQuery.addEventListener('change', () => {
    if (themeMode === 'system') applyThemeMode('system', { persist: false });
  });
}

if (btnThemeLight) btnThemeLight.addEventListener('click', () => applyThemeMode('light'));
if (btnThemeDark) btnThemeDark.addEventListener('click', () => applyThemeMode('dark'));
if (btnThemeSystem) btnThemeSystem.addEventListener('click', () => applyThemeMode('system'));
if (btnInspectorToggle) btnInspectorToggle.addEventListener('click', () => setInspectorOpen(!isInspectorOpen()));
if (btnInspectorClose) btnInspectorClose.addEventListener('click', () => setInspectorOpen(false));
if (btnInspectorRefresh) btnInspectorRefresh.addEventListener('click', () => updateInspector());

applyThemeMode(themeMode || 'system', { persist: false });
updateContextStatus();

const entries = [];
const listeners = new Set();
const emitUpdate = () => {
  const payload = { path: '(sandbox)', entries: [...entries] };
  for (const fn of listeners) { try { fn(payload); } catch {} }
  renderPrompts();
};

const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2));

function renderPrompts() {
  panelBody.textContent = '';
  const pending = new Map();
  for (const e of entries) {
    if (e?.type !== 'ui_prompt') continue;
    const id = String(e?.requestId || '');
    if (!id) continue;
    if (e.action === 'request') pending.set(id, e);
    if (e.action === 'response') pending.delete(id);
  }

  if (pending.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '暂无待办（request 后会出现在这里）';
    panelBody.appendChild(empty);
    return;
  }

  for (const [requestId, req] of pending.entries()) {
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('div');
    title.style.fontWeight = '800';
    title.textContent = req?.prompt?.title || '(untitled)';

    const msg = document.createElement('div');
    msg.className = 'muted';
    msg.style.marginTop = '6px';
    msg.textContent = req?.prompt?.message || '';

    const source = document.createElement('div');
    source.className = 'muted';
    source.style.marginTop = '6px';
    source.textContent = req?.prompt?.source ? String(req.prompt.source) : '';

    const form = document.createElement('div');
    form.style.marginTop = '10px';
    form.style.display = 'grid';
    form.style.gap = '10px';

    const kind = String(req?.prompt?.kind || '');

    const mkBtn = (label, danger) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn' + (danger ? ' danger' : '');
      btn.textContent = label;
      return btn;
    };

    const submit = async (response) => {
      entries.push({ ts: new Date().toISOString(), type: 'ui_prompt', action: 'response', requestId, response });
      emitUpdate();
    };

    if (kind === 'kv') {
      const fields = Array.isArray(req?.prompt?.fields) ? req.prompt.fields : [];
      const values = {};
      for (const f of fields) {
        const key = String(f?.key || '');
        if (!key) continue;
        const wrap = document.createElement('div');
        const lab = document.createElement('label');
        lab.textContent = f?.label ? String(f.label) : key;
        const input = document.createElement(f?.multiline ? 'textarea' : 'input');
        input.placeholder = f?.placeholder ? String(f.placeholder) : '';
        input.value = f?.default ? String(f.default) : '';
        input.addEventListener('input', () => { values[key] = String(input.value || ''); });
        values[key] = String(input.value || '');
        wrap.appendChild(lab);
        wrap.appendChild(input);
        form.appendChild(wrap);
      }
      const row = document.createElement('div');
      row.className = 'row';
      const ok = mkBtn('Submit');
      ok.addEventListener('click', () => submit({ status: 'ok', values }));
      const cancel = mkBtn('Cancel', true);
      cancel.addEventListener('click', () => submit({ status: 'cancel' }));
      row.appendChild(ok);
      row.appendChild(cancel);
      form.appendChild(row);
    } else if (kind === 'choice') {
      const options = Array.isArray(req?.prompt?.options) ? req.prompt.options : [];
      const multiple = Boolean(req?.prompt?.multiple);
      const selected = new Set();
      const wrap = document.createElement('div');
      const lab = document.createElement('label');
      lab.textContent = '选择';
      const select = document.createElement('select');
      if (multiple) select.multiple = true;
      for (const opt of options) {
        const v = String(opt?.value || '');
        const o = document.createElement('option');
        o.value = v;
        o.textContent = opt?.label ? String(opt.label) : v;
        select.appendChild(o);
      }
      select.addEventListener('change', () => {
        selected.clear();
        for (const o of select.selectedOptions) selected.add(String(o.value));
      });
      wrap.appendChild(lab);
      wrap.appendChild(select);
      form.appendChild(wrap);
      const row = document.createElement('div');
      row.className = 'row';
      const ok = mkBtn('Submit');
      ok.addEventListener('click', () => submit({ status: 'ok', value: multiple ? Array.from(selected) : Array.from(selected)[0] || '' }));
      const cancel = mkBtn('Cancel', true);
      cancel.addEventListener('click', () => submit({ status: 'cancel' }));
      row.appendChild(ok);
      row.appendChild(cancel);
      form.appendChild(row);
    } else {
      const row = document.createElement('div');
      row.className = 'row';
      const ok = mkBtn('OK');
      ok.addEventListener('click', () => submit({ status: 'ok' }));
      const cancel = mkBtn('Cancel', true);
      cancel.addEventListener('click', () => submit({ status: 'cancel' }));
      row.appendChild(ok);
      row.appendChild(cancel);
      form.appendChild(row);
    }

    card.appendChild(title);
    if (msg.textContent) card.appendChild(msg);
    if (source.textContent) card.appendChild(source);
    card.appendChild(form);
    panelBody.appendChild(card);
  }
}

const getTheme = () => currentTheme || resolveTheme();

const host = {
  bridge: { enabled: true },
  context: { get: () => ({ pluginId: __SANDBOX__.pluginId, appId: __SANDBOX__.appId, theme: getTheme(), bridge: { enabled: true } }) },
  theme: {
    get: getTheme,
    onChange: (listener) => {
      if (typeof listener !== 'function') return () => {};
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
  },
  admin: {
    state: async () => ({ ok: true, state: {} }),
    onUpdate: () => () => {},
    models: { list: async () => ({ ok: true, models: [] }) },
    secrets: { list: async () => ({ ok: true, secrets: [] }) },
  },
  registry: {
    list: async () => ({ ok: true, apps: [__SANDBOX__.registryApp] }),
  },
  backend: {
    invoke: async (method, params) => {
      const r = await fetch('/api/backend/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }),
      });
      const j = await r.json();
      if (j?.ok === false) throw new Error(j?.message || 'invoke failed');
      return j?.result;
    },
  },
  uiPrompts: {
    read: async () => ({ path: '(sandbox)', entries: [...entries] }),
    onUpdate: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    request: async (payload) => {
      const requestId = payload?.requestId ? String(payload.requestId) : uuid();
      const prompt = payload?.prompt && typeof payload.prompt === 'object' ? { ...payload.prompt } : null;
      if (prompt && !prompt.source) prompt.source = __SANDBOX__.pluginId + ':' + __SANDBOX__.appId;
      entries.push({ ts: new Date().toISOString(), type: 'ui_prompt', action: 'request', requestId, runId: payload?.runId, prompt });
      emitUpdate();
      return { ok: true, requestId };
    },
    respond: async (payload) => {
      const requestId = String(payload?.requestId || '');
      if (!requestId) throw new Error('requestId is required');
      const response = payload?.response && typeof payload.response === 'object' ? payload.response : null;
      entries.push({ ts: new Date().toISOString(), type: 'ui_prompt', action: 'response', requestId, runId: payload?.runId, response });
      emitUpdate();
      return { ok: true };
    },
    open: () => (setPanelOpen(true), { ok: true }),
    close: () => (setPanelOpen(false), { ok: true }),
    toggle: () => (setPanelOpen(panel.style.display !== 'flex'), { ok: true }),
  },
  ui: { navigate: (menu) => ({ ok: true, menu }) },
  chat: (() => {
    const clone = (v) => JSON.parse(JSON.stringify(v));

    const agents = [
      {
        id: 'sandbox-agent',
        name: 'Sandbox Agent',
        description: 'Mock agent for ChatOS UI Apps Sandbox',
      },
    ];

    const sessions = new Map();
    const defaultSessionByAgent = new Map();
    const messagesBySession = new Map();

    const listeners = new Set();
    const activeRuns = new Map(); // sessionId -> { aborted: boolean, timers: number[] }

    const emit = (payload) => {
      for (const sub of listeners) {
        const filter = sub?.filter && typeof sub.filter === 'object' ? sub.filter : {};
        if (filter?.sessionId && String(filter.sessionId) !== String(payload?.sessionId || '')) continue;
        if (Array.isArray(filter?.types) && filter.types.length > 0) {
          const t = String(payload?.type || '');
          if (!filter.types.includes(t)) continue;
        }
        try {
          sub.fn(payload);
        } catch {
          // ignore
        }
      }
    };

    const ensureAgent = async () => {
      if (agents.length > 0) return agents[0];
      const created = { id: 'sandbox-agent', name: 'Sandbox Agent', description: 'Mock agent' };
      agents.push(created);
      return created;
    };

    const ensureSession = async (agentId) => {
      const aid = String(agentId || '').trim() || (await ensureAgent()).id;
      const existingId = defaultSessionByAgent.get(aid);
      if (existingId && sessions.has(existingId)) return sessions.get(existingId);

      const id = 'sandbox-session-' + uuid();
      const session = { id, agentId: aid, createdAt: new Date().toISOString() };
      sessions.set(id, session);
      defaultSessionByAgent.set(aid, id);
      if (!messagesBySession.has(id)) messagesBySession.set(id, []);
      return session;
    };

    const agentsApi = {
      list: async () => ({ ok: true, agents: clone(agents) }),
      ensureDefault: async () => ({ ok: true, agent: clone(await ensureAgent()) }),
      create: async (payload) => {
        const agent = {
          id: 'sandbox-agent-' + uuid(),
          name: payload?.name ? String(payload.name) : 'Sandbox Agent',
          description: payload?.description ? String(payload.description) : '',
        };
        agents.unshift(agent);
        return { ok: true, agent: clone(agent) };
      },
      update: async (id, patch) => {
        const agentId = String(id || '').trim();
        if (!agentId) throw new Error('id is required');
        const idx = agents.findIndex((a) => a.id === agentId);
        if (idx < 0) throw new Error('agent not found');
        const a = agents[idx];
        if (patch?.name) a.name = String(patch.name);
        if (patch?.description) a.description = String(patch.description);
        return { ok: true, agent: clone(a) };
      },
      delete: async (id) => {
        const agentId = String(id || '').trim();
        if (!agentId) throw new Error('id is required');
        const idx = agents.findIndex((a) => a.id === agentId);
        if (idx < 0) return { ok: true, deleted: false };
        agents.splice(idx, 1);
        return { ok: true, deleted: true };
      },
      createForApp: async (payload) => {
        const name = payload?.name ? String(payload.name) : 'App Agent (' + __SANDBOX__.appId + ')';
        return await agentsApi.create({ ...payload, name });
      },
    };

    const sessionsApi = {
      list: async () => ({ ok: true, sessions: clone(Array.from(sessions.values())) }),
      ensureDefault: async (payload) => {
        const session = await ensureSession(payload?.agentId);
        return { ok: true, session: clone(session) };
      },
      create: async (payload) => {
        const agentId = payload?.agentId ? String(payload.agentId) : (await ensureAgent()).id;
        const id = 'sandbox-session-' + uuid();
        const session = { id, agentId, createdAt: new Date().toISOString() };
        sessions.set(id, session);
        if (!messagesBySession.has(id)) messagesBySession.set(id, []);
        return { ok: true, session: clone(session) };
      },
    };

    const messagesApi = {
      list: async (payload) => {
        const sessionId = String(payload?.sessionId || '').trim();
        if (!sessionId) throw new Error('sessionId is required');
        const msgs = messagesBySession.get(sessionId) || [];
        return { ok: true, messages: clone(msgs) };
      },
    };

    const abort = async (payload) => {
      const sessionId = String(payload?.sessionId || '').trim();
      if (!sessionId) throw new Error('sessionId is required');
      const run = activeRuns.get(sessionId);
      if (run) {
        run.aborted = true;
        for (const t of run.timers) {
          try {
            clearTimeout(t);
          } catch {
            // ignore
          }
        }
        activeRuns.delete(sessionId);
      }
      emit({ type: 'assistant_abort', sessionId, ts: new Date().toISOString() });
      return { ok: true };
    };

    const send = async (payload) => {
      const sessionId = String(payload?.sessionId || '').trim();
      const text = String(payload?.text || '').trim();
      if (!sessionId) throw new Error('sessionId is required');
      if (!text) throw new Error('text is required');

      if (!sessions.has(sessionId)) throw new Error('session not found');

      const msgs = messagesBySession.get(sessionId) || [];
      const userMsg = { id: 'msg-' + uuid(), role: 'user', text, ts: new Date().toISOString() };
      msgs.push(userMsg);
      messagesBySession.set(sessionId, msgs);
      emit({ type: 'user_message', sessionId, message: clone(userMsg) });

      const assistantMsg = { id: 'msg-' + uuid(), role: 'assistant', text: '', ts: new Date().toISOString() };
      msgs.push(assistantMsg);
      emit({ type: 'assistant_start', sessionId, message: clone(assistantMsg) });

      const out = '[sandbox] echo: ' + text;
      const chunks = [];
      for (let i = 0; i < out.length; i += 8) chunks.push(out.slice(i, i + 8));

      const run = { aborted: false, timers: [] };
      activeRuns.set(sessionId, run);

      chunks.forEach((delta, idx) => {
        const t = setTimeout(() => {
          if (run.aborted) return;
          assistantMsg.text += delta;
          emit({ type: 'assistant_delta', sessionId, delta });
          if (idx === chunks.length - 1) {
            activeRuns.delete(sessionId);
            emit({ type: 'assistant_end', sessionId, message: clone(assistantMsg) });
          }
        }, 80 + idx * 60);
        run.timers.push(t);
      });

      return { ok: true };
    };

    const events = {
      subscribe: (filter, fn) => {
        if (typeof fn !== 'function') throw new Error('listener is required');
        const sub = { filter: filter && typeof filter === 'object' ? { ...filter } : {}, fn };
        listeners.add(sub);
        return () => listeners.delete(sub);
      },
      unsubscribe: () => (listeners.clear(), { ok: true }),
    };

    return {
      agents: agentsApi,
      sessions: sessionsApi,
      messages: messagesApi,
      send,
      abort,
      events,
    };
  })(),
};

inspectorEnabled = true;
updateInspector();

let dispose = null;

async function loadAndMount() {
  if (typeof dispose === 'function') { try { await dispose(); } catch {} dispose = null; }
  container.textContent = '';

  const entryUrl = __SANDBOX__.entryUrl;
  const mod = await import(entryUrl + (entryUrl.includes('?') ? '&' : '?') + 't=' + Date.now());
  const mount = mod?.mount || mod?.default?.mount || (typeof mod?.default === 'function' ? mod.default : null);
  if (typeof mount !== 'function') throw new Error('module entry must export mount()');
  const ret = await mount({ container, host, slots: { header: headerSlot } });
  if (typeof ret === 'function') dispose = ret;
  else if (ret && typeof ret.dispose === 'function') dispose = () => ret.dispose();
}

const renderError = (e) => {
  const pre = document.createElement('pre');
  pre.style.padding = '12px';
  pre.style.whiteSpace = 'pre-wrap';
  pre.textContent = '[sandbox] ' + (e?.stack || e?.message || String(e));
  container.appendChild(pre);
};

const scheduleReload = (() => {
  let t = null;
  return () => {
    if (t) return;
    t = setTimeout(() => {
      t = null;
      loadAndMount().catch(renderError);
    }, 80);
  };
})();

try {
  const es = new EventSource('/events');
  es.addEventListener('reload', () => scheduleReload());
} catch {
  // ignore
}

$('#btnReload').addEventListener('click', () => loadAndMount().catch(renderError));

loadAndMount().catch(renderError);
`;
}

async function loadBackendFactory({ pluginDir, manifest }) {
  const entryRel = manifest?.backend?.entry ? String(manifest.backend.entry).trim() : '';
  if (!entryRel) return null;
  const abs = resolveInsideDir(pluginDir, entryRel);
  const fileUrl = url.pathToFileURL(abs).toString();
  const mod = await import(fileUrl + `?t=${Date.now()}`);
  if (typeof mod?.createUiAppsBackend !== 'function') {
    throw new Error('backend entry must export createUiAppsBackend(ctx)');
  }
  return mod.createUiAppsBackend;
}

export async function startSandboxServer({ pluginDir, port = 4399, appId = '' }) {
  const { manifest } = loadPluginManifest(pluginDir);
  const app = pickAppFromManifest(manifest, appId);
  const effectiveAppId = String(app?.id || '');
  const entryRel = String(app?.entry?.path || '').trim();
  if (!entryRel) throw new Error('apps[i].entry.path is required');

  const entryAbs = resolveInsideDir(pluginDir, entryRel);
  if (!isFile(entryAbs)) throw new Error(`module entry not found: ${entryRel}`);

  const entryUrl = `/plugin/${encodeURIComponent(entryRel).replaceAll('%2F', '/')}`;

  let backendInstance = null;
  let backendFactory = null;

  const ctxBase = {
    pluginId: String(manifest?.id || ''),
    pluginDir,
    stateDir: path.join(process.cwd(), '.chatos', 'state', 'chatos'),
    sessionRoot: process.cwd(),
    projectRoot: process.cwd(),
    dataDir: '',
    llm: {
      complete: async (payload) => {
        const input = typeof payload?.input === 'string' ? payload.input : '';
        const normalized = String(input || '').trim();
        if (!normalized) throw new Error('input is required');
        const modelName =
          typeof payload?.modelName === 'string' && payload.modelName.trim()
            ? payload.modelName.trim()
            : typeof payload?.modelId === 'string' && payload.modelId.trim()
              ? `model:${payload.modelId.trim()}`
              : 'sandbox';
        return {
          ok: true,
          model: modelName,
          content: `[sandbox llm] ${normalized}`,
        };
      },
    },
  };
  ctxBase.dataDir = path.join(process.cwd(), '.chatos', 'data', ctxBase.pluginId);
  ensureDir(ctxBase.stateDir);
  ensureDir(ctxBase.dataDir);

  const sseClients = new Set();
  const sseWrite = (res, event, data) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data ?? null)}\n\n`);
    } catch {
      // ignore
    }
  };
  const sseBroadcast = (event, data) => {
    for (const res of sseClients) {
      sseWrite(res, event, data);
    }
  };

  let changeSeq = 0;
  const stopWatch = startRecursiveWatcher(pluginDir, ({ eventType, filePath }) => {
    const rel = filePath ? path.relative(pluginDir, filePath).replaceAll('\\', '/') : '';
    const base = rel ? path.basename(rel) : '';
    if (!rel) return;
    if (base === '.DS_Store') return;
    if (base.endsWith('.map')) return;

    changeSeq += 1;
    if (rel.startsWith('backend/')) {
      backendInstance = null;
      backendFactory = null;
    }
    sseBroadcast('reload', { seq: changeSeq, eventType: eventType || '', path: rel });
  });

  const server = http.createServer(async (req, res) => {
    try {
      const parsed = url.parse(req.url || '/', true);
      const pathname = parsed.pathname || '/';

      if (req.method === 'GET' && pathname === '/') {
        return sendText(res, 200, htmlPage(), 'text/html; charset=utf-8');
      }

      if (req.method === 'GET' && pathname === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        sseClients.add(res);
        const ping = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {
            // ignore
          }
        }, 15000);
        req.on('close', () => {
          try {
            clearInterval(ping);
          } catch {
            // ignore
          }
          sseClients.delete(res);
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/sandbox.mjs') {
        const tokenNames = loadTokenNames();
        const js = sandboxClientJs()
          .replaceAll('__SANDBOX__.pluginId', JSON.stringify(ctxBase.pluginId))
          .replaceAll('__SANDBOX__.appId', JSON.stringify(effectiveAppId))
          .replaceAll('__SANDBOX__.entryUrl', JSON.stringify(entryUrl))
          .replaceAll('__SANDBOX__.registryApp', JSON.stringify({ plugin: { id: ctxBase.pluginId }, id: effectiveAppId, entry: { type: 'module', url: entryUrl } }))
          .replaceAll('__SANDBOX__.tokenNames', JSON.stringify(tokenNames));
        return sendText(res, 200, js, 'text/javascript; charset=utf-8');
      }

      if (req.method === 'GET' && pathname.startsWith('/plugin/')) {
        const rel = decodeURIComponent(pathname.slice('/plugin/'.length));
        const abs = resolveInsideDir(pluginDir, rel);
        if (!serveStaticFile(res, abs)) return sendText(res, 404, 'Not found');
        return;
      }

      if (req.method === 'GET' && pathname === '/api/manifest') {
        return sendJson(res, 200, { ok: true, manifest });
      }

      if (pathname === '/api/backend/invoke') {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: 'Method not allowed' });
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', async () => {
          try {
            const payload = body ? JSON.parse(body) : {};
            const method = typeof payload?.method === 'string' ? payload.method.trim() : '';
            if (!method) return sendJson(res, 400, { ok: false, message: 'method is required' });
            const params = payload?.params;

            if (!backendFactory) backendFactory = await loadBackendFactory({ pluginDir, manifest });
            if (!backendFactory) return sendJson(res, 200, { ok: false, message: 'backend not configured in plugin.json' });

            if (!backendInstance || typeof backendInstance !== 'object' || !backendInstance.methods) {
              backendInstance = await backendFactory({ ...ctxBase });
            }
            const fn = backendInstance?.methods?.[method];
            if (typeof fn !== 'function') return sendJson(res, 404, { ok: false, message: `method not found: ${method}` });
            const result = await fn(params, { ...ctxBase });
            return sendJson(res, 200, { ok: true, result });
          } catch (e) {
            return sendJson(res, 200, { ok: false, message: e?.message || String(e) });
          }
        });
        return;
      }

      sendText(res, 404, 'Not found');
    } catch (e) {
      sendJson(res, 500, { ok: false, message: e?.message || String(e) });
    }
  });
  server.once('close', () => stopWatch());

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  // eslint-disable-next-line no-console
  console.log(`Sandbox running:
  http://localhost:${port}/
pluginDir:
  ${pluginDir}
app:
  ${ctxBase.pluginId}:${effectiveAppId}
`);
}
