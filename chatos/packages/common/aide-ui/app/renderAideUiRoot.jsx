import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme as antdTheme } from 'antd';
import 'antd/dist/reset.css';

import { ErrorBoundary } from '../components/ErrorBoundary.jsx';
import { safeLocalStorageGet, safeLocalStorageSet, THEME_STORAGE_KEY } from '../lib/storage.js';

function resolveInitialTheme() {
  const stored = safeLocalStorageGet(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  try {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function renderAideUiRoot({ App, containerId = 'root' }) {
  if (typeof App !== 'function') {
    throw new Error('renderAideUiRoot: App is required');
  }

  const initialTheme = resolveInitialTheme();
  try {
    document.documentElement.dataset.theme = initialTheme;
  } catch {
    // ignore DOM errors
  }

  function RootApp() {
    const [themeMode, setThemeMode] = useState(initialTheme);

    useEffect(() => {
      safeLocalStorageSet(THEME_STORAGE_KEY, themeMode);
      try {
        document.documentElement.dataset.theme = themeMode;
      } catch {
        // ignore DOM errors
      }
    }, [themeMode]);

    const algorithm = useMemo(
      () => (themeMode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm),
      [themeMode]
    );

    return (
      <ConfigProvider theme={{ algorithm }}>
        <App themeMode={themeMode} onToggleTheme={() => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))} />
      </ConfigProvider>
    );
  }

  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Root container not found: #${containerId}`);
    return null;
  }

  try {
    const root = createRoot(container);
    root.render(
      <ErrorBoundary>
        <RootApp />
      </ErrorBoundary>
    );
    return root;
  } catch (err) {
    container.textContent = `UI load error: ${err?.message || String(err)}`;
    console.error(err);
    return null;
  }
}

