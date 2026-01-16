import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Layout, Spin } from 'antd';

import { GlobalStyles } from './components/GlobalStyles.jsx';
import { ConfigSwitchFeedback } from './components/ConfigSwitchFeedback.jsx';
import { UiPromptsSmileHub } from './components/UiPromptsSmileHub.jsx';
import { api, hasApi } from './lib/api.js';
import { AppContent } from './app/AppContent.jsx';
import { AppHeader } from './app/AppHeader.jsx';
import { createAdminActions } from './app/admin-actions.js';
import { useConfigSwitch } from './hooks/useConfigSwitch.js';

const { Content } = Layout;

const EMPTY_ADMIN = {
  models: [],
  secrets: [],
  mcpServers: [],
  subagents: [],
  prompts: [],
  settings: [],
  landConfigs: [],
};
export default function App({ themeMode = 'light', onToggleTheme }) {
  const [menu, setMenu] = useState('chat/session');
  const [admin, setAdmin] = useState(EMPTY_ADMIN);
  const [uiFlags, setUiFlags] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(hasApi ? null : 'IPC bridge not available. Is preload loaded?');
  const autoRedirectRef = useRef(false);
  const configSwitch = useConfigSwitch();

  const developerMode = Boolean(uiFlags?.developerMode);
  const actions = useMemo(() => createAdminActions({ api, hasApi }), []);

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
        const nextUiFlags = payload?.uiFlags && typeof payload.uiFlags === 'object' ? payload.uiFlags : {};
        setUiFlags(nextUiFlags);
        if (!autoRedirectRef.current && nextUiFlags?.aideInstalled === false) {
          autoRedirectRef.current = true;
          setMenu('apps/home');
        }
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
      const nextUiFlags = payload?.uiFlags && typeof payload.uiFlags === 'object' ? payload.uiFlags : {};
      setUiFlags(nextUiFlags);
      if (!autoRedirectRef.current && nextUiFlags?.aideInstalled === false) {
        autoRedirectRef.current = true;
        setMenu('apps/home');
      }
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
    <Layout style={{ height: '100vh' }}>
      <GlobalStyles />

      <AppHeader
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
        menu={menu}
        onMenuChange={setMenu}
        developerMode={developerMode}
      />

      <Content style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {error ? (
          <div style={{ padding: 16 }}>
            <Alert type="error" message={error} showIcon />
          </div>
        ) : null}

        <div style={{ padding: '0 16px' }}>
          <ConfigSwitchFeedback
            isSwitching={configSwitch.isSwitching}
            currentConfig={configSwitch.currentConfig}
            lastError={configSwitch.lastError}
            onCloseError={configSwitch.clearError}
          />
        </div>

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
              onSetSubagentModel={actions?.setSubagentModel}
              promptActions={actions?.promptActions}
              onSaveSettings={actions?.saveSettings}
              developerMode={developerMode}
              onNavigate={setMenu}
            />
          )}
        </div>

        <UiPromptsSmileHub />
      </Content>
    </Layout>
  );
}
