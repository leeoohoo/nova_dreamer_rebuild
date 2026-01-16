import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Layout, Spin } from 'antd';

import { GlobalStyles } from './components/GlobalStyles.jsx';
import { api, hasApi } from './lib/api.js';
import { AppContent } from './app/AppContent.jsx';
import { AppHeader } from './app/AppHeader.jsx';
import { createAdminActions } from './app/admin-actions.js';

const { Content } = Layout;

const EMPTY_ADMIN = {
  models: [],
  secrets: [],
  mcpServers: [],
  subagents: [],
  prompts: [],
  settings: [],
};

export default function App({ themeMode = 'light', onToggleTheme }) {
  const [menu, setMenu] = useState('cli');
  const [admin, setAdmin] = useState(EMPTY_ADMIN);
  const [uiFlags, setUiFlags] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(hasApi ? null : 'IPC bridge not available. Is preload loaded?');

  const developerMode = Boolean(uiFlags?.developerMode);
  const actions = useMemo(() => createAdminActions({ api, hasApi }), []);

  const refreshAdminState = async () => {
    if (!hasApi) return;
    try {
      const payload = await api.invoke('admin:state');
      const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
      setAdmin({ ...EMPTY_ADMIN, ...data });
      setUiFlags(payload?.uiFlags && typeof payload.uiFlags === 'object' ? payload.uiFlags : {});
      setError(null);
    } catch {
    }
  };

  const handleSetSubagentModel = async (payload) => {
    const result = await actions?.setSubagentModel?.(payload);
    await refreshAdminState();
    return result;
  };

  useEffect(() => {
    if (!hasApi) return undefined;
    let canceled = false;

    const load = async () => {
      setLoading(true);
      try {
        const payload = await api.invoke('admin:state');
        if (canceled) return;
        const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
        setAdmin({ ...EMPTY_ADMIN, ...data });
        setUiFlags(payload?.uiFlags && typeof payload.uiFlags === 'object' ? payload.uiFlags : {});
        setError(null);
      } catch (err) {
        if (canceled) return;
        setError(err?.message || 'Failed to load admin state');
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    void load();

    const unsub = api.on('admin:update', (payload) => {
      const data = payload?.data && typeof payload.data === 'object' ? payload.data : null;
      setAdmin((prev) => ({ ...prev, ...(data || {}) }));
      setUiFlags(payload?.uiFlags && typeof payload.uiFlags === 'object' ? payload.uiFlags : {});
    });

    return () => {
      canceled = true;
      try {
        unsub?.();
      } catch {
        // ignore
      }
    };
  }, []);

  if (!hasApi) {
    return <Alert type="error" message="IPC bridge not available. Is preload loaded?" />;
  }

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <GlobalStyles />

      <AppHeader
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
        menu={menu}
        onMenuChange={setMenu}
        developerMode={developerMode}
      />

      <Content style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {error ? (
            <div style={{ padding: 16 }}>
              <Alert type="error" message={error} showIcon />
            </div>
          ) : null}

          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            {loading ? (
              <div style={{ padding: 18 }}>
                <Spin />
              </div>
            ) : (
              <AppContent
                menu={menu}
                admin={admin}
                loading={loading}
                modelActions={actions?.modelActions}
                secretsActions={actions?.secretsActions}
                mcpActions={actions?.mcpActions}
                subagentActions={actions?.subagentActions}
                onSetSubagentModel={handleSetSubagentModel}
                promptActions={actions?.promptActions}
                onSaveSettings={actions?.saveSettings}
                developerMode={developerMode}
                onNavigate={setMenu}
              />
            )}
          </div>
        </div>

      </Content>
    </Layout>
  );
}
